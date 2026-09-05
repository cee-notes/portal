# Pasting this project into a repo from scratch

The folder is already assembled (`/home/user/repo-from-scratch`, zipped as
`/home/user/cee-portal-repo-files.zip`). 91 checks - `57 backend + 7 single-file + 27 real-DOM UI` -
pass against exactly these bytes, verified with `bash tools/run.sh` inside this tree:

```
layout: split (src/ + dist/)
wrote dist/cee_mock_all_in_one.gs  [split layout: src -> dist]
PASSED  57 passed, 0 failed
PASSED   7 passed, 0 failed
PASSED  27 passed, 0 failed
```

## Every file to paste

| Repo path | Bytes | md5 (10) |
|---|---|---|
| `.gitignore` | 290 | `341c9416b9` |
| `CEE Notes Logo (2).jpg` | 23,289 | `9c4fb07b69` |
| `DEPLOY.md` | 13,937 | `45cf4ef596` |
| `PASTE.md` | 48 | `ac3293eb57` |
| `README.md` | 8,754 | `89b323a798` |
| `appsscript.json` | 405 | `0a5fa4d6c0` |
| `dist/cee_mock_all_in_one.gs` | 220,151 | `6e59f32d81` |
| `index.html` | 4,545 | `b4b70555b3` |
| `package.json` | 374 | `2d4cee78ee` |
| `questions-template.csv` | 1,063 | `0150b29765` |
| `src/Code.gs` | 100,373 | `c033e1aef2` |
| `src/index.html` | 83,063 | `151ae690e2` |
| `tools/build.js` | 4,397 | `2a2af97c58` |
| `tools/figure-vector.b64` | 3,352 | `7a9aaad062` |
| `tools/figure-vector.png` | 2,514 | `0b1337755d` |
| `tools/fixture.pdf` | 970 | `7a3443a55c` |
| `tools/fixture.pdf.b64` | 1,296 | `20a1efd5ca` |
| `tools/fixture.xlsx` | 2,074 | `73bd51c00e` |
| `tools/fixture.xlsx.b64` | 2,768 | `1a72d53867` |
| `tools/harness.js` | 12,183 | `6c2d2a8141` |
| `tools/paths.js` | 1,305 | `bcafeb6a75` |
| `tools/rebalance.py` | 3,760 | `15e91142e6` |
| `tools/run.sh` | 810 | `eec9e08cbc` |
| `tools/test-allinone.js` | 6,562 | `03327d63d0` |
| `tools/test-ui.js` | 26,185 | `d43ac5476d` |
| `tools/test.js` | 42,566 | `b665366eed` |

`tools/` holds 14 files: `build.js paths.js harness.js test.js test-allinone.js test-ui.js run.sh
rebalance.py` plus `fixture.xlsx`, `fixture.pdf`, `figure-vector.png` and their `.b64` twins.
## Every file to paste

Total 27 files, single-file build = 220,151 bytes (md5 `6e59f32d81`).

| Repo path | Bytes | md5 (10) |
|---|---|---|
| `.gitignore` | 290 | `341c9416b9` |
| `CEE Notes Logo (2).jpg` | 23,289 | `9c4fb07b69` |
| `DEPLOY.md` | 14,154 | `56f14532c7` |
| `PASTE.md` | 7,151 | `08446ff042` |
| `README.md` | 8,754 | `6ae67179bc` |
| `appsscript.json` | 405 | `0a5fa4d6c0` |
| `dist/cee_mock_all_in_one.gs` | 220,151 | `6e59f32d81` |
| `index.html` | 4,545 | `b4b70555b3` |
| `package.json` | 374 | `2d4cee78ee` |
| `questions-template.csv` | 1,063 | `0150b29765` |
| `src/Code.gs` | 100,373 | `c033e1aef2` |
| `src/index.html` | 83,677 | `9178cdd209` |
| `tools/README.md` | 1,128 | `62ae987806` |
| `tools/build.js` | 4,397 | `2a2af97c58` |
| `tools/figure-vector.b64` | 3,352 | `7a9aaad062` |
| `tools/figure-vector.png` | 2,514 | `0b1337755d` |
| `tools/fixture.pdf` | 970 | `7a3443a55c` |
| `tools/fixture.pdf.b64` | 1,296 | `20a1efd5ca` |
| `tools/fixture.xlsx` | 2,074 | `73bd51c00e` |
| `tools/fixture.xlsx.b64` | 2,768 | `1a72d53867` |
| `tools/harness.js` | 12,183 | `6c2d2a8141` |
| `tools/paths.js` | 1,305 | `bcafeb6a75` |
| `tools/rebalance.py` | 3,760 | `15e91142e6` |
| `tools/run.sh` | 810 | `eec9e08cbc` |
| `tools/test-allinone.js` | 6,562 | `03327d63d0` |
| `tools/test-ui.js` | 27,805 | `f94fb73e5e` |
| `tools/test.js` | 42,566 | `b665366eed` |

## What each file is for

