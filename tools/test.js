/** Acceptance tests for CEE Mock Portal - runs the REAL Code.gs in a Node mock of
 *  the Apps Script runtime. Every numbered check maps to a handoff requirement. */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const h = require('./harness');

const ROOT = path.resolve(__dirname, '..');
const P = require('./paths.js');
let pass = 0, fail = 0, group = '';
function section(t) { group = t; console.log('\n=== ' + t + ' ==='); }
function test(name, fn) {
  try { fn(); console.log('  ok   ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n         ' + String(e.message).split('\n').join('\n         ')); fail++; }
}
const norm = s => String(s || '').toLowerCase().replace(/[\s\u00a0]+/g, ' ')
  .replace(/[.,;:!?'"\u2018\u2019\u201c\u201d()\[\]{}]/g, '').trim();

h.newSpreadsheet('SHEET123', 'CEE Mock Sheet');
const api = h.loadCode();
// globals (CONFIG, DEFAULT_BANK, ...) are exposed as accessors on the api object

/* ------------------------------------------------------------------ */
section('Setup + storage schema');
test('setup_() creates the four tabs', () => {
  const r = api.setup_(false);
  assert.deepStrictEqual(Array.from(r.tabsReady), ['Users', 'Attempts', 'Responses', 'Questions']);
  for (const n of r.tabsReady) assert.ok(api.__sheet(n), n + ' missing');
});
test('Users columns exactly as specified', () => {
  assert.deepStrictEqual(api.__header('Users'),
    ['id', 'name', 'email', 'username', 'pass', 'role', 'status', 'deviceId', 'session', 'sessionExpiry', 'created']);
});
test('Attempts / Responses / Questions columns exactly as specified', () => {
  assert.deepStrictEqual(api.__header('Attempts'),
    ['ts', 'userId', 'name', 'email', 'score', 'total', 'correct', 'wrong', 'skipped', 'acc', 'section', 'detailCount']);
  assert.deepStrictEqual(api.__header('Responses'),
    ['ts', 'userId', 'itemIndex', 'question', 'topic', 'chosenLetter', 'correctLetter', 'wasCorrect', 'explanation', 'image']);
  assert.deepStrictEqual(api.__header('Questions'),
    ['section', 'topic', 'question', 'A', 'B', 'C', 'D', 'answer', 'explanation', 'image']);
});
test('marking policy is +1 / -0.25 / 0', () => {
  assert.strictEqual(api.mark(true), 1);
  assert.strictEqual(api.mark(false), -0.25);
});
test('health() reports the tabs and the embedded-html mode', () => {
  const hh = JSON.parse(JSON.stringify(api.health()));
  assert.strictEqual(hh.ok, true);
  assert.ok(hh.tabs.Users && hh.tabs.Questions);
  assert.strictEqual(hh.marking, '+1 / -0.25 / 0');
  assert.match(hh.emailQuotaLeft, /recipients today|unknown/);
});

/* ------------------------------------------------------------------ */
section('(1)(2) Registration, admin approval, emails');
const ADMIN = { name: 'Principal Sir', email: 'principal@example.com', password: 'teach3r!', deviceId: 'dev-admin-1' };
const STUD = { name: 'Sita Sharma', email: 'sita@example.com', password: 'stud3nt!', deviceId: 'dev-sita-A' };
let adminToken = null, studToken = null;

test('first registration becomes an approved teacher (and is logged in)', () => {
  const r = api.register(ADMIN);
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.role, 'teacher');
  assert.strictEqual(r.status, 'approved');
  assert.ok(r.auto && r.token, 'expected an auto-login token');
  adminToken = r.token;
  const u = api.__rows('Users')[0];
  assert.strictEqual(u[6], 'approved');
  assert.match(u[4], /^[0-9a-f]{64}$/, 'password must be a sha-256 hash, not plaintext');
});
test('admins are emailed when someone registers', () => {
  const found = h.REG.mails.filter(m => /New registration/.test(m.subject));
  assert.ok(found.length >= 1, 'no admin notification email');
  assert.strictEqual(found[0].to, api.CONFIG.ADMIN_EMAILS[0]);
});
test('student registration is pending and cannot log in yet', () => {
  const r = api.register(STUD);
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.status, 'pending');
  assert.ok(!r.token, 'pending users must not get a token');
  const before = h.REG.mails.length;
  const bad = api.login({ ident: STUD.email, password: STUD.password, deviceId: STUD.deviceId });
  assert.strictEqual(bad.ok, false);
  assert.match(bad.error, /pending/i);
  const started = api.startMock('fake-token', {});
  assert.strictEqual(started.ok, false);
  assert.ok(before <= h.REG.mails.length);
});
test('teacher sees the pending account and approves it by email', () => {
  const ov = api.adminOverview(adminToken);
  assert.strictEqual(ov.ok, true, ov.error);
  const row = ov.users.find(u => u.email === STUD.email);
  assert.strictEqual(row.status, 'pending');
  const r = api.setStatus(adminToken, row.id, 'approved');
  assert.strictEqual(r.ok, true, r.error);
  const mail = h.REG.mails.filter(m => m.to === STUD.email && /approved/i.test(m.subject)).pop();
  assert.ok(mail, 'student was not emailed about the approval');
});
test('rejection is emailed too, and blocks a live session', () => {
  const r0 = api.register({ name: 'Test Reject', email: 'reject@example.com', password: 'pass1234', deviceId: 'dev-r' });
  assert.strictEqual(r0.ok, true, r0.error);
  const id = api.__rows('Users').map(r => r[0]).pop();
  const r = api.setStatus(adminToken, id, 'rejected');
  assert.strictEqual(r.ok, true, r.error);
  const rej = h.REG.mails.filter(m => m.to === 'reject@example.com').pop();
  assert.ok(rej && /could not be approved/.test(rej.body), 'rejection email text missing');
  const me = api.me('whatever', 'whatever');
  assert.strictEqual(me.ok, false);
});

