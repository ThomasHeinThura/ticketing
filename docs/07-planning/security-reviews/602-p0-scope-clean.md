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

## Palette preload experiment rejected — exact hosted disposition

Root's unchanged hosted G11 run for the 670 palette-preload candidate, job `37706535532`, completed **17/22**. LCP was **2532/2500 ms** and board was **624.9/500 ms**. The run added failures `G13ProjectsCLS`, `G11paletteclick`, and `G11palettekeyboard`; the palette interaction checks require the shared hidden `command-dialog-popup` to exist before Ctrl+K. The benchmark contract and workload were not changed.

This result is worse overall than frozen 1878's hosted job `37703108224` at **19/22**, although LCP and board measurements were individually lower. This establishes neither that the preload edit caused the LCP/board changes nor that environment variation caused the remaining failures. The candidate is rejected by the user-directed disposition. The two palette launcher product files are reverted to the exact reviewed 1878 contents; this note preserves the experiment, counts, and failure names. No benchmark, fixture, threshold, retry, or assertion was changed to rescue the candidate. No performance acceptance, merge readiness, or phase completion is claimed.

## First-open retention experiment rejected — exact hosted disposition

Commit `6623ede2dee312e29ef608b134b70bcf5739a9c2` attempted to retain the command-palette popup and descendants when explicit Ctrl+K intent arrived before the scheduled idle warm-up. The exact hosted G11 job `37710329521` completed **19/22**: LCP **2540/2500 ms**, board **652.3/500 ms**, and `G11paletteclick` **720.9/200 ms**. The preceding accepted product state at `6feadaf9e2eda80c45d24b4154d15a21483948a0` had hosted job `37708668475` at **20/22** (LCP **2548/2500 ms**, board **656.8/500 ms**). The attempted lifecycle correction therefore worsened the aggregate result; these measurements do not establish why.

The 6623 product delta is reverted by normal revert commit `fa5624cf`; the four UI source/test files match 6fe exactly. The hosted logs remain preserved. No benchmark, workload, threshold, retry, or assertion changed. This experiment is rejected, and no performance acceptance or phase completion is claimed.

## Exact frozen-source reconciliation — PR #602

**Reviewed head:** `23a01a62ece3ca7d17105626f64ad78641435ec1`

This record reconciles the final frozen product source and its complete landed history after the palette, containment, and TaskCard experiments. It preserves each earlier finding and rejected measurement as history. It does not claim review of a later note-only commit; the product tree remains the reviewed tree `085d0347a7bc0ad138625c7d400d65ab0b68ea6f`.

### Independent ordinary reviews

Two fresh independent GPT-6 Luna contexts reviewed the exact frozen source and bounded landed history. Their private context identities are the report filenames below; neither report records a session UUID.

| Context identity and report | Range and actual checks | Verdict |
| --- | --- | --- |
| `luna-review-a-23.md` in `/Users/heinthura/.codex/taskdesk-evidence/2026-10-08/p0-memo-body-experiment/` | `670442d8..23a01a62`; inspected every landed commit and revert, tree equality and changed files; `check-contrast.test.mjs` 52 tests, TaskCard test 9 tests, exact revert comparisons and `git diff --check` passed. Did not run built-CSS browser measurement. | CLEAR for frozen source/history; no performance, security, merge, or phase-finalizer approval implied. |
| `luna-review-b-23.md` in the same directory | `8af2a77a..23a01a62` and full bounded landed history; contrast check passed with 420 source-grounded pairs in both themes; focused launcher/TaskCard tests 2 files / 14 tests; `git diff --check` passed. | CLEAR for bounded landed history/delta; no full P0 finalizer or phase closure. |

### Independent security reviews

An earlier retained private source report, `sol-security-23.md` in that evidence directory, is now reconciled to this exact source. It records a lightweight confirmation with no focused tests run. Separately, a fresh independent GPT-6 Sol context `/root/p0_exact23_sol_source` re-reviewed the complete `670442d8..23a01a62` history and final net source. Its report is `/Users/heinthura/.codex/taskdesk-evidence/2026-10-08/p0-pr602-exact23-sol-source.md`. It records **CLEAR**, zero blocking PR-source security findings, and **3 files / 17 tests passed** across the command-palette launcher, command-palette component, and TaskCard tests; it also ran exact-history/file inspection, security-path matching, restored-tree comparisons and `git diff --check`. The full history includes the normal reverts, and the report confirms the net source after the earlier reviewed 670 state consists only of the palette launcher and its test plus review documentation. No authority or gate pass/fail behavior changes in that delta. These PR-source reviews are separate from the P0 phase finalizer and from private runner V19 evidence.

### Exact-source and acceptance boundary

