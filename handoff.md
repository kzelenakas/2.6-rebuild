# qc-rebuild — Handoff

**Last updated:** 2026-07-15 (session 4)
**Read this first.** A zero-context session should be able to resume from this file alone.

## What this is

Hardening pass on `remix-uad36-qc-LIVE` (already deployed, GitHub: `kzelenakas/remix-uad36-qc-LIVE`) — evolving the same Express + Vite/React stack in place, not a framework rewrite. This folder is a clone of that repo (`git clone`d at HEAD `d0f97c5`) plus patches, kept separate so everything is reviewable as a diff before merging back or deploying.

Full context: a senior-eng audit + rebuild plan and a build directive were written in session 1 —
`C:\Users\kzele\AppData\Local\Temp\claude\C--Users-kzele--claude\4d1fedc0-3b6b-462f-9dde-18ad9191d664\scratchpad괶-qc-BUILD-DIRECTIVE.md` (also published as an artifact — ask if the link is needed). **That directive is the authority on decisions already made** (keep the stack, fix rules dual-source-of-truth lightly rather than migrate to Postgres/Drizzle, port Python engines optionally, etc.) — read it before re-deciding anything it already covers.

## A related, more mature project exists — don't confuse the two

`Claude Cowork/Projects/uad36-qc-greenfield/uad36-qc-greenfield/` is a **separate**, further-along Python/Tornado rebuild of the same domain problem (757/757 rules encoded, 495 tests, Terraform IaC, GATE-2-audited-ready). Kevin chose this track (`qc-rebuild`) instead because he didn't want the Terraform-apply-it-yourself workflow GATE 2 required. Not a reason to merge the two; they're independent efforts on the same problem.

## Deploy targets — THREE separate things, do not confuse them

