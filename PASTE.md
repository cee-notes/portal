# Pasting this project into a repo from scratch

Assembled in `/home/user/repo-from-scratch`, zipped as `/home/user/cee-portal-repo-files.zip`.
Verified by running the project's own rig inside this tree: `58 + 7 + 28 = 93 checks`, 0 failures.

## Every file to paste

27 files. The Apps Script artifact is `dist/cee_mock_all_in_one.gs` = 221,478 bytes, md5 `61c99db04ae9650b500a51a0c1abf559` - check that number after you
paste, because a truncated 221 KB paste fails silently.

| Repo path | Bytes | md5 |
|---|---|---|
| `.gitignore` | 290 | `341c9416b9355f7faa8925837dd6f75a` |
| `CEE Notes Logo (2).jpg` | 23,289 | `9c4fb07b69e75917700136dcee0e20b4` |
| `DEPLOY.md` | 14,154 | `530ad4ba11f306c37fb9ae6407b81ea0` |
| `PASTE.md` | 7,468 | `f6a6044bc871a94dfa9ecfc6fb68cc1d` |
| `README.md` | 8,385 | `628bfd76baa6c3c8622f888bb875ee82` |
| `appsscript.json` | 405 | `0a5fa4d6c089457446cac6ced1328244` |
| `dist/cee_mock_all_in_one.gs` | 221,478 | `61c99db04ae9650b500a51a0c1abf559` |
| `index.html` | 4,545 | `b4b70555b3d68d0813cff328f5eef025` |
| `package.json` | 374 | `2d4cee78ee51b04b7c4f67d6511529f1` |
| `questions-template.csv` | 1,063 | `0150b29765aa5387cafed23c5d30a44f` |
| `src/Code.gs` | 100,831 | `2c4cc13c166d4bba78826606b28ad2ed` |
| `src/index.html` | 83,677 | `9178cdd209d9d309d139a50312260ca2` |
| `tools/README.md` | 1,128 | `62ae98780663b8d00558392e7de83356` |
| `tools/build.js` | 4,397 | `2a2af97c58b50a0f01958107b29f495a` |
| `tools/figure-vector.b64` | 3,352 | `7a9aaad062b1c406006c624e5843cb4a` |
| `tools/figure-vector.png` | 2,514 | `0b1337755d505fa1a3b7163ae5f8ba7c` |
| `tools/fixture.pdf` | 970 | `7a3443a55c6567382003feaaaf2b2da7` |
| `tools/fixture.pdf.b64` | 1,296 | `20a1efd5ca67b87fb2df35e6348a98ac` |
| `tools/fixture.xlsx` | 2,074 | `73bd51c00ee5603be9ec483e7ab58c3e` |
| `tools/fixture.xlsx.b64` | 2,768 | `1a72d53867c9c1a1e28f63b762fc5790` |
| `tools/harness.js` | 12,183 | `6c2d2a8141b0058fc46b4550ec435a1f` |
| `tools/paths.js` | 1,305 | `bcafeb6a758b588fe4aee41095db96c2` |
| `tools/rebalance.py` | 3,760 | `15e91142e69d5f3d604e7410a6970b38` |
| `tools/run.sh` | 810 | `eec9e08cbce38740255ec43958c2653d` |
| `tools/test-allinone.js` | 6,562 | `03327d63d0973fa4c0878a9d12eee2c4` |
| `tools/test-ui.js` | 27,805 | `f94fb73e5e8d46386e98a65d5eedd612` |
| `tools/test.js` | 44,679 | `2666fb7425085addf65d8f7ad897fd00` |

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