At reconciliation, the live PR head was 23a; GitHub had no submitted review records (`reviews: []`, `reviewDecision: ""`). The exact-head written reviews above are retained independent evidence, not GitHub review events. The hosted `pull request template + security review` check was still failing on stale-note and PR-body metadata and must pass on the pushed note-only successor before merge eligibility can be reconsidered.

Independent adjudication of retained V19 evidence records a pass for the bounded disposable off→shadow→off witness only. It does not establish strict cutover or full runtime acceptance. The actual Oct 9 observation remains pending. Config and task prerequisites, strict activation/rollback, signed-release installer/upgrade/rollback, and the fresh accepted-main P0 phase finalizer remain pending. Image publication policy for this lane is GHCR only; no Docker Hub publication or fallback is authorized or claimed. No production deployment, merge, waiver, or phase completion is claimed here.

## Notification task-read security correction — exact 650 source

**Reviewed head:** `650edd447899f5d9e52c50c718abef0f7aad91b2`

**Reviewed source head:** `650edd447899f5d9e52c50c718abef0f7aad91b2`, based on
`2b7192eb5181d50085f8734d2c5da226e301453e` through the notification corrections
`5ec772771497e5883ff4c55f272cd34df737b585`,
`b890c86a0feaba018d298273527d86058cb56921`,
`5712b967a428d5275edf19aaeaa6f69203e949d3`, and exact candidate `650edd44`. This later
source correction addresses concrete P0 security findings; it does not revise the frozen
palette/source history above. The notification product source reviewed here is exact 650. This
section is a source-bound record, not current PR/check status.

The retained review history stays attached to its own exact heads:

| Candidate | Independent review record | Verdict and disposition |
| --- | --- | --- |
| `5ec772771497e5883ff4c55f272cd34df737b585` | `notification-5ec-luna-authority.md`, `notification-5ec-luna-lifecycle.md`, `notification-5ec-luna-contract.md` | One authority review was **CLEAR** by inspection; two reviews were **BLOCKED** for missing effective `work_item:read`, unsupported same-organisation customer task reach, and missing per-provider rechecks. Those verdicts remain historical. |
| `b890c86a0feaba018d298273527d86058cb56921` | `notification-b890-luna-authority.md`, `notification-b890-luna-lifecycle.md`, `notification-b890-luna-contract.md` | Lifecycle was **CLEAR**. Authority and contract were **BLOCKED**: API-key capability-clamp bypass in the self GET, and stale email reach during adapter rendering. Earlier task-read/customer and network-provider blockers were addressed in this source. |
| `650edd447899f5d9e52c50c718abef0f7aad91b2` | `notification-650-luna-authority.md`, `notification-650-luna-lifecycle.md` | Two fresh independent GPT-6 Luna contexts were **CLEAR**. They inspected the credential delta and source/tests and ran `git diff --check`; they did not run tests or database probes. |
| `650edd447899f5d9e52c50c718abef0f7aad91b2` | `notification-5712-sol-security.md` | Fresh independent GPT-6 Sol security review **CLEAR** on the complete consolidated 13-file notification correction from `2b7192eb` to exact 650. The email-after-render issue was a narrower instance of the already-repeated stale-reach/provider-boundary class; the structural adapter callback and real render/transport regression close it, so no extra same-class Luna round is claimed. |

Private reports are retained outside Git under
`/Users/heinthura/.codex/taskdesk-evidence/2026-10-08/`. Historical blocked reports have not
been edited or relabelled.

### Correction and source-bound evidence

The legacy `task` notification path correlates recipient, task and live project; requires
current staff reach plus canonical effective `work_item:read`; denies customer task visibility
where the legacy row cannot prove NO-18/NO-19 requester entitlement; and filters before the
inbox limit or applies the same predicate to writes. Role implications and project/workspace
scope precedence use canonical permission helpers. For the self-scoped GET, task rows also
require the authenticated API key's existing parsed permission subset to expand to
`work_item:read`; current owner role/reach and key scope are intersected, while non-task self
notifications and browser-session behavior remain available. Each outbound provider rechecks
current reach at its final I/O boundary, including after asynchronous destination validation and
after email template rendering immediately before `sendMail`. Notification mutations remain
session-only. No new route, capability, key mapping, migration, dependency or provider behavior
was added.

The Sol reviewer independently ran:

- Isolated PostgreSQL 18 Testcontainers: **1 file / 8 tests passed** for
  `notification-task-reach.test.ts`.
- Targeted email wrapper test: **1 file / 2 tests passed**. It renders the real notification
  template, controls the async authorization check during simulated revocation, and verifies the
  transport is suppressed on denial while the allowed case sends rendered HTML.
- `pnpm --filter @taskdesk/email build` and `git diff --check`: passed.

