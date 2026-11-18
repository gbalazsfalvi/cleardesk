# Delivery record

Date: 18 November 2026. Target: local reference release today, before 23:59 Europe/Budapest. No remote publication or live portfolio deployment is included.

## Observed environment

Windows, Node 24.14.0, npm 11.9.0, Python 3.13.1. Exact package versions are in the lockfiles. Mastra 1.84.0 and Google provider 4.0.122 were checked against installed types/runtime and a synthetic wire fixture before paid verification.

The embedding snapshot is pinned to `aa8f8b060edb00e03bfdd08813a2949946c8ba55`. Its actual artifacts were hashed, its finite 384-dimensional vectors were checked, and the cache-reuse path performed no model-discovery/download request.

## Checks and evidence

This table is finalized after the last release verification; pending entries are not a claim of completion.

| Check                                          | Observed result                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| Strict production and verification types       | Passed during implementation; final run pending                                       |
| TypeScript unit/adversarial/report tests       | Final run pending                                                                     |
| Python real-DuckDB/policy/HTTP/bootstrap tests | 55 passed before final freeze; final run pending                                      |
| Real local-embedding retrieval                 | 5/5 known-answer top-1 hits, plus 1 scope control; final-source rerun pending         |
| Deterministic security rehearsal               | 15/15 cases passed; final-source rerun pending                                        |
| Offline actual browser journeys                | 5 passed, including delayed-workspace-response regression; final-source rerun pending |
| Frozen live Gemini evaluation                  | 5/5 passed on the recorded pre-release working tree; see live report hashes           |
| Live actual browser answer/source              | Passed; final-source smoke pending                                                    |
| Secret and evidence-hash checks                | Final staged-file and bundle scan pending                                             |
| npm production dependency audit                | One upstream advisory, attributed to 2 packages; not a clean audit. See SECURITY.md   |
| Python dependency consistency                  | `pip check` passed                                                                    |
| Remote CI                                      | Prepared only; not run remotely                                                       |

The live suite used one generation request per case. One earlier provider smoke and one browser smoke also succeeded: 7/12 total attempts before final hardening. The final number is recorded below after the last explicitly counted browser check. No allowance reset was performed.

## Issues found and corrected

- The bootstrap environment originally omitted build/test tools when installing production dependencies. Development dependencies are now explicitly installed for build/verification; service children remain isolated.
- Test fixture registration was corrected after a formatter/linter removed an imported pytest fixture. Failed logs were retained and the full database suite was rerun.
- A controlled browser race demonstrated an old thread response appearing after a workspace switch. Workspace/response guards now discard it, and the actual failing-then-passing regression remains in the browser suite.
- Desktop source panels originally obscured the answer, and loading briefly displayed zero sources. The panel now takes layout space; knowledge-loading state is explicit. Text contrast/readability were improved and actual screenshots inspected.
- Interrupted seed initialization originally left a database without recoverable demo credentials. Private checkpoints now precede account creation; resumption preserves passwords, and a mismatched/missing database fails clearly.
- Review found that the initial revision check needed to run before every provider dispatch, including a second tool-loop step. The counted transport now invokes current-access checking per dispatch. A synthetic two-step Mastra regression observes revocation and proves that no second HTTP request is sent or charged.
- Cancellation now returns a terminal cancellation state rather than a misleading provider failure to the waiting owner.
- Live report admission now requires consistent budget deltas and actual model-response metadata; missing/fixture metadata cannot be admitted as live PASS.
- Human document changes and terminal failure/cancellation outcomes now create safe allowlisted activity events. An in-flight discarded answer is also checked directly in DuckDB to contain no saved answer/citations.
- The Windows lifecycle check found a short gap between process exit and socket release. Shutdown now waits for its ports to drain; startup also verifies the instance marker rather than accepting an unrelated health response.
- Actual evidence export detected Windows newline translation in the Python-generated hash inventory. Reports now write canonical UTF-8 bytes; exported inventories and screenshot hashes are verified from actual bytes.

## Dependency finding

The package audit remains nonzero. The affected optional workspace/glob path is not configured and the provider tool namespace is closed and tested. No patched upstream release was available at the recorded audit. This local release discloses the remaining finding; it does not claim the underlying dependency is fixed. Details and the upstream source are in [SECURITY.md](../SECURITY.md).

## Provenance and review limits

Security fixtures drive the production Hono application in-process and actual HTTP/Python/DuckDB boundaries. The malicious-output case opens the actual browser UI. The unsafe retrieval control is a separate synthetic fixture and cannot be enabled through the product.

The live set is five fixed questions with explicit concept/source checks, not an accuracy benchmark. It was run before the final transport/operational hardening; its recorded working-tree identity is retained. The final-source live browser smoke and deterministic regressions cover the later changes. Reports are not relabelled as if every earlier paid test used the final Git commit.

The prepared CI workflow has not run on GitHub. The native Windows path, packaged UI and browser captures are observed locally; Linux execution is prepared, not asserted from an unperformed run.

## Final local release

Pending final verification, reviewed source integration into local `main`, local `v0.1.0` tag, evidence export/hash verification and final actual-secret scan. No goal completion is claimed until these entries are finalized.
