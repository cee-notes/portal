/*******************************************************************
 * CEE MOCK PORTAL  —  Medical Entrance (MBBS/BDS) practice mocks
 * Backend: Google Apps Script + Google Sheets.  No server, no DB.
 *
 * There are TWO supported ways to run this:
 *   A) ONE FILE  : paste  cee_mock_all_in_one.gs  (backend + portal HTML
 *                  embedded as base64).  Nothing else to upload.
 *   B) SPLIT     : paste Code.gs + create an HTML file named "index"
 *                  (Web app picks it up automatically).  No base64 needed.
 *
 * SETUP (30 seconds, once):
 *   1. Create a Google Sheet.  Extensions -> Apps Script -> paste code.
 *   2. OPTIONAL but recommended: set SHEET_ID below.
 *        openById('<SHEET_ID>').getRange("A1").setValue("ok")
 *      If SHEET_ID is "" the code falls back to getActiveSpreadsheet(),
 *      which is fine for bound container scripts.
 *   3. Deploy -> New deployment -> Web app
 *        Execute as: Me   |   Who has access: Anyone
 *   4. Register your admin email first (ADMIN_EMAILS) -> auto-approved.
 *      Students register, you approve them, they take mocks.
 *
 * Tabs Users / Attempts / Responses / Questions are created by itself.
 * Run setup_() from the editor once to seed the default question bank.
 *******************************************************************/

var CONFIG = {
  APP_NAME: 'CEE Mock Portal',
  /** Put your spreadsheet id here if you are NOT using a bound container
   *  script (e.g. script attached to the sheet).  "" = use active sheet. */
  SHEET_ID: '',

  /** Emails that are ALWAYS teacher/admin and are auto-approved.
   *  The very first registration of all also becomes an admin. */
  ADMIN_EMAILS: ['principal@example.com'],

  SESSION_HOURS: 24,          // feature 4: 24-hour sessions
  GRACE_SECONDS: 90,          // extra time tolerated by the server before it clamps
  MAX_QUESTIONS_PER_MOCK: 200,
  EMAIL_FROM_NAME: 'CEE Mock Portal',
  EMAIL_REPLY_TO: 'support@cee-notes.cprecnepal.org.np',  // reply-to address for all outgoing mails
  WEB_APP_URL: 'https://script.google.com/macros/s/AKfycbwgnUluOVaruBxQijfMnxtbng0pZ0SL3cKv9aYrMTjpzjdKedUMGZl2rwBgGNHl_CQS/exec',  // deployed web app URL
  EMAIL_ENABLED: true,        // master switch: false = no MailApp calls at all
  /** Personal Gmail accounts may only send ~100 recipients/day from Apps Script.
   *  If a mock day pushes you over the quota, switch the feedback mail off (or move
   *  the sheet to a Workspace account) - the in-portal review always still works. */
  EMAIL_FEEDBACK: true,       // per-attempt result + explanations to the student
  EMAIL_ADMIN_NOTIFY: true,   // "new registration" note to teachers
  EMAIL_STATUS_NOTIFY: true,  // approval / rejection / device-reset / password mails
  MAX_IMAGE_BYTES: 120000     // keeps data: images inside Gmail's inline-image cap
};

var TAB_USERS = 'Users';
var TAB_ATTEMPTS = 'Attempts';
var TAB_RESPONSES = 'Responses';
var TAB_QUESTIONS = 'Questions';

var HEADERS = {};
HEADERS[TAB_USERS] = ['id', 'name', 'email', 'username', 'pass', 'role', 'status',
  'deviceId', 'session', 'sessionExpiry', 'created'];
HEADERS[TAB_ATTEMPTS] = ['ts', 'userId', 'name', 'email', 'score', 'total', 'correct',
  'wrong', 'skipped', 'acc', 'section', 'detailCount'];
HEADERS[TAB_RESPONSES] = ['ts', 'userId', 'itemIndex', 'question', 'topic', 'chosenLetter',
  'correctLetter', 'wasCorrect', 'explanation', 'image'];
HEADERS[TAB_QUESTIONS] = ['section', 'topic', 'question', 'A', 'B', 'C', 'D', 'answer',
  'explanation', 'image'];

var SECTIONS = ['Bio', 'Chem', 'Phy', 'Math'];

/** Micro-syllabus topic codes used to tag questions (feature 12). */
var SYLLABUS = {
  Bio: {
    Z: [['Z1', 'Cell biology & biomolecules'], ['Z2', 'Plant tissue & anatomy'],
        ['Z3', 'Transport & mineral nutrition'], ['Z4', 'Photosynthesis & respiration'],
        ['Z5', 'Genetics & evolution'], ['Z6', 'Ecology & environment'],
        ['Z7', 'Plant growth & hormones'], ['Z8', 'Reproduction (plants)'],
        ['Z9', 'Biotechnology & immunology']],
    B: [['B1', 'Human digestion & absorption'], ['B2', 'Breathing & circulation'],
        ['B3', 'Excretion & osmoregulation'], ['B4', 'Locomotion & skeletal system'],
        ['B5', 'Neural control & coordination'], ['B6', 'Reproduction & development']]
  },
  Chem: [['C1', 'Physical & mole concept'], ['C2', 'Atomic structure & bonding'],
         ['C3', 'Thermodynamics & equilibrium'], ['C4', 'Solutions & electrochemistry'],
         ['C5', 'Organic: hydrocarbons & isomerism'], ['C6', 'Organic: functional groups'],
         ['C7', 'Inorganic: periodic table & p-block']],
  Phy: [['P1', 'Mechanics & vectors'], ['P2', 'Work, energy & power'],
        ['P3', 'Gravitation & rotational motion'], ['P4', 'Properties of matter'],
        ['P5', 'Thermodynamics & KTG'], ['P6', 'Waves & oscillations'],
        ['P7', 'Electricity, magnetism & EMI'], ['P8', 'Optics & modern physics']],
  Math: [['M1', 'Sets, relations & functions'], ['M2', 'Complex numbers'],
         ['M3', 'Matrices & determinants'], ['M4', 'Sequences & series'],
         ['M5', 'Trigonometry'], ['M6', 'Coordinate geometry'],
         ['M7', 'Limits, continuity & differentiability'], ['M8', 'Applications of derivatives & integrals'],
         ['M9', 'Statistics & probability']]
};

/* ==================================================================
 * MARKING POLICY  (feature 5) - server side only, never trust client
 * ================================================================== */
function mark(correct) { return correct ? 1 : -0.25; }

/* ==================================================================
 * WEB APP ENTRY
 * ================================================================== */
function doGet(e) {
  var q = (e && e.parameter) ? e.parameter : {};
  if (q.health === '1' || q.mode === 'health') return jsonOut_(health_());

  var html = '';
  try { html = getPortalHtml_(); } catch (err) { html = bootErrorHtml_(String(err)); }
  return HtmlService.createHtmlOutput(html)
    .setTitle(CONFIG.APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function bootErrorHtml_(msg) {
  return '<!doctype html><meta charset="utf-8"><body style="background:#0f1220;color:#e8ebff;' +
    'font:15px/1.6 system-ui;padding:24px"><h2>Portal HTML missing</h2><p>' +
    'This build has no embedded HTML. Paste <b>cee_mock_all_in_one.gs</b>, or add an ' +
    'HTML file named <b>index</b> with the contents of index.html.</p><pre style="opacity:.7">' +
    String(msg).replace(/</g, '&lt;') + '</pre></body>';
}

function include(name) {
  try { return HtmlService.createHtmlOutputFromFile(name).getContent(); }
  catch (err) { return ''; }
}

/** Priority: EMBEDDED_HTML (base64, all-in-one build) -> index.html file. */
function getPortalHtml_() {
  if (typeof EMBEDDED_HTML !== 'undefined' && EMBEDDED_HTML && String(EMBEDDED_HTML).replace(/\s+/g, '').length > 200) {
    return Utilities.newBlob(Utilities.base64Decode(String(EMBEDDED_HTML).replace(/\s+/g, '')), 'text/html').getDataAsString('UTF-8');
  }
  var html = include('index');
  if (!html) throw new Error('no HTML: neither EMBEDDED_HTML nor file "index" found');
  return html;
}

/* ==================================================================
 * LOW LEVEL SHEET HELPERS
 * ================================================================== */
function getSS_() {
  if (CONFIG.SHEET_ID && String(CONFIG.SHEET_ID).length > 10) {
    return SpreadsheetApp.openById(String(CONFIG.SHEET_ID));
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  throw new Error('No spreadsheet bound. Set CONFIG.SHEET_ID to your sheet id.');
}

/** Returns {sheet:Sheet, headers:string[], index:{}} - header row is row 1. */
function tab_(name) {
  var ss = getSS_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name].slice()]);
    sh.setFrozenRows(1);
  }
  var head = sh.getRange(1, 1, 1, Math.max(HEADERS[name].length, 1)).getValues()[0];
  var idx = {};
  var hdr = HEADERS[name];
  for (var i = 0; i < hdr.length; i++) {
    idx[hdr[i]] = i + 1;                     // canonical column number (source of truth)
    if (!head[i]) sh.getRange(1, i + 1).setValue(hdr[i]);   // repair missing header cells
    else if (String(head[i]).toLowerCase() !== hdr[i].toLowerCase()) head[i] = hdr[i];
  }
  return { sheet: sh, headers: head, index: idx, cols: hdr.length };
}

function col_(t, key) {
  var c = t.index[key];
  if (!c) throw new Error('Column "' + key + '" missing on tab ' + t.sheet.getName());
  return c;
}

/** All data rows as objects (header name -> value). */
function rowsOf_(name) {
  var t = tab_(name);
  var last = t.sheet.getLastRow();
  var out = [];
  if (last < 2) return out;
  var values = t.sheet.getRange(2, 1, last - 1, t.headers.length).getValues();
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var isEmpty = true;
    for (var c = 0; c < row.length; c++) { if (String(row[c]).length) { isEmpty = false; break; } }
    if (isEmpty) continue;
    var o = { _row: r + 2 };
    for (var k = 0; k < t.headers.length; k++) {
      if (t.headers[k]) o[String(t.headers[k])] = row[k];
    }
    out.push(o);
  }
  return out;
}

/** Read-modify-write ONE row only (never rewrites the tab). */
function updateRow_(name, rowNum, patch) {
  var t = tab_(name);
  var values = t.sheet.getRange(rowNum, 1, 1, t.headers.length).getValues()[0];
  for (var key in patch) {
    var c = col_(t, key);
    values[c - 1] = patch[key];
  }
  t.sheet.getRange(rowNum, 1, 1, t.headers.length).setValues([values]);
}

function appendRow_(name, obj) {
  var t = tab_(name);
  var hdr = HEADERS[name];
  var row = [];
  for (var i = 0; i < hdr.length; i++) {
    var v = obj[hdr[i]];
    row.push(v === undefined || v === null ? '' : v);
  }
  t.sheet.appendRow(row);
  return t.sheet.getLastRow();
}

function deleteRow_(name, rowNum) {
  tab_(name).sheet.deleteRow(rowNum);
}

/* ---------- users ---------- */
/** Sessions are looked up by the token itself (it is not a user id). */
function findUserByToken_(token) {
  var key = str_(token);
  if (!key) return null;
  var rows = rowsOf_(TAB_USERS);
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i].session) === key) return rows[i];
  }
  return null;
}

function findUserRow_(name, value) {
  var key = String(value || '').trim().toLowerCase();
  if (!key) return null;
  var rows = rowsOf_(TAB_USERS);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].id).toLowerCase() === key) return rows[i];
    if (String(rows[i].email).trim().toLowerCase() === key) return rows[i];
    if (rows[i].username && String(rows[i].username).trim().toLowerCase() === key) return rows[i];
  }
  return null;
}

/* ---------- questions ---------- */
function questionsRaw_() {
  var t = tab_(TAB_QUESTIONS);
  var last = t.sheet.getLastRow();
  if (last < 2) return { t: t, rows: [] };
  var values = t.sheet.getRange(2, 1, last - 1, t.headers.length).getValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var q = values[i][2];
    var has = false;
    for (var c = 0; c < 10; c++) { if (String(values[i][c]).length) { has = true; break; } }
    if (!has || String(q).trim() === '') continue;
    // The "answer" column may hold a letter (A-D) or the full option text.
    var ans = normLetter_(values[i][7]);
    if (!ans) {
      ans = letterFromText_(values[i][7], { A: values[i][3], B: values[i][4], C: values[i][5], D: values[i][6] });
    }
    if (!ans) ans = 'A';
    rows.push({ _row: i + 2,
      section: normSection_(values[i][0]), topic: str_(values[i][1]),
      question: str_(values[i][2]), A: str_(values[i][3]), B: str_(values[i][4]),
      C: str_(values[i][5]), D: str_(values[i][6]),
      answer: ans, explanation: str_(values[i][8]), image: str_(values[i][9]) });
  }
  return { t: t, rows: rows };
}

