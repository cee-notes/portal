/** Where the sources live, so one set of tools works in both project layouts:
 *
 *   flat  (this repo)      Code.gs, index.html, cee_mock_all_in_one.gs at the root,
 *                          pages/index.html as the GitHub Pages landing door
 *   split (the Pages repo) src/Code.gs + src/index.html, dist/cee_mock_all_in_one.gs,
 *                          because the root index.html there MUST be the Pages page
 *
 * The layout is decided by the presence of src/Code.gs, so copying the tools
 * between the two repos needs no edits. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SPLIT = fs.existsSync(path.join(ROOT, 'src', 'Code.gs'));
const SRC = SPLIT ? path.join(ROOT, 'src') : ROOT;
const DIST = SPLIT ? path.join(ROOT, 'dist') : ROOT;

module.exports = {
  ROOT: ROOT,
  SPLIT: SPLIT,
  CODE: path.join(SRC, 'Code.gs'),
  HTML: path.join(SRC, 'index.html'),
  BUILT: path.join(DIST, 'cee_mock_all_in_one.gs'),
  PAGES: SPLIT ? path.join(ROOT, 'index.html') : path.join(ROOT, 'pages', 'index.html'),
  /** repo-relative, forward slashes - for log lines and assertions */
  name: function (p) { return path.relative(ROOT, p).split(path.sep).join('/') || '.'; },
  exists: function (p) { return fs.existsSync(p); }
};