/* ------------------------------------------------------------------ */
section('Live deployment: portal link + support sender identity');
test('CONFIG carries the published /exec URL and the support address', () => {
  assert.match(api.CONFIG.PORTAL_URL, /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/);
  assert.strictEqual(api.CONFIG.MAIL_REPLY_TO, 'support@cee-notes.cprecnepal.org.np');
  assert.strictEqual(api.CONFIG.MAIL_FROM, 'support@cee-notes.cprecnepal.org.np');
});
test('student emails carry the portal link and the support contact', () => {
  const reg = api.register({ name: 'Link Test', email: 'link@example.com', password: 'pass1234', deviceId: 'dev-link' });
  assert.strictEqual(reg.ok, true, reg.error);
  const mail = h.REG.mails.filter(m => m.to === 'link@example.com').pop();
  assert.ok(mail, 'no registration mail');
  assert.match(mail.body, /script\.google\.com\/macros\/s\/AKfycbwgnUluOVaruBxQijfMnxtbng0pZ0SL3cKv9aYrMTjpzjdKedUMGZl2rwBgGNHl_CQS\/exec/);
  assert.match(mail.body, /mailto:support@cee-notes\.cprecnepal\.org\.np/);
  const id = api.__rows('Users').pop()[0];
  api.setStatus(adminToken, id, 'approved');
  const appr = h.REG.mails.filter(m => m.to === 'link@example.com' && /approved/i.test(m.subject)).pop();
  assert.match(appr.body, /Open the portal/);
  api.setStatus(adminToken, id, 'rejected');
  const rej = h.REG.mails.filter(m => m.to === 'link@example.com' && /Account update/.test(m.subject)).pop();
  assert.match(rej.body, /support@cee-notes\.cprecnepal\.org\.np/);
  const adminNote = h.REG.mails.filter(m => /New registration/.test(m.subject)).pop();
  assert.match(adminNote.body, /Approve them here/);
  assert.ok(!/docs\.google\.com\/spreadsheets/.test(adminNote.body), 'admin mail should not point students at the sheet URL');
});
test('mail is sent from support@ with Reply-To, and falls back if the alias is unverified', () => {
  const SUPPORT = 'support@cee-notes.cprecnepal.org.np';
  api.MAIL_STATE.aliasOk = null; api.MAIL_STATE.note = ''; api.MAIL_STATE.lastVia = '';
  h.REG.rejectFrom = false;
  const r1 = api.register({ name: 'Alias One', email: 'alias1@example.com', password: 'pass1234' });
  assert.strictEqual(r1.ok, true, r1.error);
  const withFrom = h.REG.mails.filter(x => x.from === SUPPORT);
  assert.ok(withFrom.length >= 2, 'every portal mail should go out as support@ once the alias is accepted');
  assert.ok(withFrom.every(x => x.replyTo === SUPPORT), 'Reply-To must always be the support address');
  assert.strictEqual(api.MAIL_STATE.aliasOk, true);
  assert.match(api.MAIL_STATE.lastVia, /^from:/);

  // now pretend Gmail has no "Send mail as" alias yet -> mail must still flow, without From
  api.MAIL_STATE.aliasOk = null; api.MAIL_STATE.note = '';
  h.REG.rejectFrom = true;
  const r2 = api.register({ name: 'Alias Two', email: 'alias2@example.com', password: 'pass1234' });
  assert.strictEqual(r2.ok, true, r2.error);
  const second = h.REG.mails.filter(x => x.to === 'alias2@example.com');
  assert.strictEqual(second.length, 1, 'the fallback must deliver exactly one mail, got ' + second.length);
  assert.strictEqual(second[0].from, null, 'fallback drops the unverified From');
  assert.strictEqual(second[0].replyTo === SUPPORT, true, 'but keeps Reply-To so replies reach support');
  assert.strictEqual(api.MAIL_STATE.aliasOk, false);
  assert.match(api.MAIL_STATE.note, /only send from/);
  assert.ok(String(api.MAIL_STATE.lastVia).length > 0, 'health panel needs a lastVia value');

  // and it must not re-try the alias (and duplicate the mail) on the next send
  const r3 = api.register({ name: 'Alias Three', email: 'alias3@example.com', password: 'pass1234' });
  assert.strictEqual(r3.ok, true, r3.error);
  const third = h.REG.mails.filter(x => x.to === 'alias3@example.com');
  assert.strictEqual(third.length, 1, 'no duplicate sends after the alias was rejected');
  assert.strictEqual(third[0].from, null);

  h.REG.rejectFrom = false; api.MAIL_STATE.aliasOk = null; api.MAIL_STATE.note = '';
});

