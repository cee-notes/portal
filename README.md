# CEE Mock Portal

Timed MCQ mock-test practice for Nepal's Medical Entrance (MBBS/BDS) exam.
**Google Apps Script + Google Sheets.** No server, no database, no hosting bill — the portal is
one script attached to one spreadsheet, published as a Web app.

```
Student ──> /exec URL ──> Apps Script (Code.gs) ──> Sheet tabs: Users / Attempts / Responses / Questions
                              └── MailApp: approval, rejection, device reset, per-attempt feedback
```

## Files

**This repo is the GitHub Pages copy**, so the layout is the split form: `index.html` at the root is
the landing door (Pages serves it), the actual portal lives in `src/Code.gs` + `src/index.html`, and
`dist/cee_mock_all_in_one.gs` is the generated file you paste into Apps Script. `tools/paths.js`
detects the layout, which is why the same test rig runs in both repos.

- `tools/paths.js` — resolves where the sources live, so the same rig runs in the flat layout
  (`Code.gs` + `index.html` at the root, `pages/index.html` as the Pages door) and in the split
  layout the GitHub Pages repo uses (`src/Code.gs` + `src/index.html`, generated file in `dist/`,
  root `index.html` is the door). Detected by the presence of `src/Code.gs`; nothing else changes.
| file | role |
|---|---|
| **`cee_mock_all_in_one.gs`** | **the deliverable.** Whole backend + the entire portal UI base64-encoded into `var EMBEDDED_HTML`, decoded in `doGet()` with `Utilities.base64Decode`. Paste this one file and you are done (200 KB, longest line 528 chars so it survives the editor and copy/paste) |
| `Code.gs` | the same backend as a standalone script — edit here |
| `index.html` | the portal frontend (`google.script.run`, dark responsive UI) — edit here |
| `questions-template.csv` | bulk-upload template with 6 example rows |
| `appsscript.json` | manifest for `clasp` users |
| `tools/` | build + test rig (never deployed) — see `tools/README.md` |

Usual loop: edit `Code.gs` / `index.html` → `node tools/build.js` → paste
`cee_mock_all_in_one.gs` into the Apps Script editor. See **`DEPLOY.md`** for the 5-minute setup.

## Requirements → where they live → how they are proven

| # | requirement | code | covered by |
|---|---|---|---|
| 1 | email + password registration, email is the login id | `apiRegister_`, `apiLogin_`, `findUserRow_` | `test.js` §(1)(2), `test-ui.js` register/login |
| 2 | mandatory admin approval; first teacher auto-approved | status column, `apiSetStatus_`, `apiAdminOverview_` | same sections |
| 3 | one-device lock until an admin resets it | `deviceId` bound on first login, `apiResetDevice_` | `test.js` §(3), UI reset test |
| 4 | 24-hour sessions, expiry forces re-login | `sessionExpiry`, `requireUser_` → `session:true` | `test.js` §(4), UI bounce test |
| 5 | server-side marking +1 / −0.25 / 0 | `mark()`, `apiSubmitMock_` | `test.js` §(5) + §(5b) tamper tests |
| 6 | feedback email: score + per-question verdict + explanations (+ figures) | `sendFeedbackMail_` with `inlineImages` | `test.js` §(5), §(10) |
| 7 | approval/rejection mails, admin notification on registration | `notifyAdmins_`, `apiSetStatus_`, toggles | `test.js` §(1)(2), toggle test |
| 8 | question bank + bulk CSV/XLSX upload | `apiImportQuestions_`, `parseDelimited_`, `parseXlsx_` (unzip + XML, no library) | `test.js` §(8) on a real `.xlsx` fixture |
| 9 | PDF-guided question builder | client `readPdfClient` (pdf.js) + `extractPdfText_` server fallback | `test.js` §(9) on a real PDF, UI builder test |
| 10 | image-based MAT questions in quiz / review / email | `image` column, `paperItem_`, `dataUriToBlob_`, client `pickImage` | `test.js` §(5)(10), UI upload test |
| 11 | re-open any saved attempt, answers vs correct answers | `apiGetAttempt_`, `apiMyAttempts_` | `test.js` §(11), UI review test |
| 12 | micro-syllabus topic codes (Bio Z1–Z9/B1–B6, C1–C7, P1–P8, M1–M9) | `SYLLABUS`, `topicList`, filters in `apiStartMock_` | `test.js` §(12), UI picker tests |
| — | `LockService.getScriptLock()` on every read-modify-write, row-cell updates only, `FALLBACK_BANK` (8) + seeded default bank (40) | `withLock_`, `updateRow_`, `maybeSeed_`, `FALLBACK_BANK` | `test.js` §Concurrency, §fallback |