1. **`uad36-qc-beta`** (GCP project) — the original live production deployment of `remix-uad36-qc-LIVE`. Service `uad36-qc`, region `us-central1`, URL `https://uad36-qc-620834509337.us-central1.run.app`, billed under `kevin.zelenakas@truefootage.tech`. **Do not deploy `qc-rebuild` here without explicit instruction.** Kevin works in this project directly/separately from this repo's work.
2. **`ai-qc-tf`** (GCP project) — the deploy target for *this* repo (`qc-rebuild`), chosen specifically to sandbox this work away from `uad36-qc-beta`. Service **`ai-qc-tf`** (session 4: renamed to match the project id exactly — it used to be `uad36-qc`, identical to the real production service name in a different project, which was actively confusing; two intermediate names (`uad36-qc`, `uad36-qc-sandbox`) were tried and deleted this session before landing here). Region `us-central1`, live at `https://ai-qc-tf-6uwksqbsiq-uc.a.run.app` (also `https://ai-qc-tf-989432110587.us-central1.run.app`). Deploy via `infra/deploy-gcp.ps1 -ProjectId ai-qc-tf -Service ai-qc-tf` (the `-Service` param is needed — the script's own default is still the old ambiguous `uad36-qc`). **IAP/invoker access not yet configured on this service** — it 403s for everyone, including Kevin, until he sets that up himself (access-control changes are his to make, not something to automate here).
3. **Local dev** — `npm run dev` (root, runs `tsx server.ts` which serves Express + Vite middleware on one port) or set `PORT=3999` manually. Do NOT use `preview_start` with the `qc-rebuild-frontend` launch.json config alone — it's Vite-only, no backend, `/api/*` calls will 502. Use the `qc-rebuild-server` launch.json config instead (added session 3, runs the real integrated server on port 3000).

### Incident (session 2): the deploy script sent a prod DB password change to `uad36-qc-beta` by accident

`infra/deploy-gcp.ps1` used to rely on `gcloud config set project $ProjectId` once at the top and never pass `--project` on individual calls. Mid-script, the ambient project silently reverted to `uad36-qc-beta` and several calls landed on real `uad36-qc-beta` resources instead of erroring out (prod Cloud SQL password rotated then restored, a stray secret/bucket created then deleted, a harmless unused failed revision left behind). **Fixed**: every `gcloud` call now passes `--project=$ProjectId` explicitly, plus startup/post-deploy project-identity checks that abort the script if anything doesn't resolve to the target project. Confirmed clean on every deploy since. **If `uad36-qc-beta` ever appears in this script's output again, stop and check for damage** (`gcloud sql operations list --instance=uad36-qc-db --project=uad36-qc-beta`, `gcloud run revisions list --service=uad36-qc --project=uad36-qc-beta`).

## Current state (end of session 3): committed, deployed, mostly verified

Commits, in order (all local `main`, **not pushed to GitHub**):
`685dcba` `eaf445b` `217659f` `c847d15` (session 1–2, see below) → `5b0d9da` (signed-URL upload fix + rules dual-source cleanup) → `a1a5a2e` (xmldom parse-crash fix + XSD validation gate + real sample fixtures) → `870238e` (rule-engine + collateral-risk bug fixes + rules auto-reseed).

`ai-qc-tf` is deployed through all of the above — revision `uad36-qc-00005-8pm`, serving 100% traffic. **Not fully confirmed from this session** (no IAP-authenticated browser access available here): check `/api/meta` shows `rule_count: 729` (down from an inflated stale number — see "rules dual-source-of-truth" below, this is a correction, not data loss), and check `POST /api/uploads/init` returns a signed URL rather than 500 (depends on the second IAM grant below having actually landed).

### Feature: real PDF preview + revision compare (session 1)
- `frontend/src/components/ReportPreviewPane.tsx` — renders the actual uploaded report PDF, severity-colored overlay boxes on rule-triggered fields, two-way linked to the finding list.
- `frontend/src/components/RevisionCompareView.tsx` — reviewer's v1-vs-v2 compare, scroll-locked, poppable to a separate OS window.
- `server.ts` — `GET /api/runs/:runId/file?version=original|revised` serves the real PDF.
- Old fake-data `PDFPreview.tsx` — **deleted** (session 3, once explicitly named).

### Feature: auth hardening (session 2)
`getActiveUser()` used to trust a raw identity header with zero verification when it matched a known user, and several run-scoped routes had no authorization check at all. Fixed: identity headers require a valid `x-qc-proxy-secret` or fall back to real IAP identity; added `canAccessRun()` (admin/reviewer always, appraiser only on their own runs) applied to every run-scoped route; closed a runs-list query-param filter bypass.

**Verified end-to-end this session (session 3)** against real runs, closing the top item from session 2: run owner sees their own run/file (200), a different appraiser is denied (403) on both `GET /api/runs/:runId` and `GET /api/runs/:runId/file`, reviewer/admin see everything regardless of ownership (200). Tested via the local `x-goog-authenticated-user-email` header (that's what IAP injects in prod; locally it's read as-is, unverified — same code path, just no IAP in front of it to guarantee the header is trustworthy).

### Feature: version footer (session 2)
`/api/meta` returns `commit`/`environment`; footer shows `<project> · <commit> · ruleset <version>`.

## Session 3: large-upload 413 fix + rules dual-source-of-truth

### Fixed: 413 on large ZIP uploads
Root cause: Cloud Run enforces a hard, non-configurable ~32MB request-body ceiling — no Express/multer setting can raise it, and UAD zip bundles (XML + PDF + photos) commonly exceed it. Never reachable from local testing (no such limit locally), which is why it only showed up against `ai-qc-tf`.

Fix: direct-to-GCS signed-URL upload path that bypasses Cloud Run for large files.
- `src/server/uploads.ts` (new) — `createSignedUploadUrl`/`downloadUploadedObject`/`deleteUploadedObject`, gated on `QC_UPLOAD_BUCKET` env var.
- `server.ts` — `POST /api/uploads/init` (404s if `QC_UPLOAD_BUCKET` unset); `/api/runs` and `/api/runs/:runId/revision` accept either multipart or a JSON `{objectPath, filename}`; explicit multer `fileSize` limit (500MB) with a clean 413 instead of an unhandled crash.
- `frontend/src/api.ts` — tries the signed-URL path for files ≥20MB, falls back to direct multipart otherwise.
- `infra/deploy-gcp.ps1` — now passes `QC_UPLOAD_BUCKET=$bucket` on every deploy.

**IAM grants status (needed for the signed-URL path to actually work in prod):**
1. `roles/storage.objectAdmin` on the bucket for the runtime SA — **Kevin ran this, confirmed landed** (verified via `get-iam-policy` output).
2. `roles/iam.serviceAccountTokenCreator` on the runtime SA (self-grant, needed for `getSignedUrl()` via ADC) — Kevin hit `Regional Access Boundary ... Gaia id not found for email kevin.zelenakas@truefootage.tech` running this from Cloud Shell. Likely a transient/Workspace-account identity-resolution issue unrelated to the command itself; suggested retrying, or running from local `gcloud` instead of Cloud Shell, or (if it persists) escalating to a GCP org admin. **Unconfirmed whether it ultimately landed** — check `gcloud iam service-accounts get-iam-policy 989432110587-compute@developer.gserviceaccount.com --project=ai-qc-tf` for `roles/iam.serviceAccountTokenCreator`, or just try `POST /api/uploads/init` against prod and see if it 500s.

I (Claude) will not run IAM-grant commands myself even with explicit authorization — modifying access controls is a hard rule, not a soft one. Kevin has to run these himself.

### Fixed: rules dual-source-of-truth
`data/rules.json` and `data/archives/*` were tracked in git even though `db.ts` already boot-seeds `DATA_DIR` only when empty. Untracked both, added `data/{rules,runs,profiles,users}.json` + `data/archives/` + `data/files/` + `data/rules_seed_version.txt` + root `dist/` to `.gitignore`. `rules/h1_rules.json`/`rules/seed_rules.json` (the actual seed sources) stay tracked.

## Session 3 continued: real sample data, a process-crashing bug, and the rule-engine's actual bugs

Kevin supplied the official GSE UAD 3.6 sample packages (SF1, SF3, Condo2 — xml+pdf+zip, no NPI) plus the correct Combined XSD schema (from `Claude Cowork/Projects/Rules_Encoding/Combined/`). Added as `fixtures/uad-samples/{SF1,SF3,Condo2}_Appraisal/`. This was the first real end-to-end test data this project has ever had, and it surfaced several previously-undetected bugs.

### Critical fix: the whole server could crash on any real report upload
`@xmldom/xmldom` 0.9 replaced its old `errorHandler: {error, fatalError}` option with a single `onError(level, msg)` callback; the old option is silently ignored, so **every real UAD XML upload reported `parse_failed: true`, ever, in this project's history** — the rule engine had never actually run against real data before this session. Fixed in `src/server/parser.ts`. That then exposed a second, worse bug: `runPythonSupplementalRules`/`runPythonCollateralRisk` in `engine.ts` write to a spawned Python subprocess's stdin; a failed spawn (wrong `QC_PYTHON_BIN`, missing interpreter) surfaces as an unhandled `'error'` event on the **stdin pipe**, not the `ChildProcess` object, and only the latter had a handler — crashing the entire Node process, not just that request. **Any real report upload could have taken down the whole service for every user.** Fixed with a `pythonProcess.stdin.on("error", ...)` handler in both functions. Also pinned the four `"latest"` deps (`@xmldom/xmldom`, `@google/genai`, `adm-zip`, `multer`) — the xmldom break is exactly the failure mode that was meant to prevent.

### Fixed: qc-rebuild's own copy of the Combined XSD was corrupted (0 bytes)
Replaced with the correct 1.76MB file.

### Added: real XSD schema-validation gate (was completely missing)
`src/server/schemaValidation.ts` (new, `libxmljs2`) — validates each upload against the Combined schema, appends errors to `structural_errors`. A genuine structural pass/fail gate that didn't exist before at all (only XML well-formedness was ever checked).

### Fixed: 9 H-1 rules producing false HardStops against real reports
Traced from an appraiser-facing QC export Kevin shared (SF3, 18 HardStops — turned out ~half were bugs, not real findings):
- **UAD1103/1104/1105/1106/1113/1159**: compound `"(A and B) or (C and D)"` rule descriptions got flattened by the encoder into one bag of atomic conditions with a single global AND/OR, discarding the grouping — e.g. UAD1103-1106/1113 required manufactured-home fields on *any* dwelling regardless of `ConstructionMethodType`, because `ImprovementType=Dwelling` alone satisfied an OR across everything. Fixed: `engine.ts`'s `conditional_field_present` now supports grouped conditions (`conditions: [[...],[...]]` = OR of AND-groups) plus per-condition numeric operators (`>`,`<`,`>=`,`<=`,`!=`), backward-compatible with the flat format ~700 other rules use. Re-encoded correctly in `rules/h1_rules.json`.
- **UAD1011/UAD1086**: cardinality checks ("if Field <> the number of instances of X") misread by the encoder as literal-value comparisons — captured the word "the" as `compare_value`, always-true HardStop. No engine operator for count-of-matching-children exists yet — reverted to `needs_encoding` (explicitly skipped by the engine) rather than left firing garbage. **Building a real fix needs a new engine operator for "count of repeating child elements matching a condition"** — not started.
- **UAD1264**: `"> 1,000,000,000"` truncated to `compare_value: 1` at the encoder's first comma — fired HardStop on every legitimate value. Fixed to `1000000000`.

Root-caused all of it to `rules/parse_rules.cjs` (the actual rule encoder) and fixed the encoder itself, not just the 9 instances: comma-formatted numbers no longer truncate, a bareword RHS can't be captured as a literal anymore (must be a real number/quoted string/true-false), compound and/or descriptions now bail to `needs_encoding` instead of silently flattening wrong, numeric conditions like "LivingUnitCount > 0" are captured instead of silently dropped.

**Verified locally**: SF3's HardStops dropped 18 → 9 after the fix, none of the 9 buggy rule IDs fire anymore, 0 rule_errors.

**Not done / deferred for cost reasons**: did not do a broader audit of the remaining ~329 `needs_encoding` H-1 rules or the collateral_risk rule set beyond the one bug below — this was triaged tightly to the demonstrated bugs, not opened into a full rules-quality pass.

### Fixed: collateral_risk `field_in_set` operator was inverted for one rule
`collateral_risk/operators.py`'s `field_in_set` only implemented "flag if NOT in the set" (correct for CR-030/CR-031's "outside the valid enumeration" checks), silently reused for CR-038's "flag if Q6" intent — inverted, so it fired on every quality rating *except* Q6 (confirmed: fired on Q4 in the SF3 export). Added a `mode` flag (`flag_if_in` vs default `flag_if_not_in`); CR-038 now uses `mode: "flag_if_in"`. CR-030/CR-031 unaffected.

