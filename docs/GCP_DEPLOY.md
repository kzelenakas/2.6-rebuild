# Deploying the QC app to Google Cloud — step by step (no developer experience needed)

This walks you from "app runs on my PC" to "app runs on company GCP behind a login wall."
Budget guidance is included at each step. Expected steady cost: **$12–20/month**, well inside the $300 beta budget.

## Before you start — one-time setup (~30 minutes)

1. **Get the GCP project from IT.** Real appraisal reports contain GLBA-protected borrower
   data, so the project must be company-controlled (this was decided in the design spec).
   Ask IT for: a GCP project with billing enabled, and the `Owner` or `Editor` role on it
   for your Google account.
2. **Install the Google Cloud CLI.** Download from https://cloud.google.com/sdk/docs/install
   (Windows installer). Accept the defaults.
3. **Log in.** Open PowerShell and run:
   ```powershell
   gcloud auth login
   ```
   A browser window opens — sign in with your company Google account.

## Deploy (~15 minutes, mostly waiting)

From the project folder in PowerShell:

```powershell
.\infra\deploy-gcp.ps1 -ProjectId "YOUR-PROJECT-ID"
```

The script does everything: enables services, creates the Postgres database
(smallest tier), creates the file-retention bucket, builds the app in the cloud,
and deploys it to Cloud Run. **It prints a generated database password — save it
in your password manager.**

When it finishes it prints the service URL. The service is deliberately NOT
public (`--no-allow-unauthenticated`) — nobody can reach it until IAP is on.

## Turn on IAP (the login wall) — one time

IAP means only allowlisted company Google accounts can open the app. No passwords
to manage, no login code in the app.