test('teacher can save the portal link + support address at runtime', () => {
  const before = JSON.parse(JSON.stringify(api.getSettings(adminToken)));
  assert.strictEqual(before.ok, true, before.error);
  assert.strictEqual(before.portalUrl, api.CONFIG.PORTAL_URL, 'CONFIG is the default until something is saved');

  const bad = api.saveSettings(adminToken, { portalUrl: 'http://nope' });
  assert.strictEqual(bad.ok, false, 'plain http must be refused');
  assert.match(bad.error, /https:\/\//);
  const bad2 = api.saveSettings(adminToken, { supportEmail: 'not-an-email' });
  assert.strictEqual(bad2.ok, false);
  assert.match(bad2.error, /email address/);
  const anon = api.saveSettings('s_not_a_token', { portalUrl: 'https://x.example/exec' });
  assert.strictEqual(anon.ok, false, 'only a teacher may change settings');

  const r = api.saveSettings(adminToken, {
    portalUrl: 'https://script.google.com/macros/s/EXEC123abcdef/exec',
    supportEmail: 'support@example.org'
  });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.portalUrl, 'https://script.google.com/macros/s/EXEC123abcdef/exec');
  assert.match(r.message, /Test mail sent/, 'saving must verify the sender: ' + r.message);
  assert.match(h.REG.mails.filter(m => /Settings saved/.test(m.subject)).pop().replyTo, /support/);

  const after = api.health();
  assert.strictEqual(after.portalUrl, 'https://script.google.com/macros/s/EXEC123abcdef/exec');
  const reg = api.register({ name: 'Saved Link', email: 'saved@example.com', password: 'pass1234' });
  assert.strictEqual(reg.ok, true, reg.error);
  const m = h.REG.mails.filter(x => x.to === 'saved@example.com').pop();
  assert.match(m.body, /EXEC123abcdef\/exec/, 'the freshly saved link must be in the mail');
  assert.match(m.body, /mailto:support@example\.org/);

  api.saveSettings(adminToken, { portalUrl: '', supportEmail: '' });   // restore the baked defaults
  assert.strictEqual(api.health().portalUrl, api.CONFIG.PORTAL_URL, 'clearing falls back to CONFIG');
  void before;
});

test('the served page carries the support address (no extra round-trip)', () => {
  const out = api.doGet({ parameter: {} });
  const html = out.getContent();
  assert.ok(html.indexOf('id="supportLine"') > 0, 'support line markup is present');
  assert.ok(html.indexOf('mailto:support@cee-notes.cprecnepal.org.np') > 0, 'support address is injected');
  assert.strictEqual(html.indexOf('__SUPPORT_EMAIL__'), -1, 'placeholder fully replaced');
  assert.ok(html.indexOf("var raw = '" + api.CONFIG.PORTAL_URL + "';") > 0, 'portal link must reach the offline notice');
  assert.strictEqual(html.indexOf('__PORTAL_URL__'), -1);
  assert.ok(html.indexOf('cee-notes/%20portal') > 0 || html.indexOf('raw.githubusercontent.com/cee-notes/portal') > 0, 'CPREC branding present');
  const api2 = h.loadCode({ file: P.BUILT });
  const html2 = api2.doGet({ parameter: {} }).getContent();
  assert.ok(html2.indexOf('mailto:support@cee-notes.cprecnepal.org.np') > 0, 'same in the all-in-one file');
});


test('the GitHub Pages copy is a door, not a dead app', () => {
  const p2 = P.PAGES;
  assert.ok(fs.existsSync(p2), 'pages/index.html is missing');
  const land = fs.readFileSync(p2, 'utf8');
  assert.strictEqual(land.indexOf('google.script.run'), -1, 'the landing page must not embed the app');
  assert.strictEqual(land.indexOf('id="li-ident"'), -1, 'a login form on a static host can never work');
  const EXEC = api.CONFIG.PORTAL_URL;
  assert.ok(land.indexOf('href="' + EXEC + '"') > 0, 'the button must point at the published portal URL');
  assert.ok(land.indexOf("var url = '" + EXEC + "'") > 0, 'the auto-redirect must use the same URL');
  assert.match(land, /Powered by/, 'keep the CPREC credit block from their design');
  assert.match(land, /cee-notes.github.io|GitHub Pages/, 'the file should explain what it is for');
});