`bash tools/run.sh` runs all of it: **92 checks, all passing** (57 backend, 7 single-file,
28 real-DOM UI). The UI tests load the actual `index.html` in jsdom with `google.script.run`
wired to the actual backend running on a mocked Apps Script runtime — so the buttons are proven,
not just the functions.

## Design notes worth knowing

- **Why marking cannot be gamed.** `startMock` stores, in Script Properties for that user,
  a 12-char hash of every served question plus the four-option shuffle order. `submitMock`
  ignores the option order the browser sends and scores `hash → bank answer`, mapping the tapped
  card through *its own* stored order. Sending a different question text, an invented `order`, or
  a slot of 99 becomes "not attempted" (and is reported as `tampered`). Late submission is judged
  against the server clock + `GRACE_SECONDS`, not the client's timer, and only flags the row —
  it never changes marks.
- **Sheets is not a database, so:** every mutation is serialised by `withLock_`, writes touch one
  row's cells (or one block append) instead of rewriting tabs, and `detailCount` links an attempt
  to its response rows. Concurrent students therefore queue; the visible symptom is a retryable
  "portal is busy".
- **Identity model:** `pass = sha-256(password + "|" + email)`; the session token is a uuid in
  `Users.session` with `sessionExpiry`; the device is a random install id in the browser's
  localStorage (so a browser update cannot lock a student out). There is no Google login prompt
  for students — the /exec page is public, accounts gate access.
- **Review fidelity:** `Responses` stores letters (per the agreed schema); the review screen and
  the feedback email re-join the bank to show all four option texts, so a student sees
  *"C – Mitochondria"* rather than a bare letter.
- **Pages is a door, not the app:** `pages/index.html` is what belongs on
  `cee-notes.github.io/portal` (branding + a link to `/exec`). The app only runs from the Apps
  Script URL, and `index.html` now says so out loud instead of freezing if opened elsewhere.
- **Embedding:** the UI is one file with a `/*__INCLUDES__*/` marker and a `include(name)`
  helper on the server, so splitting the frontend later is a one-line change.
- **Mail identity + portal link:** `sendMail_()` sets `Reply-To` from `CONFIG.MAIL_REPLY_TO`
  (always works) and attempts `from: CONFIG.MAIL_FROM`; if Gmail has not verified that alias it
  retries without `from` and latches `MAIL_STATE.aliasOk = false`, so the address is never
  re-tried (and no mail is ever duplicated or lost). Every student mail gets `supportFooter_()`
  (portal link + support address), `doGet` injects the support address into the login screen via
  `brandHtml_` placeholders, and `getSettings` / `saveSettings` let a teacher change the portal
  URL and support address at runtime (Script Properties `CEE_SETTINGS_V1`) without a re-deploy —
  saving sends one probe mail so the sender is verified immediately. `health()` reports
  `portalUrl` and `mail.{from,replyTo,aliasAccepted,lastVia}`.

## Deliberately not here

No MongoDB/Node/Cloudflare/Express and no separate web host (that path was explored and dropped);
no payment or anything needing a card; mail is Google's `MailApp` only. The GitHub repo is a code
store, not the runtime.

## Known trade-offs

- Consumer Gmail sends ≤100 recipients/day from Apps Script, so ~33 submitted mocks/day get a
  feedback email before `MailApp` refuses; `EMAIL_FEEDBACK: false` (or a Workspace account) is the
  lever, and the in-portal review is unaffected.
- `MailApp` can only sign mail as an address the *script owner's* Google account is allowed to
  use, so `MAIL_FROM: support@…` needs a verified Gmail alias (or Workspace delegation). Until
  that exists the visible sender is the sheet owner and `Reply-To` carries the support address —
  replies still reach the support inbox.
- Changing `CONFIG.PORTAL_URL` in the repo does not move the live deployment; it must be pasted
  (new version) or saved through Teacher → System on the running copy.
- Inlined `data:` figures are capped at 120 KB because Gmail only renders small inline images; a
  hosted URL is better for very large figures.
- The `.xlsx` reader supports what teachers actually paste (shared strings, inline strings,
  numbers). For anything exotic, "Download CSV template" and use CSV.
- The server PDF reader is best-effort (text-layer PDFs). The main path is the in-browser reader.