1. Console → Security → Identity-Aware Proxy: https://console.cloud.google.com/security/iap?project=ai-qc-tf
   (the `?project=ai-qc-tf` in the URL matters — GCP shows whatever project you were
   last looking at otherwise, and that's exactly the mix-up that caused a rename this week)
2. If prompted, configure the OAuth consent screen (Internal, app name "UAD 3.6 QC").
3. Find the Cloud Run service **`ai-qc-tf`** in the list and toggle IAP **on**.
   (Session 4 renamed this service to match the project id exactly, specifically so
   step 3 here can never again be confused with the identically-named service that
   used to live in the real production project. If you ever see a service called
   `uad36-qc` in *this* project again, someone reverted the rename — check `handoff.md`.)
4. Click the service → "Add principal" → enter a coworker's email →
   role **IAP-secured Web App User**. Repeat per person (start with just yourself).

Open the service URL in your browser — you should get a Google sign-in, then the app.

## Turning on live AI rules (optional, after the basics work)

The app deploys with AI rules OFF (`QC_AI_BACKEND=stub`). To turn on Vertex AI
(the only AI path allowed for real reports — see GLBA note below):

```powershell
gcloud run services update ai-qc-tf --project ai-qc-tf --region us-central1 `
  --set-env-vars "QC_AI_BACKEND=vertex,QC_VERTEX_PROJECT=ai-qc-tf,QC_DATA_CLASS=real"
gcloud services enable aiplatform.googleapis.com --project ai-qc-tf
```

**GLBA guardrail (built into the app):** if anyone sets `QC_AI_BACKEND=gemini`
(the developer-key backend) while `QC_DATA_CLASS=real`, the app refuses to start.
The developer key is for local testing on the GSE sample files only.

## Budget guardrails

1. Console → Billing → Budgets & alerts → Create budget → $25/month with alerts
   at 50/90/100%.
2. Expected costs: Cloud SQL db-f1-micro ~$9–12/mo, Cloud Run ~$0–3/mo (scales to
   zero when idle), storage pennies, Vertex AI cents per analyzed report.

## Updating the app later

Any time the code changes, redeploy with one command — **always use the deploy
script, not a raw `gcloud run deploy`**, because the script also re-checks you're
actually pointed at `ai-qc-tf` and not the real production project:

```powershell
.\infra\deploy-gcp.ps1 -ProjectId ai-qc-tf -Service ai-qc-tf
```

(The `-Service ai-qc-tf` matters — the script's own built-in default is still the
old name `uad36-qc`. Leaving it off recreates the exact confusion this was fixed for.)

Everything in the database (runs, findings, reviewer actions, rules) survives
redeploys — it lives in Cloud SQL, not the container.

## Managing access day-to-day (IAM/IAP, plain language)

Two separate locks sit in front of this app, and both need to be understood or you'll
misdiagnose every access problem:

1. **Cloud Run's own lock** — every service here is deployed `--no-allow-unauthenticated`,
   meaning Cloud Run itself refuses any request that doesn't carry a valid Google identity
   with permission to invoke it. This exists even if IAP is never touched.
2. **IAP (Identity-Aware Proxy)** — sits in front of #1 and is what makes it convenient:
   once IAP is on for a service and someone's allowlisted, they get an ordinary Google
   sign-in page instead of needing to manually carry an identity token around.

**A 403 Forbidden with no sign-in page means IAP isn't configured yet** (or isn't
configured for *that specific service* — it doesn't carry over automatically when a
service is renamed or recreated, which is exactly what happened this session). A
sign-in page that then rejects the account means IAP is on, but that person isn't
allowlisted.

### Grant someone access (do this after IAP is on, per the section above)
Console path: Security → Identity-Aware Proxy → find the service → checkbox next to
it → "Add Principal" (right panel) → their email → role **IAP-secured Web App User**.

Command-line equivalent:
```powershell
gcloud run services add-iam-policy-binding ai-qc-tf --project ai-qc-tf --region us-central1 `
  --member="user:their.email@truefootage.tech" --role="roles/iap.httpsResourceAccessor"
```

### Check who currently has access
```powershell
gcloud run services get-iam-policy ai-qc-tf --project ai-qc-tf --region us-central1
```
Look for `role: roles/iap.httpsResourceAccessor` entries — each `member:` line under
it is someone who can get in.

### Revoke someone's access
Same Console path as granting, but click the trash icon next to their name. Or:
```powershell
gcloud run services remove-iam-policy-binding ai-qc-tf --project ai-qc-tf --region us-central1 `
  --member="user:their.email@truefootage.tech" --role="roles/iap.httpsResourceAccessor"
```

### "Which project am I actually looking at?" — the #1 source of mistakes here
GCP shows you a project switcher at the top of every Console page, and it silently
remembers the last one you picked across unrelated tasks. Before touching *anything*
in the Console (IAM, IAP, billing, deleting a service), check that dropdown reads
**`ai-qc-tf`** — not `uad36-qc-beta` (Kevin's real production project, billed to
`kevin.zelenakas@truefootage.tech`, must never be touched by this repo's work without
saying so explicitly). Same rule on the command line: every command in this doc
carries an explicit `--project ai-qc-tf` for exactly this reason — never rely on
`gcloud config set project` having "stuck" from an earlier session.

### Troubleshooting checklist for "I can't reach the app"
1. Confirm the URL — should be `https://ai-qc-tf-6uwksqbsiq-uc.a.run.app` (or the
   longer `https://ai-qc-tf-989432110587.us-central1.run.app` form). Any URL still
   starting `uad36-qc-` is a dead, deleted service.
2. Is IAP even turned on for `ai-qc-tf` yet? (Security → Identity-Aware Proxy Console
   page, toggle next to the service.)
3. Is your account in the allowlist? (`get-iam-policy` command above.)
4. Still stuck — check `gcloud run services describe ai-qc-tf --project ai-qc-tf --region us-central1`
   is serving traffic at all (`status.conditions` should show `Ready: True`).

## Loading a new schema or rule set (no redeploy of code)

- **New rule set:** Admin mode → Import rules (JSON file). Every change freezes a
  new ruleset version automatically; old runs keep pointing at the version they ran under.
- **New UAD schema version (e.g. v1.4 XSD):** put the new XSD folder in the image
  (or a mounted volume) and set `QC_XSD_PATH` to it, plus a regenerated field
  manifest via `QC_MANIFEST_PATH`. See docs/INTEGRATION.md for the full procedure.