function bankMap_(list) {
  var m = {};
  for (var i = 0; i < list.length; i++) {
    var k = keyOf_(list[i].question);
    if (!m[k]) m[k] = [];
    m[k].push(list[i]);
  }
  return m;
}

/* ==================================================================
 * SMALL UTILITIES
 * ================================================================== */
function str_(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function hashKey_(q) {
  return sha256_(keyOf_(q)).slice(0, 12);
}
function keyOf_(s) {
  return str_(s).toLowerCase().replace(/[\s\u00a0]+/g, ' ')
    .replace(/[.,;:!?'"\u2018\u2019\u201c\u201d()\[\]{}]/g, '').trim();
}
function ok_(extra) { var o = { ok: true }; if (extra) for (var k in extra) o[k] = extra[k]; return o; }
function err_(msg, extra) {
  var o = { ok: false, error: msg };
  if (extra) for (var k in extra) o[k] = extra[k];
  return o;
}
/** Uniform failure object (also used to catch client-side network noise). */
function fail_(what, e) {
  var m = (e && e.message) ? e.message : String(e);
  if (/Access denied|auth|x-frame|network|permission|not authorized/i.test(m) && !/Access denied to a Google Doc|no spreadsheet/i.test(m)) {
    return err_(m);
  }
  return err_('Could not ' + what + ': ' + m);
}

function sha256_(text) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
  var out = '';
  for (var i = 0; i < raw.length; i++) {
    var v = (raw[i] < 0 ? raw[i] + 256 : raw[i]).toString(16);
    out += (v.length === 1 ? '0' : '') + v;
  }
  return out;
}
function uid_(prefix) {
  return (prefix || '') + Utilities.getUuid().replace(/-/g, '').slice(0, 20);
}
function deviceIdOf_(email, ua) {
  return sha256_('dev|' + str_(email).toLowerCase() + '|' + str_(ua)).slice(0, 32);
}
function now_() { return new Date().getTime(); }
function iso_(ms) {
  var d = ms ? new Date(ms) : new Date();
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}
function fmtTs_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (typeof v === 'number' || /^\d{10,}$/.test(String(v))) return iso_(Number(v));
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  return String(v);
}
function shuffle_(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}
function clampNum_(v, lo, hi, dflt) {
  var n = Number(v);
  if (isNaN(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
function normSection_(v) {
  var s = str_(v);
  var alias = { bio: 'Bio', biology: 'Bio', bot: 'Bio', botany: 'Bio', zoo: 'Bio', zoology: 'Bio',
    chem: 'Chem', chemistry: 'Chem', phy: 'Phy', physics: 'Phy', math: 'Math', maths: 'Math',
    mathematics: 'Math', 'bio.': 'Bio', 'chem.': 'Chem', 'phy.': 'Phy' };
  var low = s.toLowerCase().trim();
  if (alias[low]) return alias[low];
  for (var i = 0; i < SECTIONS.length; i++) { if (SECTIONS[i].toLowerCase() === low) return SECTIONS[i]; }
  return s || 'Bio';
}

/** Only a real option letter counts: "B", "b)", "Option C", "Answer = D".
 *  Anything else (including a full option text such as "equal") returns '' so the
 *  caller can fall back to matching the text against the four options. */
function normLetter_(v) {
  var up = str_(v).toUpperCase();
  if (!up) return '';
  if (/^[A-D]$/.test(up)) return up;
  var m = up.match(/^(?:OPT(?:ION)?|ANSWER|KEY|CORRECT(?:\s+ANSWER)?|RIGHT|Sahi)?\s*[:=]?\s*([A-D])\s*[.)\]]?$/);
  return m ? m[1] : '';
}
function letterFromText_(text, q) {
  var t = keyOf_(text);
  if (!t) return '';
  var opt = ['A', 'B', 'C', 'D'];
  for (var i = 0; i < 4; i++) {
    if (keyOf_(q[opt[i]]) === t) return opt[i];
  }
  return '';
}
function numOrNull_(v) {
  if (v === '' || v === null || v === undefined) return 0;
  var n = Number(v);
  return isNaN(n) ? 0 : Math.round(n * 1000) / 1000;
}

/* ==================================================================
 * SESSIONS / AUTH
 * ================================================================== */
function SessionError_(msg) { this.name = 'Session'; this.message = msg; }
SessionError_.prototype = new Error();

function requireUser_(token, ident) {
  var u = findUserByToken_(token);
  if (!u && str_(ident)) u = findUserRow_(TAB_USERS, ident);
  if (!u) throw new SessionError_('No account matches this session. Please log in again.');
  if (String(u.status) !== 'approved') {
    throw new SessionError_(String(u.status) === 'pending'
      ? 'Your account is waiting for teacher approval.'
      : 'This account is ' + u.status + '. Contact your teacher.');
  }
  var exp = Number(u.sessionExpiry || 0);
  if (!str_(token) || str_(u.session) !== str_(token) || !exp || exp < now_()) {
    throw new SessionError_('Session expired (24 h). Please log in again.');
  }
  u._id = String(u.id);
  u._email = str_(u.email);
  u._row = u._row;
  u._role = str_(u.role);
  return u;
}
function requireTeacher_(token, ident) {
  var u = requireUser_(token, ident);
  if (u._role !== 'teacher' && u._role !== 'admin') throw new SessionError_('Teacher rights required.');
  return u;
}

/* ==================================================================
 * PUBLIC API - AUTH
 * ================================================================== */
function apiRegister_(payload) {
  var email = str_(payload.email).toLowerCase();
  var name = str_(payload.name);
  var pass = String(payload.password || '');
  var username = str_(payload.username).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err_('Enter a valid email address.');
  if (name.length < 2) return err_('Enter your full name.');
  if (pass.length < 6) return err_('Password must be at least 6 characters.');

  return withLock_(function () {
    if (findUserRow_(TAB_USERS, email) || (username && findUserRow_(TAB_USERS, username))) {
      return err_('That email or username is already registered.');
    }
    var admins = CONFIG.ADMIN_EMAILS.map(function (x) { return String(x).trim().toLowerCase(); });
    var isFirst = rowsOf_(TAB_USERS).length === 0;
    var isAdmin = isFirst || admins.indexOf(email) >= 0;
    var now = now_();
    var row = {
      id: uid_('u_'), name: name, email: email,
      username: username || email.split('@')[0],
      pass: sha256_(pass + '|' + email),
      role: isAdmin ? 'teacher' : 'student',
      status: isAdmin ? 'approved' : 'pending',
      deviceId: '', session: '', sessionExpiry: '', created: now
    };
    appendRow_(TAB_USERS, row);
    var portalUrl = CONFIG.WEB_APP_URL || getRootUrl_();
    notifyAdmins_('New registration', '' + name + ' (' + email + ') registered as ' + row.role +
      (isAdmin ? ' (auto-approved)' : ' and needs approval.') + '\nPortal: ' + portalUrl);
    if (!isAdmin && CONFIG.EMAIL_STATUS_NOTIFY) {
      sendMail_(email, 'Account created - awaiting approval',
        '<p>Hello <b>' + esc_(name) + '</b>,</p><p>Your CEE Mock Portal account (' + esc_(email) +
        ') was created and is <b>pending approval</b>. You will get another email as soon as a teacher approves it.</p>');
    }
    var out = ok_({ status: row.status, role: row.role, email: email,
      message: isAdmin ? 'Admin account created and approved.' : 'Registered! Wait for a teacher to approve your account, then log in.' });
    if (isAdmin) {
      var li = apiLogin_({ ident: email, password: pass,
        deviceId: str_(payload.deviceId) || deviceIdOf_(email, payload.ua), ua: payload.ua });
      if (li.ok) { out.auto = true; out.token = li.token; out.user = li.user; }
    }
    return out;
  });
}

function apiLogin_(payload) {
  var ident = str_(payload.ident).toLowerCase();
  var pass = String(payload.password || '');
  if (!ident || !pass) return err_('Email and password are required.');
  return withLock_(function () {
    var u = findUserRow_(TAB_USERS, ident);
    if (!u || String(u.pass) !== sha256_(pass + '|' + str_(u.email).toLowerCase())) {
      return err_('Email or password is incorrect.');
    }
    var status = str_(u.status);
    if (status === 'pending') return err_('Your account is pending teacher approval. You will get an email when it is approved.');
    if (status !== 'approved') return err_('This account is ' + status + '. Contact your teacher.');

    // The portal generates one random install id per browser profile and keeps it in
    // localStorage; that is what "one device" means here (a browser update that changes
    // the user-agent must not lock a student out).
    var want = str_(payload.deviceId) || deviceIdOf_(ident, payload.ua);
    var bound = str_(u.deviceId);
    if (bound && bound !== want) {
      return err_('This account is locked to another device. Ask your teacher to reset the device lock (Teacher dashboard -> Students).',
        { locked: true });
    }
    var token = uid_('s_');
    var exp = now_() + CONFIG.SESSION_HOURS * 3600 * 1000;   // feature 4
    var patch = { session: token, sessionExpiry: exp };
    if (!bound) patch.deviceId = want;                        // feature 3: first login binds
    updateRow_(TAB_USERS, u._row, patch);
    return ok_({ token: token, user: publicUser_(u), bound: !bound });
  });
}

function apiLogout_(token) {
  try {
    var u = requireUser_(token);
    withLock_(function () { updateRow_(TAB_USERS, u._row, { session: '', sessionExpiry: '' }); });
  } catch (e) { /* logging out of a dead session is fine */ }
  return ok_();
}

function apiMe_(token, ident) {
  var u = requireUser_(token, ident);
  var out = ok_({ user: publicUser_(u), expires: iso_(u.sessionExpiry), syllabus: SYLLABUS });
  out.stats = attemptStats_(u._id);
  if (u._role === 'teacher' || u._role === 'admin') out.pending = countPending_();
  return out;
}

function publicUser_(u) {
  return { id: String(u.id), name: str_(u.name), email: str_(u.email),
    username: str_(u.username), role: str_(u.role), status: str_(u.status),
    hasDevice: !!str_(u.deviceId), created: fmtTs_(u.created) };
}
function countPending_() {
  var rows = rowsOf_(TAB_USERS), n = 0;
  for (var i = 0; i < rows.length; i++) if (String(rows[i].status) === 'pending') n++;
  return n;
}
function attemptStats_(userId) {
  var rows = rowsOf_(TAB_ATTEMPTS), mine = [];
  for (var i = 0; i < rows.length; i++) if (String(rows[i].userId) === String(userId)) mine.push(rows[i]);
  mine.sort(function (a, b) { return Number(b.ts) - Number(a.ts); });
  var best = null, sum = 0;
  for (var j = 0; j < mine.length; j++) {
    var s = Number(mine[j].score) || 0;
    sum += s;
    if (best === null || s > Number(best.score)) best = mine[j];
  }
  return { attempts: mine.length, best: best ? numOrNull_(best.score) : 0,
    avg: mine.length ? Math.round(sum / mine.length * 100) / 100 : 0,
    lastTs: mine.length ? mine[0].ts : '' };
}

/* ==================================================================
 * EXAM ENGINE
 * ================================================================== */
function apiStartMock_(token, opts) {
  var u = requireUser_(token);
  opts = opts || {};
  return withLock_(function () {
    maybeSeed_();                                   // first run: fill the bank from DEFAULT_BANK
    var meta = getBankMeta_();
    var bank = questionsRaw_().rows;
    var source = 'Questions';
    if (bank.length < 4) { bank = DEFAULT_BANK; source = 'seed'; }
    if (!bank.length) { bank = FALLBACK_BANK; source = 'fallback'; }

    var wantSection = str_(opts.section);
    var wantTopic = str_(opts.topic).toUpperCase();
    var pool = [];
    for (var i = 0; i < bank.length; i++) {
      var q = bank[i];
      if (wantSection && wantSection !== 'all' && normSection_(q.section) !== wantSection) continue;
      if (wantTopic && keyOf_(q.topic).indexOf(keyOf_(wantTopic)) < 0) continue;
      pool.push(q);
    }
    if (!pool.length) {
      return err_('No questions match that filter (' + (wantSection || 'all') +
        (wantTopic ? ' / ' + wantTopic : '') + '). Bank size: ' + bank.length + '.');
    }
    shuffle_(pool);
    var count = clampNum_(opts.count, 1, CONFIG.MAX_QUESTIONS_PER_MOCK, 10);
    if (count > pool.length) count = pool.length;
    var selected = pool.slice(0, count);
    var minutes = clampNum_(opts.minutes, 1, 240, Math.max(1, Math.round(count * 1.5)));

    var paper = [], keys = [], orders = [];
    for (var k = 0; k < selected.length; k++) {
      var item = paperItem_(selected[k], k, opts.shuffleOptions !== false);
      paper.push({ i: item.i, question: item.question, topic: item.topic, section: item.section,
        image: item.image, order: item.order, opts: item.opts });
      keys.push(hashKey_(item.question));
      orders.push(item.order);
    }
    setPaperMeta_(u._id, { started: now_(), minutes: minutes, count: paper.length,
      section: wantSection || 'all', topic: wantTopic, source: source, keys: keys, orders: orders });

    return ok_({ paper: paper, minutes: minutes, count: paper.length, source: source,
      startedAt: iso_(now_()),
      meta: { sections: SECTIONS, syllabus: SYLLABUS, bankSize: meta.size } });
  });
}

/** One question as served to the student: options are re-ordered, so the letters
 *  (which is what gets marked) follow the shuffled presentation. */
function paperItem_(q, i, doShuffle) {
  var letters = ['A', 'B', 'C', 'D'];
  if (doShuffle) shuffle_(letters);
  var text = { A: q.A, B: q.B, C: q.C, D: q.D };
  var nonBlank = 0;
  for (var j = 0; j < 4; j++) if (text[letters[j]]) nonBlank++;
  if (nonBlank < 2) letters = ['A', 'B', 'C', 'D'];      // keep it answerable
  return {
    i: i,
    question: q.question,
    topic: q.topic,
    section: normSection_(q.section),
    image: q.image || '',
    order: letters.join(''),
    opts: { A: text[letters[0]], B: text[letters[1]], C: text[letters[2]], D: text[letters[3]] }
  };
}

/** Server-side marking. The paper's identity (question hash) and the option order
 *  live in Script Properties from startMock(), so nothing the browser sends can
 *  change what is marked - the client only supplies "which card did I tap". */
function apiSubmitMock_(token, payload) {
  var u = requireUser_(token);
  payload = payload || {};
  return withLock_(function () {
    var meta = getPaperMeta_(u._id);
    if (!meta || !meta.keys || !meta.keys.length) {
      return err_('No mock is in progress for this account (the paper was cleared). Start a new mock.');
    }
    var bank = questionsRaw_().rows;
    if (!bank.length) bank = DEFAULT_BANK.concat(FALLBACK_BANK);
    else bank = bank.concat(DEFAULT_BANK).concat(FALLBACK_BANK);
    var byHash = {}, used = {};
    for (var b = 0; b < bank.length; b++) {
      var h = hashKey_(bank[b].question);
      if (!byHash[h]) byHash[h] = [];
      byHash[h].push(bank[b]);
    }

    var answers = {};
    var echo = {};
    var items = payload.items || [];
    for (var n = 0; n < items.length; n++) {
      var it = items[n] || {};
      var idx = Number(it.i === undefined ? n : it.i);
      if (isNaN(idx) || idx < 0 || idx >= meta.keys.length) continue;
      if (answers[idx] === undefined) { answers[idx] = Number(it.chosen) || 0; echo[idx] = str_(it.question); }
    }

    var ts = Number(payload.ts) || now_();
    var correct = 0, wrong = 0, skipped = 0, score = 0, notFound = 0, tampered = 0;
    var rows = [];
    for (var i = 0; i < meta.keys.length; i++) {
      var key = meta.keys[i];
      var order = meta.orders && meta.orders[i] ? String(meta.orders[i]) : 'ABCD';
      var pool2 = byHash[key] || [];
      var q = null;
      for (var c = 0; c < pool2.length; c++) {
        var tag = key + '#' + c;
        if (!used[tag]) { used[tag] = true; q = pool2[c]; break; }
      }
      if (!q) q = pool2.length ? pool2[0] : null;

      var slot = answers[i] === undefined ? 0 : answers[i];
      var chosenLetter = (slot >= 1 && slot <= 4) ? normLetter_(order.charAt(slot - 1)) : '';
      var state, wasCorrect;
      if (!q) { notFound++; state = 'missing'; skipped++; wasCorrect = -1; }
      else if (echo[i] && keyOf_(echo[i]) !== keyOf_(q.question)) {
        tampered++; state = 'missing'; skipped++; wasCorrect = -1;      // answered a question we never served
      } else if (!chosenLetter) { state = 'skipped'; skipped++; wasCorrect = -1; }
      else if (chosenLetter === (q.answer || 'A')) { state = 'correct'; correct++; score += mark(true); wasCorrect = 1; }
      else { state = 'wrong'; wrong++; score += mark(false); wasCorrect = 0; }

      rows.push({
        opts: q ? { A: q.A, B: q.B, C: q.C, D: q.D } : null,
        ts: ts, userId: u._id, itemIndex: i,
        question: q ? q.question : (echo[i] || '(question no longer in the bank)'),
        topic: q ? q.topic : '', chosenLetter: state === 'missing' ? '' : chosenLetter,
        correctLetter: q ? (q.answer || 'A') : '', wasCorrect: wasCorrect,
        explanation: q ? q.explanation : '', image: q ? (q.image || '') : ''
      });
    }

    var total = meta.keys.length;
    var attempted = correct + wrong;
    var acc = attempted ? Math.round(correct / attempted * 1000) / 10 : 0;
    score = Math.round(score * 100) / 100;

    // ---- deadline is enforced here, not by the browser timer ----
    var started = Number(meta.started) || 0;
    var allowed = (Number(meta.minutes) || Math.ceil(total * 1.5)) * 60 + CONFIG.GRACE_SECONDS;
    var overtime = started && ts > started + allowed * 1000;

    var section = str_(meta.section) || 'all';
    if (meta.topic) section = section + ' / ' + meta.topic;
    if (overtime) section = section + ' (late)';
    var attempt = {
      ts: ts, userId: u._id, name: str_(u.name), email: u._email,
      score: score, total: total, correct: correct, wrong: wrong, skipped: skipped,
      acc: acc, section: section, detailCount: rows.length
    };
    var rowNo = appendRow_(TAB_ATTEMPTS, attempt);

    var tR = tab_(TAB_RESPONSES);
    var block = [];
    for (var r = 0; r < rows.length; r++) {
      block.push([rows[r].ts, rows[r].userId, rows[r].itemIndex, rows[r].question, rows[r].topic,
        rows[r].chosenLetter, rows[r].correctLetter, rows[r].wasCorrect, rows[r].explanation, rows[r].image]);
    }
    if (block.length) tR.sheet.getRange(tR.sheet.getLastRow() + 1, 1, block.length, 10).setValues(block);

    clearPaperMeta_(u._id);

    var result = ok_({
      ts: ts, row: rowNo, score: score, total: total, correct: correct, wrong: wrong,
      skipped: skipped, acc: acc, notFound: notFound, tampered: tampered, overtime: !!overtime,
      perItem: buildPerItem_(rows)
    });
    try {
      var mr = sendFeedbackMail_(u, attempt, rows);
      if (mr && mr.skipped) result.mailSkipped = true;
      if (mr && mr.error) result.mailError = mr.error;
    } catch (e) { result.mailError = String(e && e.message || e); }
    return result;
  });
}

function buildPerItem_(rows) {
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    out.push({
      opts: r.opts || null,
      i: r.itemIndex, question: r.question, topic: r.topic, image: r.image,
      chosen: r.chosenLetter, correct: r.correctLetter,
      state: r.wasCorrect === 1 ? 'correct' : (r.wasCorrect === 0 ? 'wrong' : 'skipped'),
      explanation: r.explanation
    });
  }
  return out;
}

/** Re-open any saved attempt (feature 11). */
function apiGetAttempt_(token, ts, userId) {
  var u = requireUser_(token);
  var mine = String(userId || u._id);
  if (mine !== u._id && u._role !== 'teacher' && u._role !== 'admin') {
    return err_('You can only open your own attempts.');
  }
  var attempts = rowsOf_(TAB_ATTEMPTS);
  var found = null;
  for (var i = 0; i < attempts.length; i++) {
    if (String(attempts[i].userId) === mine && String(attempts[i].ts) === String(ts)) { found = attempts[i]; break; }
  }
  if (!found) return err_('Attempt not found for that time stamp.');
  var all = rowsOf_(TAB_RESPONSES);
  var bankIdx = bankMap_(questionsRaw_().rows);
  var items = [];
  for (var r = 0; r < all.length; r++) {
    var row = all[r];
    if (String(row.userId) !== mine) continue;
    if (String(row.ts) !== String(ts)) continue;
    var bq = (bankIdx[keyOf_(row.question)] || [])[0] || null;
    items.push({
      opts: bq ? { A: bq.A, B: bq.B, C: bq.C, D: bq.D } : null,
      i: Number(row.itemIndex) || 0, question: str_(row.question), topic: str_(row.topic),
      image: str_(row.image), chosen: str_(row.chosenLetter), correct: str_(row.correctLetter),
      state: Number(row.wasCorrect) === 1 ? 'correct' : (Number(row.wasCorrect) === 0 ? 'wrong' : 'skipped'),
      explanation: str_(row.explanation)
    });
  }
  items.sort(function (a, b) { return a.i - b.i; });
  return ok_({
    attempt: { ts: fmtTs_(found.ts), score: numOrNull_(found.score), total: Number(found.total) || 0,
      correct: Number(found.correct) || 0, wrong: Number(found.wrong) || 0,
      skipped: Number(found.skipped) || 0, acc: numOrNull_(found.acc), section: str_(found.section),
      name: str_(found.name), email: str_(found.email) },
    items: items
  });
}

function apiMyAttempts_(token) {
  var u = requireUser_(token);
  var rows = rowsOf_(TAB_ATTEMPTS), out = [];
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].userId) !== u._id) continue;
    out.push(attemptRowView_(rows[i]));
  }
  out.sort(function (a, b) { return Number(b.tsRaw) - Number(a.tsRaw); });
  return ok_({ attempts: out.slice(0, 100) });
}
function attemptRowView_(r) {
  return { tsRaw: Number(r.ts) || 0, ts: fmtTs_(r.ts), score: numOrNull_(r.score), total: Number(r.total) || 0,
    correct: Number(r.correct) || 0, wrong: Number(r.wrong) || 0, skipped: Number(r.skipped) || 0,
    acc: numOrNull_(r.acc), section: str_(r.section), detailCount: Number(r.detailCount) || 0 };
}

