# tools/ - not deployed, developer only

| file | what it is |
|---|---|
| `build.js` | base64-encodes `index.html`, wraps it into lines of <=116 chars and writes `../cee_mock_all_in_one.gs` |
| `harness.js` | Node mock of the Apps Script runtime (Sheets, LockService, Utilities incl. base64/sha-256/gzip/zip, PropertiesService, MailApp, HtmlService). Only used by the tests |
| `test.js` | 51 backend acceptance checks, one section per requirement number |
| `test-allinone.js` | checks the generated single file (doGet, round-trip of the HTML, full journey) |
| `test-ui.js` | loads the real `index.html` in jsdom and clicks through the portal against the real backend |
| `run.sh` | `bash tools/run.sh` = syntax checks + build + all three suites |
| `rebalance.py` | one-off: spreads the answer letters in the seeded bank (kept for reference) |
| `figure-vector.png/.b64` | the sample Physics figure embedded in `DEFAULT_BANK` |
| `fixture.xlsx(.b64)`, `fixture.pdf(.b64)` | genuine Office/PDF fixtures so the importers are tested on real file formats |

`npm install` in the project root pulls jsdom (test-only dependency).
