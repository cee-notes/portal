/** Apps Script runtime mock good enough to execute Code.gs in Node.
 *  Written for this project's tests only - not part of the deployment. */
'use strict';
const crypto = require('crypto');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const P = require('./paths.js');      // where Code.gs / index.html live in this layout

/* ----------------- spreadsheet ----------------- */
class MockRange {
  constructor(sheet, row, col, nr, nc) {
    this.sheet = sheet; this.row = row; this.col = col;
    this.nr = nr || 1; this.nc = nc || 1;
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const rowArr = this.sheet.rows[this.row - 1 + r] || [];
      const line = [];
      for (let c = 0; c < this.nc; c++) {
        const v = rowArr[this.col - 1 + c];
        line.push(v === undefined ? '' : v);
      }
      out.push(line);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(vals) {
    const need = this.row - 1 + vals.length;
    while (this.sheet.rows.length < need) this.sheet.rows.push([]);
    for (let r = 0; r < vals.length; r++) {
      const target = this.sheet.rows[this.row - 1 + r];
      for (let c = 0; c < vals[r].length; c++) target[this.col - 1 + c] = vals[r][c];
    }
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
}
class MockSheet {
  constructor(name) { this.name = name; this.rows = []; this.frozen = 0; }
  getName() { return this.name; }
  getLastRow() {
    let last = 0;
    for (let i = 0; i < this.rows.length; i++) {
      if ((this.rows[i] || []).some(v => String(v === undefined ? '' : v).length)) last = i + 1;
    }
    return last;
  }
  getMaxColumns() { return Math.max(1, ...this.rows.map(r => r.length)); }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      const m = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(a);
      if (!m) throw new Error('A1 range parsing not mocked: ' + a);
      const c1 = colNum(m[1]), c2 = m[3] ? colNum(m[3]) : c1;
      const r2 = m[4] ? Number(m[4]) : Number(m[2]);
      return new MockRange(this, Number(m[2]), c1, r2 - Number(m[2]) + 1, c2 - c1 + 1);
    }
    return new MockRange(this, a, b, c, d);
  }
  appendRow(arr) { this.rows.push(arr.slice()); return this.rows.length; }
  deleteRow(n) { return this.deleteRows(n, 1); }
  deleteRows(start, count) { this.rows.splice(start - 1, count); return this; }
  setFrozenRows(n) { this.frozen = n; return this; }
  clear() { this.rows = []; return this; }
}
function colNum(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
class MockSpreadsheet {
  constructor(id, name) { this.id = id; this.name = name || 'Mock Sheet'; this.sheets = []; }
  getName() { return this.name; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
  getSheetByName(n) { return this.sheets.find(s => s.getName() === n) || null; }
  insertSheet(n) {
    if (this.getSheetByName(n)) throw new Error('sheet exists: ' + n);
    const sh = new MockSheet(n); this.sheets.push(sh); return sh;
  }
  getSheets() { return this.sheets.slice(); }
}

/* ----------------- blobs / zip ----------------- */
function normBytes(d) {
  if (d instanceof Int8Array) return d.slice();
  if (Array.isArray(d)) { const a = new Int8Array(d.length); for (let i = 0; i < d.length; i++) a[i] = d[i] & 0xff; return a; }
  if (Buffer.isBuffer(d)) { const a = new Int8Array(d.length); for (let i = 0; i < d.length; i++) a[i] = d[i] | 0; return a; }
  if (typeof d === 'string') { const b = Buffer.from(d, 'utf8'); const a = new Int8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b[i] | 0; return a; }
  return new Int8Array(0);
}
class MockBlob {
  constructor(data, ct, name) { this._b = normBytes(data); this._ct = ct || ''; this._name = name || 'blob'; }
  getBytes() { return this._b; }
  getContentType() { return this._ct; }
  setContentType(ct) { return new MockBlob(this._b, ct, this._name); }
  getName() { return this._name; }
  copyBlob() { return new MockBlob(this._b, this._ct, this._name); }
  getDataAsString(cs) {
    const enc = cs === 'ISO-8859-1' ? 'latin1' : (cs || 'utf8').toLowerCase() === 'utf-8' ? 'utf8' : String(cs).toLowerCase();
    return Buffer.from(toBuffer(this._b)).toString(enc);
  }
  getAs(type) { throw new Error('getAs(' + type + ') is intentionally unavailable in the harness'); }
}
function toBuffer(int8) { return Buffer.from(int8.buffer, int8.byteOffset, int8.length); }
function zipRead(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65557; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nlen = buf.readUInt16LE(off + 28), elen = buf.readUInt16LE(off + 30), clen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.toString('latin1', off + 46, off + 46 + nlen);
    const lnlen = buf.readUInt16LE(lho + 26), lelen = buf.readUInt16LE(lho + 28);
    const dstart = lho + 30 + lnlen + lelen;
    const data = buf.slice(dstart, dstart + csize);
    const bytes = method === 0 ? data : method === 8 ? zlib.inflateRawSync(data) : (() => { throw new Error('zip method ' + method); })();
    out.push({ name, data: bytes });
    off += 46 + nlen + elen + clen;
  }
  return out;
}

/* ----------------- services ----------------- */
const REG = {
  active: null, byId: new Map(), mails: [], lockFail: false, lockCount: 0, rejectFrom: false,
  htmlFiles: () => fs.readFileSync(P.HTML, 'utf8')
};
function snapshot() { return REG.active; }
function restore(ss) { REG.active = ss; return ss; }
function newSpreadsheet(id, name) {
  const ss = new MockSpreadsheet(id, name);
  REG.byId.set(id, ss);
  REG.active = ss;
  return ss;
}
const SpreadsheetApp = {
  getActiveSpreadsheet: () => REG.active,
  openById: (id) => {
    const ss = REG.byId.get(String(id));
    if (!ss) throw new Error("This document no longer exists: " + id);
    return ss;
  },
  getUi: () => ({
    createMenu: () => ({ addItem() { return this; }, addToUi() { return this; } }),
    alert() { return 'OK'; }
  })
};
const LockService = {
  getScriptLock() {
    return {
      waitLock() { REG.lockCount++; return !REG.lockFail; },
      tryLock() { REG.lockCount++; return !REG.lockFail; },
      releaseLock() {}
    };
  }
};
const Utilities = {
  DigestAlgorithm: { SHA_256: 'SHA-256' },
  Charset: { UTF_8: 'UTF-8' },
  computeDigest(algo, data /* , charset */) {
    const buf = Buffer.isBuffer(data) ? data : (typeof data === 'string' ? Buffer.from(data, 'utf8') : toBuffer(normBytes(data)));
    return Int8Array.from(crypto.createHash(algo).update(buf).digest());
  },
  getUuid: () => crypto.randomUUID(),
  base64Encode(d) {
    const buf = typeof d === 'string' ? Buffer.from(d, 'utf8') : toBuffer(normBytes(d));
    return buf.toString('base64');
  },
  base64Decode(s) { return normBytes(Buffer.from(String(s).replace(/\s/g, ''), 'base64')); },
  newBlob: (data, ct, name) => new MockBlob(data, ct, name),
  formatDate(d, tz, fmt) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  },
  ungzip(blob) {
    const raw = toBuffer(normBytes(blob.getBytes()));
    let out;
    try { out = zlib.gunzipSync(raw); } catch (e) { out = zlib.inflateSync(raw); }
    return new MockBlob(out, 'application/octet-stream', blob.getName() + '.out');
  },
  unzip(blob) {
    return zipRead(toBuffer(normBytes(blob.getBytes()))).map(e => new MockBlob(e.data, 'application/octet-stream', e.name));
  }
};
const MailApp = {
  getRemainingDailyQuota() { return Math.max(0, 100 - REG.mails.length); },
  sendEmail(opts) {
    const o = typeof opts === 'string' ? { to: opts, subject: arguments[1], body: arguments[2] } : opts;
    if (!o.to) throw new Error('No recipient');
    if (o.from && REG.rejectFrom) throw new Error('You may only send from your address or alias: ' + o.from);
    const m = {
      to: o.to, subject: o.subject, body: o.htmlBody || o.body || '', from: o.from || null, replyTo: o.replyTo || null,
      hasInline: o.inlineImages ? Object.keys(o.inlineImages) : null,
      inlineBytes: o.inlineImages ? Object.keys(o.inlineImages).map(k => o.inlineImages[k].getBytes().length) : null
    };
    REG.mails.push(m);
  }
};
const propsStore = new Map();
const PropertiesService = {
  getScriptProperties: () => ({
    getProperty: k => (propsStore.has(k) ? propsStore.get(k) : null),
    setProperty: (k, v) => { propsStore.set(k, String(v)); return this; },
    deleteProperty: k => { propsStore.delete(k); return this; },
    getProperties: () => Object.fromEntries(propsStore)
  })
};
const Session = { getScriptTimeZone: () => 'Asia/Katmandu', getActiveUser: () => ({ getEmail: () => 'owner@example.com' }) };
const HtmlService = {
  XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
  createHtmlOutput(html) {
    const o = { _h: html, setTitle() { return o; }, addMetaTag() { return o; }, setXFrameOptionsMode() { return o; }, getContent: () => o._h };
    return o;
  },
  createHtmlOutputFromFile(name) {
    if (name === 'index') return HtmlService.createHtmlOutput(REG.htmlFiles());
    throw new Error('file not found: ' + name);
  }
};
const ContentService = {
  MimeType: { JSON: 'JSON' },
  createTextOutput(s) { const o = { _c: s, setMimeType() { return o; }, getContent: () => o._c }; return o; }
};
const Logger = { log: (...a) => console.log('[log]', ...a) };

