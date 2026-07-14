# One-time-ish deploy script for the UAD 3.6 QC beta on GCP Cloud Run.
# Prereqs: gcloud CLI installed and logged in (gcloud auth login),
#          a GCP project with billing enabled.
# Usage:   .\infra\deploy-gcp.ps1 -ProjectId "your-project-id"

param(
    [Parameter(Mandatory = $true)][string]$ProjectId,
    [string]$Region = "us-central1",
    [string]$Service = "uad36-qc",
    [string]$DbInstance = "uad36-qc-db",
    [string]$DbPasswordSecret = "uad36-qc-db-password",
    [string]$GoogleMapsSecret = "uad36-qc-google-maps-api-key",
    [string]$GeminiSecret = "uad36-qc-gemini-api-key",
    [string]$ProxySecret = "uad36-qc-proxy-secret"
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

Write-Host "==> Setting project" -ForegroundColor Cyan
gcloud config set project $ProjectId

Write-Host "==> Enabling required services (one-time, ~2 min)" -ForegroundColor Cyan
gcloud services enable run.googleapis.com cloudbuild.googleapis.com `
    artifactregistry.googleapis.com sqladmin.googleapis.com iap.googleapis.com secretmanager.googleapis.com
if ($LASTEXITCODE -ne 0) { Write-Host "FAILED enabling services." -ForegroundColor Red; exit 1 }

Write-Host "==> Ensuring DB password exists in Secret Manager (source of truth, never regenerated blank)." -ForegroundColor Cyan
$secretExists = gcloud secrets describe $DbPasswordSecret --format="value(name)" 2>$null
$dbJustCreated = $false
if (-not $secretExists) {
    $newPassword = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
    $newPassword | gcloud secrets create $DbPasswordSecret --data-file=- --replication-policy=automatic
    if ($LASTEXITCODE -ne 0) { Write-Host "FAILED creating DB password secret." -ForegroundColor Red; exit 1 }
    $dbJustCreated = $true
}
$DbPassword = gcloud secrets versions access latest --secret=$DbPasswordSecret
if (-not $DbPassword) { Write-Host "FAILED reading DB password from Secret Manager." -ForegroundColor Red; exit 1 }

Write-Host "==> Creating Cloud SQL Postgres (smallest tier, ~`$10/mo). Skips if it exists." -ForegroundColor Cyan
$exists = gcloud sql instances list --filter="name=$DbInstance" --format="value(name)"
if (-not $exists) {
    gcloud sql instances create $DbInstance --database-version=POSTGRES_16 `
        --tier=db-f1-micro --region=$Region --storage-size=10
    if ($LASTEXITCODE -ne 0) { Write-Host "FAILED creating Cloud SQL instance." -ForegroundColor Red; exit 1 }
    gcloud sql users set-password postgres --instance=$DbInstance --password=$DbPassword
    gcloud sql databases create qc --instance=$DbInstance
} elseif ($dbJustCreated) {
    # Secret was just created but instance already existed — sync the instance to match the new secret.
    gcloud sql users set-password postgres --instance=$DbInstance --password=$DbPassword
}

Write-Host "==> Creating GCS bucket for retained report files + persistent app data. Skips if it exists." -ForegroundColor Cyan
$bucket = "$ProjectId-uad36-qc-files"
if (-not (gcloud storage buckets list --filter="name=$bucket" --format="value(name)")) {
    gcloud storage buckets create "gs://$bucket" --location=$Region --uniform-bucket-level-access
}

Write-Host "==> Granting Cloud Run runtime SA access to the DB password secret" -ForegroundColor Cyan
$projectNumber = gcloud projects describe $ProjectId --format="value(projectNumber)"
$runtimeSa = "$projectNumber-compute@developer.gserviceaccount.com"
gcloud secrets add-iam-policy-binding $DbPasswordSecret `
    --member="serviceAccount:$runtimeSa" --role="roles/secretmanager.secretAccessor" --condition=None | Out-Null

Write-Host "==> Ensuring the proxy shared secret exists (source of truth, never regenerated once set)." -ForegroundColor Cyan
# QC_PROXY_SECRET is what proves an incoming request actually came from the
# trusted proxy (Bubble) rather than a caller spoofing an X-QC-User-Email
# header. Without it every request is treated as an anonymous guest -- auto-
# generate one here so the service never runs without this closed by default.
$proxySecretExists = gcloud secrets describe $ProxySecret --format="value(name)" 2>$null
if (-not $proxySecretExists) {
    $newProxySecret = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 40 | ForEach-Object { [char]$_ })
    $newProxySecret | gcloud secrets create $ProxySecret --data-file=- --replication-policy=automatic
    if ($LASTEXITCODE -ne 0) { Write-Host "FAILED creating proxy secret." -ForegroundColor Red; exit 1 }
    Write-Host "==> Created '$ProxySecret'. The Bubble proxy must send this exact value as the" -ForegroundColor Yellow
    Write-Host "    X-QC-Proxy-Secret header on every request, or all callers stay anonymous." -ForegroundColor Yellow
    Write-Host "    Retrieve it with: gcloud secrets versions access latest --secret=$ProxySecret" -ForegroundColor Yellow
}
gcloud secrets add-iam-policy-binding $ProxySecret `
    --member="serviceAccount:$runtimeSa" --role="roles/secretmanager.secretAccessor" --condition=None | Out-Null

# Google Maps / Gemini keys are external credentials (Maps Platform / AI Studio),
# not something this script can generate like the DB password -- create them
# yourself first: gcloud secrets create uad36-qc-google-maps-api-key --data-file=-
# (paste the key, Ctrl+Z/Ctrl+D to end) and same for uad36-qc-gemini-api-key.
# Collateral-risk POI/geo rules and Gemini-backed AI suggestions silently run
# key-less (empty string) until these exist -- no crash, just reduced findings.
$secretRefs = @("QC_PROXY_SECRET=$($ProxySecret):latest")
foreach ($pair in @(@{Name = $GoogleMapsSecret; EnvVar = "GOOGLE_MAPS_API_KEY" }, @{Name = $GeminiSecret; EnvVar = "GEMINI_API_KEY" })) {
    $exists = gcloud secrets describe $pair.Name --format="value(name)" 2>$null
    if ($exists) {
        gcloud secrets add-iam-policy-binding $pair.Name `
            --member="serviceAccount:$runtimeSa" --role="roles/secretmanager.secretAccessor" --condition=None | Out-Null
        $secretRefs += "$($pair.EnvVar)=$($pair.Name):latest"
    } else {
        Write-Host "==> Secret '$($pair.Name)' not found -- skipping $($pair.EnvVar), rules needing it stay key-less." -ForegroundColor Yellow
    }
}

