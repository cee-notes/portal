/** Loads the REAL index.html in a DOM and clicks through it, with google.script.run
 *  wired to the REAL Code.gs backend running in the Apps Script mock. */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const h = require('./harness');

const ROOT = path.resolve(__dirname, '..');
const P = require('./paths.js');
let pass = 0, fail = 0;
const results = [];
async function test(n, fn) {
  try { await fn(); console.log('  ok   ' + n); pass++; }
  catch (e) { console.log('  FAIL ' + n + '\n         ' + (e && e.message)); fail++; results.push([n, e]); }
}
const norm = x => String(x == null ? '' : x).replace(/\s+/g, ' ').trim();

/* ---------- backend under test ---------- */
h.newSpreadsheet('UI001', 'UI sheet');
const backend = h.loadCode();
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => { if (!/Could not parse CSS|Not implemented/.test(String(e.message))) errors.push(String(e.message)); });
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

/* ---------- google.script.run shim (mirrors Apps Script semantics) ---------- */
function makeRunner() {
  const chain = (st) => new Proxy({}, {
    get(_t, prop) {
      if (prop === 'withSuccessHandler') return (fn) => chain(Object.assign({}, st, { ok: fn }));
      if (prop === 'withFailureHandler') return (fn) => chain(Object.assign({}, st, { fail: fn }));
      if (typeof prop !== 'string') return undefined;
      return (...args) => {
        try {
          const fn = backend[prop];
          if (typeof fn !== 'function') throw new Error('no such server function: ' + prop);
          const res = fn.apply(null, args);
          if (st.ok) st.ok(res);
        } catch (e) { if (st.fail) st.fail(e); else throw e; }
        return undefined;   // Apps Script runners return the runner, never a value
      };
    }
  });
  return chain({});
}

