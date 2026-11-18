# Third-party software and model notices

Original ClearDesk source uses [Apache License 2.0](../LICENSE). Dependencies retain their own licenses and notices. This table records direct packages used in the local reference; it does not replace the full transitive dependency licenses in the installed distributions.

| Component                    | Pinned version / identity | Declared license                         |
| ---------------------------- | ------------------------- | ---------------------------------------- |
| Mastra core                  | 1.84.0                    | Apache-2.0                               |
| Google AI SDK provider       | 4.0.122                   | Apache-2.0                               |
| React / React DOM            | 19.3.1                    | MIT                                      |
| Vite                         | 8.3.8                     | MIT                                      |
| Hono / Node adapter          | 4.13.19 / 2.1.9           | MIT                                      |
| IBM Plex Sans via Fontsource | 5.3.0                     | SIL OFL-1.1                              |
| Lucide React                 | 1.75.0                    | ISC; retain the complete upstream notice |
| DuckDB Python                | 2.0.0                     | MIT                                      |
| FastEmbed                    | 0.9.1                     | Apache-2.0                               |

The font and icon notices are included under [apps/web/public/licenses](../apps/web/public/licenses/) and copied into the Vite build. Package lockfiles retain exact dependency versions; Python wheels are hash-locked. Review the upstream distributions before redistributing a compiled bundle.

## Embedding weights

Model: [BAAI/bge-small-en-v1.5](https://huggingface.co/BAAI/bge-small-en-v1.5). ONNX artifact repository: [Qdrant/bge-small-en-v1.5-onnx-Q](https://huggingface.co/Qdrant/bge-small-en-v1.5-onnx-Q/tree/aa8f8b060edb00e03bfdd08813a2949946c8ba55). The recorded repository license metadata is MIT.

The immutable revision is `aa8f8b060edb00e03bfdd08813a2949946c8ba55`. The preparation script records actual artifact sizes and SHA-256 hashes, performs a finite 384-dimensional vector check, and retains model attribution/license files in the ignored local snapshot. Weights are downloaded by the operator and are not committed as ClearDesk source. There is no claim that ClearDesk trained this embedding model.

## Primary implementation references

- [Mastra agents](https://mastra.ai/docs/agents/overview) and the installed package's actual types/runtime behavior.
- [DuckDB concurrency](https://duckdb.org/docs/current/connect/concurrency) for deployment topology; ClearDesk deliberately adds a stricter single-owner adapter.
- [Google API-key documentation](https://aistudio.google.com/docs/api-key) for authenticated official-endpoint access.
- [OWASP GenAI security guidance](https://genai.owasp.org/) for threat categories. These references are not an endorsement or certification of this implementation.

The synthetic policies, organizations, canaries and verification questions were created for this reference. No employer/customer data or source code is included.