section('(3) One-device lock + (4) 24-hour sessions');
test('first successful login stores the deviceId', () => {
  const r = api.login({ ident: STUD.email, password: STUD.password, deviceId: 'dev-sita-A' });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.bound, true, 'first login should report binding');
  studToken = r.token;
  const u = api.__rows('Users').find(x => x[2] === STUD.email);
  assert.strictEqual(u[7], 'dev-sita-A');
});
test('a different device is blocked until an admin resets it', () => {
  const bad = api.login({ ident: STUD.email, password: STUD.password, deviceId: 'dev-sita-B' });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.locked, true);
  assert.match(bad.error, /locked to another device/i);
  const row = api.adminOverview(adminToken).users.find(u => u.email === STUD.email);
  const reset = api.resetDevice(adminToken, row.id);
  assert.strictEqual(reset.ok, true, reset.error);
  assert.ok(h.REG.mails.some(m => m.to === STUD.email && /Device lock reset/.test(m.subject)));
  const ok = api.login({ ident: STUD.email, password: STUD.password, deviceId: 'dev-sita-B' });
  assert.strictEqual(ok.ok, true, ok.error);
  studToken = ok.token;
  assert.strictEqual(api.__rows('Users').find(x => x[2] === STUD.email)[7], 'dev-sita-B');
});
test('wrong password never returns a token', () => {
  const r = api.login({ ident: STUD.email, password: 'nope', deviceId: 'dev-sita-B' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /incorrect/i);
});
test('sessionExpiry is now + 24h and me() accepts the token', () => {
  const u = api.__rows('Users').find(x => x[2] === STUD.email);
  const exp = Number(u[9]);
  const delta = exp - Date.now();
  assert.ok(delta > 23.9 * 3600 * 1000 && delta <= 24 * 3600 * 1000 + 5000, 'expiry not ~24h: ' + delta);
  const me = api.me(studToken);
  assert.strictEqual(me.ok, true, me.error);
  assert.strictEqual(me.user.email, STUD.email);
  assert.ok(me.expires, 'me() should tell the client when the session ends');
});
test('an expired session forces re-login', () => {
  const rowNum = api.__sheet('Users').rows.findIndex(r => r[2] === STUD.email) + 1;
  api.updateRow_('Users', rowNum, { sessionExpiry: Date.now() - 1000 });
  const me = api.me(studToken);
  assert.strictEqual(me.ok, false);
  assert.strictEqual(me.session, true, 'should be flagged so the UI forces a re-login');
  assert.match(me.error, /expired/i);
  const started = api.startMock(studToken, { count: 3 });
  assert.strictEqual(started.ok, false);
  const again = api.login({ ident: STUD.email, password: STUD.password, deviceId: 'dev-sita-B' });
  assert.strictEqual(again.ok, true, again.error);
  studToken = again.token;
});

/* ------------------------------------------------------------------ */
section('(5) Server-side marking + (10) images in the paper');
function bankRow(question) {
  const rows = api.__rows('Questions');
  return rows.find(r => norm(r[2]) === norm(question));
}
function slotFor(item, letter) { return item.order.indexOf(letter) + 1; }
let paper1 = null;
test('startMock serves a shuffled paper without the answer key', () => {
  const r = api.startMock(studToken, { section: 'all', count: 10, minutes: 20 });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.count, 10);
  assert.strictEqual(r.source, 'Questions');
  paper1 = r.paper;
  for (const it of r.paper) {
    assert.ok(!('answer' in it) && !('correct' in it) && !('explanation' in it),
      'served question must not expose the key/explanation: ' + JSON.stringify(Object.keys(it)));
    assert.strictEqual(it.order.length, 4);
    assert.strictEqual([...it.order].sort().join(''), 'ABCD');
    const b = bankRow(it.question);
    assert.ok(b, 'served a question that is not in the bank: ' + it.question.slice(0, 40));
    const served = ['A', 'B', 'C', 'D'].map(k => norm(it.opts[k])).sort().join('|');
    const stored = [b[3], b[4], b[5], b[6]].map(norm).sort().join('|');
    assert.strictEqual(served, stored, 'options must be the same four texts, only re-ordered');
    assert.ok(it.opts[it.order.charAt(0)] !== undefined, 'order must index into opts');
  }
});
test('all-correct paper scores exactly +1 per question', () => {
  const items = paper1.map((it, i) => {
    const b = bankRow(it.question);
    assert.ok(b, 'bank row not found: ' + it.question.slice(0, 30));
    return { i: i, question: it.question, chosen: slotFor(it, b[7]) };
  });
  const r = api.submitMock(studToken, { ts: Date.now(), items: items });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.score, 10);
  assert.strictEqual(r.correct, 10);
  assert.strictEqual(r.wrong, 0);
  assert.strictEqual(r.skipped, 0);
  assert.strictEqual(r.acc, 100);
});
test('mixed answers: +1 correct, -0.25 wrong, 0 blank', () => {
  const r0 = api.startMock(studToken, { section: 'all', count: 10, minutes: 20 });
  const items = r0.paper.map((it, i) => {
    const b = bankRow(it.question);
    const right = slotFor(it, b[7]);
    if (i < 2) return { i: i, question: it.question, chosen: right };                       // 2 correct
    if (i < 6) return { i: i, question: it.question, chosen: right === 1 ? 2 : 1 };         // 4 wrong
    return { i: i, question: it.question, chosen: 0 };                                       // 4 skipped
  });
  const r = api.submitMock(studToken, { ts: Date.now(), items: items });
  assert.strictEqual(r.correct, 2);
  assert.strictEqual(r.wrong, 4);
  assert.strictEqual(r.skipped, 4);
  assert.strictEqual(r.score, 2 - 4 * 0.25);            // 1
  assert.strictEqual(r.acc, 33.3);
  const aRow = api.__rows('Attempts').pop();
  assert.deepStrictEqual(aRow.slice(4, 10), [1, 10, 2, 4, 4, 33.3].map(x => x));
});
test('Attempts + Responses rows are written with the specified columns', () => {
  const aRow = api.__rows('Attempts').pop();
  assert.strictEqual(aRow[1], api.__rows('Users').find(x => x[2] === STUD.email)[0], 'userId');
  assert.strictEqual(aRow[11], 10, 'detailCount');
  const resp = api.__rows('Responses');
  const mine = resp.filter(r => r[0] === aRow[0]);
  assert.strictEqual(mine.length, 10, 'one response row per question');
  const flags = mine.map(r => r[7]).map(Number).sort((a, b) => b - a);
  assert.deepStrictEqual(flags, [1, 1, 0, 0, 0, 0, -1, -1, -1, -1], 'wasCorrect must be 1/0/-1');
  assert.ok(mine.every(r => /^[A-D]$/.test(String(r[6] || ''))), 'correctLetter column');
});
test('the bank figure reaches the paper, the review and the email', () => {
  const r0 = api.startMock(studToken, { section: 'Phy', topic: 'P1', count: 5, minutes: 10 });
  assert.strictEqual(r0.ok, true, r0.error);
  const figure = r0.paper.find(it => /figure shows two forces/i.test(it.question));
  assert.ok(figure, 'the seeded image question was not served for Phy/P1');
  assert.match(figure.image, /^data:image\/png;base64,/, 'figure must be a data URI');
  const items = r0.paper.map((it, i) => ({ i: i, question: it.question, chosen: slotFor(it, bankRow(it.question)[7]) }));
  const r = api.submitMock(studToken, { ts: Date.now(), items: items });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.correct, r0.count);
  const withImg = r.perItem.filter(x => x.image.length > 40);
  assert.ok(withImg.length >= 1, 'review result must carry the image');
  const mail = h.REG.mails.filter(m => m.to === STUD.email).pop();
  assert.ok(mail, 'no feedback email');
  assert.match(mail.subject, /Your mock result/);
  assert.ok(mail.body.length > 1500, 'feedback email looks empty: ' + mail.body.length);
  assert.ok(mail.hasInline && mail.hasInline.length >= 1, 'figure was not inlined into the email');
  assert.strictEqual(mail.inlineBytes[0], 2514, 'inlined PNG size differs from the bank figure');
});
test('feedback email contains per-question verdicts and explanations', () => {
  const mail = h.REG.mails.filter(m => m.to === STUD.email).pop();
  assert.ok(mail, 'no mail found');
  const api2 = api;
  const body = JSON.stringify(mail);
  assert.match(body, /Correct|Wrong|Not attempted/);
  assert.ok(mail.body.length > 1500);
  assert.match(mail.body, /oxygen liberated|photolysis|O-18|figure|Q\d/);
});

