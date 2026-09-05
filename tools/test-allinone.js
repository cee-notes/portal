/** Verifies the generated single file behaves exactly like Code.gs + index.html. */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const h = require('./harness');
const ROOT = path.resolve(__dirname, '..');
const P = require('./paths.js');
const FILE = P.name(P.BUILT);

let pass = 0, fail = 0;
function test(n, fn) {
  try { fn(); console.log('  ok   ' + n); pass++; }
  catch (e) { console.log('  FAIL ' + n + '\n         ' + e.message); fail++; }
}
const src = fs.readFileSync(P.BUILT, 'utf8');
const html = fs.readFileSync(P.HTML, 'utf8');
const code = fs.readFileSync(P.CODE, 'utf8');

h.newSpreadsheet('ALLIN1', 'All in one');
const api = h.loadCode({ file: P.BUILT });

console.log('\n=== single-file build ===');
test('file is one paste-able .gs (no includes, sane line lengths)', () => {
  assert.ok(src.length > 150000, 'file looks truncated: ' + src.length);
  const longest = src.split('\n').reduce((a, l) => Math.max(a, l.length), 0);
  assert.ok(longest < 1000, 'longest line too long for the editor: ' + longest);
  assert.ok(!/\t/.test(src), 'tabs found - use spaces for clean pasting');
  // the UI is base64, so no markup (and no </script>) may appear raw in the .gs file
  assert.ok(!/<\/script>/i.test(src), 'raw HTML leaked into the .gs - it must stay base64');
  assert.ok(!/id="scr-auth"/.test(src), 'the portal markup leaked raw - it must stay base64');
  assert.ok(!/<div class="bar">/.test(src), 'the portal markup leaked raw - it must stay base64');
  assert.ok(/<\/script>/i.test(html), 'sanity: index.html itself does contain script tags');
});
test('EMBEDDED_HTML holds the whole portal UI', () => {
  assert.ok(typeof api.EMBEDDED_HTML === 'string' && api.EMBEDDED_HTML.length > 60000, 'embedded html missing');
  const b64 = String(api.EMBEDDED_HTML).replace(/\s+/g, '');
  const decoded = Buffer.from(b64, 'base64').toString('utf8');
  assert.strictEqual(decoded, html, 'decoded HTML is not byte-identical to index.html');
  // what students actually receive is the same bytes with the live config filled in
  const branded = decoded
    .replace(/__SUPPORT_EMAIL__/g, api.CONFIG.SUPPORT_EMAIL)
    .replace(/__PORTAL_URL__/g, api.CONFIG.PORTAL_URL || '');
  assert.strictEqual(api.getPortalHtml_(), branded, 'served html differs from index.html + config');
  assert.ok(branded.indexOf('__SUPPORT_EMAIL__') < 0, 'placeholder left in the page');
});
test('backend body is unchanged from Code.gs (only the header + literal are added)', () => {
  assert.ok(src.includes(code.slice(code.indexOf('var TAB_USERS'), code.indexOf('var TAB_USERS') + 400)), 'Code.gs body not embedded verbatim');
});
test('doGet() serves the portal without needing an index.html file', () => {
  const out = api.doGet({ parameter: {} });
  const body = out.getContent();
  assert.match(body, /<!DOCTYPE html>[\s\S]*CEE Mock Portal/);
  assert.ok(body.length > 60000, 'served html too small: ' + body.length);
  assert.ok(body.indexOf('id="supportLine"') > 0, 'support line missing from the served page');
  assert.ok(body.indexOf('mailto:support@cee-notes.cprecnepal.org.np') > 0, 'support address not injected');
  assert.strictEqual(body.indexOf('__SUPPORT_EMAIL__'), -1, 'unreplaced placeholder in the page');
  const b64 = String(api.EMBEDDED_HTML).replace(/\s+/g, '');
  assert.strictEqual(html.replace(/\s+/g, '').length, Buffer.from(b64, 'base64').toString('utf8').replace(/\s+/g, '').length);
});
test('doGet(?health=1) answers with JSON, not the portal', () => {
  const out = api.doGet({ parameter: { health: '1' } });
  const j = JSON.parse(out.getContent());
  assert.strictEqual(j.app, 'CEE Mock Portal');
  assert.match(j.embeddedHtml, /^yes \(/, 'health should report the embedded html');
});
test('a full student journey runs on the single file', () => {
  const t = api.register({ name: 'Principal Sir', email: 'principal@example.com', password: 'teach3r!', deviceId: 'dev-t' });
  assert.strictEqual(t.ok, true, t.error);
  const teacher = t.token;
  const s = api.register({ name: 'Gita', email: 'gita@example.com', password: 'pass1234', deviceId: 'dev-g' });
  assert.strictEqual(s.status, 'pending');
  const uid = api.__rows('Users').pop()[0];
  assert.strictEqual(api.setStatus(teacher, uid, 'approved').ok, true);
  const li = api.login({ ident: 'gita@example.com', password: 'pass1234', deviceId: 'dev-g' });
  assert.strictEqual(li.ok, true, li.error);
  const p = api.startMock(li.token, { section: 'all', count: 6, minutes: 10 });
  assert.strictEqual(p.ok, true, p.error);
  assert.strictEqual(p.count, 6);
  const norm = x => String(x || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const items = p.paper.map((it, i) => {
    const row = api.__rows('Questions').find(r => norm(r[2]) === norm(it.question));
    return { i: i, question: it.question, chosen: it.order.indexOf(row[7]) + 1 };
  });
  const sub = api.submitMock(li.token, { ts: Date.now(), items: items });
  assert.strictEqual(sub.ok, true, sub.error);
  assert.strictEqual(sub.score, 6);
  assert.strictEqual(sub.correct, 6);
  const rev = api.getAttempt(li.token, sub.ts);
  assert.strictEqual(rev.ok, true, rev.error);
  assert.strictEqual(rev.items.length, 6);
  assert.ok(rev.items.every(x => x.explanation.length > 3), 'review lost the explanations');
  const mail = h.REG.mails.filter(m => m.to === 'gita@example.com').pop();
  assert.ok(mail && /Your mock result/.test(mail.subject), 'no feedback email');
  const ov = api.adminOverview(teacher);
  assert.strictEqual(ov.ok, true, ov.error);
  assert.ok(ov.users.length >= 2 && ov.recent.length >= 1);
});
test('bulk import + pdf text + bank edit work on the single file', () => {
  const admin = api.login({ ident: 'principal@example.com', password: 'teach3r!', deviceId: 'dev-t' });
  assert.strictEqual(admin.ok, true, admin.error);
  const csv = 'section,topic,question,A,B,C,D,answer,explanation\nBio,Z2,"Test import question?","one","two","three","four",C,"because"\n';
  const imp = api.importQuestions(admin.token, { csv: csv, name: 'a.csv' });
  assert.strictEqual(imp.ok, true, imp.error);
  assert.strictEqual(imp.added, 1);
  const b64 = fs.readFileSync(path.join(__dirname, 'fixture.pdf.b64'), 'utf8').trim();
  const pdf = api.extractPdfText(admin.token, b64, 'syllabus.pdf');
  assert.strictEqual(pdf.ok, true, pdf.error);
  assert.match(pdf.text, /Cell theory states/);
});
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + '  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
