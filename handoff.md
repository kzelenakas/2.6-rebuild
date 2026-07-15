# qc-rebuild — Handoff

**Last updated:** 2026-07-14 (session 3, part 2)
**Read this first.** A zero-context session should be able to resume from this file alone.

## What this is

Hardening pass on `remix-uad36-qc-LIVE` (already deployed, GitHub: `kzelenakas/remix-uad36-qc-LIVE`) — evolving the same Express + Vite/React stack in place, not a framework rewrite. This folder is a clone of that repo (`git clone`d at HEAD `d0f97c5`) plus patches, kept separate so everything is reviewable as a diff before merging back or deploying.

Full context: a senior-eng audit + rebuild plan and a build directive were written in session 1 —
`C:\Users\kzele\AppData\Local\Temp\claude\C--Users-kzele--claude\4d1fedc0-3b6b-462f-9dde-18ad9191d664\scratchpad괶-qc-BUILD-DIRECTIVE.md` (also published as an artifact — ask if the link is needed). **That directive is the authority on decisions already made** (keep the stack, fix rules dual-source-of-truth lightly rather than migrate to Postgres/Drizzle, port Python engines optionally, etc.) — read it before re-deciding anything it already covers.

## A related, more mature project exists — don't confuse the two

`Claude Cowork/Projects/uad36-qc-greenfield/uad36-qc-greenfield/` is a **separate**, further-along Python/Tornado rebuild of the same domain problem (757/757 rules encoded, 495 tests, Terraform IaC, GATE-2-audited-ready). Kevin chose this track (`qc-rebuild`) instead because he didn't want the Terraform-apply-it-yourself workflow GATE 2 required. Not a reason to merge the two; they're independent efforts on the same problem.

## Deploy targets — THREE separate things, do not confuse them

1. **`uad36-qc-beta`** (GCP project) — the original live production deployment of `remix-uad36-qc-LIVE`. Service `uad36-qc`, region `us-central1`, URL `https://uad36-qc-620834509337.us-central1.run.app`, billed under `kevin.zelenakas@truefootage.tech`. **Do not deploy `qc-rebuild` here without explicit instruction.** Kevin works in this project directly/separately from this repo's work.
2. **`ai-qc-tf`** (GCP project) — the deploy target for *this* repo (`qc-rebuild`), chosen specifically to sandbox this work away from `uad36-qc-beta`. Service `uad36-qc`, region `us-central1`, live at `https://uad36-qc-6uwksqbsiq-uc.a.run.app` (also `https://uad36-qc-989432110587.us-central1.run.app`). Deploy via `infra/deploy-gcp.ps1 -ProjectId ai-qc-tf`.
3. **Local dev** — `npm run dev` (root, runs `tsx server.ts` which serves Express + Vite middleware on one port) or set `PORT=3999` manually. Do NOT use `preview_start` with the `qc-rebuild-frontend` launch.json config alone — it's Vite-only, no backend, `/api/*` calls will 502. Run the real integrated server instead.

### Incident this session: the deploy script sent a prod DB password change to `uad36-qc-beta` by accident

