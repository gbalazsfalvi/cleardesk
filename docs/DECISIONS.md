# Engineering decisions

| Decision                                                          | Reason                                                                               | Cost / consequence                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Separate authenticated Hono application; standalone Mastra agents | The framework does orchestration without exposing a second public agent API          | Application owns sessions, routing, progress and persistence               |
| Explicit authorized history; no automatic agent memory            | Every model-visible dependency needs current access checks                           | More storage logic; conservative history redaction                         |
| One Python DuckDB owner                                           | Avoid unsafe shared connections and unsupported multi-writer assumptions             | Single local data process; bounded queue and limited scaling               |
| Embeddings outside database transactions                          | Model loading/inference must not hold the transaction or owner queue                 | Recheck authority/capacity when committing the completed ingestion         |
| Exact SQL filtering/ranking                                       | The small corpus does not need an ANN service; policy is inspectable in one query    | Not intended for millions of chunks                                        |
| Pinned local ONNX snapshot                                        | Reproducible embedding bytes; no remote document embedding service                   | First setup downloads model artifacts; hashes need maintenance             |
| Two read tools and no model actions                               | Demonstrate authority containment instead of relying on polite refusals              | No automated emails, account changes or document edits                     |
| Closed provider tool namespace                                    | Framework additions or malformed model tool calls cannot expand the intended surface | Unsupported tools fail explicitly                                          |
| Structured output and registry-valid citations                    | Citation-shaped text alone is not provenance                                         | Valid provenance still does not prove semantic correctness                 |
| Complete context dependencies, not just cited sources             | An answer may incorporate information it does not cite                               | A later restriction can hide otherwise harmless answers                    |
| No raw answer streaming                                           | Access and citation gates complete before content reaches the user                   | The UI shows progress, then the completed answer                           |
| Persistent pre-dispatch attempt reservation                       | Failed/retried/nested calls must not evade the live allowance                        | Uncertain failures remain spent; locks require operator review             |
| Generated local demo passwords                                    | A source repository should not ship working fixed credentials                        | Reviewers open an ignored local file after bootstrap                       |
| Native launch before optional container packaging                 | Deliver and verify the user's local stack without touching parallel Docker workloads | Docker Compose is not part of this release                                 |
| Fixture / retrieval / live / browser evidence separated           | Different tests establish different things                                           | More explicit reports and limitations instead of one aggregate green badge |

## Compatibility rulings

The installed shared host uses Node 24.14.0. jsdom 29.1.1 was chosen because newer jsdom releases require a newer Node patch. `engine-strict` stays enabled; no shared/global Node change was made.

DuckDB's actual TIMESTAMPTZ conversion probe required `pytz`; it is explicitly hash-locked rather than replacing timezone-aware values with ambiguous strings.

Google model discovery accepted the authorized credential and listed the fixed evaluated model. The installed Mastra/Google provider types and an actual synthetic wire test established interoperability; live generation then confirmed it. Provider-returned version aliases are preserved as observed rather than replaced with an assumed dated build.

The dependency audit found an unpatched optional-globbing advisory. We did not downgrade Mastra to an unrelated old API or pretend an unofficial version was a fix. The narrow surface and remaining finding are documented in [SECURITY.md](../SECURITY.md).
