# PR #602 — P0 source and CI review record

Recorded 2026-10-07. These are independent candidate reviews, not P0 acceptance or the phase finalizer.

**Reviewed head:** `4459af21208577264d219a36f4505e05a150e93b`

## Source and risk

P0 foundation: `5326937460b195d8e69584c0cb99305348330a95`. The candidate excludes #599 attachment/public-origin ancestry. Product changes concern UI rendering, route search parsing, shared primitives and focus/lifecycle behavior. CI changes enforce contrast, tracked scratch checker inventory and dynamic create-form loading. No API, permissions, migrations, benchmark workloads, budgets, retry rules or fixtures changed in this correction train.

Fresh native Codex CLI contexts were requested with the model and provider below, ephemeral sessions and a read-only sandbox. The retained control-plane headers report those selections. Reviewers cannot independently attest the underlying model variant. They did not author, direct or remediate the candidates they reviewed.

## Ordinary panel and structural corrections

| Exact source | Independent context | Scope and verdict |
| --- | --- | --- |
| `eedf45e681c68936c8062a29704501d6d75b69c0` | GPT-6 Luna / OpenAI · `01a11777-6281-7f73-a350-69f7acbc64ae` | UI lifecycle review clear; no browser/test pass claimed |
| same | GPT-6 Luna / OpenAI · `01a11777-66f1-7e70-a235-8445d839e022` | Performance integration review requested changes to false lazy-shell test claims |
| same | GPT-6 Luna / OpenAI · `01a11777-6b8e-7af0-9b6c-95ef9d3999d1` | Integration review requested changes to the same claims |
| `01e509c531a8b31fe9fa2ae0f701c806ff486740` | GPT-6 Luna / OpenAI · `01a11785-1e51-7c20-b843-f7027fe89a1b` | Claims corrected; remaining ephemeral checker-copy race blocked this source |
| `c36aaf9a40e5846438dd685c24c8ca58c04fa366` | GPT-6 Luna / OpenAI · `01a11792-42b9-7282-a8b3-8e2e7bf17a27` | Tracked-source scratch invariant clear; no unsupported test pass claim |
| `4459af21208577264d219a36f4505e05a150e93b` | GPT-6 Luna / OpenAI · `01a117a0-1088-74a1-beac-5067c90dd8f7` | Two-file startup-graph gate delta clear |

The original static shell remains explicitly static; the full form is dynamic. Tests now assert the actual mount/import behavior. The scratch copier uses Git-tracked sources and fails closed on inventory failures. The final two-file gate delta rejects form reachability through either the initial agent entry or work-list route static graph.

Current Luna reviewer ran syntax/Biome/diff inspection and write-free graph checks. Of ten focused Node tests, six passed and four stopped before assertions because the read-only sandbox denied temporary-directory creation. Author's ten-test pass remains author evidence.

## Independent GPT-6 Sol security review

- Full net candidate at `c36aaf9a40e5846438dd685c24c8ca58c04fa366`: fresh GPT-6 Sol / OpenAI context `01a11794-5fd6-7e82-ab78-2e7a51cb9985`. Requested changes solely because the dynamic-form check omitted the initial agent entry graph. No authority broadening or additional blocker found.
- Exact `4459af21208577264d219a36f4505e05a150e93b` delta: fresh GPT-6 Sol / OpenAI context `01a117a2-1e94-7800-892c-eacbd13af889`. **CLEAR**. Both entry and route static graphs now reject direct or indirect form imports; dynamic imports remain permitted. The prior sole blocker is resolved. No new blocker found.

The Sol delta reviewer ran syntax, Biome, diff checks and three write-free graph assertions. Ten Node tests were attempted: six passed and four were blocked by sandbox `mkdtemp` permissions. The bundle checker passed against existing output; the reviewer did not rebuild or establish its source binding. No browser, Docker, API or hosted acceptance was claimed.

The scratch inventory's existing handling of working-tree bytes and lack of explicit symlink-target enforcement were recorded as nonblocking limits for the clean, symlink-free inspected candidate; no permission/gate waiver was issued.

## Actual source-bound evidence and remaining acceptance

Author: gate delta ten Node tests passed; Biome two files and diff checks passed. Prior root browser at c36: six tests passed, zero skipped, unexpected or flaky; geometry, keyboard cancellation/drop, property writes and create-dialog focus were exercised against mocked API.

Hosted run `37665076268` tested merge source `8513062a8f6b2ac84cc75067436293fadf09e3e8`, whose full tree is identical to c36 (parents accepted main and c36). PostgreSQL passed 137 files / 1659 tests. G11 passed **20/22**, failing LCP **2524/2500 ms** and board **658.8/500 ms**. These are historical c36 results, not a green check on 445.

The source-bound local attribution capture is diagnostic only and changes timing through profiling. Old flattened hosted CPU nodes cannot support hierarchical CPU attribution. No performance acceptance is inferred from either diagnostic.

**Still open:** exact-head hosted checks including G11 22/22; frozen image/installer/migration/runtime/rollback proof; authorization runtime and observation compatibility adjudication; protected merge; fresh GPT-6.1 Sol P0 phase finalizer on accepted main. No merge readiness, cutover or phase completion is claimed.

Full private reports/logs and failed evidence remain outside Git under the 2026-10-07 evidence directory. This public note contains no seeder, credentials, database URLs, cookies or tokens.

