# v0.1.1 publication verification

19 November 2026. Offline verification before the first public GitHub release. No model generation request was sent by any check on this page.

## Tested source

| Field                      | Value                                                                       |
| -------------------------- | --------------------------------------------------------------------------- |
| Source revision            | `76e66fc693b6a476975defc216cf24c6623ddcb6`                                  |
| Working tree               | Clean for every report below (`workingTreeDirty: false`)                    |
| Source-tree SHA-256        | `2b9cc0173fb195610ddfb2dc30107a149d722c2b29e0cb6abee8e35a516ded76`          |
| Source-tree method         | `utf8-lf-v1` (apps, packages, services, scripts, verification, root config) |
| Corpus SHA-256             | `4e52bffcfff2f9cd945f9c05b5d7bb5444212e8f26b47bdf17aff543224a9af8`          |
| Embedding manifest SHA-256 | `7abeb180b9c205b60f1094e7deba05e39e36a92b7a7356c6fd4b412552757cb7`          |
| Host                       | Windows, Node 24.14.0, npm 11.9.0, Python 3.13.1                            |

Later commits that change only documentation keep the same source-tree SHA-256. The GitHub release page names the tagged commit and its GitHub Actions run.

## Observed results

| Check                                      | Command                 | Result                                                                              |
| ------------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------- |
| Formatting, strict types, TypeScript tests | `npm run validate:demo` | 68 passed                                                                           |
| Python real-DuckDB/policy/HTTP tests       | `npm run validate:demo` | 59 passed; the known upstream TestClient deprecation warning remains                |
| Ruff, production build, secret scan        | `npm run validate:demo` | Passed; 7 available private secrets compared against 189 files, 0 violations        |
| Local-embedding retrieval                  | `npm run validate:demo` | 5/5 known-answer top-1 hits plus 1 scope control ([report](retrieval/report.md))    |
| Deterministic security rehearsal           | `npm run validate:demo` | 15/15 cases ([report](security/report.md))                                          |
| Offline browser journeys                   | `npm run validate:demo` | 6 passed, 0 retries; the paid live test skipped ([summary](browser/summary.json))   |
| Loopback HTTP adversarial review           | `npm run assess:http`   | 26/26 scenarios, 35 requests, sessions cleaned up ([report](http/report.json))      |
| npm audit, production and full             | `npm audit`             | 0 findings each; see [SECURITY.md](../../../SECURITY.md) for the withdrawn advisory |
| Python dependency consistency              | `pip check`             | No broken requirements                                                              |

`validate:demo` restarted the owned instance in fixture mode. `assess:http` ran against that restarted v0.1.1 instance. Both left the application ledgers unchanged by generation (`applicationGenerationDelta: 0`; the original evaluation ledger was unchanged). Afterwards the instance was switched back to its previous live mode with no model request.

## Files

- `security/`, `retrieval/` and `http/` contain byte-for-byte copies of the run reports and their original `SHA256SUMS`.
- `browser/summary.json` is derived from the Playwright JSON report. Machine-local paths, durations and error details were removed; test titles and outcomes are unchanged.
- `browser/mobile-workspace-fixture.png` is the mobile capture from that run. It shows the corrected singular source count and the hidden workspace label. Captures are offline fixtures, not model output.

The desktop administrator capture from the same run was not promoted because its sidebar showed a conversation from the owner's own local use. The v0.1.0 capture remains the documented administrator screenshot.

## Not covered

- No live Gemini evaluation was repeated. The 18 November live observations remain historical and keep their own source identities.
- GitHub Actions runs `npm run verify` on Ubuntu. It does not start the application, run browsers, perform the HTTP review or call a model.
- This is not a penetration test, load benchmark, production deployment or certification.