/* ==================================================================
 * PAPER METADATA (start time / duration) in Script Properties
 * ================================================================== */
function props_() { return PropertiesService.getScriptProperties(); }
function pkey_(k, id) { return 'CEE_' + k + '_' + id; }
function getPaperMeta_(id) {
  var v = props_().getProperty(pkey_('PAPER', id));
  if (!v) return null;
  try { return JSON.parse(v); } catch (e) { return null; }
}
function setPaperMeta_(id, obj) { props_().setProperty(pkey_('PAPER', id), JSON.stringify(obj)); }
function clearPaperMeta_(id) { props_().deleteProperty(pkey_('PAPER', id)); }

/* ==================================================================
 * TEACHER: APPROVALS, STUDENTS
 * ================================================================== */
function apiAdminOverview_(token) {
  var t = requireTeacher_(token);
  maybeSeed_();
  var users = rowsOf_(TAB_USERS);
  var attempts = rowsOf_(TAB_ATTEMPTS);
  var out = [];
  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    var n = 0, best = '';
    for (var a = 0; a < attempts.length; a++) {
      if (String(attempts[a].userId) === String(u.id)) {
        n++;
        if (best === '' || Number(attempts[a].score) > Number(best)) best = attempts[a].score;
      }
    }
    var exp = Number(u.sessionExpiry || 0);
    out.push({ id: String(u.id), name: str_(u.name), email: str_(u.email), username: str_(u.username),
      role: str_(u.role), status: str_(u.status), created: fmtTs_(u.created),
      device: str_(u.deviceId) ? str_(u.deviceId).slice(0, 8) + '…' : 'not bound',
      sessionActive: exp > now_(), attempts: n, best: numOrNull_(best) });
  }
  out.sort(function (x, y) { return (x.status === 'pending' ? -1 : 1) - (y.status === 'pending' ? -1 : 1); });
  var recent = [];
  for (var r = attempts.length - 1; r >= 0 && recent.length < 25; r--) {
    var row = attempts[r];
    recent.push({ ts: fmtTs_(row.ts), name: str_(row.name), email: str_(row.email), score: numOrNull_(row.score),
      total: Number(row.total) || 0, acc: numOrNull_(row.acc), section: str_(row.section), userId: String(row.userId) });
  }
  recent.reverse();
  return ok_({ users: out, recent: recent, bank: getBankMeta_(),
    syllabus: SYLLABUS, me: publicUser_(t) });
}

function apiSetStatus_(token, userId, status) {
  var t = requireTeacher_(token);
  var allowed = { approved: 1, rejected: 1, pending: 1 };
  if (!allowed[status]) return err_('Unknown status.');
  return withLock_(function () {
    var u = findUserRow_(TAB_USERS, userId);
    if (!u) return err_('No such user.');
    var patch = { status: status };
    if (status !== 'approved') { patch.session = ''; patch.sessionExpiry = ''; }
    updateRow_(TAB_USERS, u._row, patch);
    var subject = status === 'approved' ? 'Your CEE Mock Portal account is approved' : 'Account update';
    var body = status === 'approved'
      ? '<p>Good news <b>' + esc_(str_(u.name)) + '</b> — your account (' + esc_(str_(u.email)) +
        ') is <b>approved</b>. Log in at the portal and start practising.</p><p><b>Note:</b> the account locks to the first device you log in from. If you change phone/laptop, ask your teacher to reset the device lock.</p>'
      : status === 'rejected'
        ? '<p>Hi <b>' + esc_(str_(u.name)) + '</b>, your registration (' + esc_(str_(u.email)) +
          ') could not be approved. Please contact your teacher with your full name and exam details.</p>'
        : '<p>Hi <b>' + esc_(str_(u.name)) + '</b>, your account was moved back to <b>pending</b>.</p>';
    var sent = CONFIG.EMAIL_STATUS_NOTIFY ? sendMail_(str_(u.email), subject, body) : { sent: false, skipped: true };
    return ok_({ message: 'Marked ' + status + (sent.sent ? ' and emailed the student.' : '.'), actor: t._email });
  });
}

