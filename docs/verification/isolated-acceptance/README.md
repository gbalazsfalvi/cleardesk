# Isolated offline acceptance

19 November 2026, after the v0.1.1 release. Source revision `bbd88a6`, clean working tree, source-tree SHA-256 beginning `f600434a08c305fc` (`utf8-lf-v1`). No model generation request was sent.

## Problem

Up to v0.1.1, `npm run validate:demo` ran against the owner's long-lived demo database and left the instance in fixture mode. Every run added conversations for the demo accounts. On 19 November the owner's database reached the product's cap of 100 conversations for Alex in Northstar, and rehearsal case E12 failed with `SCENARIO_ERROR` ([preserved report](../v0.1.1/24a59fb-local-instance/security/report.md)).

## Change

Runtime state is resolved through one strictly validated directory: `.local` for the owner, or exactly `.local/acceptance/<name>` through `CLEARDESK_STATE`. Each acceptance run seeds a fresh synthetic state with its own generated credentials, runs that instance in fixture mode on the usual loopback ports, keeps the state for inspection and restarts the owner's instance in its unchanged mode.

## Observation

Two consecutive `npm run validate:demo` runs on the same long-lived installation, with the owner's Alex/Northstar conversations still at 100:

| Run | TypeScript | Python    | Retrieval     | Rehearsal                                  | Browser                | Secret scan                                                        |
| --- | ---------- | --------- | ------------- | ------------------------------------------ | ---------------------- | ------------------------------------------------------------------ |
| 1   | 74 passed  | 72 passed | 5/5 + control | 15/15 ([report](run-1/security/report.md)) | 6 passed, live skipped | 7 private values compared, 0 violations                            |
| 2   | 74 passed  | 72 passed | 5/5 + control | 15/15 ([report](run-2/security/report.md)) | 6 passed, live skipped | 13 private values compared (including run 1's state), 0 violations |

Before and after both runs, the owner's `runtime.json`, `demo-accounts.json`, `application-usage.json` and `generation-budget.json` had identical SHA-256 values. The owner's instance was restarted in live mode, and every account's conversation count per workspace was unchanged (Alex/Northstar 100, Sam 22 and 51, Riley 4, Jordan 3 and 1, Taylor 0). Each acceptance state used about 6.7 MB.

Report directories are byte-for-byte copies with their original `SHA256SUMS`. This is a local Windows observation; GitHub Actions runs `npm run verify` only.