### Added: rules auto-reseed on source change
`db.ts` previously only seeded `rules.json` when the file was completely absent — meaning a rule fix shipped in a redeploy never reached an environment that had already booted once, which is exactly how the bugs above survived multiple `ai-qc-tf` deploys. Now tracks a content hash of `rules/h1_rules.json` in `data/rules_seed_version.txt`; a mismatch (or missing marker — e.g. first boot after this was added) triggers a full reseed. **This intentionally overwrites any rule customizations made through the admin UI when the source changes** — same semantics as a from-scratch deploy, just no longer gated to "only once ever." Local reseed dropped the rule count 1036→729 (and active 709→402) — that's the dual-source-of-truth drift finally correcting, not data loss: 729 is `rules/h1_rules.json`'s actual count, the live store had accumulated ~307 extra rules over time that were never in the seed source.

### Field-location coverage: 0 working entries → 45, from a real source
`fieldLocations.ts` previously used short fake keys that never matched a real `Finding.field_path` (always the long MISMO XPath) — the overlay was a complete no-op regardless of coordinates. Fixed the key format, and ran `scripts/extract-pdf-text.mjs` (new, reusable) against the real SF1 sample PDF, matching extracted text against `schemas/uad36_field_manifest.json` labels for 45 unambiguous matches. This PDF renders as one "label ... value" text line per field, not a boxy visual form, so each bbox is the whole matched line, not a tight per-value box — still useful for scroll-to. Single-sample-derived, comp-grid fields skipped as ambiguous (repeated labels), may not generalize to other appraisal software's PDF layout. SF3/Condo2 PDFs are in `fixtures/` too if extending this.