function apiResetDevice_(token, userId) {
  var t = requireTeacher_(token);
  return withLock_(function () {
    var u = findUserRow_(TAB_USERS, userId);
    if (!u) return err_('No such user.');
    updateRow_(TAB_USERS, u._row, { deviceId: '', session: '', sessionExpiry: '' });
    if (CONFIG.EMAIL_STATUS_NOTIFY) sendMail_(str_(u.email), 'Device lock reset',
      '<p>Hi <b>' + esc_(str_(u.name)) + '</b>, your teacher reset the one-device lock on your CEE Mock Portal account. Log in once from your new device and it will be bound again.</p>');
    return ok_({ message: 'Device lock cleared. The student can log in from a new device now.' });
  });
}

function apiTeacherResetPassword_(token, userId, newPassword) {
  var t = requireTeacher_(token);
  if (String(newPassword || '').length < 6) return err_('New password must be at least 6 characters.');
  return withLock_(function () {
    var u = findUserRow_(TAB_USERS, userId);
    if (!u) return err_('No such user.');
    updateRow_(TAB_USERS, u._row, { pass: sha256_(newPassword + '|' + str_(u.email).toLowerCase()) });
    sendMail_(str_(u.email), 'Password reset',
      '<p>Hi <b>' + esc_(str_(u.name)) + '</b>, your teacher reset your CEE Mock Portal password to <code>' + esc_(newPassword) + '</code>. Please log in and change it by registering again or asking for another reset.</p>');
    return ok_({ message: 'Password reset and emailed to the student.' });
  });
}

/* ==================================================================
 * TEACHER: QUESTION BANK
 * ================================================================== */
function getBankMeta_() {
  var rows = rowsOf_(TAB_QUESTIONS);
  var bySection = {}, byTopic = {};
  for (var i = 0; i < rows.length; i++) {
    var s = normSection_(rows[i].section);
    var tp = str_(rows[i].topic) || 'un-tagged';
    bySection[s] = (bySection[s] || 0) + 1;
    byTopic[tp] = (byTopic[tp] || 0) + 1;
  }
  return { size: rows.length, bySection: bySection, byTopic: byTopic,
    seeded: props_().getProperty('CEE_SEEDED') === '1' };
}

function apiListQuestions_(token, filter) {
  requireTeacher_(token);
  filter = filter || {};
  var rows = questionsRaw_().rows, out = [];
  for (var i = 0; i < rows.length; i++) {
    var q = rows[i];
    if (filter.section && filter.section !== 'all' && q.section !== filter.section) continue;
    if (filter.topic && keyOf_(q.topic).indexOf(keyOf_(filter.topic)) < 0) continue;
    if (filter.q) {
      var hay = (q.question + ' ' + q.explanation + ' ' + q.topic).toLowerCase();
      if (hay.indexOf(String(filter.q).toLowerCase()) < 0) continue;
    }
    out.push({ row: q._row, section: q.section, topic: q.topic, question: q.question,
      A: q.A, B: q.B, C: q.C, D: q.D, answer: q.answer, explanation: q.explanation,
      hasImage: !!q.image, image: q.image.length > 120 ? q.image.slice(0, 60) + '…(' + q.image.length + ' chars)' : q.image });
  }
  return ok_({ questions: out.slice(0, Number(filter.limit) || 300), meta: getBankMeta_() });
}

function apiSaveQuestion_(token, q) {
  requireTeacher_(token);
  q = q || {};
  var norm = normaliseQuestion_(q);
  if (norm.error) return err_(norm.error);
  return withLock_(function () {
    if (q.row && Number(q.row) > 1) {
      updateRow_(TAB_QUESTIONS, Number(q.row), norm.row);
      return ok_({ message: 'Question updated (row ' + q.row + ').', row: Number(q.row) });
    }
    var r = appendRow_(TAB_QUESTIONS, norm.row);
    return ok_({ message: 'Question added (row ' + r + ').', row: r });
  });
}

function apiDeleteQuestion_(token, row) {
  requireTeacher_(token);
  var n = Number(row);
  if (!(n > 1)) return err_('Bad row.');
  return withLock_(function () { deleteRow_(TAB_QUESTIONS, n); return ok_({ message: 'Row ' + n + ' deleted.' }); });
}

function normaliseQuestion_(q) {
  var section = normSection_(q.section);
  if (SECTIONS.indexOf(section) < 0) {
    return { error: 'Section must be one of ' + SECTIONS.join(', ') + ' (got "' + str_(q.section) + '").' };
  }
  var question = str_(q.question);
  if (question.length < 5) return { error: 'Question text is too short.' };
  var opts = [str_(q.A), str_(q.B), str_(q.C), str_(q.D)];
  var filled = 0;
  for (var i = 0; i < 4; i++) if (opts[i]) filled++;
  if (filled < 2) return { error: 'At least two options are required for: ' + question.slice(0, 40) };
  var answer = normLetter_(q.answer);
  if (!answer && q.answer) answer = letterFromText_(q.answer, { A: opts[0], B: opts[1], C: opts[2], D: opts[3] });
  if (!answer) answer = 'A';
  var img = str_(q.image);
  if (img && img.indexOf('data:') === 0 && img.length > CONFIG.MAX_IMAGE_BYTES * 1.4) {
    return { error: 'Embedded image too large (limit ~' + Math.round(CONFIG.MAX_IMAGE_BYTES / 1024) + ' KB). Re-save it smaller or host it and paste a URL.' };
  }
  return { row: {
    section: section, topic: str_(q.topic), question: question,
    A: opts[0], B: opts[1], C: opts[2], D: opts[3],
    answer: answer, explanation: str_(q.explanation), image: img } };
}

/** Bulk upload: CSV text, CSV file (base64) or XLSX file (base64). */
function apiImportQuestions_(token, payload) {
  requireTeacher_(token);
  payload = payload || {};
  var text = '';
  var fileName = str_(payload.name);
  try {
    if (str_(payload.csv)) {
      text = String(payload.csv);
    } else if (str_(payload.b64)) {
      var bytes = Utilities.base64Decode(str_(payload.b64).replace(/\s/g, ''));
      if (/\.xlsx$/i.test(fileName) || /spreadsheetml/i.test(str_(payload.mime))) {
        var table = parseXlsx_(bytes);
        if (!table) return err_('Could not read that .xlsx (try saving it as CSV).');
        text = tableToCsv_(table);
      } else if (/\.csv$/i.test(fileName) || /text\/(comma|plain)/i.test(str_(payload.mime))) {
        text = Utilities.newBlob(bytes).getDataAsString('UTF-8');
      } else {
        text = Utilities.newBlob(bytes).getDataAsString('UTF-8');
      }
    }
  } catch (e) {
    return err_('Could not read the upload: ' + e.message);
  }
  if (!text) return err_('Nothing to import - the file looks empty.');
  return importFromText_(text, fileName);
}

function importFromText_(text, fileName) {
  var table = parseDelimited_(text);
  if (!table.length) return err_('No rows found.');
  var head = table[0].map(function (h) { return keyOf_(h); });
  var map = {};
  for (var c = 0; c < head.length; c++) map[head[c]] = c;
  var canon = ['section', 'topic', 'question', 'A', 'B', 'C', 'D', 'answer', 'explanation', 'image'];
  var alias = {
    section: ['section', 'subj', 'subject', 'paper', 'group'],
    topic: ['topic', 'code', 'syllabus', 'unit', 'chapter'],
    question: ['question', 'q', 'qtext', 'questiontext', 'stem'],
    A: ['a', 'opta', 'optiona', 'choicea', 'option1', 'aoption'],
    B: ['b', 'optb', 'optionb', 'choiceb', 'option2', 'boption'],
    C: ['c', 'optc', 'optionc', 'choicec', 'option3', 'coption'],
    D: ['d', 'optd', 'optiond', 'choiced', 'option4', 'doption'],
    answer: ['answer', 'ans', 'key', 'correct', 'correctanswer', 'answerkey'],
    explanation: ['explanation', 'explain', 'solution', 'desc', 'reason', 'hint'],
    image: ['image', 'img', 'picture', 'imageurl', 'figure', 'photo']
  };
  // A first row that smells like a header (3+ recognised column names) is skipped as such,
  // so "Subject,Chapter,Q,...,Correct" works just as well as the canonical header.
  var aliasHits = 0;
  for (var hc = 0; hc < head.length; hc++) {
    for (var hn in alias) { if (alias[hn].indexOf(head[hc]) >= 0) { aliasHits++; break; } }
  }
  var hasHeader = head.indexOf('question') >= 0 || aliasHits >= 3;
  var idx = {};
  for (var k = 0; k < canon.length; k++) {
    var name = canon[k];
    var found = -1;
    for (var a = 0; a < alias[name].length; a++) {
      if (map[alias[name][a]] !== undefined) { found = map[alias[name][a]]; break; }
    }
    if (found < 0 && !hasHeader) found = k;            // header-less CSV in canonical order
    idx[name] = found;
  }
  if (idx.question < 0) {
    return err_('Could not find a "question" column. Header must contain: section, topic, question, A, B, C, D, answer' +
      (hasHeader ? '' : ' (or use that exact order with no header row)') + '. Got: ' + table[0].slice(0, 12).join(' | '));
  }
  var cell = function (row, key) { var i = idx[key]; return (i >= 0 && row[i] !== undefined) ? String(row[i]).trim() : ''; };
  var start = hasHeader ? 1 : 0;
  var good = [], bad = [];
  for (var r = start; r < table.length; r++) {
    var row = table[r];
    if (!row.join('').trim()) continue;
    var q = { section: cell(row, 'section'), topic: cell(row, 'topic'), question: cell(row, 'question'),
      A: cell(row, 'A'), B: cell(row, 'B'), C: cell(row, 'C'), D: cell(row, 'D'),
      answer: cell(row, 'answer'), explanation: cell(row, 'explanation'), image: cell(row, 'image') };
    if (!q.answer) { q.answer = cell(row, 'answer'); }
    var n = normaliseQuestion_(q);
    if (n.error) { bad.push('row ' + (r + 1) + ': ' + n.error); continue; }
    good.push(n.row);
  }
  if (!good.length) return err_('Nothing valid to import. ' + bad.slice(0, 4).join('; '));
  var result = withLock_(function () {
    var t = tab_(TAB_QUESTIONS);
    var block = [];
    for (var i = 0; i < good.length; i++) {
      var g = good[i];
      block.push([g.section, g.topic, g.question, g.A, g.B, g.C, g.D, g.answer, g.explanation, g.image]);
    }
    var first = t.sheet.getLastRow() + 1;
    t.sheet.getRange(first, 1, block.length, 10).setValues(block);
    return { added: block.length, firstRow: first };
  });
  return ok_({ message: 'Imported ' + result.added + ' question(s) from ' + (fileName || 'pasted text') + '.',
    added: result.added, skipped: bad.length, problems: bad.slice(0, 25), meta: getBankMeta_(),
    templateHeader: HEADERS[TAB_QUESTIONS] });
}

