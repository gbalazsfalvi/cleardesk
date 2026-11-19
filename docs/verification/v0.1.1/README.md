# v0.1.1 publication verification

19 November 2026. Offline verification before and during the first public GitHub release. No check on this page sent a model generation request.

## Release verification: fresh clone at `a82a13c`

The authoritative run used a fresh clone of the public repository, bootstrapped from scratch with new synthetic accounts and data, on the Windows workstation. It did not use the owner's long-lived demo database.

| Field                      | Value                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------- |
| Source revision            | `a82a13ca61edcad0f91f017d17cec3f6ec62444a`                                         |
| Working tree               | Clean for every report (`workingTreeDirty: false`)                                 |
| Source-tree SHA-256        | `a61014eec93f0507c488f049cd63d91bb224648638d175967301a98904dbf31b` (`utf8-lf-v1`)  |
| Source-tree scope          | `apps`, `packages`, `services`, `scripts`, `verification` and root `*.json`/`*.ts` |
| Corpus SHA-256             | `4e52bffcfff2f9cd945f9c05b5d7bb5444212e8f26b47bdf17aff543224a9af8`                 |
| Embedding manifest SHA-256 | `7abeb180b9c205b60f1094e7deba05e39e36a92b7a7356c6fd4b412552757cb7`                 |
| Host                       | Windows, Node 24.14.0, npm 11.9.0, Python 3.13.1                                   |

| Check                                          | Command                 | Result                                                                                                                           |
| ---------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Fresh setup                                    | `npm run bootstrap`     | Passed: locked npm/Python installs, pinned embedding snapshot, new synthetic seed, build                                         |
| Formatting, strict types, TypeScript tests     | `npm run validate:demo` | 71 passed                                                                                                                        |
| Python real-DuckDB/policy/HTTP tests           | `npm run validate:demo` | 59 passed; the known upstream TestClient deprecation warning remains                                                             |
| Ruff, production build, secret scan            | `npm run validate:demo` | Passed; 6 available private values compared against 207 files, 0 violations                                                      |
| Local-embedding retrieval                      | `npm run validate:demo` | 5/5 known-answer top-1 plus 1 scope control ([report](a82a13c-fresh-clone/retrieval/report.md))                                  |
| Deterministic security rehearsal               | `npm run validate:demo` | 15/15 ([report](a82a13c-fresh-clone/security/report.md))                                                                         |
| Offline browser journeys                       | `npm run validate:demo` | 6 passed, 0 retries; paid live test skipped ([summary](a82a13c-fresh-clone/browser/summary.json))                                |
| Loopback HTTP adversarial review               | `npm run assess:http`   | 26/26, 35 requests, sessions cleaned up, generation delta 0 ([report](a82a13c-fresh-clone/http/report.json))                     |
| GitHub Actions `npm run verify` (Ubuntu 24.04) | CI                      | 71 TypeScript and 59 Python tests passed ([run 44486543619](https://github.com/gbalazsfalvi/cleardesk/actions/runs/44486543619)) |

The fresh clone had no `.env.local`, so a live provider request was not possible. Its generation ledgers did not exist before or after the HTTP review.

## Earlier observations on the owner's long-lived instance

These runs used the owner's existing synthetic demo database and are kept unchanged, including the failure.

| Revision  | Result                                                                                                                                                                                                                                                                                 | Files                                             |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `bdff56d` | Before the publication changes: `npm run verify` (63 TypeScript, 59 Python tests), `evidence:verify` and `assess:http` 26/26 passed.                                                                                                                                                   | Logs only (not committed)                         |
| `76e66fc` | After the UI and capture fixes: `validate:demo` passed (68 TypeScript, 59 Python tests, 15/15, retrieval 5/5, 6 browser journeys) and `assess:http` 26/26 passed.                                                                                                                      | [76e66fc-local-instance](76e66fc-local-instance/) |
| `24a59fb` | After the fresh-clone build fix: `verify`, retrieval and `assess:http` 26/26 passed, but the rehearsal reported **E12 `SCENARIO_ERROR`** and the browser suite did not run. Alex had reached the product's cap of 100 conversations in Northstar after many earlier verification runs. | [24a59fb-local-instance](24a59fb-local-instance/) |

The E12 error is a verification prerequisite failure, not a renderer finding: the scenario could not create its conversation. The product has no conversation deletion, so the owner's data was left as is and the release was verified from a fresh bootstrap instead. [LIMITATIONS.md](../../LIMITATIONS.md) records this.

A fresh clone at `24a59fb` then passed `validate:demo` but exposed a second defect: `assess:http` crashed because a fresh install has no generation ledgers yet. Commit `a82a13c` fixed that; the run above is its verification.

## Files

- Report directories contain byte-for-byte copies of the run reports and their original `SHA256SUMS`.
- `browser/summary.json` files are derived from the Playwright JSON report. Machine-local paths, durations and error details were removed; test titles and outcomes are unchanged.
- `76e66fc-local-instance/browser/mobile-workspace-fixture.png` is the mobile capture from that run. It shows the corrected singular source count and hidden workspace label. It is an offline fixture capture, not model output.

The desktop administrator capture from the `76e66fc` run was not promoted because its sidebar showed a conversation from the owner's own local use. The v0.1.0 capture remains the documented administrator screenshot.

## Not covered

- No live Gemini evaluation was repeated. The 18 November live observations remain historical and keep their own source identities.
- GitHub Actions runs `npm run verify` only. It does not start the application, run browsers, perform the HTTP review or call a model.
- The application lifecycle was verified on Windows only. There is no public running deployment.
- This is not a penetration test, load benchmark, production deployment or certification.