(async function main() {
  const dom = await JSDOM.fromFile(P.HTML, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://portal.example.com/', virtualConsole: vc,
    beforeParse(window) {
      window.google = { script: { run: makeRunner() } };
      window.confirm = () => true;
      window.alert = () => true;
      window.prompt = () => 'temp12345';
      // canvas stand-in: the client only needs a 2d context + toDataURL
      window.HTMLCanvasElement.prototype.getContext = function () {
        return { fillRect() {}, drawImage() {}, save() {}, restore() {}, scale() {} };
      };
      window.HTMLCanvasElement.prototype.toDataURL = function (type, q) {
        return 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD//gA7Q1JFQVRPUg==';
      };
      const Img = window.Image;
      window.__trace = [];
      window.Image = function () {
        const i = new Img();
        Object.defineProperty(i, 'src', {
          configurable: true,
          set(v) { window.__trace.push('src:' + String(v).slice(0, 14)); setTimeout(() => {
            Object.defineProperty(i, 'width', { value: 800, configurable: true });
            Object.defineProperty(i, 'height', { value: 600, configurable: true });
            if (i.onload) i.onload();
          }, 0); },
          get() { return ''; }
        });
        return i;
      };
      if (!window.crypto || !window.crypto.getRandomValues) {
        Object.defineProperty(window, 'crypto', { value: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); return a; } } });
      }
    }
  });
  const w = dom.window, d = w.document;
  const $ = (id) => d.getElementById(id);
  const settle = async (n) => { for (let i = 0; i < (n || 8); i++) await new Promise(r => setTimeout(r, 0)); };
  const type = (id, val) => { $(id).value = val; };
  const click = async (id, n) => { $(id).click(); await settle(n === undefined ? 8 : n); };
  const visible = (id) => $(id).className.indexOf('hidden') < 0;
  const txt = (id) => norm($(id).textContent);

  console.log('\n=== portal UI (index.html) driven in a real DOM ===');

  await settle(4);
  await test('boots on the auth screen with a debug handle, no script errors', () => {
    assert.ok(visible('scr-auth'), 'auth screen should be showing');
    assert.ok(!visible('scr-student'), 'dashboard must stay hidden before login');
    assert.ok(w.__cee && w.__cee.state, 'window.__cee debug handle missing');
    assert.strictEqual(errors.length, 0, 'page errors: ' + errors.join(' | '));
    assert.match($('ex-timer') ? 'timer exists' : 'nope', /nope|timer/);
  });

  await test('registering the first account logs a teacher straight into the teacher dashboard', async () => {
    await click('tab-register');
    type('rg-name', 'Principal Sir'); type('rg-email', 'principal@example.com');
    type('rg-pass', 'teach3r!'); type('rg-pass2', 'teach3r!');
    await click('btnRegister', 20);
    assert.ok(visible('scr-teacher'), 'teacher dashboard should be showing');
    assert.match(txt('who'), /Principal Sir \(teacher\)/);
    assert.strictEqual(w.__cee.state.user.role, 'teacher');
    assert.ok(/^[0-9a-f]{32,}$/.test(w.__cee.state.dev), 'install id should be a long hex string: ' + w.__cee.state.dev);
  });

  await test('the bank was seeded on first run, and the tabs cards show it', () => {
    const rows = backend.__rows('Questions');
    assert.ok(rows.length >= 40, 'expected a seeded bank, got ' + rows.length);
    assert.match(txt('t-stats'), /Waiting for approval/);
  });

  await test('log out clears the view back to auth', async () => {
    await click('btnLogout', 6);
    assert.ok(visible('scr-auth'));
    assert.ok(!visible('scr-teacher'));
  });

  await test('a student registers and sees the awaiting-approval notice', async () => {
    await click('tab-register');
    type('rg-name', 'Gita Karki'); type('rg-email', 'gita@example.com'); type('rg-user', 'gita');
    type('rg-pass', 'pass1234'); type('rg-pass2', 'pass1234');
    await click('btnRegister', 10);
    assert.match($('rgMsg').innerHTML, /Registered/);
    assert.ok(!w.__cee.state.token, 'a pending student must not hold a session');
    assert.strictEqual(backend.__rows('Users').pop()[6], 'pending');
    assert.strictEqual(d.getElementById('pane-login').className, '', 'login pane should be revealed for the teacher');
    assert.strictEqual($('li-ident').value, 'gita@example.com', 'email should carry over to the login box');
  });

  await test('a pending student cannot get in', async () => {
    type('li-pass', 'pass1234');
    await click('btnLogin', 8);
    assert.match($('liMsg').textContent, /pending teacher approval/i);
  });

  await test('teacher approves from the approvals tab (button click, not code)', async () => {
    type('li-ident', 'principal@example.com'); type('li-pass', 'teach3r!');
    await click('btnLogin', 16);
    assert.ok(visible('scr-teacher'));
    const items = d.querySelectorAll('#absList .item');
    assert.strictEqual(items.length, 1, 'one pending student expected, got ' + items.length);
    assert.match(items[0].textContent, /Gita Karki/);
    const btn = items[0].querySelector('[data-act="approve"]');
    btn.click();
    await settle(18);
    assert.strictEqual(backend.__rows('Users').find(r => r[2] === 'gita@example.com')[6], 'approved');
    assert.ok(h.REG.mails.some(m => m.to === 'gita@example.com' && /approved/i.test(m.subject)), 'no approval email');
    assert.match($('pendBadge').className, /hidden/, 'pending badge should clear');
  });

  await test('student login lands on the dashboard with a populated topic picker', async () => {
    await click('btnLogout', 6);
    type('li-ident', 'gita@example.com'); type('li-pass', 'pass1234');
    await click('btnLogin', 18);
    assert.ok(visible('scr-student'), 'student dashboard expected');
    assert.match(txt('st-hello'), /Hello, Gita Karki/);
    const secs = Array.from($('mk-section').options).map(o => o.value);
    assert.deepStrictEqual(secs, ['all', 'Bio', 'Chem', 'Phy', 'Math']);
    $('mk-section').value = 'Phy';
    $('mk-section').dispatchEvent(new w.Event('change'));
    const topics = Array.from($('mk-topic').options).map(o => o.value);
    assert.ok(topics.includes('P1') && topics.length === 9, 'Phy should list P1..P8 + blank: ' + topics.join(','));
    $('mk-section').value = 'Bio';
    $('mk-section').dispatchEvent(new w.Event('change'));
    assert.ok(Array.from($('mk-topic').options).map(o => o.value).includes('Z5'), 'Bio must list Z and B codes');
    assert.strictEqual(w.__cee.topicList('Bio').length, 15, 'Bio = Z1-Z9 + B1-B6');
  });

  await test('start mock renders the exam engine (palette, timer, four cards)', async () => {
    $('mk-section').value = 'all';
    $('mk-section').dispatchEvent(new w.Event('change'));
    $('mk-count').value = '5'; $('mk-min').value = '10';
    await click('btnStart', 16);
    assert.ok(visible('scr-exam'), 'exam screen expected');
    assert.strictEqual(d.querySelectorAll('#palette button').length, 5);
    assert.strictEqual(d.querySelectorAll('#ex-opts .opt').length, 4, 'four option cards');
    assert.match(txt('ex-num'), /1\/5/);
    assert.match(txt('ex-timer'), /^\d\d:\d\d$/, 'timer should read mm:ss, got ' + txt('ex-timer'));
    assert.ok(!/answer|explanation/.test(d.getElementById('ex-q').innerHTML.toLowerCase().slice(0, 10)), 'no key in DOM');
    assert.strictEqual(backend.__rows('Responses').length, 0);
  });

  await test('answering updates the card, the palette and the counter', async () => {
    const first = d.querySelector('#ex-opts .opt');
    first.click(); await settle(2);
    assert.match(d.querySelector('#ex-opts .opt').className, /sel/);
    assert.match(d.querySelectorAll('#palette button')[0].className, /done/);
    assert.match(txt('ex-progress'), /1 answered/);
    d.getElementById('btnMark').click(); await settle(2);
    assert.match(txt('ex-marked'), /1 marked/);
    d.getElementById('btnNext').click(); await settle(2);
    assert.match(txt('ex-num'), /2\/5/);
    d.getElementById('btnPrev').click(); await settle(2);
    assert.match(txt('ex-num'), /1\/5/);
    assert.match(d.querySelector('#ex-opts .opt').className, /sel/, 'answer must persist when navigating back');
    d.getElementById('btnClear').click(); await settle(2);
    assert.doesNotMatch(d.querySelector('#ex-opts .opt').className, /sel/);
    assert.match(txt('ex-progress'), /0 answered/);
  });

  await test('submitting shows the result, review and images; the attempt is stored', async () => {
    for (let i = 0; i < 5; i++) {
      const pal = d.querySelectorAll('#palette button')[i];
      pal.click(); await settle(1);
      d.querySelector('#ex-opts .opt').click(); await settle(1);
    }
    await click('btnSubmitExam', 24);
    assert.ok(visible('scr-result'), 'result screen expected');
    assert.match(txt('rs-title'), /Score:/);
    assert.strictEqual(d.querySelectorAll('#rs-stats .stat').length, 4);
    const items = d.querySelectorAll('#rs-list .item');
    assert.strictEqual(items.length, 5, 'one review card per question, got ' + items.length);
    assert.ok(/Correct \+1|Wrong -0\.25|Not attempted 0/.test(items[0].textContent), 'verdict line missing: ' + items[0].textContent.slice(0, 60));
    const imgs = Array.from(d.querySelectorAll('#rs-list .item img'));
    for (const im of imgs) assert.match(im.getAttribute('src'), /^(https?:|data:image\/)/, 'every review image must be renderable');
    const att = backend.__rows('Attempts').pop();
    assert.ok(att, 'attempt row missing');
    assert.strictEqual(Number(att[11]), 5, 'detailCount should be 5');
    assert.strictEqual(backend.__rows('Responses').filter(r => r[0] === att[0]).length, 5);
    assert.strictEqual(w.__cee.state.paper, null, 'the in-progress paper must be cleared');
    assert.ok(h.REG.mails.some(m => m.to === 'gita@example.com' && /Your mock result/.test(m.subject)), 'no feedback email');
  });

  await test('the review filter and "only wrong" checkbox work', async () => {
    const cb = $('rs-onlyWrong');
    cb.checked = true; cb.dispatchEvent(new w.Event('change'));
    await settle(4);
    const shown = d.querySelectorAll('#rs-list .item').length;
    const notCorrect = backend.__rows('Responses').filter(r => Number(r[7]) !== 1).length;
    assert.strictEqual(shown, notCorrect, 'filter should hide correct items');
    cb.checked = false; cb.dispatchEvent(new w.Event('change')); await settle(4);
    assert.strictEqual(d.querySelectorAll('#rs-list .item').length, 5);
  });

  await test('back on the dashboard the history and stats are live', async () => {
    await click('btnBackDash', 20);
    assert.ok(visible('scr-student'));
    assert.strictEqual(txt('stAttempts'), '1');
    const rows = d.querySelectorAll('#histList tr');
    assert.strictEqual(rows.length, 1, 'history should list the attempt');
    assert.match(rows[0].textContent, /Review/);
  });

  await test('reopening the attempt from history renders the stored review', async () => {
    d.querySelector('#histList [data-act="review"]').click();
    await settle(20);
    assert.ok(!visible('reviewStd'), 'review holder should be visible');
    assert.match($('reviewStd').textContent, /Attempt review/);
    assert.strictEqual($('reviewStd').querySelectorAll('.item').length, 5);
  });

  await test('a paper drawn for Phy/P1 shows the seeded figure in the quiz', async () => {
    $('mk-section').value = 'Phy'; $('mk-section').dispatchEvent(new w.Event('change'));
    $('mk-topic').value = 'P1';
    $('mk-count').value = '5';
    await click('btnStart', 16);
    let sawImage = false;
    for (let i = 0; i < 5; i++) {
      d.querySelectorAll('#palette button')[i].click(); await settle(2);
      if (d.querySelector('#ex-imgbox img')) { sawImage = true; break; }
    }
    assert.ok(sawImage, 'the seeded vector figure should render in the exam');
    assert.match(d.querySelector('#ex-imgbox img').getAttribute('src'), /^data:image\/png;base64,/);
    await click('btnSubmitExam', 24);
    assert.ok(visible('scr-result'));
  });

  await test('a student clicking the hidden teacher button is refused, not shown the panel', async () => {
    const before = $('scr-teacher').className;
    d.getElementById('btnTeacher').click(); await settle(6);
    assert.strictEqual($('scr-teacher').className, before, 'student must not reach the teacher screen');
    assert.ok(visible('scr-result') || visible('scr-student'), 'student should stay on their own screen');
  });

  await test('log back in as the teacher for the admin screens', async () => {
    await click('btnLogout', 6);
    type('li-ident', 'principal@example.com'); type('li-pass', 'teach3r!');
    await click('btnLogin', 18);
    assert.ok(visible('scr-teacher'), 'teacher dashboard expected');
  });

  await test('teacher: the question form, CSV paste and image guard are wired', async () => {
    await click('btnTeacher', 22);
    d.querySelector('#scr-teacher .tabbar [data-tt="bank"]').click();
    await settle(4);
    $('qf-section').value = 'Chem'; $('qf-section').dispatchEvent(new w.Event('change'));
    type('qf-topic', 'C5');
    assert.strictEqual($('qf-topic').value, 'C5', 'topic code must survive a section change');
    type('qf-question', 'UI-created question: which hydrocarbon is aromatic?');
    type('qf-a', 'Ethane'); type('qf-b', 'Benzene'); type('qf-c', 'Ethene'); type('qf-d', 'Ethyne');
    $('qf-answer').value = 'B'; type('qf-expl', 'Benzene follows Huckel 4n+2 with n=1.');
    const before = backend.__rows('Questions').length;
    await click('btnSaveQ', 22);
    assert.strictEqual(backend.__rows('Questions').length, before + 1, 'question not appended');
    assert.match($('qfMsg').textContent, /added/);
    const row = backend.__rows('Questions').pop();
    assert.strictEqual(row[1], 'C5'); assert.strictEqual(row[7], 'B');
    assert.match($('qList').textContent, /UI-created question/, 'bank list should show the new question');
    // bulk paste path
    const csv = 'section,topic,question,A,B,C,D,answer,explanation\nMath,M2,"i^2 equals?",1,-1,i,-i,B,"by definition"\n';
    type('csvText', csv);
    await click('btnImportCsv', 20);
    assert.match($('upMsg').textContent, /Imported 1/);
    assert.strictEqual(backend.__rows('Questions').pop()[2], 'i^2 equals?');
  });

  await test('teacher: PDF builder splits sentences and saves the stem into the bank', async () => {
    const sents = w.__cee.splitSentences('Cell theory states that all organisms are made of cells. New cells arise only from pre-existing cells. Robert Hooke observed cork in 1665.');
    assert.strictEqual(sents.length, 3, 'splitter returned ' + JSON.stringify(sents));
    d.querySelector('#scr-teacher .tabbar [data-tt="pdf"]').click(); await settle(2);
    type('pdf-section', 'Bio'); type('pdf-topic', 'Z1');
    type('pdf-question', sents[0] + ' Which statement is correct?');
    type('pdf-a', sents[0]); type('pdf-b', 'Cells arise spontaneously'); type('pdf-c', 'Only plants have cells'); type('pdf-d', 'Atoms are the unit of life');
    $('pdf-answer').value = 'A'; type('pdf-expl', 'Quoted from the syllabus PDF text.');
    const before = backend.__rows('Questions').length;
    await click('btnPdfSave', 20);
    assert.strictEqual(backend.__rows('Questions').length, before + 1, 'builder save did not reach the bank');
    assert.match(backend.__rows('Questions').pop()[2], /Which statement is correct/);
  });

  await test('teacher: system tab health check + reset-device button in the students table', async () => {
    d.querySelector('#scr-teacher .tabbar [data-tt="sys"]').click(); await settle(2);
    await click('btnHealth', 16);
    const out = JSON.parse($('healthOut').textContent);
    assert.strictEqual(out.ok, true);
    assert.ok(out.counts.Questions >= 40, 'health should count the bank');
    assert.match(out.embeddedHtml, /^no/, 'split build has no literal - expected');
    d.querySelector('#scr-teacher .tabbar [data-tt="std"]').click(); await settle(6);
    const gitaRow = Array.from(d.querySelectorAll('#stdList tr')).find(tr => /gita@example\.com/.test(tr.textContent));
    assert.ok(gitaRow, 'gita not listed');
    assert.match(gitaRow.textContent, /locked|active|not bound|[0-9a-f]{6}/);
    const btn = gitaRow.querySelector('[data-act="resetdev"]');
    assert.ok(btn, 'no device reset button rendered');
    btn.click(); await settle(16);
    assert.strictEqual(backend.__rows('Users').find(r => r[2] === 'gita@example.com')[7], '', 'device id should be cleared');
  });

  await test('teacher: portal link + support address can be fixed without a re-deploy', async () => {
    d.querySelector('#scr-teacher .tabbar [data-tt="sys"]').click(); await settle(8);
    assert.strictEqual($('tPortal').value, backend.CONFIG.PORTAL_URL, 'system tab should preload the saved link');
    assert.strictEqual($('tSupport').value, backend.CONFIG.SUPPORT_EMAIL);
    // index.html served outside doGet has no placeholder replacement, so the line must hide itself
    assert.strictEqual($('supportLine').className, 'hidden', 'unreplaced support placeholder should hide the line');

    type('tPortal', 'https://script.google.com/macros/s/UIEXEC123/exec');
    await click('btnPortal', 24);
    assert.match($('portalMsg').textContent, /Test mail sent/, 'saving must verify the sender: ' + $('portalMsg').textContent);
    assert.strictEqual(backend.health().portalUrl, 'https://script.google.com/macros/s/UIEXEC123/exec');
    const probe = backend.__mails.filter(m => /Settings saved/.test(m.subject)).pop();
    assert.ok(probe, 'no settings test mail');
    assert.strictEqual(probe.from, backend.CONFIG.MAIL_FROM, 'test mail should go out as the support address');
    assert.strictEqual(probe.replyTo, backend.CONFIG.SUPPORT_EMAIL);

    await click('btnHealth', 16);
    assert.match($('healthNote').textContent, /UIEXEC123/, 'health note should echo the live portal link');

    // the link now reaches student mail
    const before = backend.__rows('Users').length;
    assert.match(String(backend.register({ name: 'Link Ui', email: 'linkui@example.com', password: 'pass1234' }).ok), /true/);
    const mail = backend.__mails.filter(m => m.to === 'linkui@example.com').pop();
    assert.match(mail.body, /UIEXEC123\/exec/, 'pending mail should carry the saved link');
    assert.strictEqual(backend.__rows('Users').length, before + 1);

    type('tPortal', '');   // clear -> back to whatever CONFIG says
    await click('btnPortal', 24);
    assert.strictEqual(backend.health().portalUrl, backend.CONFIG.PORTAL_URL, 'clearing falls back to CONFIG');
  });

  await test('uploading a figure resizes it into a data: URI and saves with the question', async () => {
    d.querySelector('#scr-teacher .tabbar [data-tt="bank"]').click(); await settle(3);
    const input = d.getElementById('qf-imgfile');
    const file = new w.File([new Uint8Array(64).fill(7)], 'figure.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new w.Event('change'));
    await settle(10);
    assert.match($('qf-image').value, /^data:image\/jpeg;base64,/, 'the resized data URI should be in the field');
    assert.strictEqual(w.__trace.filter(x => x.startsWith('src:')).length, 1, 'the image must be loaded once, trace: ' + w.__trace.join(','));
    assert.ok(d.querySelector('#qf-imgprev img'), 'preview thumbnail missing');
    type('qf-question', 'Figure test: what does the diagram show?');
    type('qf-a', 'A vector sum'); type('qf-b', 'A circle'); type('qf-c', 'Nothing'); type('qf-d', 'A wave');
    $('qf-answer').value = 'A'; type('qf-expl', 'Figure questions ride along in the image column.');
    const before = backend.__rows('Questions').length;
    await click('btnSaveQ', 20);
    assert.strictEqual(backend.__rows('Questions').length, before + 1);
    const row = backend.__rows('Questions').pop();
    assert.match(String(row[9]), /^data:image\/jpeg;base64,/, 'image column should carry the data URI');
    // and the "remove image" control clears it
    $('qf-image').value = 'x';
    d.querySelector('#qf-imgprev').innerHTML = '<button data-act="dropimg">Remove image</button>';
    d.querySelector('[data-act="dropimg"]').click(); await settle(3);
    assert.strictEqual($('qf-image').value, '', 'remove-image should clear the field');
  });

  await test('teacher can issue a new password from the students table', async () => {
    d.querySelector('#scr-teacher .tabbar [data-tt="std"]').click(); await settle(8);
    const gitaRow = Array.from(d.querySelectorAll('#stdList tr')).find(tr => /gita@example\.com/.test(tr.textContent));
    const btn = gitaRow.querySelector('[data-act="pw"]');
    btn.click(); await settle(14);
    assert.ok(h.REG.mails.some(m => m.to === 'gita@example.com' && /Password reset/.test(m.subject)), 'no password email');
    const li = backend.login({ ident: 'gita@example.com', password: 'temp12345', deviceId: 'ui-test-device' });
    assert.strictEqual(li.ok, true, li.error);
  });

  await test('an expired session bounces the user to the login screen', async () => {
    const rowNum = backend.__sheet('Users').rows.findIndex(r => r[2] === 'principal@example.com') + 1;
    backend.updateRow_('Users', rowNum, { sessionExpiry: Date.now() - 1000 });
    const r = await w.__cee.api('myAttempts');
    await settle(8);
    assert.strictEqual(r.session, true, 'expected the session flag, got ' + JSON.stringify(r));
    // now let the client itself hit a session failure: the teacher refresh must bounce us
    await click('btnRefreshT', 14);
    assert.ok(visible('scr-auth'), 'should have been bounced to the auth screen');
    assert.match($('liMsg').textContent, /expired|log in again/i);
    assert.strictEqual(w.__cee.state.token, '', 'the dead token must be dropped from state');
  });

  await test('the CPREC branding from the Pages repo is kept in the portal', () => {
    const img = d.querySelector('.logo img');
    assert.ok(img, 'header logo missing');
    assert.match(img.src, /cee-notes\/%20portal|raw\.githubusercontent\.com\/cee-notes\/portal/, 'logo src: ' + img.src);
    assert.match(d.querySelector('link[rel="icon"]').href, /CEE%20Notes%20Logo/, 'favicon missing');
    assert.match(d.body.textContent, /Powered by/, 'footer credit missing');
    assert.match(d.body.textContent, /Follow us on Facebook/);
    assert.strictEqual(d.getElementById('offlineNotice'), null, 'no notice when google.script.run exists');
  });

  await test('a static copy explains itself instead of freezing', async () => {
    const errs = [];
    const vc2 = new VirtualConsole();
    vc2.on('jsdomError', e => { if (!/Could not parse CSS|Not implemented/.test(String(e.message))) errs.push(String(e.message)); });
    const raw = fs.readFileSync(P.HTML, 'utf8');
    const dom2 = new JSDOM(raw, { runScripts: 'dangerously', pretendToBeVisual: true,
      url: 'https://cee-notes.github.io/portal/', virtualConsole: vc2 });
    const d2 = dom2.window.document;
    await new Promise(r => setTimeout(r, 2600));   // the page waits ~2 s for a runner before giving up
    assert.strictEqual(d2.getElementById('reviewStd'), null, 'the app must not start without a server');
    const notice = d2.getElementById('offlineNotice');
    assert.ok(notice, 'no offline notice rendered');
    assert.match(notice.textContent, /plain copy of the portal page|Open the portal from its own link/);
    assert.strictEqual(d2.getElementById('scr-auth').className, 'hidden', 'the dead login form must be hidden');
    assert.deepStrictEqual(errs, [], 'guard must not throw: ' + errs.join(' | '));
    // placeholder unreplaced on a static host -> no bogus link, just the owner note
    assert.match(notice.textContent, /Deploy .* Web app|Owner:/s);
    dom2.window.close();
  });

  await test('a runner that arrives late is not mistaken for a static copy', async () => {
    // Apps Script installs google.script.run from its own script tag; if that lands after
    // ours, the app has to wait for it instead of showing the offline notice.
    const errs3 = [];
    const vc3 = new VirtualConsole();
    vc3.on('jsdomError', e => { if (!/Could not parse CSS|Not implemented/.test(String(e.message))) errs3.push(String(e.message)); });
    const dom3 = new JSDOM(fs.readFileSync(P.HTML, 'utf8'), {
      runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://script.google.com/macros/s/X/exec',
      virtualConsole: vc3,
      beforeParse(window) { window.google = { script: {} }; }        // no .run yet
    });
    await new Promise(r => setTimeout(r, 300));                      // boot() is now in its grace loop
    assert.strictEqual(dom3.window.document.getElementById('offlineNotice'), null, 'gave up too early');
    dom3.window.google.script.run = makeRunner();                   // framework catches up
    await new Promise(r => setTimeout(r, 600));
    const d3 = dom3.window.document;
    assert.ok(d3.getElementById('reviewStd'), 'app did not start once the runner appeared');
    assert.strictEqual(d3.getElementById('offlineNotice'), null);
    assert.ok(d3.getElementById('supportLine'), 'startApp should have run');
    assert.deepStrictEqual(errs3, [], 'late runner must not throw: ' + errs3.join(' | '));
    dom3.window.close();
  });

  await test('no uncaught page errors during the whole run', () => {
    assert.deepStrictEqual(errors, []);
  });

  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + '  ' + pass + ' passed, ' + fail + ' failed');
  if (fail && results.length) console.log('\nfirst failure detail:\n' + (results[0][1] && results[0][1].stack));
  dom.window.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('harness crashed:', e); process.exit(2); });
