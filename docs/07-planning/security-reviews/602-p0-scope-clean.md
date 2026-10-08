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

## Ubuntu installation correction — exact current CI delta

**Reviewed head:** `6510d552d489c4126e4d819f9f9c9aea1e923dcb`

Comparison base: `db15b664e903e8ca5c19bea6856d8c00da3b1058`. Six files change: fast/full workflows, a fixed-path Ubuntu APT mirror normalizer and tests, the visual-scope gate, and CI documentation. Product source, benchmark budgets/workloads/fixtures/retries and browser versions remain unchanged.

Fresh GPT-6 Luna / OpenAI context `01a117da-573e-7af2-85db-33bee8850308` inspected the complete initial `00b347f1948cddfc1f8b9957233984cac6cf4bbe` delta. Its sole blocker was using sudo in the root-running Playwright container, which has no sudo. Parser/syntax, visual-scope and diff checks passed; writable tests were not independently run. The verdict on 00b remains BLOCKED, not relabelled.

The 651 correction structurally classifies all five installation sites: G8 runs Node directly as container root, while the four hosted-runner jobs retain sudo. Tests enumerate the expected jobs and reject unclassified invocations; the visual-scope gate pins the actual G8 sequence.

Fresh independent GPT-6 Sol / OpenAI context `01a117e2-77b9-7d52-8c3c-d56fa7e5c072` reviewed the complete six-file net CI delta at exact 651. **CLEAR**, no blocker. It confirms the prior sole ordinary blocker resolved and checks fixed paths, ownership, symlink/hardlink rejection, no-follow reads, atomic writes, narrow URI parsing, retained repository options and all five executor contexts. This current full Sol pass closes the known corrected mechanism's tier under AGENTS.md's structural review rule; no new Luna verdict is fabricated.

Sol independently passed three syntax checks, Biome on three scripts, diff checks, four parser assertions, five invocation checks and the G8 scope checker. Author evidence: initial 174 focused Node tests plus eight corrected normalizer tests passed. Neither reviewer performed apt, Docker, API, browser or hosted runtime execution. Nonblocking documentation wording still says all helper invocations use sudo; the actual G8 invocation is direct root execution, as explicitly recorded here.

Latest completed timing evidence remains db15 hosted run `37667984584`, restarted cancelled job `112968981754`: **19/22**, failing LCP 2540/2500 ms, task-state 256.6/200 ms and board 690/500 ms. The prior attempt cancelled during installation without measurements. Its synthetic merge `67eb7bca4e425f25f8ace46fec506704dafb07bd` has the same complete tree as db15. Current 651 hosted acceptance remains separate and pending. No final P0 freeze, merge readiness or phase acceptance is claimed.

## Final bounded scheduling correction — current independent reviews

**Reviewed head:** `01de3c09c3ef6038f0cfda5244ac710f1c59b453`

Complete delta from reviewed6510 contains a historical review note and five UI files. Closed palette warming waits for existing primary readiness/two frames, then browser idle; explicit intent still imports immediately, unsupported browsers retain the prior two-frame fallback and disposal cancels scheduled work. Work-list readiness marks resolved error/empty/populated output, not its separately ready project header. API, domain, permissions, migrations, dependencies, CI gate semantics, benchmarks, fixtures, workloads, budgets and retries are unchanged.

Two fresh independent GPT-6 Luna / OpenAI contexts, `01a118b1-c7fc-7b62-8123-77b2451191ec` (scheduling) and `01a118b1-c7fc-7ff1-9f11-ca6d20c5852a` (readiness), each inspected the complete bounded delta and ran **2 files / 18 tests**, PASS. Both returned **CLEAR**, no blockers; neither authored, directed or remediated the source.

Fresh independent GPT-6 Sol / OpenAI context `01a118b6-67c0-7c21-b446-2da70142c3ad` inspected the complete6510-to-current delta, relevant callers, ordinary verdicts and retained prior review chain. **CLEAR**, no security blockers. It independently ran diff checks and **2 files / 18 tests**, PASS. It did not author, direct or remediate the candidate. No runtime/image/date-adjudication/finalizer approval is inferred.

Root retrieved complete hosted run `37700952445`: unchanged G11 **22/22**, list300.4ms, LCP2328ms, board424.4ms; PostgreSQL **137 files / 1659 tests**, G4/G8 and E2E **27 tests** pass. Its tested synthetic merge `3df8e1e361baf412bee545b52c0c7e4c88e985fe` has the same full tree `b8605194d12e31b308e20e1f56d93b8465f5de60` as reviewed01de. Non-gating profile capture exceeded its event bound; that failure is retained and is not relabelled successful diagnostic evidence. The complete canonical performance suite is unchanged and passed.

This appended review-only record preserves all original blocked reviews and failed experiments. No source correction beyond a concrete failing P0 gate is authorized after the final note-only freeze. Frozen image/installer/migration/upgrade/rollback, authorization runtime proof, observation compatibility, all current required hosted checks, protected merge and fresh independent GPT-6.1 Sol phase finalizer remain open.

## Palette preload correction — independent review at exact 670

**Reviewed head:** `670442d820d3569fefb024120d2929ff6296668c`, based on frozen source `1878d6f17d46908885b36c45dddd069a19e5004b`. This is a separate candidate after the 1878 freeze, not a mutation of that frozen source. The two-file UI delta changes closed-palette idle warming from mounting `CommandPalette` to importing its module. The component and its closed dialog/list are rendered only after explicit intent; the existing idle/RAF schedule, intent cancellation, no-idle fallback, and kept-mounted behavior after first intent remain. No API, domain, permission, schema, dependency, CI, benchmark, fixture, workload, budget, or retry changes.

Two fresh independent GPT-6 Luna contexts reviewed the exact two-file delta and its launcher lifecycle:

| Context | Actual check | Verdict |
| --- | --- | --- |
| `p0-palette-reduction-6704/luna-intent` | Launcher test file: **1 file / 5 tests passed**; no preload, first-intent, error, or unmount-ordering regression found | Clear |
| `p0-palette-reduction-6704/luna-lifecycle` | Launcher test file: **5 tests passed**; no actionable lifecycle regression found | Clear |

Fresh independent GPT-6 Sol security confirmation at the same exact head verified the two-file delta and a passing `git diff --check`. It found no security authority or gate change and did not run tests. This was a scoped UI lifecycle confirmation, not the P0 phase finalizer.

Author verification is recorded separately: the launcher test command passed **1 file / 5 tests**; the full command-palette directory passed **3 files / 9 tests**. Focused Biome passed on both changed files, web typecheck passed after building local workspace dependencies, and agent and portal production builds passed. The previously reported `9/9` was the directory-wide author run; it was not the count from the reviewers' launcher-only command. The exact reviewer records and prompts remain outside Git under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-08/p0-palette-reduction-6704/`.

**Performance remains unverified for 670.** The latest supplied full G11 remains red at **19/22** (LCP 2552/2500 ms, task-state 207.1/200 ms, board 687.3/500 ms; list 497.5 ms passed). The earlier 01de run passed 22/22, but these results do not establish this delta as the cause of either outcome. Root owns the unchanged full G11 rerun and the retain/revert disposition. No merge readiness or phase completion is inferred.