/** RFC4180-ish CSV / TSV / semicolon splitter. */
function parseDelimited_(text) {
  var s = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  var firstLine = s.split('\n', 1)[0];
  var delim = ',';
  if (firstLine.indexOf('\t') >= 0 && (firstLine.match(/,/g) || []).length === 0) delim = '\t';
  else if ((firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length) delim = ';';
  var rows = [], row = [], field = '', quoted = false;
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (s.charAt(i + 1) === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
    } else {
      if (ch === '"') quoted = true;
      else if (ch === delim) { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
      else field += ch;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  var out = [];
  for (var r = 0; r < rows.length; r++) {
    if (rows[r].join('').trim() === '') continue;
    out.push(rows[r]);
  }
  return out;
}

function tableToCsv_(table) {
  var esc = function (v) {
    var s = String(v === null || v === undefined ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  var lines = [];
  for (var i = 0; i < table.length; i++) lines.push(table[i].map(esc).join(','));
  return lines.join('\n');
}

function apiExportQuestionsCsv_(token) {
  requireTeacher_(token);
  var rows = questionsRaw_().rows;
  var table = [HEADERS[TAB_QUESTIONS].slice()];
  for (var i = 0; i < rows.length; i++) {
    var q = rows[i];
    table.push([q.section, q.topic, q.question, q.A, q.B, q.C, q.D, q.answer, q.explanation,
      q.image && q.image.indexOf('data:') === 0 ? '(embedded image)' : q.image]);
  }
  return ok_({ csv: tableToCsv_(table), count: rows.length });
}

/* ==================================================================
 * XLSX READER (no library, no Drive): .xlsx is a zip of XML parts
 * ================================================================== */
function parseXlsx_(bytes) {
  try {
    var blob = Utilities.newBlob(bytes, 'application/zip', 'book.zip');
    var entries = Utilities.unzip(blob);
    var list = [];
    for (var i = 0; i < entries.length; i++) {
      list.push({ path: String(entries[i].getName() || '').replace(/\\/g, '/'), blob: entries[i] });
    }
    var sharedEnt = findEntry_(list, ['xl/sharedStrings.xml', 'sharedStrings.xml']);
    var shared = sharedEnt ? readSharedStrings_(sharedEnt.blob.getDataAsString('UTF-8')) : [];
    var sheetEnt = findEntry_(list, ['xl/worksheets/sheet1.xml', 'sheet1.xml']);
    if (!sheetEnt) sheetEnt = findEntryMatching_(list, /worksheets\/[^/]+\.xml$/);
    if (!sheetEnt) return null;
    return readSheetXml_(sheetEnt.blob.getDataAsString('UTF-8'), shared);
  } catch (e) {
    return null;
  }
}
function findEntry_(list, names) {
  for (var k = 0; k < names.length; k++) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].path === names[k] || list[i].path.replace(/^.*\//, '') === names[k]) return list[i];
    }
  }
  return null;
}
function findEntryMatching_(list, re) {
  for (var i = 0; i < list.length; i++) { if (re.test(list[i].path)) return list[i]; }
  return null;
}
function decodeXmlEntities_(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(parseInt(d, 10)); })
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
function readSharedStrings_(xml) {
  var out = [];
  var re = /<si>([\s\S]*?)<\/si>/g, m;
  while ((m = re.exec(xml)) !== null) {
    out.push(readTexts_(m[1]));
  }
  return out;
}
function readTexts_(chunk) {
  var parts = [], re = /<t[^>]*>([\s\S]*?)<\/t>/g, m;
  while ((m = re.exec(chunk)) !== null) parts.push(decodeXmlEntities_(m[1]));
  return parts.join('');
}
function colIndex_(ref) {
  var letters = String(ref).replace(/[0-9$]/g, '').toUpperCase();
  var n = 0;
  for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return Math.max(0, n - 1);
}
function readSheetXml_(xml, shared) {
  var rowsOut = [];
  var rowRe = /<row[^>]*>([\s\S]*?)<\/row>|<row[^>]*\/>/g, rm;
  while ((rm = rowRe.exec(xml)) !== null) {
    var inner = rm[1] || '';
    var cells = {};
    var cRe = /<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g, cm;
    while ((cm = cRe.exec(inner)) !== null) {
      var attrs = cm[1] !== undefined ? cm[1] : cm[2];
      var body = cm[3] || '';
      var ref = (attrs.match(/r="([A-Z]+[0-9]+)"/) || [])[1] || '';
      var type = (attrs.match(/t="([^"]+)"/) || [])[1] || 'n';
      var ci = ref ? colIndex_(ref) : Object.keys(cells).length;
      var val = '';
      if (type === 'inlineStr') {
        val = readTexts_(body);
      } else {
        var v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        if (v === undefined) v = '';
        if (type === 's') val = shared[Number(v)] || '';
        else if (type === 'str') val = decodeXmlEntities_(v);
        else val = decodeXmlEntities_(v);
      }
      cells[ci] = val;
    }
    var max = -1;
    for (var k in cells) max = Math.max(max, Number(k));
    var row = [];
    for (var i = 0; i <= max; i++) row.push(cells[i] === undefined ? '' : cells[i]);
    if (row.join('').trim() !== '') rowsOut.push(row);
  }
  return rowsOut.length ? rowsOut : null;
}

/* ==================================================================
 * PDF: server-side text fallback (client-side PDF.js is the main path)
 * ================================================================== */
function apiExtractPdfText_(token, b64, name) {
  requireTeacher_(token);
  if (!str_(b64)) return err_('No PDF data received.');
  try {
    var bytes = Utilities.base64Decode(str_(b64).replace(/\s/g, ''));
    var text = extractPdfText_(bytes);
    if (!text || text.replace(/\s/g, '').length < 20) {
      // last resort: some runtimes convert PDF -> text for us
      try {
        text = Utilities.newBlob(bytes, 'application/pdf', 'x.pdf').getAs('text/plain').getDataAsString('UTF-8');
      } catch (e) {}
    }
    text = String(text || '').replace(/\u0000/g, '').replace(/[ \t]{2,}/g, ' ');
    if (text.replace(/\s/g, '').length < 20) {
      return err_('This PDF exposes no text layer (it is probably a scan). The in-browser reader is the normal path here - if it also failed, load the free pdf.js copy locally.',
        { needsClient: true });
    }
    return ok_({ text: text, chars: text.length, method: 'server' });
  } catch (e) {
    return err_('Server-side PDF reader failed: ' + e.message, { needsClient: true });
  }
}

/** Minimal PDF text reader: walks every stream object, inflates FlateDecode,
 *  and pulls the strings out of the text-showing operators. Best effort by
 *  design - the portal's main reader runs in the browser with pdf.js. */
function extractPdfText_(bytes) {
  var src = bytesToLatin1_(bytes);
  var pos = 0, out = [];
  while (true) {
    var st = src.indexOf('stream', pos);
    if (st < 0) break;
    var en = src.indexOf('endstream', st);
    if (en < 0) break;
    var head = src.slice(Math.max(0, st - 900), st);
    var dictStart = head.lastIndexOf('<<');
    var dict = dictStart >= 0 ? head.slice(dictStart) : head;
    var s = st + 6;
    if (src.charAt(s) === '\r') s++;
    if (src.charAt(s) === '\n') s++;
    var raw = src.slice(s, en);
    var e = raw.length;
    while (e > 0 && (raw.charCodeAt(e - 1) === 10 || raw.charCodeAt(e - 1) === 13)) e--;
    raw = raw.slice(0, e);
    pos = en + 9;
    if (/FlateDecode/.test(dict)) {
      var inflated = inflate_(raw);
      if (!inflated) continue;      // cannot read it - skip the stream
      raw = inflated;
    }
    if (!/\)\s*Tj|TJ\s|\bTJ\b|BT/.test(raw) && !/<[0-9A-Fa-f]{2,}>\s*Tj/.test(raw)) continue;
    var txt = pdfStringsToText_(raw);
    if (txt.replace(/\s/g, '').length > 1) out.push(txt);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

function inflate_(latin1) {
  try {
    var bytes = latin1ToBytes_(latin1);
    var blob = Utilities.newBlob(bytes, 'application/octet-stream', 'z.bin');
    var un = Utilities.ungzip(blob);
    return un.getDataAsString('ISO-8859-1');
  } catch (e) { return ''; }
}

/** Content-stream -> plain text: keeps (...) and <hex> operands of Tj/TJ,
 *  and starts a new line on Td, TD, T-star, BT and ET operators. */
function pdfStringsToText_(content) {
  var out = '', i = 0, n = content.length;
  while (i < n) {
    var ch = content.charAt(i);
    if (ch === '(') {
      var depth = 1, j = i + 1, buf = '';
      while (j < n && depth > 0) {
        var c = content.charAt(j);
        if (c === '\\') {
          var nxt = content.charAt(j + 1);
          if (nxt >= '0' && nxt <= '7') {
            var oct = '';
            for (var k = 0; k < 3 && /[0-7]/.test(content.charAt(j + 1 + k)); k++) oct += content.charAt(j + 1 + k);
            buf += String.fromCharCode(parseInt(oct, 8)); j += 1 + oct.length; continue;
          }
          buf += ({ n: '\n', r: '\n', t: ' ', b: ' ', f: ' ', '(': '(', ')': ')', '\\': '\\' })[nxt] !== undefined
            ? ({ n: '\n', r: '\n', t: ' ', b: ' ', f: ' ', '(': '(', ')': ')', '\\': '\\' })[nxt] : nxt;
          j += 2; continue;
        }
        if (c === '(') depth++;
        if (c === ')') { depth--; if (!depth) break; }
        buf += c; j++;
      }
      out += buf;
      i = j + 1; continue;
    }
    if (ch === '<' && /[0-9A-Fa-f]/.test(content.charAt(i + 1) || '')) {
      var h = content.indexOf('>', i);
      if (h > i && h - i < 4000) {
        var hex = content.slice(i + 1, h).replace(/[^0-9A-Fa-f]/g, ''), dec = '';
        for (var x = 0; x + 1 < hex.length; x += 2) {
          var code = parseInt(hex.substr(x, 2), 16);
          dec += code >= 32 || code === 10 ? String.fromCharCode(code) : ' ';
        }
        if (/\s*Tj/.test(content.slice(h, h + 6))) out += dec;
        i = h + 1; continue;
      }
    }
    if (ch === 'T') {
      var nw = content.substr(i, 2);
      if (nw === 'T*' || nw === 'Td' || nw === 'TD' || nw === 'Tj' || nw === 'TJ') {
        if (nw === 'T*' || nw === 'Td' || nw === 'TD') out += '\n';
        i += 2; continue;
      }
    }
    if (ch === 'E' && content.substr(i, 2) === 'ET') { out += '\n'; i += 2; continue; }
    if (ch === 'B' && content.substr(i, 2) === 'BT') { out += '\n'; i += 2; continue; }
    i++;
  }
  var lines = out.split('\n'), keep = [];
  for (var L = 0; L < lines.length; L++) {
    var line = lines[L].replace(/[ ]{2,}/g, ' ').trim();
    if (line.replace(/[^A-Za-z0-9\u0900-\u097F]/g, '').length < 2) continue;
    keep.push(line);
  }
  return keep.join('\n');
}

function bytesToLatin1_(bytes) {
  var parts = [], CH = 4096;
  for (var i = 0; i < bytes.length; i += CH) {
    var end = Math.min(i + CH, bytes.length), sub = [];
    for (var k = i; k < end; k++) sub.push(bytes[k] < 0 ? bytes[k] + 256 : bytes[k]);
    parts.push(String.fromCharCode.apply(null, sub));
  }
  return parts.join('');
}
function latin1ToBytes_(str) {
  var out = new Int8Array(str.length);
  for (var i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

/* ==================================================================
 * IMAGES  (feature 10) - validate what the client sent
 * ================================================================== */
function apiInspectImage_(token, dataUri) {
  requireTeacher_(token);
  return ok_(describeImage_(dataUri));
}
function describeImage_(dataUri) {
  var s = str_(dataUri);
  if (!s) return { ok: true, empty: true, bytes: 0 };
  if (/^(https?:)?\/\//i.test(s) || /^https?:/i.test(s)) return { ok: true, kind: 'url', bytes: s.length };
  if (s.indexOf('data:') !== 0) return { ok: false, error: 'Image must be a URL or a data: URI.' };
  var comma = s.indexOf(',');
  if (comma < 0) return { ok: false, error: 'Malformed data: URI.' };
  var meta = s.slice(0, comma), b64 = s.slice(comma + 1).replace(/\s/g, '');
  var bytes = Math.floor(b64.length * 3 / 4);
  if (bytes > CONFIG.MAX_IMAGE_BYTES) {
    return { ok: false, bytes: bytes, error: 'Image is ~' + Math.round(bytes / 1024) + ' KB; the limit is ' +
      Math.round(CONFIG.MAX_IMAGE_BYTES / 1024) + ' KB. Crop it or lower the JPEG quality.' };
  }
  return { ok: true, kind: 'data', mime: meta.split(':')[1].split(';')[0], bytes: bytes, base64: b64 };
}

/* ==================================================================
 * CONCURRENCY  (Sheets is not a database -> serialise every RMW)
 * ================================================================== */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  var got = false;
  try { got = lock.waitLock(30000); } catch (e) { got = false; }
  if (!got) throw new Error('The portal is busy (another student is writing to the sheet). Try again in a few seconds.');
  try { return fn(); }
  finally { try { lock.releaseLock(); } catch (e) {} }
}

/* ==================================================================
 * EMAILS  (features 6 and 7) - never let mail break a submission
 * ================================================================== */
function esc_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function getRootUrl_() {
  try { return SpreadsheetApp.getActiveSpreadsheet().getUrl(); }
  catch (e) { try { return getSS_().getUrl(); } catch (e2) { return ''; } }
}
function adminEmails_() {
  var list = [];
  var cfg = CONFIG.ADMIN_EMAILS || [];
  for (var i = 0; i < cfg.length; i++) {
    var a = str_(cfg[i]).toLowerCase();
    if (a && list.indexOf(a) < 0) list.push(a);
  }
  try {
    var users = rowsOf_(TAB_USERS);
    for (var u = 0; u < users.length; u++) {
      if ((str_(users[u].role) === 'teacher' || str_(users[u].role) === 'admin') &&
          String(users[u].status) === 'approved') {
        var m = str_(users[u].email).toLowerCase();
        if (m && list.indexOf(m) < 0) list.push(m);
      }
    }
  } catch (e) {}
  if (!list.length) {
    try { list.push(Session.getActiveUser().getEmail()); } catch (e2) {}
  }
  return list;
}
function sendMail_(to, subject, html, inlineImages) {
  if (!CONFIG.EMAIL_ENABLED || !str_(to)) return { sent: false, skipped: true };
  if (/[Rr]esult:/.test(subject) && !CONFIG.EMAIL_FEEDBACK) return { sent: false, skipped: true };
  try {
    var opt = { to: to, subject: CONFIG.APP_NAME + ' - ' + subject, htmlBody: html,
      name: CONFIG.EMAIL_FROM_NAME };
    if (CONFIG.EMAIL_REPLY_TO) { opt.replyTo = CONFIG.EMAIL_REPLY_TO; }
    if (inlineImages) { opt.inlineImages = inlineImages; }
    MailApp.sendEmail(opt);
    return { sent: true };
  } catch (e) {
    return { sent: false, error: String(e && e.message || e) };
  }
}
function notifyAdmins_(subject, text) {
  if (!CONFIG.EMAIL_ENABLED || !CONFIG.EMAIL_ADMIN_NOTIFY) return 0;
  var list = adminEmails_();
  var html = '<p style="font:15px/1.6 Arial">' + esc_(text).replace(/\n/g, '<br>') + '</p>' +
    '<p style="font:13px Arial;color:#666">' + esc_(iso_(now_())) + ' &middot; ' + esc_(CONFIG.APP_NAME) + '</p>';
  for (var i = 0; i < list.length; i++) sendMail_(list[i], subject, html);
  return list.length;
}

var STATE_LABEL = { correct: 'Correct', wrong: 'Wrong', skipped: 'Not attempted', missing: 'Not found in bank' };
var STATE_COLOR = { correct: '#12a150', wrong: '#d64545', skipped: '#7a8199', missing: '#b07b00' };

function sendFeedbackMail_(u, attempt, rows) {
  var head = '<div style="font:15px/1.6 Arial;color:#111">' +
    '<div style="background:#0f1220;color:#fff;padding:16px 18px;border-radius:10px 10px 0 0">' +
    '<div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;opacity:.7">' + esc_(CONFIG.APP_NAME) + '</div>' +
    '<div style="font-size:22px;font-weight:700">' + numOrNull_(attempt.score) + ' / ' + attempt.total +
    ' &nbsp;pts</div><div style="font-size:13px;opacity:.85">' + esc_(str_(u.name)) + ' &middot; ' + esc_(iso_(attempt.ts)) +
    ' &middot; section ' + esc_(attempt.section || 'all') + '</div></div>' +
    '<table style="border-collapse:collapse;margin:12px 0;font-size:14px">' +
    statCell_('Correct', attempt.correct, '#12a150') + statCell_('Wrong', attempt.wrong, '#d64545') +
    statCell_('Skipped', attempt.skipped, '#7a8199') + statCell_('Accuracy', attempt.acc + '%', '#4f7cff') +
    '</table><p style="font-size:13px;color:#555">Marking: +1 correct, -0.25 wrong, 0 not attempted. ' +
    'Open the portal to re-open this attempt with the same explanations.</p>';

  var inline = {}, html = head, n = 0;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var st = r.wasCorrect === 1 ? 'correct' : (r.wasCorrect === 0 ? 'wrong' : 'skipped');
    var imgHtml = '';
    var img = str_(r.image);
    if (img && /^(https?:)?\/\//i.test(img)) {
      imgHtml = '<img src="' + esc_(img) + '" alt="figure" style="max-width:280px;display:block;margin:6px 0;border-radius:6px">';
    } else if (img && img.indexOf('data:') === 0) {
      var blob = dataUriToBlob_(img, 'figure_' + (i + 1));
      if (blob) {
        var cid = 'fig' + (i + 1) + '_' + n;
        inline[cid] = blob;
        imgHtml = '<img src="cid:' + cid + '" alt="figure" style="max-width:280px;display:block;margin:6px 0;border-radius:6px">';
        n++;
      }
    }
    html += '<div style="border:1px solid #e5e7f0;border-radius:10px;padding:12px 14px;margin:10px 0">' +
      '<div style="font-weight:700;color:' + STATE_COLOR[st] + '">Q' + (Number(r.itemIndex) + 1) + ' &middot; ' +
      esc_(STATE_LABEL[st]) + ' <span style="color:#7a8199;font-weight:400">' + esc_(r.topic) + '</span></div>' +
      '<div style="margin:6px 0">' + esc_(r.question) + '</div>' + imgHtml +
      '<div style="font-size:14px">Your answer: <b>' + (r.chosenLetter ? esc_(r.chosenLetter + ' \u2013 ' + optText_(r, r.chosenLetter)) : '&mdash; none') +
      '</b> &nbsp; Correct: <b style="color:#12a150">' + esc_((r.correctLetter || '?') + (r.correctLetter ? ' \u2013 ' + optText_(r, r.correctLetter) : '')) + '</b></div>' +
      (r.explanation ? '<div style="margin-top:6px;font-size:13px;color:#333;background:#f5f7ff;border-left:3px solid #4f7cff;padding:6px 10px;border-radius:0 6px 6px 0">' +
        esc_(r.explanation) + '</div>' : '') + '</div>';
  }
  html += '</div>';
  return sendMail_(u._email, 'Your mock result: ' + numOrNull_(attempt.score) + '/' + attempt.total, html, inline);
}
function optText_(r, letter) {
  var o = r.opts || {};
  return o[letter] ? String(o[letter]) : '';
}
function statCell_(label, value, color) {
  return '<td style="padding:6px 14px;border:1px solid #e5e7f0"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#7a8199">' +
    esc_(label) + '</div><div style="font-size:18px;font-weight:700;color:' + color + '">' + esc_(value) + '</div></td>';
}
function dataUriToBlob_(uri, nameHint) {
  try {
    var comma = uri.indexOf(',');
    var meta = uri.slice(0, comma);
    if (meta.indexOf('base64') < 0) return null;
    var mime = (meta.split(':')[1] || 'image/png').split(';')[0];
    var bytes = Utilities.base64Decode(uri.slice(comma + 1).replace(/\s/g, ''));
    return Utilities.newBlob(bytes, mime, (nameHint || 'figure') + '.' + mime.split('/')[1]);
  } catch (e) { return null; }
}

/* ==================================================================
 * BANKS  (guaranteed fallback so "Take a mock" always works)
 * ================================================================== */
function seedQuestions_(force) {
  return withLock_(function () {
    var t = tab_(TAB_QUESTIONS);
    var existing = t.sheet.getLastRow() - 1;
    if (existing > 0 && !force) return { seeded: false, existing: existing };
    if (force) {
      if (existing > 0) t.sheet.deleteRows(2, existing);
    }
    var block = [];
    for (var i = 0; i < DEFAULT_BANK.length; i++) {
      var q = DEFAULT_BANK[i];
      block.push([q.section, q.topic, q.question, q.A, q.B, q.C, q.D, q.answer, q.explanation, q.image || '']);
    }
    if (block.length) t.sheet.getRange(2, 1, block.length, 10).setValues(block);
    props_().setProperty('CEE_SEEDED', '1');
    return { seeded: true, count: block.length };
  });
}
/** Called inside an existing script lock, so it must not take the lock again. */
function maybeSeed_() {
  if (props_().getProperty('CEE_SEEDED') === '1') return;
  if (rowsOf_(TAB_QUESTIONS).length > 0) { props_().setProperty('CEE_SEEDED', '1'); return; }
  try { seedIntoEmptyTab_(); props_().setProperty('CEE_SEEDED', '1'); } catch (e) {}
}
function seedIntoEmptyTab_() {
  var t = tab_(TAB_QUESTIONS);
  if (t.sheet.getLastRow() > 1) return { seeded: false, existing: t.sheet.getLastRow() - 1 };
  var block = [];
  for (var i = 0; i < DEFAULT_BANK.length; i++) {
    var q = DEFAULT_BANK[i];
    block.push([q.section, q.topic, q.question, q.A, q.B, q.C, q.D, q.answer, q.explanation, q.image || '']);
  }
  if (block.length) t.sheet.getRange(2, 1, block.length, 10).setValues(block);
  return { seeded: true, count: block.length };
}

/* ==================================================================
 * DIAGNOSTICS / SETUP
 * ================================================================== */
function health_() {
  var out = { app: CONFIG.APP_NAME, at: iso_(now_()), tz: '', tabs: {}, counts: {}, errors: [] };
  try { out.tz = Session.getScriptTimeZone(); } catch (e) {}
  var names = [TAB_USERS, TAB_ATTEMPTS, TAB_RESPONSES, TAB_QUESTIONS];
  for (var i = 0; i < names.length; i++) {
    try {
      var t = tab_(names[i]);
      out.tabs[names[i]] = { rows: Math.max(0, t.sheet.getLastRow() - 1), headers: t.headers.slice(0, HEADERS[names[i]].length).join(',') };
      out.counts[names[i]] = Math.max(0, t.sheet.getLastRow() - 1);
    } catch (e) { out.errors.push(names[i] + ': ' + e.message); }
  }
  try { out.pending = countPending_(); } catch (e) {}
  try { out.embeddedHtml = (typeof EMBEDDED_HTML !== 'undefined' && EMBEDDED_HTML) ? 'yes (' + String(EMBEDDED_HTML).replace(/\s/g, '').length + ' b64 chars)' : 'no'; } catch (e) {}
  try { out.spreadsheet = getSS_().getName(); } catch (e) { out.spreadsheet = 'ERROR: ' + e.message; }
  try { out.admins = adminEmails_().length; } catch (e) {}
  try { out.emailQuotaLeft = MailApp.getRemainingDailyQuota() + ' recipients today'; } catch (e) { out.emailQuotaLeft = 'unknown'; }
  try { out.spreadsheetTabs = getSS_().getSheets().length; } catch (e) {}
  out.locking = 'LockService.getScriptLock() on every read-modify-write';
  out.marking = '+1 / -0.25 / 0';
  return out;
}

function setup_(showSeed) {
  var names = [TAB_USERS, TAB_ATTEMPTS, TAB_RESPONSES, TAB_QUESTIONS];
  for (var i = 0; i < names.length; i++) tab_(names[i]);
  var seed = showSeed === false ? { seeded: false } : (function () {
    var empty = rowsOf_(TAB_QUESTIONS).length === 0;
    return empty ? seedQuestions_(false) : { seeded: false, existing: rowsOf_(TAB_QUESTIONS).length };
  })();
  return { tabsReady: names, seed: seed, health: health_() };
}

/** Clear Users/Attempts/Responses (keeps the bank). Teacher-only, typed phrase required. */
function resetData_(phrase) {
  if (str_(phrase) !== 'RESET DATA') return err_('Type RESET DATA to confirm.');
  return withLock_(function () {
    var names = [TAB_USERS, TAB_ATTEMPTS, TAB_RESPONSES];
    var removed = {};
    for (var i = 0; i < names.length; i++) {
      var t = tab_(names[i]);
      var last = t.sheet.getLastRow();
      if (last > 1) { t.sheet.deleteRows(2, last - 1); removed[names[i]] = last - 1; }
      else removed[names[i]] = 0;
    }
    props_().deleteProperty('CEE_SEEDED');
    return ok_({ removed: removed, message: 'Portal data cleared. The question bank was kept.' });
  });
}

function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('CEE Mock Portal')
      .addItem('Setup / create tabs + seed bank', 'setupFromMenu_')
      .addItem('Health check (logs)', 'healthFromMenu_')
      .addToUi();
  } catch (e) { /* no UI on some clients */ }
}
function setupFromMenu_() {
  var r = setup_(true);
  SpreadsheetApp.getUi().alert('CEE Mock Portal', 'Tabs ready: ' + r.tabsReady.join(', ') +
    '\nSeeded questions: ' + (r.seed.count || r.seed.existing || 0) +
    '\n\nDeploy as a Web app (Execute as: Me, Access: Anyone) and share the /exec URL.', SpreadsheetApp.ButtonSet.OK);
}
function healthFromMenu_() {
  Logger.log(JSON.stringify(health_(), null, 2));
  SpreadsheetApp.getUi().alert('Health check written to the Apps Script logs (View -> Logs).');
}

/* ==================================================================
 * PUBLIC API (google.script.run cannot see functions ending in "_")
 * ================================================================== */
function apiWrap_(label, fn) {
  try { return fn(); }
  catch (e) {
    if (e && e.name === 'Session') return err_(e.message, { session: true });
    return err_(label + ': ' + (e && e.message ? e.message : String(e)));
  }
}

function register(payload)             { return apiWrap_('register', function () { return apiRegister_(payload); }); }
function login(payload)                { return apiWrap_('login', function () { return apiLogin_(payload); }); }
function logout(token)                 { return apiWrap_('logout', function () { return apiLogout_(token); }); }
function me(token)                     { return apiWrap_('me', function () { return apiMe_(token); }); }
function startMock(token, opts)        { return apiWrap_('startMock', function () { return apiStartMock_(token, opts); }); }
function submitMock(token, payload)    { return apiWrap_('submitMock', function () { return apiSubmitMock_(token, payload); }); }
function getAttempt(token, ts, userId) { return apiWrap_('getAttempt', function () { return apiGetAttempt_(token, ts, userId); }); }
function myAttempts(token)             { return apiWrap_('myAttempts', function () { return apiMyAttempts_(token); }); }
function adminOverview(token)          { return apiWrap_('adminOverview', function () { return apiAdminOverview_(token); }); }
function setStatus(token, id, status)  { return apiWrap_('setStatus', function () { return apiSetStatus_(token, id, status); }); }
function resetDevice(token, id)        { return apiWrap_('resetDevice', function () { return apiResetDevice_(token, id); }); }
function resetPassword(token, id, pw)  { return apiWrap_('resetPassword', function () { return apiTeacherResetPassword_(token, id, pw); }); }
function listQuestions(token, f)       { return apiWrap_('listQuestions', function () { return apiListQuestions_(token, f); }); }
function saveQuestion(token, q)        { return apiWrap_('saveQuestion', function () { return apiSaveQuestion_(token, q); }); }
function deleteQuestion(token, row)    { return apiWrap_('deleteQuestion', function () { return apiDeleteQuestion_(token, row); }); }
function importQuestions(token, p)     { return apiWrap_('importQuestions', function () { return apiImportQuestions_(token, p); }); }
function exportQuestionsCsv(token)     { return apiWrap_('exportQuestionsCsv', function () { return apiExportQuestionsCsv_(token); }); }
function extractPdfText(token, b64, n) { return apiWrap_('extractPdfText', function () { return apiExtractPdfText_(token, b64, n); }); }
function inspectImage(token, uri)      { return apiWrap_('inspectImage', function () { return apiInspectImage_(token, uri); }); }
function seedBank(token, force)        { return apiWrap_('seedBank', function () { requireTeacher_(token); return ok_(seedQuestions_(!!force)); }); }
function resetPortal(token, phrase)    { return apiWrap_('resetPortal', function () { requireTeacher_(token); return resetData_(phrase); }); }
function health()                      { return ok_(health_()); }

/* ==================================================================
 * DEFAULT + FALLBACK QUESTION BANKS
 * FALLBACK_BANK is only used if the Questions tab is empty AND seeding failed,
 * so 'Take a mock' can never dead-end. DEFAULT_BANK seeds the tab on first run
 * (setup_() or Teacher dashboard -> Seed default bank).
 * ================================================================== */
/** Tiny PNG figure (340x230) used by the image-based sample question. */
var FIGURE_VECTOR_PNG = (
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAVQAAADmCAYAAACK531/AAAJmUlEQVR42u3dzY0URxiAYTKwtBEgWeLkQHwjEwJAvjgMInIqSA" +
"SxVh/QwNLA9E79fD/PoTw3pLer6nHNznTPm3d//f1s3Maf/304fTWMSOPzl+cfxsh//+O/n1znV4w3x3/+eHrbdrzsPwA9e+3S333+M4wzTEf3H6Ca/+sDqE" +
"A1/00xBSpQgQrUtv2jMQUqUIEK1Jb9MzAFKlCBCtR2/bMwBSpQgQrUVv0zMQUqUIEK1Db9szEFKlCBCtQW/SswBSpQgQrU8v2rMAUqUIEK1NL9KzEFKlCBCt" +
"Sy/asxBSpQgQrUkv07MAUqUIEK1HL9uzAFKlCBCtRS/TsxBSpQgQrUMv27MQUqUIEK1BL9ETAFKlCBCtT0/VEwBSpQgQrU1P2RMAUqUIEK1LT90TAFKlCBCt" +
"SU/RExBSpQgQrUdP1RMQUqUIEK1FT9kTEFKlCBCtQ0/dExBSpQgQrUFP0ZMAUqUIEK1PD9WTAFKlCBCtTQ/ZkwBSpQgQrUsP3ZMAUqUIEK1JD9GTEFKlCBCt" +
"Rw/VkxBSpQgQrUUP2ZMQUqUIEK1DD92TEFKlCBCtQQ/RUwBSpQgQrU7f1VMAUqUIEK1K39lTAFKlCBCtRt/dUwBSpQgQrULf0VMQUqUIEK1OX9VTEFKlCBCt" +
"Sl/ZUxBSpQgQrUZf3VMQUqUIEK1CX9HTAFKlCBCtTp/V0wBSpQgQrUqf2dMAUqUIEK1Gn93TAFKlCBCtQp/R0xBSpQgQrU4f1dMQUqUIEK1KGjM6ZABSpQgQ" +
"pToMYG1biNA9CzV6PWOMPUdbmNA1TX4fpwQnVCdTJteDJ1QvWWH6hAhSlQgQpUoEbF1PoHKlCBCtRBJ1PrH6hABSpQB73Nt/6BClSgAnXQ30ytf6ACFahAHf" +
"QBlPUPVKACFaiDPs23/oEKVKACddBXo6x/oAIVqEAd9D1T6x+oQAUqUAd9ad/6BypQgQrUQXdAWf9ABSpQgTrodlLrH6hABSpQB92bb/0DFahABerTmAedWP" +
"9ABSpQ24M66qlR1j9QgQrU1qCOfASf9Q9UoAK1Laijn2dq/QMVqEBtCeqMh0Nb/0AFKlDbgTrrSfvWP1CBCtRWoM782RLrH6hABWobUGb/BpT1D1SgArUFKC" +
"t+UM/6BypQgVoelFW/Tmr9AxWoQC0Nysqferb+gQpUoJYFZSWmQAUqUIFaFpTVmAIVqEAFaklQdmAKVKACFajlQNmFKVCBClSglgJlJ6ZABSpQgVoGlN2YAh" +
"WoQAVqCVAiYApUoAIVqOlBiYIpUIEKVKCmBiUSpkAFKlCBmhaUaJgCFahABWpKUCJiClSgAhWo6UCJiilQgQpUoKYCJTKmQAUqUIGaBpTomAIVqEAFagpQMm" +
"AKVKACFajhQcmCKVCBClSghl5QmTAFKlCBCtSwCyobpkAFKlCBGnJBZcQUqEAFKlDDLaismAIVqEAFaqgFlRlToAIVqEANs6CyYwpUoE4B1biNA9CzV+P7cY" +
"ap61JnHKC6DteHE6oTasuTqROqE6q3/EDdvqAqYQpUoAIVqNsWVDVMgQpUoAJ1y4KqiClQgQpUoC5fUFUxBSpQgQrUpQuqMqZABSpQgbpsQVXHFKhABSpQly" +
"yoDpgCFahABer0BdUFU6ACFahAndrfCVOgAhWoQJ3W3w1ToAIVqECd0t8RU6ACFahAHd7fFVOgAhWoQB06OmMKVKACFagwBSpQgQpUmAIVqEAFKkxtKKCaf6" +
"ACFaZABSpQgboIU/OvH6hABeqgk6n51w9UoAJ10Nt8868fqEAF6qC/mZp//UAFKlAHfQBl/vUDFahAHfRpvvnXD1SgAnXQV6PMv36gAhWog75nav71AxWoQB" +
"30pX3zrx+oQAXqoDugzL9+oAIVqINuJzX/+oEKVKAOujff/OsHKlCB+jTmQSfmXz9Qgdoe1FFPjTL/+oEK1NagjnwEn/nXD1SgtgV19PNMzb9+oAK1JagzHg" +
"5t/vUDFajtQJ31pH3zrx+oQG0F6syfLTH/+oEK1Dagzv4NKPOvH6hAbQHqih/UM//6gQrU8qCu+nVS868fqEAtDerKn3o2//qBCtSyoK7EFCj6gQrUsqCuxh" +
"Qo+oEK1JKg7sAUKPqBCtRyoO7CFCj6gQrUUqDuxBQo+oEK1DKg7sYUKPqBOgFU4zYOQM9eR48zTF1/I8o4QHUdrg8n1A0n1AgnUyc0/U6o3vKnBzUSpkDRD1" +
"SgpgU1GqZA0Q9UoKYENSKmQNEPVKCmAzUqpkDRD1SgpgI1MqZA0Q9UoKYBNTqmQNEPVKCmADUDpkDRD1Sghgc1C6ZA0Q9UoIYGNROmQNEPVKCGBTUbpkDRD1" +
"SgLgH1WFCvHVkwBYp+oAI13An12xPpV1CBoh+oQAXqRVBfvsXPthDNv36gAjUEqGd/MwUqUIEKVAvqIqg/+wAKqECNMN7/8/zdACpQw4L6q0/zgQrUqKiewQ" +
"pUoG4F9XdfjQIqUKNiegYrUIG6DdR7vmcKVKBmAPXrACpQt4B675f2gQrUbKgCFahLQb1yBxRQgZoR1ZewAhWoU0C9ejspUIFa4cQKVKAOBfUM0nvugAIqUC" +
"ugmuluP6AGvqA/g/QY9yzEA9Qrb7MMI9LI+IAfoCYE9d5/zwnVCTXziRWok0F95KlL2cajp1MnVKPa6fTbW6qNT789MDmh3nFC9X9o/U6o5t9b/kGgOr0Y/o" +
"YKVKA+cEF9yumE6lN+8w9Ujy8Div7hd06Zf6ACFSjulHrlnVLmH6hABYp+J1KgAhUo+mM9bcr8AxWoQNF/J6jmH6hABYr+B1E1/0AFKlD0P4ip+QcqUIGiXz" +
"9QgWpD6dcPVBcUqOZfv36gAtWG0q8fqEC1ofTrBypQLSj9+vUDFag2lH79QAWqDaVfP1CBakPp1w9UoFpQ+vXrBypQbSj9+teDavw4DlBdB8MwrgwnVCdU86" +
"9fv7f8QLWh9OsHKlBtKP36gQpUC0q/fv1ABaoNpV8/UIFqQ+nXD1Sg2lD69QPVBQWq+devH6hAtaH06wcqUG0o/fqBClQLSr9+/UAFqg2lXz9QgWpD6dcPVK" +
"DaUPr1AxWoFpR+/fqBClQbSr9+oALVhtKvH6hAtaH06weqCwpU869fP1CBakPp1w9UoNpQ+vUDFagWlH79+oEKVBtKv36gAtWG0q8fqEC1ofTrBypQLSj9+v" +
"UDFag2lH79QAWqDaVfP1CBakHp1w9UFxSo5l+/fqBaUPr16weqBaVfv36guqD69evXD1QLSr9+/UC1oPTr1w9UC0q/fv1AdUH169ev/+L4Hz92Ml5qbuxbAA" +
"AAAElFTkSuQmCC"
  );

var DEFAULT_BANK = [
  {section: "Phy", topic: "P1", question: "The rate of change of momentum of a body is equal to", A: "the net force acting on it", B: "its impulse", C: "its power", D: "its kinetic energy", answer: "A", explanation: "Newton's second law: F = dp/dt, the net force equals the time rate of change of momentum.", image: ""},
  {section: "Phy", topic: "P1", question: "A projectile has the maximum range when launched at an angle of", A: "30 deg", B: "45 deg", C: "60 deg", D: "90 deg", answer: "B", explanation: "Range R = u^2 sin(2A)/g is maximum when sin 2A = 1, i.e. A = 45 deg.", image: ""},
  {section: "Phy", topic: "P2", question: "A stone dropped from rest reaches the ground in 5 s. The height is nearly (g = 10 m s-2)", A: "25 m", B: "50 m", C: "125 m", D: "250 m", answer: "C", explanation: "h = 1/2 g t^2 = 0.5 x 10 x 25 = 125 m.", image: ""},
  {section: "Phy", topic: "P3", question: "Two planets of masses m1 and m2 are separated by distance d. The mutual gravitational force is proportional to", A: "(m1 + m2) / d^2", B: "m1 m2 d^2", C: "m1 m2 / d", D: "m1 m2 / d^2", answer: "D", explanation: "Newton's law of gravitation F = G m1 m2 / d^2.", image: ""},
  {section: "Phy", topic: "P3", question: "The moment of inertia of a uniform disc about its central axis perpendicular to the plane is", A: "(1/2) MR^2", B: "(2/5) MR^2", C: "(1/12) ML^2", D: "MR^2", answer: "A", explanation: "For a disc I = (1/2) M R^2; ring is MR^2 and solid sphere is (2/5) MR^2.", image: ""},
  {section: "Phy", topic: "P5", question: "The first law of thermodynamics is the law of", A: "inertia", B: "conservation of energy", C: "constant velocity", D: "entropy increase", answer: "B", explanation: "dQ = dU + dW restates conservation of heat energy.", image: ""},
  {section: "Phy", topic: "P8", question: "The focal length of a lens of power -0.5 D is", A: "-2 D", B: "-0.5 m", C: "-2 m", D: "2 m", answer: "C", explanation: "f (in m) = 1 / P = 1 / (-0.5) = -2 m; negative means a diverging lens.", image: ""},
  {section: "Phy", topic: "P7", question: "Four 2 ohm resistors are connected in series across a 12 V battery. The current is", A: "2 A", B: "6 A", C: "0.75 A", D: "1.5 A", answer: "D", explanation: "R_total = 2 x 4 = 8 ohm, so I = V/R = 12/8 = 1.5 A.", image: ""},
  {section: "Phy", topic: "P8", question: "In the photoelectric effect, the maximum kinetic energy of emitted electrons depends on", A: "frequency of light", B: "distance of source", C: "work function only", D: "intensity of light", answer: "A", explanation: "KEmax = h f - phi, so it increases with frequency, not intensity.", image: ""},
  {section: "Phy", topic: "P1", question: "The figure shows two forces acting on a point: the blue arrow is 3 N and the green arrow is 4 N (the grid squares are 1 unit each). The magnitude of the resultant, shown by the dashed line, is", A: "1 N", B: "5 N", C: "7 N", D: "12 N", answer: "B", explanation: "The arrows are at right angles, so R = sqrt(3^2 + 4^2) = 5 N. Figures like this are stored in the 'image' column of the Questions tab and show up in the quiz, the review and the feedback email.", image: FIGURE_VECTOR_PNG},
  {section: "Phy", topic: "P4", question: "A wire is stretched; its Young's modulus depends on", A: "the length", B: "the area of cross-section", C: "the material", D: "the load", answer: "C", explanation: "Modulus of elasticity is a material constant; length, area and load cancel in stress/strain.", image: ""},
  {section: "Chem", topic: "C1", question: "Which one of the following contains the greatest number of atoms?", A: "1 g of O2", B: "1 g of Cl2", C: "1 g of N2", D: "1 g of H2", answer: "D", explanation: "Least molar mass gives most moles: H2 = 0.5 mol of molecules = 1 g-atom x 2, i.e. the largest number of atoms.", image: ""},
  {section: "Chem", topic: "C2", question: "The number of unpaired electrons in Fe2+ (Z = 26) is", A: "4", B: "5", C: "6", D: "2", answer: "A", explanation: "Fe = [Ar]3d6 4s2, so Fe2+ = 3d6 with four unpaired electrons in the five 3d orbitals.", image: ""},
  {section: "Chem", topic: "C2", question: "Which one of the following has a coordinate (dative) bond?", A: "NaCl", B: "NH4+", C: "CH4", D: "HCl", answer: "B", explanation: "In NH4+ the lone pair of NH3 is donated to H+, giving a coordinate bond.", image: ""},
  {section: "Chem", topic: "C6", question: "Acetaldehyde reacts with I2 and NaOH to give", A: "C2H5OH", B: "CH3I", C: "CHI3 (iodoform)", D: "CH3COOH", answer: "C", explanation: "The iodoform (haloform) reaction of a CH3CO- compound gives a yellow ppt of CHI3.", image: ""},
  {section: "Chem", topic: "C6", question: "Propene on reaction with HBr in the absence of peroxide gives mainly", A: "1,2-dibromopropane", B: "propane", C: "1-bromopropane", D: "2-bromopropane", answer: "D", explanation: "Markovnikov's rule: H adds to the carbon with more H, so Br goes to C-2.", image: ""},
  {section: "Chem", topic: "C3", question: "For the reaction N2 + 3H2 = 2NH3, the relation between Kp and Kc is", A: "Kp = Kc(RT)^-2", B: "Kp = Kc(RT)^2", C: "Kp = Kc", D: "Kp = Kc(RT)", answer: "A", explanation: "dn = 2 - 4 = -2, so Kp = Kc (RT)^dn = Kc(RT)^-2.", image: ""},
  {section: "Chem", topic: "C7", question: "In the modern periodic table, the element with the largest atomic radius among the following is", A: "K", B: "Cs", C: "Li", D: "Na", answer: "B", explanation: "Radius increases down a group; caesium is the largest of these.", image: ""},
  {section: "Chem", topic: "C4", question: "The equivalent mass of oxalic acid crystal (H2C2O4.2H2O, M = 126) as a reducing agent is", A: "42", B: "126", C: "63", D: "31.5", answer: "C", explanation: "As a reductant it loses 2 electrons, so Eq. mass = 126/2 = 63.", image: ""},
  {section: "Bio", topic: "Z1", question: "Cell theory was proposed mainly by", A: "Darwin and Wallace", B: "Mendel", C: "Watson and Crick", D: "Schleiden and Schwann", answer: "D", explanation: "Schleiden (plants, 1838) and Schwann (animals, 1839) gave the cell theory; Virchow added 'cells come from cells'.", image: ""},
  {section: "Bio", topic: "Z1", question: "Which cell organelle is the site of protein synthesis?", A: "Ribosome", B: "Vacuole", C: "Centriole", D: "Lysosome", answer: "A", explanation: "Ribosomes (free or on RER) polymerise amino acids into protein.", image: ""},
  {section: "Bio", topic: "Z4", question: "The oxygen liberated during photosynthesis comes from", A: "CO2", B: "H2O", C: "glucose", D: "O3", answer: "B", explanation: "Photolysis of water in PSII releases O2; experiments with O-18 proved this.", image: ""},
  {section: "Bio", topic: "Z5", question: "A cross between two heterozygous tall plants (Tt x Tt) gives a phenotypic ratio of", A: "9:3:3:1", B: "1:2:1", C: "3:1", D: "1:1", answer: "C", explanation: "Monohybrid F2 phenotypic ratio is 3 tall : 1 short (genotypic 1:2:1).", image: ""},
  {section: "Bio", topic: "Z6", question: "The pyramid of energy in any ecosystem is always", A: "inverted or upright", B: "flat", C: "inverted", D: "upright", answer: "D", explanation: "Energy decreases at each successive trophic level, so the energy pyramid is always upright.", image: ""},
  {section: "Bio", topic: "Z7", question: "The plant hormone that mainly promotes fruit ripening is", A: "ethylene", B: "abscisic acid", C: "auxin", D: "gibberellin", answer: "A", explanation: "Ethylene is the gaseous ripening hormone; ABA promotes dormancy and abscission.", image: ""},
  {section: "Bio", topic: "B1", question: "The principal site of absorption of digested food in man is", A: "stomach", B: "small intestine", C: "large intestine", D: "oesophagus", answer: "B", explanation: "Villi and microvilli of the small intestine give the huge surface needed for absorption.", image: ""},
  {section: "Bio", topic: "B2", question: "Which of the following pairs of human skeletal parts is correctly matched?", A: "Stapes - wrist bone", B: "Radius - thigh bone", C: "Humerus - foreleg of a dog", D: "Femur - upper arm bone", answer: "C", explanation: "The humerus of the arm is homologous to the forelimb (humerus) of a dog; the stapes is in the ear, the radius is in the forearm.", image: ""},
  {section: "Bio", topic: "B5", question: "The part of the human brain that controls equilibrium and muscular coordination is", A: "medulla oblongata", B: "hypothalamus", C: "cerebrum", D: "cerebellum", answer: "D", explanation: "Cerebellum coordinates posture, balance and fine muscle activity.", image: ""},
  {section: "Bio", topic: "B6", question: "In man, fertilisation normally takes place in the", A: "ampulla of the fallopian tube", B: "ovary", C: "vagina", D: "uterus", answer: "A", explanation: "The ovum meets the sperm in the ampullary-isthmic junction of the oviduct.", image: ""},
  {section: "Bio", topic: "Z9", question: "The enzyme that cuts DNA at specific recognition sites is", A: "DNA ligase", B: "restriction endonuclease", C: "reverse transcriptase", D: "RNA polymerase", answer: "B", explanation: "Restriction enzymes (e.g. EcoRI) make sticky/blunt cuts at palindromic sites; ligase joins them.", image: ""},
  {section: "Math", topic: "M1", question: "The domain of the real function f(x) = 1 / sqrt(x - 2) is", A: "all real x", B: "x >= 2", C: "x > 2", D: "x != 2", answer: "C", explanation: "We need x - 2 > 0 (strict, since the denominator cannot be zero), so x in (2, infinity).", image: ""},
  {section: "Math", topic: "M2", question: "If z = 3 + 4i, then |z| equals", A: "7", B: "25", C: "1", D: "5", answer: "D", explanation: "|z| = sqrt(3^2 + 4^2) = 5.", image: ""},
  {section: "Math", topic: "M3", question: "The determinant of the 2x2 matrix [2 3; 4 5] is", A: "-2", B: "10", C: "7", D: "2", answer: "A", explanation: "2(5) - 3(4) = 10 - 12 = -2.", image: ""},
  {section: "Math", topic: "M4", question: "The sum of the first 20 terms of the A.P. 3, 7, 11, ... is", A: "840", B: "820", C: "760", D: "800", answer: "B", explanation: "S = n/2 [2a + (n-1)d] = 10 [6 + 19(4)] = 10 x 82 = 820.", image: ""},
  {section: "Math", topic: "M5", question: "The value of tan 15 deg tan 75 deg is", A: "1/2", B: "0", C: "1", D: "2", answer: "C", explanation: "tan 75 = cot 15, and tan x cot x = 1.", image: ""},
  {section: "Math", topic: "M6", question: "The distance of the point (3, -4) from the origin is", A: "7", B: "25", C: "1", D: "5", answer: "D", explanation: "sqrt(9 + 16) = 5.", image: ""},
  {section: "Math", topic: "M7", question: "The limit of (sin 3x)/(5x) as x tends to 0 is", A: "3/5", B: "5/3", C: "0", D: "1", answer: "A", explanation: "sin 3x ~ 3x near 0, so the limit = 3/5.", image: ""},
  {section: "Math", topic: "M8", question: "The derivative of log(x) with respect to x (natural log) is", A: "x", B: "1/x", C: "log x / x", D: "x - 1", answer: "B", explanation: "d/dx ln x = 1/x for x > 0.", image: ""},
  {section: "Math", topic: "M9", question: "A fair die is thrown twice. The probability of getting a total of 9 is", A: "1/6", B: "1/36", C: "1/9", D: "1/12", answer: "C", explanation: "Favourable pairs (3,6),(4,5),(5,4),(6,3) = 4 out of 36 = 1/9.", image: ""},
  {section: "Math", topic: "M9", question: "The mean of the first 10 natural numbers is", A: "5", B: "6", C: "4.5", D: "5.5", answer: "D", explanation: "Sum = 55, mean = 55/10 = 5.5.", image: ""},
];

var FALLBACK_BANK = [
  {section: "Phy", topic: "P1", question: "The dimensional formula of force is", A: "[M L T-1]", B: "[M L T-2]", C: "[M L2 T-3]", D: "[M L-1 T-2]", answer: "B", explanation: "Force = mass x acceleration = kg m s-2, so [M L T-2].", image: ""},
  {section: "Chem", topic: "C1", question: "Number of moles in 8 g of O2 is (M = 32 g/mol)", A: "2", B: "0.125", C: "0.25", D: "0.5", answer: "C", explanation: "n = given mass / molar mass = 8 / 32 = 0.25 mol.", image: ""},
  {section: "Bio", topic: "Z1", question: "The powerhouse of the cell is", A: "Golgi body", B: "Lysosome", C: "Ribosome", D: "Mitochondria", answer: "D", explanation: "Mitochondria carry out aerobic respiration and produce ATP, hence 'powerhouse of the cell'.", image: ""},
  {section: "Math", topic: "M5", question: "The value of sin^2 x + cos^2 x is", A: "1", B: "2", C: "sin 2x", D: "0", answer: "A", explanation: "The Pythagorean identity sin^2 x + cos^2 x = 1 holds for every real x.", image: ""},
  {section: "Bio", topic: "B2", question: "The normal pacemaker of the human heart is", A: "AV node", B: "SA node", C: "Purkinje fibres", D: "Bundle of His", answer: "B", explanation: "The sinoatrial (SA) node fires fastest and sets the heart rate.", image: ""},
  {section: "Chem", topic: "C4", question: "The pH of a 0.01 M NaOH solution at 25 C is", A: "2", B: "7", C: "12", D: "13", answer: "C", explanation: "[OH-] = 10^-2 so pOH = 2 and pH = 14 - 2 = 12.", image: ""},
  {section: "Phy", topic: "P2", question: "A body falls freely from rest. Its velocity after 3 s is (g = 9.8 m s-2)", A: "44.1 m/s", B: "9.8 m/s", C: "19.6 m/s", D: "29.4 m/s", answer: "D", explanation: "v = u + gt = 0 + 9.8 x 3 = 29.4 m/s.", image: ""},
  {section: "Math", topic: "M1", question: "If f(x) = 2x + 3, then f(f(1)) equals", A: "13", B: "19", C: "5", D: "8", answer: "A", explanation: "f(1) = 5, then f(5) = 2(5) + 3 = 13.", image: ""},
];
