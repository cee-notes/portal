#!/bin/bash
# Rebuild the single file, then run every suite against the real code.
set -e
cd "$(dirname "$0")/.."
echo "--- syntax ---"
node -e "
const fs=require('fs'), P=require('./tools/paths.js');
fs.copyFileSync(P.CODE, '/tmp/.code.check.js');
const s=fs.readFileSync(P.HTML,'utf8');
fs.writeFileSync('/tmp/.client.check.js', s.slice(s.indexOf('<script>')+8, s.lastIndexOf('</'+'script>')));
console.log('layout: ' + (P.SPLIT ? 'split (src/ + dist/)' : 'flat (root)'));
"
node --check /tmp/.code.check.js && echo "Code.gs OK"
node --check /tmp/.client.check.js && echo "index.html inline script OK"
echo "--- build ---"
node tools/build.js
echo "--- backend suite ---";  node tools/test.js
echo "--- single-file suite ---"; node tools/test-allinone.js
echo "--- UI suite ---";       node tools/test-ui.js