The author's exact-650 local run additionally passed API typecheck, two focused PostgreSQL
files **/ 10 tests** (notification reach plus the audit-failure notification caller), Biome on
the five touched API/test files, and `git diff --check`. An earlier author email-package
invocation passed **7 files / 18 tests**; a separate direct targeted run passed **1 file / 2
tests**. The broader count is not represented as the targeted email count. These counts are
separate from b890 (**1 file / 7 tests**) and 5712 checks.

This review chain and its runs are source-bound to exact 650. They do not establish hosted CI,
Docker image build/boot, performance or browser acceptance, production-provider delivery, merge
readiness, or the additive fresh GPT-6.1 Sol P0 phase finalizer. Frozen install/upgrade/rollback
and runtime acceptance remain separate gates.

## Notification email test-fixture correction — exact 8b792 source

**Reviewed head:** `8b792d0fd382dfe76d84c4ccc4ca52e9880ed281`

Fresh independent GPT-6 Luna and GPT-6 Sol reviews of exact 8b792 were **CLEAR** for the
test-only change. The targeted email test passed **1 file / 2 tests**; `pnpm check:env` passed.
The test now uses Vitest `stubEnv`/`unstubAllEnvs` rather than direct environment assignment
and deletion. No production email code, environment registration, checker behavior, baseline,
or assertion was changed. These reviews bind only the test-fixture correction; the full product
security review remains bound to exact 650 above.

Hosted fast run `37813776014` found the direct environment access in the email test. Its failure
is retained; the full hosted run was still in progress when this note was updated, so no full-run
result is claimed. The corrected source passes the local email test, `check:env`, Biome, and
`git diff --check`. This test-only fix does not establish the remaining hosted CI, image, runtime,
performance, browser, merge, or phase-finalizer gates.

## Approved strict diagnostic witness — exact b757 source

**Reviewed head:** `b7573671d2cafed3871d04ee52e40b79260a966b`

Thomas approved the bounded diagnostic witness on 2026-10-09. It carries only a server-owned opaque request ID, registered route/source pair, finite decision category and provenance result. No authority branch, payload, credential, raw tenant or row identifier is added. Fresh independent Luna reviews of the earlier a386 and 30b predecessors found route/source pairing and unsafe caller-object serialization; those blocked reports remain historical. The complete b757 structural correction snapshots own data descriptors, rejects accessors/symbols/custom prototypes, checks finite primitive values and exact registered pair, and serializes only a fresh null-prototype safe projection. A full fresh independent GPT-6 Sol context `/root/p0_b757_structural_sol` cleared the complete b757 source and sealed V26 packet. The canonical change-altitude rule closes this repeated same-class structural remediation with that full Sol pass; no unperformed b757 Luna verdict is claimed.

The Sol reviewer independently ran 2 API files / 12 tests, API typecheck (four configurations), and 155 offline proof tests; all passed. All 47 V26 file hashes/lengths matched. The exact b757 image built and booted UID 10001, live/ready 200, complete owned cleanup. The verdict does not claim actual strict-runtime PASS, current hosted performance PASS, protected merge or stage finalization. The independent unchanged 27-source guard compatibility ruling preserves original observation dates and source identities only.

## Existence-oracle correlation compatibility — exact 8a27 source

**Reviewed head:** `8a27bc973b42836344fb229d6bd4d1c3c0a4d46b`

The sole delta from b757 is `tests/api-integration/existence-oracle-317.test.ts`. Both response request IDs must be distinct valid 32-character lowercase hexadecimal values. Only this independently random nonce is excluded from foreign-versus-missing header equality. Every other header, body, status and existing route/reach assertion remains enforced. Seven comparator probes reject malformed/missing/reflected IDs and changed cache-control, and accept valid distinct nonces; the full focused PostgreSQL file passed 17/17 on a dedicated private test database. Initial local default-credential authentication failure remains historical and was not called an authorization regression.

Fresh independent GPT-6 Luna `/root/p0_oracle_delta_luna` and GPT-6 Sol `/root/p0_oracle_delta_sol` are CLEAR on exact 8a27. Both inspected the actual delta and production correlation contract; they ran no database/build/performance process during root's exclusive measurement window. The 17 passing tests are owner-provided evidence, not reviewer-run evidence. No shipped code, dependency, migration, benchmark workload, performance threshold or authorization behavior changed. Full hosted acceptance remains pending on the new exact head.

Private original reports remain outside Git; these secret-free bindings preserve their identities:

- `p0-b757-v26-final-sol.md`: SHA-256 `c93aa76dce4d7be4ba146a4ba38c5f150f5cae79f35bb4c02fa1fd672ea121ca`.
- `p0-oracle-8a27-luna.md`: SHA-256 `4c9b6283e37d571268f8ae3749589ea22c6fcb1757698df5d594137a9cab7486`.
- `p0-oracle-8a27-sol.md`: SHA-256 `9be1a280b82a86f57369eda830105f87b7c9b22f1d336bb0574d2b2b8a61a68f`.
