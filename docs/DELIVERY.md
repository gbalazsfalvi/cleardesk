# Delivery record

Date: 18 November 2026. Target: local reference release today, before 23:59 Europe/Budapest. No remote publication or live portfolio deployment is included.

## Observed environment

Windows, Node 24.14.0, npm 11.9.0, Python 3.13.1. Exact package versions are in the lockfiles. Mastra 1.84.0 and Google provider 4.0.122 were checked against installed types/runtime and a synthetic wire fixture before paid verification.

The embedding snapshot is pinned to `aa8f8b060edb00e03bfdd08813a2949946c8ba55`. Its actual artifacts were hashed, its finite 384-dimensional vectors were checked, and the cache-reuse path performed no model-discovery/download request.

## Checks and evidence

Final observed acceptance results are below. Fixture, local-vector, live-model and browser evidence remain distinct.

| Check                                             | Observed result                                                                                     |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Single-command setup/build/start                  | npm run demo passed on the verified host; cache and credentials reused without reset                |
| Complete offline acceptance                       | npm run validate:demo passed, including restart and fresh reports                                   |
| Strict production and verification types          | Passed                                                                                              |
| TypeScript unit/adversarial/report tests          | 47 passed                                                                                           |
| Python real-DuckDB/policy/HTTP/bootstrap tests    | 58 passed; one recorded upstream TestClient deprecation warning                                     |
| Real local-embedding retrieval                    | 5/5 known-answer top-1 hits plus 1 scope control passed; committed-source rerun passed              |
| Deterministic security rehearsal                  | 15/15 cases passed; committed-source rerun passed                                                   |
| Offline actual browser journeys                   | 6 passed; the explicitly gated paid test was skipped                                                |
| Frozen live Gemini evaluation                     | 5/5 passed on its recorded pre-release working tree                                                 |
| Final committed-source live browser answer/source | Passed; one actual generation, authorized citation opened, immutable capture retained               |
| Secret comparison and evidence hashes             | Passed: 7 available private secrets compared; 16 manifest entries and 5 public screenshots verified |
| npm production dependency audit                   | One upstream advisory attributed to 2 packages; remaining finding disclosed in SECURITY.md          |
| Python dependency consistency                     | pip check passed                                                                                    |
| Remote CI                                         | Prepared only; not run remotely                                                                     |

The five-question live suite used one generation per case. Together with the initial provider smoke and two browser smokes, total observed delivery usage is **8/12 generation HTTP attempts**. Four remain in the configured local allowance. No allowance reset was performed.

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
- The final Git checkout check exposed raw source fingerprints changing with Windows line endings. Source identity now declares `utf8-lf-v1`, normalizing only declared UTF-8 text; binary bytes and exact evidence inventories remain unchanged. Dedicated regressions cover newline equivalence, meaningful changes, binary preservation and invalid encoding.

## Dependency finding

The package audit remains nonzero. The affected optional workspace/glob path is not configured and the provider tool namespace is closed and tested. No patched upstream release was available at the recorded audit. This local release discloses the remaining finding; it does not claim the underlying dependency is fixed. Details and the upstream source are in [SECURITY.md](../SECURITY.md).

## Provenance and review limits

Security fixtures drive the production Hono application in-process and actual HTTP/Python/DuckDB boundaries. The malicious-output case opens the actual browser UI. The unsafe retrieval control is a separate synthetic fixture and cannot be enabled through the product.

The live set is five fixed questions with explicit concept/source checks, not an accuracy benchmark. It was run before the final transport/operational hardening; its recorded working-tree identity is retained. The final-source live browser smoke and deterministic regressions cover the later changes. Reports are not relabelled as if every earlier paid test used the final Git commit.

The prepared CI workflow has not run on GitHub. The native Windows path, packaged UI and browser captures are observed locally; Linux execution is prepared, not asserted from an unperformed run.

## Final local release

Accepted local reference: **v0.1.0**, local **main** branch and annotated **v0.1.0** tag. Public GitHub/portfolio publication remains a follow-up.

The final committed-source security, retrieval and live-browser runs identify snapshot **c07965c41f17b0ae30f7b19395b8d36d317e6f15**, with a clean working tree at each run. The production/verification source-tree SHA-256 is **b9bee3876df7413a0dba58501f88f3596e9570f18fc0b95ac25e355f9b7583eb**. Final release documentation/evidence commits retain that same source tree; they do not relabel the earlier five-question paid evaluation.

The complete offline acceptance, subsequent committed-source runs, final real-browser capture, actual-private-secret comparison, exported report hashes and staged-file review passed. The local app is left running at **http://127.0.0.1:4280** in live mode. Generated demo passwords remain in ignored **.local/private/demo-accounts.json**.