Write-Host "==> Building container with Cloud Build and deploying to Cloud Run" -ForegroundColor Cyan
$conn = "${ProjectId}:${Region}:${DbInstance}"
# --update-env-vars only touches the keys listed here — it will never wipe out
# unrelated env vars set by a previous deploy or manually in the console.
# QC_DATA_DIR points at the same persistent GCS volume as QC_FILES_DIR so rules/
# profiles/runs/users survive redeploys and scale-to-zero instead of living on
# the container's ephemeral local disk.
# Both Python rule engines run by default (unset = enabled). To opt out without a
# redeploy: gcloud run services update SERVICE --update-env-vars QC_DISABLE_SUPPLEMENTAL=1
# or QC_DISABLE_COLLATERAL_RISK=1.
$deployArgs = @(
    "run", "deploy", $Service,
    "--source", ".",
    "--region", $Region,
    "--no-allow-unauthenticated",
    "--add-cloudsql-instances", $conn,
    "--add-volume", "name=files,type=cloud-storage,bucket=$bucket",
    "--add-volume-mount", "volume=files,mount-path=/data/files",
    "--update-env-vars", "QC_DB_URL=postgresql+psycopg://postgres:$DbPassword@/qc?host=/cloudsql/$conn,QC_DATA_CLASS=real,QC_AI_BACKEND=stub,QC_FILES_DIR=/data/files,QC_DATA_DIR=/data/files/appdata",
    "--memory", "1Gi", "--cpu", "1", "--min-instances", "0", "--max-instances", "2"
)
if ($secretRefs.Count -gt 0) {
    $deployArgs += @("--set-secrets", ($secretRefs -join ","))
}
gcloud @deployArgs

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "DEPLOY FAILED. Check the build logs above / Cloud Build history before assuming anything shipped." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Deployed. NEXT STEPS (manual, see docs/GCP_DEPLOY.md):" -ForegroundColor Green
Write-Host " 1. Turn on IAP for this Cloud Run service and allowlist company Google accounts."
Write-Host " 2. Vertex AI rules: redeploy with QC_AI_BACKEND=vertex and QC_VERTEX_PROJECT=$ProjectId."
Write-Host " 3. Set a budget alert at `$25/month in Billing > Budgets."