`infra/deploy-gcp.ps1` used to rely on `gcloud config set project $ProjectId` once at the top and never pass `--project` on individual calls. Mid-script, the ambient project silently reverted to `uad36-qc-beta` (root cause not fully nailed down — different `gcloud` command families appear to resolve ambient project inconsistently within one script run) and, because both projects default to the same resource names (`uad36-qc-db` instance, `uad36-qc` service), several calls landed on real `uad36-qc-beta` resources instead of erroring out:
- `gcloud sql users set-password postgres` rotated the **live production** Cloud SQL password to a value that didn't match `uad36-qc-beta`'s own Secret Manager secret. **Restored** (read the correct value from `uad36-qc-beta`'s own `uad36-qc-db-password` secret, wrote it back). Live app confirmed responding afterward (IAP 302 redirect, normal).
- A stray `uad36-qc-proxy-secret` and a stray GCS bucket (`ai-qc-tf-uad36-qc-files`) got created in `uad36-qc-beta`. Both deleted.
- A failed, non-serving Cloud Run revision (`uad36-qc-00015-8cw`) got created in `uad36-qc-beta`. Cloud Run won't let you delete a service's "latest created revision" directly even when not serving — left in place, self-resolves on `uad36-qc-beta`'s next real deploy. Harmless, never got traffic.

**Fix applied:** `infra/deploy-gcp.ps1` now passes `--project=$ProjectId` explicitly on every single `gcloud` call, no exceptions, plus a startup check (`gcloud projects describe $ProjectId` must resolve to itself or the script aborts) and a post-deploy check (`gcloud run services describe` must confirm the service exists in the target project or the script fails loudly). Rerun against `ai-qc-tf` twice since with this fix — both times confirmed clean, zero `uad36-qc-beta` calls in either log. **Should be safe now, but if you ever see `uad36-qc-beta` mentioned in this script's output again, stop immediately and check for damage the same way this session did** (`gcloud sql operations list --instance=uad36-qc-db --project=uad36-qc-beta`, `gcloud run revisions list --service=uad36-qc --project=uad36-qc-beta`).

## Status: two feature sets landed and committed, `ai-qc-tf` is live

Commits this session, in order: `685dcba` (PDF preview + revision compare), `eaf445b` (auth: close identity-spoofing + missing authorization on run PII), `217659f` (auth: restore IAP-direct-login as trusted identity path), `c847d15` (version footer). All committed to `main` locally, **not pushed to GitHub**.

### Feature: real PDF preview + revision compare (session 1, deployed to `ai-qc-tf` but not smoke-tested end to end there yet)
- `frontend/src/components/ReportPreviewPane.tsx` — renders the *actual* uploaded report PDF (`react-pdf`/`pdfjs-dist`), severity-colored overlay boxes on rule-triggered fields, two-way linked to the finding list. Replaced the old `PDFPreview.tsx` (fake hardcoded data) in `App.tsx`. Old component still in tree, unused, not deleted.
- `frontend/src/components/RevisionCompareView.tsx` — reviewer's v1-vs-v2 compare, scroll-locked by scroll fraction (`scrollSync.ts`/`useScrollLock.ts`, has a passing Vitest test). Poppable to a separate OS window.
- `server.ts` — `GET /api/runs/:runId/file?version=original|revised` serves the real PDF from the retained upload.
- Known gap: `frontend/src/data/fieldLocations.ts` has only ~8 stub field→page/bbox entries. Needs real Form 1004/UAD template coordinates — content work, not engineering.

### Feature: auth hardening (session 2 — triggered by a fable-advisor consult that found a live GLBA exposure)
Root cause found: `getActiveUser()` in `server.ts` trusted a raw `x-qc-user-email` header if it matched a known user in `users.json`, granting that user's real role — including admin — with **zero verification**. Only the fallback path for *unmatched* emails checked `QC_PROXY_SECRET`. Separately, several run-scoped routes (`GET /api/runs/:runId`, `GET /api/runs/:runId/file` — the report PDF route — plus findings/check, revision upload, reviewer-requests, export) had **no authorization check at all**, and the runs-list self-filter was bypassable via query params.

Fixed:
- No identity header honored — DB-matched or not — without a valid `x-qc-proxy-secret`. Falls back to a real GCP-IAP-authenticated identity (`getIapEmail()`, ported from the already-fixed live `remix-uad36-qc-LIVE` repo) when no secret is present, so direct IAP login still works. Only when neither is present does it fall to guest/lowest-privilege.
- Added `canAccessRun()` (admin/reviewer always; appraiser only on runs attributed to them) and applied it to every previously-ungated run-scoped route.
- Runs-list query-param filter bypass closed (appraiser role can no longer widen their own view via query string).
- `infra/deploy-gcp.ps1` auto-generates and wires `QC_PROXY_SECRET` through Secret Manager on deploy now (same pattern as the DB password), so a fresh deploy is closed by default.
- Seeded `kevin.zelenakas@truefootage.tech` as a default admin in `src/server/db.ts`'s first-boot seed so a fresh deploy doesn't lock out IAP-direct access.

**Not verified end-to-end with real run data** — only verified via direct `curl` against a locally-running server (spoofed headers correctly fall back to guest without the secret; correct secret grants the requested role). Never tested the ownership checks (`canAccessRun`) against an actual run record — no XML/PDF fixture existed to create one through the real parse pipeline. **This is the highest-value next debugging step**: create a real run (upload a report through the UI) as one identity, then confirm a different appraiser identity gets 403 on `GET /api/runs/:runId` and `GET /api/runs/:runId/file`, and that admin/reviewer can still see everything.

### Feature: version footer
`/api/meta` now returns `commit` (`GIT_COMMIT` env, short git hash) and `environment` (`GCP_PROJECT` env), both set by `deploy-gcp.ps1` at deploy time. Footer shows `<project> · <commit> · ruleset <version>` at the bottom of every screen. Verified locally and on `ai-qc-tf` (revision `uad36-qc-00003-7xq`).

## `ai-qc-tf` current state

- Deployed, revision `uad36-qc-00003-7xq`, serving 100% traffic, includes all commits through `c847d15`.
- `QC_PROXY_SECRET` auto-generated and wired (`gcloud secrets versions access latest --secret=uad36-qc-proxy-secret --project=ai-qc-tf` to retrieve — needed for Bubble proxy config, not done yet).
- Google Maps + Gemini API keys copied over from `uad36-qc-beta`'s existing secrets (`google-maps-api-key`, `gemini-api-key` — note the *different naming convention* there, no `uad36-qc-` prefix) and wired in.
- Budget alert set: $25/mo, scoped to `ai-qc-tf` only, 50/90/100% thresholds.
- IAP enabled on the Cloud Run service (native `--iap` flag, not the deprecated OAuth-brand flow — that's fully retired as of March 2026). **Nobody is allowlisted yet.** Kevin has the one-liner to grant himself access (`gcloud projects add-iam-policy-binding ai-qc-tf --member="user:kevin.zelenakas@truefootage.tech" --role="roles/iap.httpsResourceAccessor" --condition=None`) — unclear if he's run it yet, check before assuming IAP login works.
- Empty state: no runs, no migrated data from `uad36-qc-beta`. First real test needs a report uploaded through the full flow.
- Not yet configured: Bubble proxy pointing at this service at all (no proxy exists for `ai-qc-tf` yet, only `uad36-qc-beta` presumably has one) — so realistically the only way in right now is direct IAP-authenticated browser access or `gcloud run services proxy uad36-qc --region us-central1 --project ai-qc-tf` (local tunnel, bypasses IAP, lands as guest/appraiser).

## Session 3 (2026-07-14): 413 fix, rules dual-source-of-truth, field-link bug — none of this is committed yet

All changes below are sitting **uncommitted** in the working tree (per this repo's whole point: reviewable as a diff before anything merges). Run `git status`/`git diff` before committing.

### Fixed: 413 on large ZIP uploads
Root cause: Cloud Run enforces a hard, non-configurable ~32MB request-body ceiling — no Express/multer setting can raise it, and UAD zip bundles (XML + PDF + photos) commonly exceed it. This was never reachable from local testing (Express/multer had no size limit either way), which is why it only showed up against `ai-qc-tf`.

Fix: added a direct-to-GCS signed-URL upload path that bypasses Cloud Run for large files entirely.
- `src/server/uploads.ts` (new) — `createSignedUploadUrl`/`downloadUploadedObject`/`deleteUploadedObject`, gated on `QC_UPLOAD_BUCKET` env var.
- `server.ts` — new `POST /api/uploads/init` route (404s if `QC_UPLOAD_BUCKET` unset); `/api/runs` and `/api/runs/:runId/revision` now accept either the existing multipart body or a JSON `{objectPath, filename}` naming an object already uploaded via the signed URL; explicit multer `fileSize` limit (500MB) with a clean 413 JSON response instead of an unhandled crash.
- `frontend/src/api.ts` — `uploadReport`/`uploadRevision` try the signed-URL path for files ≥20MB, falling back to the old direct multipart upload if `/api/uploads/init` isn't configured (local dev) or fails.
- `.env.example` — documents `QC_UPLOAD_BUCKET`.
- Verified locally: direct multipart upload (both `.xml` and `.zip`) still works end-to-end against the real integrated server; `/api/uploads/init` correctly 404s with `QC_UPLOAD_BUCKET` unset.

**Not verified**: the signed-URL path itself — needs `QC_UPLOAD_BUCKET` set and two IAM grants on the Cloud Run runtime SA that are **not yet applied and not yet in `deploy-gcp.ps1`** (a permission-classifier gate blocked writing IAM-grant commands into the script even just as authored code, not executed — treated as an access-control change). Kevin needs to either run these himself or explicitly ask for the script edit again:
```
gcloud storage buckets add-iam-policy-binding gs://ai-qc-tf-uad36-qc-files --project=ai-qc-tf --member="serviceAccount:989432110587-compute@developer.gserviceaccount.com" --role="roles/storage.objectAdmin" --condition=None
gcloud iam service-accounts add-iam-policy-binding 989432110587-compute@developer.gserviceaccount.com --project=ai-qc-tf --member="serviceAccount:989432110587-compute@developer.gserviceaccount.com" --role="roles/iam.serviceAccountTokenCreator" --condition=None
```
Then add `QC_UPLOAD_BUCKET=ai-qc-tf-uad36-qc-files` to the `--update-env-vars` list in `infra/deploy-gcp.ps1` (not yet added — same block reason) and redeploy. Until then, large uploads against `ai-qc-tf` will still 413.

### Fixed: rules dual-source-of-truth
`data/rules.json` and `data/archives/*` were tracked in git even though `src/server/db.ts` already boot-seeds `DATA_DIR` only when empty (that logic was already correct). Untracked both from git and added `data/{rules,runs,profiles,users}.json` + `data/archives/` + `data/files/` to `.gitignore`. `rules/h1_rules.json` and `rules/seed_rules.json` (the actual seed sources) stay tracked, untouched.

### Found and partially fixed: the field-highlight overlay was completely non-functional
`frontend/src/data/fieldLocations.ts` keyed its 9 stub entries by short human names ("Address", "City", ...). `Finding.field_path` (what `ReportPreviewPane.tsx` actually looks up) is always the long MISMO XPath key from `schemas/uad36_field_manifest.json` (e.g. `doc:MESSAGE/.../ExecutionDate`) — so the overlay never fired for any real finding, coordinates aside.

Fixed the key format; **did not fabricate coordinates**. There is no source in this repo to derive real bbox positions from: `GSE_UAD_3.6.0_v1.3_schema/Appendix E-1 URAR with Codes.pdf` (the only PDF in the repo) turns out to be a field-code style-guide document (confirmed via `pdfjs` text extraction — it's a spec/cover-page document, not a rendered form), not the physical URAR/Form 1004 page layout — and that layout isn't one universal thing anyway, it depends on which appraisal software (ACI/Total/ClickForms) rendered the PDF. Building this map for real needs an actual sample report PDF, which still doesn't exist anywhere in this repo (confirmed again).

Left `FIELD_LOCATIONS = {}` with a header comment explaining this, and added `scripts/extract-pdf-text.mjs` (pdfjs-based) as a reusable tool: once a real sample report PDF exists, it dumps every text item's page + bbox for matching against manifest `label`s to backfill this map — flagged in the comment that automated label-matching will need hand-verification (repeated labels across comp columns, etc.).

### Not done
- `frontend/src/components/PDFPreview.tsx` (dead, unused) — still not deleted; the safety classifier blocked removing a file the user hadn't explicitly named, even via `git rm`. Ask explicitly if you want it gone.
- IAM grants + `deploy-gcp.ps1` env-var wiring for the signed-URL upload path (see above) — needs either Kevin running the two commands or explicitly re-asking for the script edit.
- Everything below this section, still unstarted from session 2.

## Session 3 part 2 (2026-07-14): real sample data closes the engine's biggest untested gaps — and finds a process-crashing bug

Kevin supplied the official GSE UAD 3.6 sample packages (SF1, SF3, Condo2 — xml+pdf+zip each, real rendered forms + photos, no NPI) plus the correct Combined XSD schema. Added as `fixtures/uad-samples/{SF1,SF3,Condo2}_Appraisal/`. This let real end-to-end testing happen for the first time ever in this project's history — and surfaced a critical bug.

### Critical fix: the whole server could crash on any real report upload
`parseAndNormalizeXML` was silently failing on every real UAD XML (an `@xmldom/xmldom` 0.9 API break — `errorHandler: {error, fatalError}` was replaced by a single `onError(level, msg)` callback; the old option is now ignored, so parsing quietly "succeeded" with no document and every run reported `parse_failed: true`). Fixed in `src/server/parser.ts`. Once fixed, real uploads reached `evaluateReport` for the first time — which hit a second, much worse bug: `runPythonSupplementalRules`/`runPythonCollateralRisk` in `src/server/engine.ts` spawn a Python subprocess and write to its stdin; on a failed spawn (wrong `QC_PYTHON_BIN`, missing interpreter, etc.) the error surfaces on the **stdin pipe itself**, not the `ChildProcess` object — and only the latter had an `.on("error")` handler. An unhandled error event on the stdin socket crashes the entire Node process, not just that request. **This means, until this session, any real report upload could take down the whole QC service for every concurrent user.** Fixed by adding the missing `pythonProcess.stdin.on("error", ...)` handler in both functions. Also pinned the four previously-`"latest"` dependencies (`@xmldom/xmldom`, `@google/genai`, `adm-zip`, `multer`) to their currently-installed versions, per the build directive's Phase 07 item — the xmldom break is exactly the failure mode that item was meant to prevent.

### Fixed: qc-rebuild's own copy of the Combined XSD was corrupted (0 bytes)
`GSE_UAD_3.6.0_v1.3_schema/Combined/GSE_UAD_3.6.0_v1.3.xsd` was an empty file (vs. 1.76MB at the source Kevin pointed to, `Claude Cowork/Projects/Rules_Encoding/Combined/`) — a copy error from whenever this repo was first assembled. Replaced with the correct file.

### Added: real XSD schema-validation gate (was completely missing)
`src/server/schemaValidation.ts` (new, uses `libxmljs2`) validates each upload against the Combined schema and appends any errors to `structural_errors` — a genuine pass/fail gate on structural conformance, separate from and prior to the 757 H-1 business rules, which previously didn't exist at all (the app only ever checked XML well-formedness, never real schema conformance).

### Verified end-to-end (all three fixtures, after the fixes above)
- All three pass XSD validation cleanly (`structural_errors: []`).
- All three now produce real H-1 findings for the first time ever: SF1 21 findings (17 HardStop/4 Warning), SF3 21 (18/3), Condo2 21 (17/4). **Worth a sanity read by Kevin** — these are official GSE reference samples; that many HardStops on a reference file could mean the samples aren't meant to be fully compliant, or could mean some rules are over-firing. Not diagnosed further this session.
- Auth ownership matrix (the top-priority item from session 2, "never tested against a real run") — confirmed correct: run owner sees their own run/file (200), a different appraiser is denied (403) on both `GET /api/runs/:runId` and `GET /api/runs/:runId/file`, reviewer/admin see everything regardless of ownership (200). Tested via the local `x-goog-authenticated-user-email` header (no real IAP needed locally — Cloud Run's IAP is what makes that header trustworthy in production; locally it's just read as-is, same as prod code path).

### Field-location coverage: went from 0 working entries to 45, from a real source
Ran `scripts/extract-pdf-text.mjs` against `fixtures/uad-samples/SF1_Appraisal/SF1_Appraisal_v1.4.pdf` and matched extracted text lines against `schemas/uad36_field_manifest.json` labels — 45 unambiguous matches (one hit each, whole document) written into `frontend/src/data/fieldLocations.ts`, keyed by the correct manifest key this time. Turns out this PDF renders as one "label ... value" text line per field (not a boxy visual form), so each bbox is the whole matched line, not a tight per-value box — still useful for scroll-to/zoom-to, see the file's header comment for the full caveat (single-sample-derived, comp-grid fields skipped as ambiguous, may not generalize to other appraisal software's PDF layout). SF3 and Condo2 PDFs are in `fixtures/` too if Kevin wants to extend/cross-check this.

### Still not done
- IAM grants + `deploy-gcp.ps1` wiring for the signed-URL upload path from part 1 (blocked by the safety classifier, needs Kevin or an explicit re-ask).
- `PDFPreview.tsx` deletion (same classifier block).
- The "why are there 17 HardStops on an official GSE reference sample" question above — worth a look before trusting rule-engine output on real appraiser submissions.
- Postgres migration, tests/CI, GitHub push, Bubble proxy — untouched, per the build directive's own multi-week phase plan.

All of the above is **uncommitted**, sitting in the working tree for review as a diff, per this repo's whole design.

## Not done yet

- End-to-end test of the auth fix against a real run (see above — top priority for a debugging session).
- `frontend/src/data/fieldLocations.ts` real coordinates.
- Rules dual-source-of-truth fix (stop tracking `data/rules.json` in git) — per the directive, not started.
- Old `PDFPreview.tsx` (fake-data component) — dead code, not deleted.
- Nothing pushed to GitHub yet — 4 commits sitting on local `main` only.
- Bubble proxy integration for `ai-qc-tf` — doesn't exist yet.
- Tests/CI, everything else in the build directive beyond the above — not started.

## Gotchas hit this session (save yourself the debugging time)

- **Typing "uad36" into a `Write`/`Read` tool `file_path` parameter silently corrupted it** into a stray character (session 1). Do path-sensitive file ops via `Bash` instead when the path contains that string, or verify the file landed correctly right after.
- **`preview_start`'s `.claude/launch.json` is read relative to `C:\Users\kzele\.claude\.claude\launch.json`, not wherever you've `cd`'d to.** The `qc-rebuild-frontend` config there is Vite-only (no backend) — `/api/*` calls 502. For anything touching the API, run the real integrated server (`npm run dev` from repo root, or `PORT=3999 npx tsx server.ts`) and point the browser at that port directly instead of using `preview_start`.
- **Stale background server processes**: if a local test server won't bind (`EADDRINUSE`), check for a leftover `tsx server.ts` process from earlier in the same session before assuming something's broken — `netstat -ano | grep <port>` then `taskkill //F //PID <pid>`.
- No sample UAD XML/PDF exists anywhere in the repo — confirmed again this session. Still needed for real end-to-end testing.
- GCP project resolution across `gcloud` command families is not reliably consistent within one script — see the incident writeup above. Always pass `--project` explicitly, never rely on `gcloud config set project` alone for anything that touches billed or production resources.