| Path | Role |
|---|---|
| `index.html` | **GitHub Pages door** (root is what Pages serves): logo + CPREC/Facebook credits, one *Open the portal* button, 3-second auto-redirect to `/exec`. No app code, so it cannot hang. |
| `src/Code.gs` | the whole Apps Script backend: auth, approval, device lock, 24 h sessions, marking, mail, banks, CSV/XLSX/PDF, teacher APIs |
| `src/index.html` | the portal UI (student + teacher on one dark page); embedded as base64 by the build |
| `dist/cee_mock_all_in_one.gs` | **the only file that goes into Apps Script** - generated: header + `var EMBEDDED_HTML` + `src/Code.gs` |
| `tools/paths.js` | detects this split layout (`src/` + `dist/`) vs the flat one, so one rig serves both repos |
| `tools/build.js` | base64-embeds `src/index.html`, asserts the round trip, writes `dist/cee_mock_all_in_one.gs` |
| `tools/harness.js` | Node mock of the Apps Script runtime (Sheets, MailApp, LockService, Properties, `Utilities.unzip`) - tests only |
| `tools/test.js`, `tools/test-allinone.js`, `tools/test-ui.js` | the 57 / 7 / 27 checks; `tools/run.sh` rebuilds then runs all three |
| `tools/fixture.xlsx`, `tools/fixture.pdf`, `tools/figure-vector.png` (+ `.b64`) | real files read by the upload, PDF-extraction and image tests |
| `tools/rebalance.py` | re-emits the seeded banks with an even answer spread; run only after editing a bank |
| `appsscript.json` | Apps Script manifest: V8 runtime, `USER_DEPLOYING` / `ANYONE_ANONYMOUS`, the three OAuth scopes |
| `package.json` | jsdom dev-dependency + `npm run build` / `npm test`; the portal itself needs no packages |
| `.gitignore` | keeps `node_modules`, `package-lock.json`, data exports and scratch out of the repo |
| `questions-template.csv` | the bulk-upload template teachers download |
| `CEE Notes Logo (2).jpg` | **must keep this exact name at the repo root**: both pages load it from `raw.githubusercontent.com/cee-notes/portal/main/CEE%20Notes%20Logo%20(2).jpg` |
| `README.md`, `DEPLOY.md` | code map + deploy runbook; DEPLOY 5 explains this repo's layout |

## Route A - web UI only, no local tools

1. Open `github.com/cee-notes/portal` → **Add file → Create new file**.
2. In the filename box type the **path including the folder** - `src/Code.gs` - GitHub creates the
   folder for you. Paste the file's entire content, **Commit changes** to `main`.
3. Repeat per file, in this order: `src/Code.gs`, `src/index.html`, `dist/cee_mock_all_in_one.gs`,
   all 14 `tools/` files, `questions-template.csv`, `appsscript.json`, `package.json`, `README.md`,
   `DEPLOY.md` - and **`index.html` last**, so the door replaces the dead app copy in one go.
4. Binary: **Add file → Upload files** → `CEE Notes Logo (2).jpg` (you cannot type a JPEG).
5. Dotfile: **Create new file**, name it exactly `.gitignore`, paste the patterns, commit - hidden
   files are unreliable through drag-and-drop.
6. Clean out what should not be there: open `Code.gs`, `cee_mock_all_in_one.gs`,
   `github-pages-landing.html` → **Delete this file**. `node_modules/` (2 045 files) needs git or
   `gh api` - the web UI cannot delete a directory.

## Route B - drag the whole folder

7. **Add file → Upload files**, then drag the *entire* `repo-from-scratch` folder onto the drop area:
   GitHub keeps sub-paths, so `src/`, `dist/` and `tools/` arrive as real directories.
8. Anything the uploader dropped (usually `.gitignore`, sometimes the image) is added via steps 4-5.
9. Commit directly to `main`, or to a new branch if `main` is protected → then merge.

## Route C - git from your machine (also the only way to purge node_modules)

10. ```bash
    unzip cee-portal-repo-files.zip && cd repo-from-scratch
    git init -q && git add -A
    git commit -q -m "Portal sources (src/), Pages door (root index.html), single-file build (dist/)"
    git remote add origin https://github.com/cee-notes/portal.git
    git checkout -b rebuild-from-scratch && git push -u origin rebuild-from-scratch
    git rm -r --cached node_modules package-lock.json && git commit -m "drop 22 MB of node_modules" && git push
    ```
11. Open the PR from `rebuild-from-scratch`. If another agent has merged since `7cac53c`, rebase
    first: `git fetch && git rebase origin/main`.

## Rules that keep the two hosts from fighting

12. Only `dist/cee_mock_all_in_one.gs` goes into Apps Script. Never `src/Code.gs` alone - that is
    exactly the "Portal HTML missing" mistake - and never a GitHub `.gs` copy older than this one.
13. md5 must match the table above; if it does not, you pasted a truncated copy (the single file is
    220,151 bytes and a partial paste is the most common silent failure).
14. After any edit to `src/`: `node tools/build.js`, paste the new `dist/` file, then
    **Deploy → Manage deployments → Edit → New version**. A code change without a new version is
    invisible to students.
15. Keep the door at the repo root. If you ever point Pages at `/docs`, move `index.html` there and
    leave no second live copy of the UI anywhere - a published copy of the app always freezes on a
    static host because `google.script.run` only exists inside Apps Script-served HTML.