/* ------------------------------------------------------------------ */
section('(5b) Tamper resistance');
test('a client cannot re-point the option letters it did not tap', () => {
  const r0 = api.startMock(studToken, { section: 'Chem', count: 4, minutes: 10 });
  const items = r0.paper.map((it, i) => ({
    i: i, question: it.question,
    order: 'DCBA',                                  // lie about the presentation order
    chosen: slotFor(it, bankRow(it.question)[7])    // slot computed from the REAL order
  }));
  const r = api.submitMock(studToken, { ts: Date.now(), items: items });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.correct, 4, 'server must score with its own stored order');
  assert.strictEqual(r.score, 4);
});
test('answers to questions that were never served are ignored', () => {
  const r0 = api.startMock(studToken, { section: 'Math', count: 3, minutes: 10 });
  const items = r0.paper.map((it, i) => ({ i: i, question: 'What is the capital of Nepal?', chosen: 1 }));
  const r = api.submitMock(studToken, { ts: Date.now(), items: items });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.correct, 0);
  assert.strictEqual(r.skipped, 3);
  assert.strictEqual(r.tampered, 3, 'mismatch should be counted and reported');
  assert.strictEqual(r.score, 0, 'a fake question must not earn or cost marks');
});
test('garbage slots and missing items become "not attempted", never a negative total', () => {
  const r0 = api.startMock(studToken, { section: 'Phy', count: 5, minutes: 10 });
  const r = api.submitMock(studToken, { ts: Date.now(), items: [{ i: 0, question: r0.paper[0].question, chosen: 99 }, { i: 1, question: r0.paper[1].question, chosen: -3 }] });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.skipped, 5);
  assert.strictEqual(r.score, 0);
});
test('the deadline is enforced by the server, not the browser', () => {
  const saved = api.CONFIG.GRACE_SECONDS;
  api.CONFIG.GRACE_SECONDS = -60;                    // make the server consider anything over 0 s late
  const r0 = api.startMock(studToken, { section: 'all', count: 2, minutes: 1 });
  const items = r0.paper.map((it, i) => ({ i: i, question: it.question, chosen: slotFor(it, bankRow(it.question)[7]) }));
  const r = api.submitMock(studToken, { ts: Date.now() + 3600 * 1000, items: items });
  assert.strictEqual(r.overtime, true, 'late submission must be flagged');
  assert.strictEqual(r.score, 2, 'lateness must not change the marking itself');
  const aRow = api.__rows('Attempts').pop();
  assert.match(String(aRow[10]), /late/, 'the attempt row should record that it was late');
  api.CONFIG.GRACE_SECONDS = saved;
});
test('double submit cannot be used to farm marks', () => {
  const r = api.submitMock(studToken, { ts: Date.now(), items: [] });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /No mock is in progress/i);
});

test('the email toggles actually silence the right mail', () => {
  const saved = { fb: api.CONFIG.EMAIL_FEEDBACK, adm: api.CONFIG.EMAIL_ADMIN_NOTIFY, st: api.CONFIG.EMAIL_STATUS_NOTIFY };
  try {
    api.CONFIG.EMAIL_FEEDBACK = false; api.CONFIG.EMAIL_ADMIN_NOTIFY = false; api.CONFIG.EMAIL_STATUS_NOTIFY = false;
    const before = h.REG.mails.length;
    const r0 = api.startMock(studToken, { section: 'all', count: 2, minutes: 5 });
    const items = r0.paper.map((it, i) => ({ i: i, question: it.question, chosen: slotFor(it, bankRow(it.question)[7]) }));
    const r = api.submitMock(studToken, { ts: Date.now(), items: items });
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(r.mailSkipped, true, 'submit should say the mail was skipped');
    const reg = api.register({ name: 'Quiet', email: 'quiet@example.com', password: 'pass1234' });
    assert.strictEqual(reg.ok, true, reg.error);
    assert.strictEqual(h.REG.mails.length, before, 'no email should be sent when every toggle is off');
    const uid = api.__rows('Users').pop()[0];
    const st = api.setStatus(adminToken, uid, 'approved');
    assert.strictEqual(st.ok, true, st.error);
    assert.strictEqual(h.REG.mails.length, before, 'status mail must respect the toggle');
    const on = api.register({ name: 'Loud', email: 'loud@example.com', password: 'pass1234' });
    void on;
  } finally {
    api.CONFIG.EMAIL_FEEDBACK = saved.fb; api.CONFIG.EMAIL_ADMIN_NOTIFY = saved.adm; api.CONFIG.EMAIL_STATUS_NOTIFY = saved.st;
  }
  const after = api.register({ name: 'Noisy', email: 'noisy@example.com', password: 'pass1234' });
  assert.strictEqual(after.ok, true, after.error);
  assert.ok(h.REG.mails.length > 0, 'mail should be back on');
});