/* ----------------- loader ----------------- */
/** Runs Code.gs in the SAME realm as the tests (so assert.deepStrictEqual and plain
 *  objects behave), exposing every top-level function plus the mutable globals. */
function loadCode(opts) {
  opts = opts || {};
  const f = opts.file || P.CODE;
  const src = fs.readFileSync(path.isAbsolute(f) ? f : path.join(ROOT, f), 'utf8');
  const fns = [...src.matchAll(/^function ([A-Za-z_$][\w$]*)\s*\(/gm)].map(m => m[1]);
  const globals = ['CONFIG', 'DEFAULT_BANK', 'FALLBACK_BANK', 'EMBEDDED_HTML', 'MAIL_STATE'];
  const services = { SpreadsheetApp, LockService, Utilities, MailApp, PropertiesService, Session, HtmlService, ContentService, Logger };
  const names = Object.keys(services);
  const body = '"use strict";\n' + src + '\n' +
    'return {' + fns.map(n => JSON.stringify(n) + ': ' + n).join(', ') + ', ' +
    globals.map(g => `get ${g}(){ try { return ${g}; } catch (e) { return undefined; } }, set ${g}(v) { ${g} = v; return v; }`).join(', ') +
    ', __services: {' + names.map(n => n + ': ' + n).join(', ') + '}};';
  let fn;
  try {
    fn = Object.create(null, {});
    const compiled = new Function(...names, body);
    const api = compiled.apply(null, names.map(n => services[n]));
    if (opts.EMBEDDED_HTML) api.EMBEDDED_HTML = opts.EMBEDDED_HTML;
    api.__sheet = (name) => REG.active.getSheetByName(name);
    api.__rows = (name) => {
      const sh = REG.active.getSheetByName(name);
      if (!sh) return [];
      return sh.rows.slice(1).filter(r => (r || []).some(v => String(v === undefined ? '' : v).length));
    };
    api.__header = (name) => (REG.active.getSheetByName(name).rows[0] || []).filter(v => String(v).length);
    api.__reset = () => { REG.mails.length = 0; REG.lockFail = false; REG.lockCount = 0; REG.rejectFrom = false; propsStore.clear(); };
    api.__mails = REG.mails;
    return api;
  } catch (e) {
    if (String(e.message).includes('EMBEDDED_HTML is not defined')) {
      // the all-in-one file defines EMBEDDED_HTML itself; nothing to do
    }
    throw e;
  }
}
module.exports = { loadCode, newSpreadsheet, REG, MockBlob, Utilities, colNum, snapshot, restore, byId: () => REG.byId };
