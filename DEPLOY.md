# Deploy the CEE Mock Portal (Apps Script + Google Sheets, free)

You need exactly two things: a Google account and one Google Sheet. No server, no domain,
no card. Whole deploy is ~5 minutes.

---

## 0. Your live deployment (checked 5 Sep 2026)

**Portal URL (already shared with students, keep it):**
`https://script.google.com/macros/s/AKfycbwgnUluOVaruBxQijfMnxtbng0pZ0SL3cKv9aYrMTjpzjdKedUMGZl2rwBgGNHl_CQS/exec`

It is reachable anonymously and answers `?health=1` with the JSON status, so *Execute as: Me /
Access: Anyone* is already right. The health check on that same URL reported:

| Field | Value today | Meaning |
|---|---|---|
| `embeddedHtml` | `no` | the deployed copy is **backend only** — students get a "Portal HTML missing" page |
| `counts` | Users 0, Questions 0 | nobody has registered yet and the bank is unseeded |
| `tabs` | 4 tabs, headers exactly as spec'd | the data model is already correct |
| `emailQuotaLeft` | 100 recipients today | `MailApp` works from this account |
| `spreadsheet` | `Untitled spreadsheet` | rename the sheet so the 5th (leftover) tab and the title are not confusing |

So the only real step left is: **paste `cee_mock_all_in_one.gs` over the deployed code and publish
a new version** —

1. Sheet → **Extensions → Apps Script** → select all in `Code.gs` → delete → paste the whole
   rebuilt `cee_mock_all_in_one.gs` → **Save** (the file already contains your `/exec` URL and the
   support address in `CONFIG`).
2. **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.** Editing code is not
   enough; `/exec` keeps serving the old version until you create one.
3. Open the `/exec` URL → the login/registration screen must appear (not the missing-HTML page).
4. `?health=1` again → `embeddedHtml: "yes (…"`, and now also `portalUrl` plus a `mail` block.

Rebuilding from this repo: `node tools/build.js` (never hand-edit `cee_mock_all_in_one.gs`).

---

## 1. Paste the code

1. Create a Google Sheet → **Extensions → Apps Script**.
2. Delete the default `Code.gs` tab's content, paste **the whole of `cee_mock_all_in_one.gs`**
   (one file: backend + the portal UI, base64-embedded). Save.
3. At the top of the file, inside `var CONFIG = {` — the copy in this repo is **already set for
   cee-notes.cprecnepal.org.np**, so on a re-paste you normally change nothing:

```js
SHEET_ID: '',                              // optional; "" = uses the bound sheet
ADMIN_EMAILS: ['support@cee-notes.cprecnepal.org.np'],  // anyone who can read this inbox can claim a teacher account
PORTAL_URL: 'https://script.google.com/macros/s/AKfycbwgnUluOVaruBxQijfMnxtbng0pZ0SL3cKv9aYrMTjpzjdKedUMGZl2rwBgGNHl_CQS/exec',
MAIL_FROM: 'support@cee-notes.cprecnepal.org.np',        // the "from" address; needs a verified Gmail alias (see 4.)
MAIL_REPLY_TO: 'support@cee-notes.cprecnepal.org.np',    // replies always land here, works with no setup
SUPPORT_EMAIL: 'support@cee-notes.cprecnepal.org.np',    // shown in every email and on the login screen
EMAIL_ENABLED: true,
EMAIL_FEEDBACK: true,                      // per-attempt result email to the student
EMAIL_ADMIN_NOTIFY: true,                  // "new registration" note to teachers
EMAIL_STATUS_NOTIFY: true,                 // approval / rejection / device / password mails
MAX_IMAGE_BYTES: 120000                    // figure size cap, keeps Gmail inline images happy
```

4. **Run `setup_` once** from the editor (function picker → `setup_` → Run) and accept the
   permission prompts. It creates the four tabs, seeds 40 questions, and the sheet then also
   gets a **CEE Mock Portal** menu (Setup / Health check). Setup is not strictly required —
   everything self-creates and self-seeds on first use — but running it means you see the
   "yes, it worked" alert.

## 2. Publish it

**Deploy → New deployment → Web app**
- Description: `portal v1`
- Execute as: **Me**
- Who has access: **Anyone**

Copy the `/exec` URL. That URL *is* your portal — share it (or a QR code) with students.

## 3. First-run flow

1. Open the `/exec` URL on your phone → **Register** with an address from `ADMIN_EMAILS`.
   That first registration is automatically an approved **teacher** (and if you are the very
   first account at all you become a teacher too, whatever your email is).
