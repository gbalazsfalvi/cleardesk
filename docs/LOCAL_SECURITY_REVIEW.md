# Local adversarial review: HTTP boundaries and remediation

18 November 2026. Authorized review of the owner's ClearDesk reference application, using its fictional organizations and generated synthetic accounts.

## Outcome

This round found and fixed one bounded request-size bypass and one CSRF error-contract inconsistency. It did not establish a cross-company or HR document disclosure. The corrected running application passed 26 actual HTTP scenarios. The seven new regression tests, complete 63-test TypeScript suite, 59 Python tests, production build and 15-case deterministic security rehearsal passed.

The initial failed run remains available beside the successful follow-up. No model generation request was dispatched by this review. The application remains loopback-only and in live mode; live mode does not imply that these probes called Gemini.

## Scope and execution

The HTTP exercise connects only to `127.0.0.1:4280` and the private service on `127.0.0.1:4281`. It uses real cookie/CSRF sessions, Node HTTP framing, the packaged Hono API, and the actual Python/DuckDB owner. Its controls include authorized reads by a normal member, an HR account, and a member of both workspaces. Those controls confirm that a denial is not merely a broken or empty service.

Each run is capped at 60 requests, with an eight-second per-request timeout and a 256 KiB response cap. The observed run used 35 requests, including setup and logout. It sends no chat to an existing conversation: request-size probes use a random nonexistent conversation identifier. It does not guess passwords, enumerate accounts, flood the listener, contact an external collector, modify document permissions, or ingest malicious files into the current corpus. Only sessions created by the exercise are logged out.

Tested surfaces include anonymous access, forged Host/Origin/internal authority headers, missing and foreign-session CSRF, known HR and foreign document identifiers, dual-membership scope, unauthorized ACL changes, mass-assigned role fields, upload path traversal, malformed JSON, chunked request framing, direct private-service access, encoded static-file traversal, SQL-shaped path input, method boundaries and error-response security headers.

Negative responses in the final harness are checked for known synthetic protected markers, document/message response fields, generated demo passwords and exercise session/CSRF values. Authorized HR and foreign-workspace controls must expose their expected synthetic marker. This is a targeted leak check, not a detector for arbitrary confidential facts or every possible encoding.

## F01: Chat byte limit could be bypassed with chunked transfer

**Assessment:** low severity in this supported local topology; a real, bounded resource-control defect.

**Cause:** the chat handler checked only the `Content-Length` header against its 16 KiB limit. Ordinary chunked requests have no such header. The global API middleware still enforced 256 KiB, but the tighter chat limit was skipped.

**Observed before:** a padded valid JSON request with declared length received `413 BODY_TOO_LARGE`. The equivalent chunked request, above 16 KiB but below 256 KiB, reached conversation processing and received `404 NOT_FOUND` for the deliberately nonexistent conversation. No model request or stored turn was necessary to demonstrate the bypass. The global oversized chunked control was already rejected.

**Correction:** route-specific body-limit middleware now runs before authentication/private-service work. It enforces the shared `LIMITS.chatRequestBytes` value for streamed requests as well as declared lengths. The old header-only handler check was removed. The existing global document/API request bound remains in place.

**Regression:** real short-lived HTTP listeners exercise both transfer modes at the exact 16 KiB boundary and one byte above it. The exact-boundary controls still reach the expected nonexistent-conversation response; oversized requests receive 413 without a private-service call. The regression initially failed and now passes.

This is not a demonstrated unbounded denial of service or authorization bypass. Existing global, question-size, admission and rate controls limited the original exposure.

## F02: Missing CSRF was classified as invalid input

**Assessment:** informational consistency/early-rejection improvement; not a successful CSRF attack.

**Cause:** an absent/empty token was forwarded to the private service's strict input schema. That schema rejected it with `400 INVALID_INPUT`, rather than the public API's expected `403 CSRF_REJECTED`. The mutation was denied before effects in both versions.

**Correction:** the browser API rejects missing, blank or overlong token headers before contacting the private service. The service still verifies the actual token against the current session; the new presence check does not replace that verification.

**Regression:** missing, empty and whitespace-only headers now return 403 with no private-service request. The actual listening-instance test observes the same correction. Foreign-session tokens and hostile origins remain rejected.

## Evidence

| Observation                              | Before                                           | After                   |
| ---------------------------------------- | ------------------------------------------------ | ----------------------- |
| Actual HTTP scenarios                    | 24/26 expected outcomes; two mismatches retained | 26/26 expected outcomes |
| New request-boundary regressions         | 5 failed, 2 passed                               | 7 passed                |
| Generation requests during HTTP exercise | 0                                                | 0                       |
| Original delivery/evaluation ledger      | Unchanged                                        | Unchanged               |
| Exercise session cleanup                 | Passed                                           | Passed                  |

- [Initial HTTP observations](verification/local-adversarial/before/report.json) and [hash inventory](verification/local-adversarial/before/SHA256SUMS).
- [Corrected HTTP observations](verification/local-adversarial/after/report.json) and [hash inventory](verification/local-adversarial/after/SHA256SUMS).
- [Failing-then-passing regression record](verification/local-adversarial/regression/report.json) and [hash inventory](verification/local-adversarial/regression/SHA256SUMS).
- [Fresh 15-case rehearsal](verification/local-adversarial/security/report.md), [JSON observations](verification/local-adversarial/security/report.json) and [hash inventory](verification/local-adversarial/security/SHA256SUMS).

The initial HTTP prototype recorded status observations without a source fingerprint or the later protected-response checks. It ran before the patch; baseline application code is available at `2790a9e`. Its original bytes are retained, and no retrospective source metadata was added. The final harness adds source/corpus/embedding provenance and protected-response checks. The after-report identifies the actual working-tree snapshot used, including its dirty flag; it is not relabelled as a clean-release run.

The unit regressions use the production Hono handlers and real HTTP framing with a synthetic private-service adapter. They do not independently prove storage authorization. The 26 listening-instance probes and the real Python/DuckDB rehearsal provide the separate integration observations.

## Repeat the review

Build/start the intended revision of the owned local instance, retaining the existing synthetic data and private account manifest. Then run:

```sh
npm run assess:http
npx vitest run apps/api/tests/request-boundaries.test.ts
npm run rehearse
npm run verify
```

`assess:http` does not switch model mode, restart processes or call a provider. Its new reports are stored under ignored `artifacts/runs/local-adversarial/`. A concurrent user's model request will change the observed application ledger and make the exercise fail conservatively; inspect the cause rather than deleting accounting state. Prerequisite failures, missing cases and cleanup problems are not passing results. Preserve previous runs.

## Limits

This is a bounded first adversarial review, not an exhaustive penetration test, a load benchmark or a security certification. It does not establish universal prompt-injection resistance. The earlier [model-focused assessment](PROMPT_INJECTION_ASSESSMENT.md) retains its separate evidence and limitations. Production identity/TLS, deployment topology, retention and the disclosed dependency finding remain described in [the threat model](THREAT_MODEL.md), [limitations](LIMITATIONS.md) and [SECURITY.md](../SECURITY.md).
