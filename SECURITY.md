# Security

ClearDesk is a local reference application with synthetic data. Its evidence demonstrates specific application boundaries, not a universal security certification. Read [the threat model](docs/THREAT_MODEL.md), [limitations](docs/LIMITATIONS.md) and [delivery evidence](docs/DELIVERY.md) before reusing it.

## Known dependency advisory

The 18 November 2026 npm audit reports **GHSA-fc5q-39xc-vjpf / CVE-2026-112366** in `picomatch` 4.0.7, also attributed transitively to Mastra. The [upstream advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) lists no patched release at this audit date. This finding remains in the lockfile; it is not reported as fixed.

The installed Mastra call site is its optional workspace glob matcher. ClearDesk configures no workspace/filesystem tools or skills. Its provider request/response gates permit only `searchKnowledge` and `readSource`; document filenames are literal DuckDB metadata. These scope restrictions are tested. Enabling glob/workspace features is blocked pending a patched dependency or a separately reviewed mitigation. This reachability assessment is not proof that the dependency is universally safe.

## Reporting an issue

For a sensitive finding, contact `balazsfalvi12@gmail.com` with a minimal synthetic reproduction, affected revision and expected/observed behavior. Do not include real company documents, API keys, passwords or session cookies. A public issue is suitable for non-sensitive defects; the repository has no remote publication in this local release.

No production support window, response-time SLA or bug bounty is promised.