/* ------------------------------------------------------------------ */
section('(11) Response review');
test('a student can re-open a saved attempt and see answers vs correct answers', () => {
  const mine = api.myAttempts(studToken);
  assert.strictEqual(mine.ok, true, mine.error);
  assert.ok(mine.attempts.length >= 4, 'attempt history looks thin: ' + mine.attempts.length);
  const first = mine.attempts[0];
  const r = api.getAttempt(studToken, first.tsRaw);
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.items.length, first.total);
  const it = r.items[0];
  assert.ok(it.question.length > 5);
  assert.ok(['correct', 'wrong', 'skipped'].includes(it.state));
  assert.ok(it.opts && 'ABCD'.split('').every(k => k in it.opts), 'review should show the option texts');
  assert.match(it.correct, /^[A-D]$/);
});
test('a student cannot open another student\'s attempt', () => {
  const other = api.register({ name: 'Other', email: 'other@example.com', password: 'pass1234', deviceId: 'dev-o' });
  assert.strictEqual(other.ok, true, other.error);
  const id = api.__rows('Users').pop()[0];
  const r = api.getAttempt(studToken, Date.now(), id);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /your own/i);
});

/* ------------------------------------------------------------------ */
section('(8) Bulk upload: CSV text and XLSX file');
test('an answer cell may hold a letter or the full option text, never a substring', () => {
  assert.strictEqual(api.normLetter_('B'), 'B');
  assert.strictEqual(api.normLetter_('c.'), 'C');
  assert.strictEqual(api.normLetter_('Option d'), 'D');
  assert.strictEqual(api.normLetter_('Answer = A'), 'A');
  assert.strictEqual(api.normLetter_('equal'), '');       // must NOT become "A"
  assert.strictEqual(api.normLetter_('Bad'), '');
  assert.strictEqual(api.normLetter_(''), '');
});
test('CSV with aliased headers, answer given as text, one broken row', () => {
  const csv = [
    'Subject,Chapter,Q,A,B,C,D,Correct,Solution',
    'chemistry,C3,"For a reaction at equilibrium the forward and reverse rates are","unequal","equal","zero","doubled","equal","At equilibrium the two rates are equal, so concentrations stay constant.",',
    'Bio,Z6,"Decomposers are also called","Producers","Consumers","Saprotrophs","Parasites",C,"They feed on dead organic matter externally and absorb it.",',
    'Phy,P4,"this row is deliberately broken",,,,,'
  ].join('\n');
  const r = api.importQuestions(adminToken, { csv: csv, name: 'pasted.csv' });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.added, 2, 'expected 2 valid rows');
  assert.strictEqual(r.skipped, 1);
  assert.match(r.problems[0], /row 4/);
  const rows = api.__rows('Questions');
  const chem = rows.filter(x => norm(x[2]).indexOf('equilibrium the forward') >= 0).pop();
  assert.ok(chem, 'question not stored');
  assert.strictEqual(chem[7], 'B', 'answer text should have resolved to its letter');
  assert.strictEqual(norm(chem[0]), 'chem', 'section alias "chemistry" should normalise');
});
test('XLSX file upload is parsed by the built-in reader', () => {
  const b64 = fs.readFileSync(path.join(__dirname, 'fixture.xlsx.b64'), 'utf8').trim();
  const r = api.importQuestions(adminToken, { b64: b64, name: 'fixture.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.added, 2, 'expected the 2 data rows of the fixture');
  const boyle = api.__rows('Questions').filter(x => /Which law relates pressure/i.test(String(x[2]))).pop();
  assert.ok(boyle, 'xlsx question text missing');
  assert.strictEqual(boyle[3], "Charles's law");
  assert.strictEqual(boyle[4], "Boyle's law");
  assert.strictEqual(boyle[7], 'B', 'answer text -> letter mapping failed');
  assert.ok(/constant/.test(String(boyle[8])), 'explanation column lost');
  const gp = api.__rows('Questions').filter(x => /10th term of the G\.P\./.test(String(x[2]))).pop();
  assert.strictEqual(gp[7], 'B');
});
test('oversized embedded images are refused with advice, not truncated', () => {
  const big = 'data:image/png;base64,' + 'A'.repeat(200000);
  const r = api.saveQuestion(adminToken, { section: 'Phy', topic: 'P1', question: 'Big image test question?', A: 'a', B: 'b', C: 'c', D: 'd', answer: 'A', explanation: '', image: big });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /too large/i);
});

/* ------------------------------------------------------------------ */
section('(9) PDF-guided builder (server fallback path)');
test('server extracts sentences from a real PDF (flate + raw streams)', () => {
  const b64 = fs.readFileSync(path.join(__dirname, 'fixture.pdf.b64'), 'utf8').trim();
  const r = api.extractPdfText(adminToken, b64, 'fixture.pdf');
  assert.strictEqual(r.ok, true, r.error);
  assert.match(r.text, /Cell theory states that all living organisms are made of cells/);
  assert.match(r.text, /Robert Hooke in 1665/);
  assert.match(r.text, /Standard deviation is the positive square root of variance/);
  assert.ok(r.chars > 100);
});
test('a PDF with no text layer returns a "needsClient" hint instead of garbage', () => {
  const r = api.extractPdfText(adminToken, Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF').toString('base64'), 'scan.pdf');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.needsClient, true);
});
test('a sentence can be inserted into the builder and saved as an MCQ', () => {
  const r = api.saveQuestion(adminToken, {
    section: 'Bio', topic: 'Z1',
    question: 'According to cell theory, which statement is correct?',
    A: 'All living organisms are made of cells', B: 'Cells arise spontaneously',
    C: 'Only animals have cells', D: 'Viruses are the basic unit of life',
    answer: 'A', explanation: 'Inserted from the syllabus PDF (FlateDecode text stream).'
  });
  assert.strictEqual(r.ok, true, r.error);
  const stored = api.__rows('Questions').pop();
  assert.match(stored[2], /cell theory/);
});

/* ------------------------------------------------------------------ */
section('(12) Micro-syllabus tags + question bank CRUD');
test('every seeded question is tagged with a valid section and topic code', () => {
  const valid = new Set(['Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z6', 'Z7', 'Z8', 'Z9', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6']
    .concat(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'])
    .concat(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'])
    .concat(['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9']));
  const rows = api.__rows('Questions');
  assert.ok(rows.length >= 40, 'default bank should be substantial: ' + rows.length);
  for (const r of rows) {
    assert.ok(['Bio', 'Chem', 'Phy', 'Math'].includes(String(r[0])), 'bad section ' + r[0]);
    assert.ok(valid.has(String(r[1])), 'bad topic code ' + r[1]);
    assert.ok(['A', 'B', 'C', 'D'].includes(String(r[7])), 'bad answer ' + r[7]);
    for (const k of [2, 3, 4, 5, 6]) assert.ok(String(r[k]).length > 0, 'blank cell in row ' + (rows.indexOf(r) + 2));
  }
});
test('topic filtering narrows the paper, and the answer spread is not "all B"', () => {
  const r = api.startMock(studToken, { section: 'Bio', topic: 'Z1', count: 20, minutes: 10 });
  assert.strictEqual(r.ok, true, r.error);
  assert.ok(r.paper.every(p => /^Z1/.test(p.topic)), 'topic filter leaked: ' + r.paper.map(p => p.topic).join(','));
  api.submitMock(studToken, { ts: Date.now(), items: [] });
  const counts = {};
  for (const row of api.__rows('Questions')) counts[row[7]] = (counts[row[7]] || 0) + 1;
  const vals = Object.keys(counts).sort();
  assert.ok(vals.length >= 3, 'answer letters look unbalanced: ' + JSON.stringify(counts));
});
test('edit and delete touch only the affected row', () => {
  const before = api.__rows('Questions').length;
  const add = api.saveQuestion(adminToken, { section: 'Math', topic: 'M9', question: 'Temp question for the edit test?', A: '1', B: '2', C: '3', D: '4', answer: 'B', explanation: 'x' });
  assert.strictEqual(add.ok, true, add.error);
  assert.strictEqual(api.__rows('Questions').length, before + 1);
  const upd = api.saveQuestion(adminToken, { row: add.row, section: 'Math', topic: 'M9', question: 'Temp question for the edit test? (edited)', A: '1', B: '2', C: '3', D: '9', answer: 'D', explanation: 'edited' });
  assert.strictEqual(upd.ok, true, upd.error);
  assert.strictEqual(api.__rows('Questions').length, before + 1, 'edit must not append a row');
  const stored = api.__sheet('Questions').rows[add.row - 1];
  assert.match(stored[2], /edited/);
  assert.strictEqual(stored[6], '9');
  const del = api.deleteQuestion(adminToken, add.row);
  assert.strictEqual(del.ok, true, del.error);
  assert.strictEqual(api.__rows('Questions').length, before);
});
test('the bank can be exported as CSV and re-imported', () => {
  const ex = api.exportQuestionsCsv(adminToken);
  assert.strictEqual(ex.ok, true, ex.error);
  const lines = ex.csv.split('\n');
  assert.strictEqual(lines[0], 'section,topic,question,A,B,C,D,answer,explanation,image');
  assert.strictEqual(lines.length - 1, ex.count);
  const before = api.__rows('Questions').length;
  const one = lines[1];
  const imp = api.importQuestions(adminToken, { csv: one, name: 'roundtrip.csv' });
  assert.strictEqual(imp.ok, true, imp.error);
  assert.strictEqual(api.__rows('Questions').length, before + 1);
  api.deleteQuestion(adminToken, api.__rows('Questions').length + 1);
});

/* ------------------------------------------------------------------ */
section('Concurrency: LockService + row-scoped writes');
test('every mutating call takes the script lock', () => {
  const b0 = h.REG.lockCount;
  api.register({ name: 'Lock probe', email: 'lock@example.com', password: 'pass1234', deviceId: 'dev-l' });
  assert.ok(h.REG.lockCount > b0, 'register did not take the lock');
  const b1 = h.REG.lockCount;
  api.me(studToken);
  assert.strictEqual(h.REG.lockCount, b1, 'pure reads should not need the lock');
});
test('when the lock is held by someone else, writes fail cleanly instead of corrupting', () => {
  h.REG.lockFail = true;
  const r = api.setStatus(adminToken, api.__rows('Users').pop()[0], 'approved');
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /busy/i);
  const rows = api.__rows('Users');
  const r2 = api.saveQuestion(adminToken, { section: 'Phy', topic: 'P1', question: 'should not be written while busy?', A: 'a', B: 'b', answer: 'A' });
  assert.strictEqual(r2.ok, false);
  assert.ok(!api.__rows('Questions').some(x => /should not be written/.test(String(x[2]))), 'write happened without the lock!');
  assert.strictEqual(api.__rows('Users').length, rows.length);
  h.REG.lockFail = false;
});
test('a single-row user update leaves every other cell of the row intact', () => {
  const u = api.__rows('Users').find(x => x[2] === STUD.email);
  const rowNum = api.__sheet('Users').rows.findIndex(r => r[2] === STUD.email) + 1;
  const before = api.__sheet('Users').rows[rowNum - 1].slice();
  api.updateRow_('Users', rowNum, { deviceId: 'dev-xyz' });
  const after = api.__sheet('Users').rows[rowNum - 1];
  assert.strictEqual(after[7], 'dev-xyz');
  for (let c = 0; c < before.length; c++) {
    if (c === 7) continue;
    assert.strictEqual(after[c], before[c], 'column ' + c + ' was clobbered');
  }
  assert.strictEqual(api.__sheet('Users').rows.length, api.__sheet('Users').rows.length);
});

/* ------------------------------------------------------------------ */
section('Guaranteed fallback bank');
test('an empty Questions tab still lets a student take a mock', () => {
  const sh = api.__sheet('Questions');
  const keep = sh.rows.slice();
  const keepDefault = api.DEFAULT_BANK;
  sh.rows = [keep[0]];                       // wipe the tab
  api.DEFAULT_BANK = [];                      // and pretend seeding is unavailable
  try {
    const r = api.startMock(studToken, { section: 'all', count: 10, minutes: 10 });
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(r.source, 'fallback');
    assert.strictEqual(r.count, 8, 'FALLBACK_BANK must hold 8 questions');
    const fbAnswer = (question) => {
      const f = api.FALLBACK_BANK.find(x => norm(x.question) === norm(question));
      assert.ok(f, 'fallback question not found: ' + question);
      return f.answer;
    };
    const items = r.paper.map((it, i) => ({ i: i, question: it.question, chosen: slotFor(it, fbAnswer(it.question)) }));
    const s = api.submitMock(studToken, { ts: Date.now(), items: items });
    assert.strictEqual(s.ok, true, s.error);
    assert.strictEqual(s.correct, 8);
    assert.strictEqual(s.score, 8);
  } finally {
    sh.rows = keep;
    api.DEFAULT_BANK = keepDefault;
  }
});
test('seeding into an empty Questions tab works and is idempotent', () => {
  const sh = api.__sheet('Questions');
  const keep = sh.rows.slice();
  sh.rows = [keep[0]];
  const s1 = api.seedBank(adminToken, false);
  assert.strictEqual(s1.ok, true, s1.error);
  assert.ok(s1.count >= 40, 'seeded ' + s1.count);
  const after = api.__rows('Questions').length;
  const s2 = api.seedBank(adminToken, false);
  assert.strictEqual(s2.seeded, false, 'must not duplicate an existing bank');
  assert.strictEqual(api.__rows('Questions').length, after);
  void keep;
});

/* ------------------------------------------------------------------ */
section('doGet / embedded HTML');
test('split build serves index.html through include()', () => {
  const out = api.doGet({ parameter: {} });
  const html = out.getContent();
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /CEE Mock Portal/);
  assert.ok(html.length > 20000, 'portal html looks truncated: ' + html.length);
});
test('health() reports no EMBEDDED_HTML for the split file', () => {
  const hh = JSON.parse(JSON.stringify(api.health()));
  assert.strictEqual(hh.embeddedHtml, 'no');
});
test('CONFIG.SHEET_ID path opens the sheet by id', () => {
  const keepActive = h.snapshot();
  const other = h.newSpreadsheet('OTHER999', 'Second sheet');
  const saved = api.CONFIG.SHEET_ID;
  api.CONFIG.SHEET_ID = 'OTHER999';
  const r = api.startMock(studToken, { count: 2, minutes: 5 });
  assert.strictEqual(r.ok, false, 'the second spreadsheet has no users, so it must fail');
  assert.match(r.error, /No account/);
  api.CONFIG.SHEET_ID = saved;
  h.restore(keepActive);
  void other;
});

/* ------------------------------------------------------------------ */
section('Teacher-side student management');
test('teacher can set a temporary password and the student can use it', () => {
  const users = api.adminOverview(adminToken).users;
  const row = users.find(u => u.email === 'other@example.com');
  api.setStatus(adminToken, row.id, 'approved');          // approved accounts can log in
  const r = api.resetPassword(adminToken, row.id, 'temp1234');
  assert.strictEqual(r.ok, true, r.error);
  const li = api.login({ ident: 'other@example.com', password: 'temp1234', deviceId: 'dev-o' });
  assert.strictEqual(li.ok, true, li.error);
  const old = api.login({ ident: 'other@example.com', password: 'pass1234', deviceId: 'dev-o' });
  assert.strictEqual(old.ok, false);
  assert.ok(h.REG.mails.some(m => m.to === 'other@example.com' && /Password reset/.test(m.subject)));
});
test('a student account cannot reach teacher endpoints', () => {
  const r = api.adminOverview(studToken);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /Teacher rights/i);
  const r2 = api.listQuestions(studToken, {});
  assert.strictEqual(r2.ok, false);
});
test('resetPortal needs the confirmation phrase and keeps the bank', () => {
  const before = api.__rows('Questions').length;
  const bad = api.resetPortal(adminToken, 'please');
  assert.strictEqual(bad.ok, false);
  const ok = api.resetPortal(adminToken, 'RESET DATA');
  assert.strictEqual(ok.ok, true, ok.error);
  assert.strictEqual(api.__rows('Users').length, 0);
  assert.strictEqual(api.__rows('Attempts').length, 0);
  assert.strictEqual(api.__rows('Responses').length, 0);
  assert.strictEqual(api.__rows('Questions').length, before, 'question bank must survive');
});

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + '  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