## Session 4: photo processing wired, map/proximity rule fixed, one flagged rules-logic gap

Kevin asked to refine rules logic and wire the collateral-risk photo + map (comp-proximity) processing to real uploaded files, using the SF3 run from session 3 (9 HardStop, 3 Warning, 12 findings, 0 rule_errors) as the reference. Verified those 12 findings are real UAD field-completeness issues on the sample, not new bugs — see "flagged, not fixed" below for the one rules-logic issue this surfaced.

### Fixed: photo rules (CR-105/106/107) had no path from a real upload to the Python engine at all
`collateral_risk/photo.py`, `operators.py`, and `engine.py`'s `evaluate_photos()` were already fully built and unit-tested (from a design pass ported over from the sibling `Revisions` project), but nothing in this repo ever called them: `server.ts` only ever pulled the `.xml` entry out of an upload zip and discarded everything else, and `collateral_risk/run_entrypoint.py` (the stdin/stdout bridge `engine.ts` spawns) only ever called `evaluate()`, never `evaluate_photos()`. Delivery photos (confirmed present in all three UAD sample zips under `Images/`) never reached the photo rules regardless of whether they were enabled.

Wired end to end:
- `server.ts` — new `extractZipImages()` pulls every `Images/*.{jpg,jpeg,png,gif}` entry out of the upload zip; called from both `/api/runs` and `/api/runs/:runId/revision`, set on `normalized.images`.
- `src/server/parser.ts` — `NormalizedReport` gets an optional `images?: Record<string, Buffer>`.
- `src/server/engine.ts`'s `runPythonCollateralRisk()` — base64-encodes `report.images` into the payload sent to `run_entrypoint.py`, but **only if `hasEnabledPhotoRules()` finds at least one enabled `photo_face_detected`/`photo_quality_flag` rule** in `collateral_risk/rules.json`. Since all three photo rules ship `enabled: false` pending Kevin's sign-off (accuracy validation, wording — see `docs/superpowers/specs/2026-07-10-collateral-risk-photo-checks-design.md` open questions), this keeps the cost at zero today; it turns on by itself the moment a rule is flipped to `enabled: true` from Admin, no code change needed then.
- Also dropped `google_maps_api_key`/`gemini_api_key` from this same payload — dead weight, `run_entrypoint.py` never read them (that was copy-pasted from the *other* Python engine's payload, see below).
- `collateral_risk/run_entrypoint.py` — decodes the base64 photos, calls `evaluate_photos()`, merges its findings with `evaluate()`'s before mapping to the `Finding` shape.

**Verified**: real photo bytes extracted from the SF3 fixture zip (36 images) round-trip through base64 unchanged; `evaluate_photos()` fires correctly against a real photo when given a temporary in-memory enabled-rule override (never touched the committed `rules.json`); full `run_entrypoint.py` subprocess invocation with real XML + real photos runs clean, no crash, no error, `hasEnabledPhotoRules()` correctly reads `false` against the live ruleset today; a full local run through `evaluateReport()` (`server.ts`'s actual code path, not a shortcut) against SF3 returns the same 12 UAD findings plus 1 CR finding, 0 rule_errors, with `images` populated. **Still gated on Kevin enabling CR-105/106/107 from Admin** — the design doc's open questions (face-detection accuracy on real photos, quality-threshold tuning) aren't resolved by this session, only the plumbing gap that made them unreachable regardless.

### Fixed: SUPP-006 (map/comp-proximity check) could never fire against a real report
`supplemental_rules/engine.py`'s SUPP-006 ("Location Verification") was already patched in an earlier pass to stop fabricating a finding on every run when it had no real data — but the replacement still looked up hardcoded flat keys (`"Subject/Address"`, `"Comp1Proximity"`, etc.) that don't exist in this project's field manifest at all (subject/doc fields are keyed by full MISMO XPath, e.g. `subject:VALUATION_ANALYSIS/PROPERTIES/PROPERTY/ADDRESS/AddressLineText` — see `schemas/uad36_field_manifest.json`), and parsed a freeform "X miles" proximity string UAD 3.6 doesn't use. Net effect: `get_field_val()` always returned `None` for every one of those keys, so the rule silently never fired — not a crash, just permanently dead code past the fabrication fix.

Rewrote it to read directly off the parsed XML (`root`, already parsed earlier in `run_checks()`, previously unused by this rule): namespace-agnostic local-tag walk (mirrors `collateral_risk/resolve.py`'s approach) to the subject `PROPERTY[ValuationUseType=SubjectProperty]` and each `PROPERTY[ValuationUseType=SalesComparable]`, their `ADDRESS` blocks, and — this is the actual "map processing" fix — UAD 3.6's own structured `<ProximityToSubjectDistanceLinearMeasure LinearUnitOfMeasureType="Miles">` field per comp, which reports the real distance as a number already. No more regex-guessing a reported-distance string. Still geocodes subject + comp addresses via `GOOGLE_MAPS_API_KEY` (already wired at deploy time in `infra/deploy-gcp.ps1`) and flags a >1 mile discrepancy between reported and haversine-computed distance — same "no real data → no finding" honesty as before, still no fabricated fallback.

**Verified**: extracted subject + all 3 comp addresses and reported distances (3.90/6.56/4.04 mi) correctly from the real SF3 XML; with geocoding mocked to a known-bad location, produced a correctly-worded SUPP-006 finding citing the right computed-vs-reported numbers for all 3 comps; with no API key (today's local-dev default, no `.env` set), returns zero findings and doesn't crash, matching production behavior when the secret isn't configured.

### Flagged, not fixed: repeating fields (ROOM, comp) can only ever see the *first* instance
Reviewing the SF3 run's 12 findings turned up a real rules-logic gap, not a bug in any single rule: `src/server/parser.ts`'s `resolveValue()`/`findChildChain()` walks a single path per field key and returns one value — for a field under a repeating container (`PROPERTY_UNIT/ROOMS/ROOM/...`, e.g. UAD1145/UAD1146's "Condition Status"/"Update Status" for room), this can only ever inspect one room, not all of them. A HardStop on "the room" is ambiguous about *which* room, and a report with 5 rooms where only room 3 is missing the field may be silently missed if `findChildChain` picks a different room first. This is architecturally the same class of problem `handoff.md`'s existing "count of matching repeating child elements" backlog item names for the Python side (`collateral_risk/resolve.py` already returns *all* matches for exactly this reason — the TS engine's field model doesn't).

**Not fixed this session** — this needs `report.fields`/`fieldManifest` to support per-instance repeating-container resolution (likely indexed keys or a list-valued field), which is a real architecture change to the TS rule engine's field model, not a one-rule patch, and risks changing behavior for every rule that touches a repeating container (rooms, comps, parties, adjustments) at once. Flagging for a scoping conversation rather than taking a swing at it inside this ask.

### Also noted, not touched: SUPP-001 through 005 use the same "guess the field key" pattern
These five rules do substring-matching over `fields.keys()` (`"grosslivingarea" in k.lower()`) rather than SUPP-006's old hardcoded-literal mistake, so they're more likely to actually match something in the real MISMO-XPath-keyed manifest — but it's still a guess, not a guarantee, and wasn't independently verified against real data this session (SF3 produced zero SUPP-001–005 findings, which is *consistent* with a clean sample but doesn't prove the lookups are correct). Worth a real audit if Kevin wants confidence in the whole `supplemental_rules` package, not just SUPP-006.

### Known local-environment gap (not a regression): `cv2.CascadeClassifier` missing on this Windows box
`python -m pytest collateral_risk` — 15/17 pass; the 2 failures are both `test_photo.py`'s face-detection tests hitting `AttributeError: module 'cv2' has no attribute 'CascadeClassifier'` on this machine's local Python install (likely a partial/stub OpenCV build). Not caused by anything this session touched (`photo.py`/`operators.py` untouched), and the Cloud Run deploy environment's `opencv-python-headless` is a normal full install — but worth a real check against a real property-photo batch before `CR-105` ever gets `enabled: true`, per the design doc's own open question 3.

## Not done yet

- **Confirm IAM grant #2 landed** (`roles/iam.serviceAccountTokenCreator`) and that `/api/uploads/init` actually works against `ai-qc-tf` — see above.
- **Confirm the rule reseed actually fired in prod** — check `/api/meta`'s `rule_count` reads `729`.
- A real engine operator for "count of matching repeating child elements" (needed to properly re-encode UAD1011/UAD1086 instead of leaving them `needs_encoding`).
- Broader audit of the ~329 remaining `needs_encoding` H-1 rules and the rest of the collateral_risk rule set — only the specifically-demonstrated bugs got fixed this session, not a general quality pass.
- `frontend/src/data/fieldLocations.ts` — only 45/410 displayable fields covered, single-sample-derived.
- **Still not pushed to GitHub** — origin/main has diverged (6 commits Kevin/someone pushed directly, including independent fixes to the same 32MB-upload and auth-spoofing bugs this branch also fixed) — needs Kevin to pick which side wins per conflict before merging, not something to auto-resolve. 9 local commits waiting.
- **Turn on IAP (or grant Cloud Run Invoker) for the renamed `ai-qc-tf` service** — session 4 renamed the service twice (`uad36-qc` → `uad36-qc-sandbox` → `ai-qc-tf`, old ones deleted), so the new one currently 403s for everyone, including Kevin, until he configures access himself.
- Bubble proxy integration for `ai-qc-tf` — doesn't exist yet.
- Postgres migration, tests/CI, everything else in the build directive beyond the above — not started.
- **Kevin's sign-off to enable CR-105/106/107** (photo rules) — plumbing is done (session 4), the rules themselves are still `enabled: false` pending accuracy review, same as before.
- **Per-instance repeating-field resolution in the TS rule engine** (rooms, comps, parties) — flagged session 4, not started; needed so rules like UAD1145/1146 check *every* room, not just the first.
- **Audit SUPP-001–005's substring field-key matching** against real data — flagged session 4, only SUPP-006 was independently re-verified.

## Gotchas hit this session (save yourself the debugging time)

- **Typing "uad36" into a `Write`/`Read` tool `file_path` parameter silently corrupted it** into a stray character. Do path-sensitive file ops via `Bash` instead when the path contains that string, or verify the file landed correctly right after.
- **`preview_start`'s `.claude/launch.json` is read relative to `C:\Users\kzele\.claude\.claude\launch.json`, not wherever you've `cd`'d to.** Use the `qc-rebuild-server` config (added this session) for anything touching the API — `qc-rebuild-frontend` is Vite-only, `/api/*` calls 502.
- **Stale background server processes**: if a local test server won't bind (`EADDRINUSE`), check for a leftover `tsx server.ts` process from earlier in the same session — `netstat -ano | grep <port>` then `taskkill //F //PID <pid>`.
- **GCP project resolution across `gcloud` command families is not reliably consistent within one script** — always pass `--project` explicitly, never rely on `gcloud config set project` alone for billed/production resources.
- **The safety classifier blocks writing IAM-grant `gcloud` commands into scripts, even as authored-but-not-executed code** — this isn't a bug to work around, it's a hard rule (modifying access controls). Give the user the exact commands to run themselves instead.
- **A "reseed rules" ask isn't just a code fix** — production's persisted `data/rules.json` on the Cloud Run volume only reseeds on a content-hash mismatch now (see "rules auto-reseed" above); if you fix a rule and it's still wrong in prod after a deploy, check whether the seed-version marker file already matches (i.e. reseed didn't actually trigger) before assuming the code fix didn't work.