2. Students register with their email + password. They are `pending` and **cannot log in**.
3. Teacher dashboard → **Approvals** → Approve (the student gets an email automatically).
4. Students log in, pick section/topic/count/time, take the mock, and get a scored result,
   a full answer review and a feedback email. Their first login binds their device.

---

## 4. Making the mail come *from* `support@cee-notes.cprecnepal.org.np`

`MailApp` can only sign mail with an address the **account that owns the script** is allowed to
use, so "sending through" your support address is a one-time Gmail setting, not a code setting:

| Option | What you do | Result |
|---|---|---|
| **A. Reply-To only (zero setup — live today)** | nothing | mail leaves as the sheet owner's Gmail with `Reply-To: support@cee-notes.cprecnepal.org.np`; students hit Reply and it goes to support. The code already does this |
| **B. Gmail alias + your host's SMTP** | Gmail → Settings → Accounts and Import → *Send mail as* → Add email address → **Send through SMTP**, then `smtp.cprecnepal.org.np:465` with the `support@cee-notes.cprecnepal.org.np` mailbox login, and confirm the token Google posts to that inbox | Apps Script may now sign as `support@cee-notes.cprecnepal.org.np`; students see the support address as the sender |
| **C. Workspace domain** | have the admin create `support@cee-notes.cprecnepal.org.np` as a send-as alias (or run the sheet from that account) and enable SMTP forwarding | same as B, no per-user setup |

The portal copes with either state: `sendMail_()` tries the alias once, and if Gmail refuses it
retries **without** `from` (never losing a mail) and remembers that for the rest of the execution.
Teacher → **System → Portal link & support** shows and changes both values without a re-deploy, and
saving fires one test mail so you see the answer immediately. Confirm any time with:

```
https://script.google.com/macros/s/AKfycbwgnUluOVaruBxQijfMnxtbng0pZ0SL3cKv9aYrMTjpzjdKedUMGZl2rwBgGNHl_CQS/exec?health=1
```

→ `mail.aliasAccepted` is `"yes"` (B/C worked), `"not tried yet"`, or `"NO - You may only send
from your address or alias: ..."` (still on option A). `portalUrl` is the link students get in
their emails; leave it empty and they get no link (admins always get one).

---

## 5. This repo is the GitHub Pages door, not the app

`cee-notes.github.io/portal/` serves the **root `index.html`** of this repo, and that file is a
landing page: your logo, the CPREC + Facebook links, a big *Open the portal* button and a
3-second auto-redirect to the Apps Script `/exec` URL. It contains no app code on purpose —
Pages is a static host, so `google.script.run` does not exist there and a published copy of the
portal UI can only render a dead login form.

Layout of this repo (the split form of `tools/paths.js`; the code repo keeps the flat form):

| Path | What it is |
|---|---|
| `index.html` | the Pages door — this is what students land on |
| `src/Code.gs`, `src/index.html` | the real portal: Apps Script backend + portal UI |
| `dist/cee_mock_all_in_one.gs` | **paste this into Apps Script** — the generated single file (backend + UI base64-embedded) |
| `tools/` | build + 91 acceptance checks; `bash tools/run.sh` works in this layout unchanged |

Never paste this repo's old root-level `Code.gs` / `cee_mock_all_in_one.gs` (they are gone now) or
anything except `dist/cee_mock_all_in_one.gs`: an artifact built before the UI was embedded is what
made the live deployment answer *"Portal HTML missing"*.

To disable the auto-jump, delete the `AUTO_REDIRECT` block at the bottom of `index.html`.

---

## What lives where

| Sheet tab | Columns |
|---|---|
| `Users` | id, name, email, username, pass (sha-256), role, status, deviceId, session, sessionExpiry, created |
| `Attempts` | ts, userId, name, email, score, total, correct, wrong, skipped, acc, section, detailCount |
| `Responses` | ts, userId, itemIndex, question, topic, chosenLetter, correctLetter, wasCorrect (1/0/−1), explanation, image |
| `Questions` | section, topic, question, A, B, C, D, answer, explanation, image |

Marking is computed **only** in `mark()` / `apiSubmitMock_()`: correct **+1**, wrong **−0.25**,
not attempted **0**. The browser never receives the answer key: `startMock` sends
question + four options + the shuffle order, and `submitMock` marks against the question hashes
and orders held in Script Properties, so nothing the student's dev-tools can touch changes a mark.

## Bulk upload

Teacher dashboard → **Question bank** → paste CSV or upload `.csv`/`.xlsx`. Columns (order-free,
and `Subject/Q/Correct/Solution` style headers are understood):

```
section,topic,question,A,B,C,D,answer,explanation,image
```

