# qc-rebuild — Handoff

**Last updated:** 2026-07-14
**Read this first.** A zero-context session should be able to resume from this file alone.

## What this is

Hardening pass on `remix-uad36-qc-LIVE` (already deployed, GitHub: `kzelenakas/remix-uad36-qc-LIVE`) — evolving the same Express + Vite/React stack in place, not a framework rewrite. This folder is a clone of that repo (`git clone`d at HEAD `d0f97c5`) plus patches, kept separate so everything is reviewable as a diff before merging back or deploying.

Full context: a senior-eng audit + rebuild plan and this build directive were written this session —
`C:\Users\kzele\AppData\Local\Temp\claude\C--Users-kzele--claude\4d1fedc0-3b6b-462f-9dde-18ad9191d664\scratchpad괶-qc-BUILD-DIRECTIVE.md` (also published as an artifact — ask if the link is needed, it wasn't re-fetched here). **That directive is the authority on decisions already made** (keep the stack, fix rules dual-source-of-truth lightly rather than migrate to Postgres/Drizzle, port Python engines optionally, etc.) — read it before re-deciding anything it already covers.

## A related, more mature project exists — don't confuse the two

`Claude Cowork/Projects/uad36-qc-greenfield/uad36-qc-greenfield/` is a **separate**, further-along Python/Tornado rebuild of the same domain problem (757/757 rules encoded, 495 tests, Terraform IaC, GATE-2-audited-ready). Kevin chose this track (`qc-rebuild`) instead because he didn't want the Terraform-apply-it-yourself workflow GATE 2 required — see `uad36-qc-greenfield/uad36-qc-greenfield/RESUME-LATER.md` if that project ever gets picked back up. Not a reason to merge the two; they're independent efforts on the same problem.

## Status: one feature landed and verified, not yet integrated end-to-end

**Built and verified working (in the browser, via a throwaway test harness — since removed):**
- `frontend/src/components/ReportPreviewPane.tsx` — renders the *actual* uploaded report PDF (via `react-pdf`/`pdfjs-dist`), with severity-colored overlay boxes on rule-triggered fields, two-way linked to the finding list (click finding → scroll+highlight; click overlay → select finding). Wired into `App.tsx`, replacing the old `PDFPreview.tsx` in the main view — **that old component was rendering hardcoded fake report data ("Sarah Jenkins, 1248 Pinecrest Avenue"), not the real uploaded document at all.** Left `PDFPreview.tsx` itself in place (unused now) rather than deleting — worth a cleanup pass later.
- `frontend/src/components/RevisionCompareView.tsx` — reviewer's v1-vs-v2 compare (this is specifically for the resubmission workflow, not comps/other reports — confirmed with Kevin). Two `react-pdf` panes, scroll-locked by *scroll fraction* not pixels (`frontend/src/lib/scrollSync.ts` + `useScrollLock.ts`, has a passing Vitest unit test), fields that differ between versions auto-highlighted in amber. Presentable as an in-app overlay or popped out to a real separate OS window (`window.open` + React portal, copies stylesheets across). Wired into `App.tsx`'s existing "Side-by-Side Revision Audit" view (a findings-diff-only view that was already there) via a new "View documents side-by-side" button.
- `server.ts` — new `GET /api/runs/:runId/file?version=original|revised` extracts the real PDF from the retained upload (zip or bare PDF) and serves it. Filenames always come from the stored run record, never the request.

**Real bug found and fixed during verification:** `pdfjs-dist` was added as a direct dependency at a different version than the one `react-pdf@9.2.1` bundles internally → version-mismatch runtime error. Fixed by pinning `pdfjs-dist` to the exact matching version (`4.8.69`) so npm dedupes to one copy. If PDFs ever silently fail to render again, check `npm ls pdfjs-dist` for a version split first.

**Verified:** `npm install` clean, `vitest run` (5/5 on scroll-sync math), `tsc -b --force` clean from inside `frontend/`, and real browser rendering confirmed via `read_page`/console (screenshot tool was flaky this session, `read_page` was the reliable check).

## Not done yet

- `frontend/src/data/fieldLocations.ts` has only ~8 stub field→page/bbox entries as a working example. Needs the real Form 1004/UAD template coordinates before this is useful beyond a demo. This is content work (mapping the fixed URAR layout), not more engineering.
- Nothing committed to git yet — current diff is `frontend/package.json`, `frontend/src/App.tsx`, `server.ts` modified; `ReportPreviewPane.tsx`, `RevisionCompareView.tsx`, `frontend/src/data/`, `frontend/src/lib/` new. Review with `git status`/`git diff` before committing.
- `npm install` has only been run inside `frontend/`, not at the repo root (root has its own `package.json` for `server.ts`) — a root-level typecheck will fail on missing modules until that's done.
- Rules dual-source-of-truth fix (stop tracking `data/rules.json` in git) — per the directive, not started.
- Old `PDFPreview.tsx` (the fake-data component) — now dead code, not deleted.
- Auth hardening, tests/CI, everything else in the build directive beyond this one feature — not started.

## Gotchas hit this session (save yourself the debugging time)

- **Typing "uad36" into a `Write`/`Read` tool `file_path` parameter silently corrupted it** into a stray character, misfiling content into a wrongly-created sibling directory. Happened twice. Workaround used: do path-sensitive file ops via `Bash`/`cat`/`mv` instead of `Write`/`Read` when the path contains that string, or verify the file landed correctly right after. This folder's own name (`qc-rebuild`) was chosen partly to avoid the substring entirely.
- **`preview_start`'s `.claude/launch.json` is read relative to this session's actual primary working directory (`C:\Users\kzele\.claude\.claude\launch.json`), not wherever you've `cd`'d to via Bash.** A `launch.json` dropped inside `qc-rebuild/.claude/` was silently ignored; had to add the `qc-rebuild-frontend` config to the real one instead. If `preview_start` returns an unexpected/unrelated server, this is why — check that file.
- No sample UAD XML/PDF exists anywhere in the repo (confirmed by audit and again this session) — `docs/DEV.md` references a fixture zip that was never actually committed. Verification this session used two hand-built minimal PDFs, not a real UAD report.