- `section`: `Bio` / `Chem` / `Phy` / `Math` (also accepts "biology", "physics", …)
- `topic`: micro-syllabus code — Bio `Z1–Z9`+`B1–B6`, Chem `C1–C7`, Phy `P1–P8`, Math `M1–M9`
- `answer`: a letter **or** the exact option text — both resolve
- `image`: a URL **or** a `data:image/...;base64,` URI (used for MAT-style figure questions)

`questions-template.csv` in this repo is a ready-made sample. **Export bank as CSV** gives you
the current bank back in the same shape, so Excel/LibreOffice is a fine editor.

## Figures / PDF builder

- **Upload** in the question form resizes to ≤1000 px, re-encodes as JPEG and stores it *inside*
  the Questions cell as a `data:` URI — so it renders in the quiz, the review and the email with
  no hosting. Cap is `MAX_IMAGE_BYTES` (120 KB); above that the portal refuses with advice.
  If you want big images or guaranteed email rendering, host them and paste the URL instead.
- **PDF builder** tab: open a syllabus/study PDF, the text is read **in the browser** with pdf.js,
  click a sentence (or highlight your own) to insert it, tag the topic code, add 4 options, save.
  If the CDN is blocked, the *Read this PDF on the server instead* button uses the built-in
  PDF text reader; scanned PDFs have no text layer, so type the question instead.

## Real limits you should know

| Limit | Value | Consequence |
|---|---|---|
| Gmail (consumer) email recipients/day | **100** | ~33 submitted mocks/day before feedback mail stops. Teacher Health check shows what is left. Move the sheet to a Workspace account for 1 500, or set `EMAIL_FEEDBACK: false` (the in-portal review keeps working) |
| Script runtime | 6 min per call | a 200-question submit is still ~2 s |
| Script Properties value | 9 KB | the in-progress paper (hashes + orders) is ~4.5 KB at the 200-question cap |
| Sheets writes | serialised | every read-modify-write holds `LockService.getScriptLock()` and writes only the affected row's cells, so 30 students submitting at once queue instead of corrupting; if a queue exceeds 30 s you get "the portal is busy", which is safe to retry |
| Cold start | 2–5 s | the first hit of the day is slow |
| Passwords | sha-256 of `password|email` | hashed, never stored plain (no per-salt; a Sheets-only design trade-off) |

## Troubleshooting

| Symptom | Fix |
|---|---|
| `No spreadsheet bound. Set CONFIG.SHEET_ID` | paste the sheet id from the URL into `CONFIG.SHEET_ID` (or keep the script bound via Extensions → Apps Script) |
| `/exec` asks you to sign in | the deployment is not "Anyone" — Deploy → Manage → edit, set **Anyone**, then **Deploy** again (edits need a new version) |
| Student says "locked to another device" | Teacher dashboard → Students → **Reset device** (emails them) |
| "Your account is pending teacher approval" | Approvals tab → Approve |
| Session expired after a day | by design — `SESSION_HOURS: 24` |
| Emails missing | `MailApp` quota hit (see table) or `EMAIL_*` toggle off; the portal never fails because of mail |
| Mail arrives from the sheet owner, not `support@cee-notes.cprecnepal.org.np` | the alias is not verified in Gmail (option B/C above) — Reply-To still routes replies to support, and the Health check says `aliasAccepted: "NO - ..."` |
| Page shows "Portal HTML missing" | the deployed file is `Code.gs` only; paste the generated **`cee_mock_all_in_one.gs`** and publish a new version |
| Students get no link in the approval email | `CONFIG.PORTAL_URL` empty and nothing saved in Teacher → System → Portal link |
| Result page shows fewer/odd items | a teacher edited the Questions tab *during* that attempt; the edit is honoured and the rest is graded from the bank |
| Blank page in a browser | open the browser console — `window.__cee` is exposed for debugging; `?health=1` on the `/exec` URL returns a JSON status if you ever need it |

## Two ways to keep the code

**A. Single file (recommended, what this repo ships):** `cee_mock_all_in_one.gs` only.
**B. Split:** `Code.gs` + a new HTML file named exactly `index` containing `index.html`.
`doGet` prefers `EMBEDDED_HTML` and falls back to the `index` file, so the split form needs no
base64 step (and `include('index')` plus the `/*__INCLUDES__*/` marker are kept if you want the
UI split into more files). Don't ship both and expect the file to win — the embedded copy does.

To rebuild the single file after editing the UI:

```bash
node tools/build.js      # writes cee_mock_all_in_one.gs
bash tools/run.sh        # syntax + build + 91 acceptance checks
```

Optional, if you prefer `clasp` to push code instead of pasting: `clasp push` works with the
`appsscript.json` in this repo (V8, execute-as-me, Anyone). GitHub is just the code store —
the portal runs on `script.google.com`, nothing is hosted from the repo.
