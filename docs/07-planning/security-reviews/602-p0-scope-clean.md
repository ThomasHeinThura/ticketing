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

## Oracle fixture type correction — exact 9179 source

**Reviewed head:** `9179d4d5d582eae9f2525ed434a2db2f65af336c`

Hosted static found TS2345 in the malformed-ID test fixture: its object union was not a valid HeadersInit type. The fixture now constructs a Headers instance and conditionally sets the same header. Cases, inputs, expected results, comparator assertions and production source remain unchanged. Author API typecheck passed all four configurations after building its three workspace dependencies; focused PostgreSQL remained 17/17, with Biome and diff check passed. Fresh exact-head read-only confirmations from independent GPT-6 Luna `/root/p0_oracle_delta_luna` and GPT-6 Sol `/root/p0_oracle_delta_sol` are CLEAR and confirm the earlier assertion/security verdict still applies. They did not rerun tests; owner evidence is attributed as such. No extra substantive review panel or blanket CI acceptance is claimed.

- `p0-oracle-9179-luna-confirmation.md`: SHA-256 `2e5a93f7a7b8d364661e7eb730b6df54477ddc46650472a42e98209e5a0634a8`.
- `p0-oracle-9179-sol-confirmation.md`: SHA-256 `dbcc5d3ff2709bcff7fcce9e90af9a8db594b55da57095410f875ad61da09092`.

## G11 speed-calibration delta — independent reviews

**Reviewed head:** `c1b9ea3b894b51dc7de14c3bb4045160de752798`

The delta is commits 5380ed6b, 2c52f65c, 48dbb9f6 and c1b9ea3b on top of `66c736e71c87b2372ba1cbf8250236ac37191565`. They contain no product source; they change only the G11 measurement method, docs and the decision log, per Thomas's 2026-10-10 approval of speed calibration with a FAST-class reference.

- **Implementation:** Claude Sonnet context `a74d20a4c019eb578`, directed by the Claude Opus conductor.
- **Diagnosis:** Claude Opus context `a8d14be4cc9608e8f`.
- **Security review:** Claude Opus, Sol tier under Thomas's 2026-10-09/10 routing. It is **not** a GPT-6 Sol review.

Each report below was written by its reviewer context to its own file. It is inserted unmodified between the markers, with its SHA-256.

Merge precondition set by the security closure review: the hosted G11 run at the exact head, in calibrated mode, must be green. Its runner class and factors are recorded in the PR body.

<!-- BEGIN REPORT (agent abba9a8e201e912f3; model claude-sonnet-5-5; role ordinary review, round 1; candidate 2c52f65c00974767028ef338600386043a03aac0; sha256 a5a7e630cf07ed628c187055c699d1d0580580ed83cab763e7cc25fc6b857014) -->
Reviewer model: Claude Sonnet (claude-sonnet-5-5)
Context id: fresh independent Sonnet ordinary-review context (Agent subagent; did not author, direct or remediate this change)
Candidate: branch claude/g11-calibration-602, HEAD 2c52f65c00974767028ef338600386043a03aac0 (confirmed with rev-parse); reviewed `git diff 66c736e7..2c52f65c` (7 files, +1169/-15)
Verdict: CLEAR WITH NON-BLOCKING

## Summary
With R0 unpinned the judging path is the old rule, line for line. The calibration math and fail-closed rules are correct as written. The tests are mostly real. Three mutants survive (below); they leave test gaps, not defects. The docs and decision log are accurate on scope. The new tests run in the required CI stage. Nothing blocks merging this method-only change as a calibration-only step. The NON-BLOCKING items should be settled before R0 is pinned, because that is the commit that turns on the new oracle.

## 1. R0 unpinned equals the old gate (checked)
- Old: `medianOfThreeWithRetry` in performance-budget.mjs takes 3 samples and a median (index 1 of the sorted values). If median >= budget it takes one more set of 3, and the second set decides.
- New: `calibratedMedianOfThreeWithRetry` (performance-calibration.mjs:303-346) does the same:
  - three samples per set, sorted, index 1;
  - retry on `>=`;
  - the second set decides, with no best-of-N;
  - the same positive-finite budget guard;
  - the same three-finite-values guard (:289-296).
- When unpinned, `referenceFor` returns null and `resolveCalibration` returns mode "calibration-only". `normaliseSample` returns the raw value bit for bit (:274). A test asserts `normalised == raw` and the same retry result (test.mjs:368-384).
- The bench wrapper (performance.bench.ts:945-1013) keeps the same `expect(result).toBeLessThan(budget)`, and the same "Performance ..." log line.
- Metrics that did not change: sign-in, comment, drag p95, CLS, G13 still use the old helpers. The expression for list, LCP, route, create, palette x2, task-state, task-assign and board only swaps the helper and adds a `calibration:` field.
- The LCP sample now returns `{value, floorMs}`. `value` is the same number as before. `report.domContentLoaded` is taken from the existing diagnostic block (`domContentLoadedEventEnd`), which runs for every LCP sample.
- Differences when unpinned (NON-BLOCKING, none can make the gate pass):
  1. `calibrate()` still runs before every set, in a new context. A rejection there (browser error, `assertCalibrationSourcePinned`) fails the job even in calibration-only mode. `resolveCalibration`'s try/catch only covers malformed runs, not a throw from `calibrate()` itself (calibration.mjs:317, 222-243). This is fail-closed. It is a small flakiness exposure that the old gate did not have. A comment or a catch would make "never gated" literally true.
  2. Extra CPU load and wall time per set, using the same 120 s per-test timeout. The expected cost is about 7 workload runs plus a context, but I did not measure it.
  3. Calibration runs immediately before the samples. Prior thermal or GC state could shift the first sample slightly. This is unmeasurable in my environment.

## 2. Normalisation math and fail-closed rules
- Factor clamp: the inclusive range [0.5, 2.5] is checked as `!(F >= min && F <= max)`, so NaN also throws (:252). Boundary tests exist (test.mjs:121-126).
- Spread: `(max - min) / median` of 5 runs, `> 0.35` throws when calibrated (:246). It is computed before F. In calibration-only mode it only adds a note.
- Stale or malformed R0:
  - it throws on non-positive or NaN, a different source hash, or empty or absent evidence (:181-204);
  - a state other than throttled or unthrottled throws;
  - per-state null falls back to calibration-only for that state only.
- Mixed pin: if only one of the two states is pinned, the other state silently runs raw. The bench prints "pinned" if either is set. That is arguably a footgun for the pin commit (NON-BLOCKING; require both or neither).
- LCP formula `floor + (value - floor)/F`:
  - the floor is clamped to the value (:283);
  - a missing or NaN floor throws when calibrated;
  - the formula is correct and tested, including the case where LCP is before DCL.
- Calibration state matches the metric state:
  - throttled metrics get a calibration run under the same CDP profile (`installFast4gAndCpuThrottle`, 4x);
  - unthrottled metrics get one with no throttle (`measureCalibrationRuns`, performance.bench.ts:85-111);
  - each set is recalibrated, including the retry set.
- Workload pinned and verified: the source text is hashed with SHA-256, the hash is a constant, and it is checked before every run and in a unit test. The workload is seeded by an LCG and reset per run. It is verified for determinism only by construction, not by an executed hash-of-output test.
- Normalised vs raw choice, against the diagnosis data:
  - normalised: list, board, route, create, palette open and keyboard navigation, task-state, task-assign, LCP post-DCL;
  - raw: sign-in (39-41 ms flat), comment (0.84 ratio), drag p95 (1.00 ratio, 16.8 ms flat), CLS and G13 (dimensionless).
  - This matches the diagnosis table.

Could calibration make a consistently over-budget build pass?
- Only if the runner measures slower than it really is. A product regression does not change F, because the workload does not include product code. Using the median of 5 after 2 warm-ups makes a single noisy run unable to move F. Raising F needs a majority of slow calibration runs, and that has to stay under the 0.35 spread bound.
- Residual leniency (NON-BLOCKING, to evaluate with R0):
  1. One global F is applied to metrics whose measured slow/fast ratios differ (diagnosis: board 1.52, list 1.42, task-state 1.40, create 1.28, route about 1.28, LCP post-DCL about 1.55). If F is about 1.5, create and route are over-corrected by about 15 percent, so a real regression of that size on a slow runner could be hidden. Pinning R0 should be accompanied by a check that the normalised values collapse the two classes per metric, not only for the aggregate.
  2. The F upper clamp of 2.5 is much wider than the observed 1.5 class gap. A tighter clamp (for example 1.8-2.0) would shrink the worst-case leniency. This is a provisional bound. The spec states it as approved, so I leave it to the owner.
  3. "post-dcl" scales everything after DOMContentLoaded by F. The diagnosis shows some post-DCL time is network-bound (the work-item-list chunk starts at about 2480-2568 ms, after DCL). If that is not CPU time, over-correction on slow runners is possible. The diagnosis ratio of 1.55 suggests it is mostly CPU, so this is minor.
  4. Calibration runs in a separate context at a different time from the samples. A bursty runner can mis-state F in either direction. Per-set recalibration and the spread bound limit this.
  5. Symmetry: F < 1 makes a fast runner stricter. For example, board 424 ms on a 0.8 runner is normalised to 530 and fails. Whether fast hosted runners still pass depends entirely on which class R0 is recorded on. This is an owner choice at the pin commit, not a defect in this one.
- Attacker or flaky-value push: a flaky value cannot push F because of the median of 5 and the spread bound. An actor who can edit the bench or R0 can do anything; the constants are in-repo and covered by review and the security-scope path list.
- The workload options (rows, columns, runs, warm-ups) are separate exports, not part of the hashed source text. Changing `CALIBRATION_ROWS` would not trip the hash or invalidate R0. Bind the options into the hash, or into R0's recorded fields, before pinning (NON-BLOCKING, worth doing in the pin commit).

## 3. Tests
Command: `node --test scripts/ci/lib/performance-calibration.test.mjs scripts/ci/lib/performance-budget.test.mjs`
Result: tests 24, pass 24, fail 0 (run in the worktree, node v26.10.0).

Negative controls, judged against my mutation runs (changes applied to a temp copy outside the worktree; nothing was edited in the worktree):
- 25% regression, fixed LCP delay, network-floor delay, median vs best-of-N, factor 1.0, faster-runner-stricter, retry-set choice (second set decides), recalibration per set: real and non-vacuous.
- Killed by the suite (17): multiply instead of divide; F ignored; post-DCL scales the whole value; post-DCL not scaled; FACTOR_MAX 3.5; FACTOR_MIN 0.1; spread check disabled; stale hash ignored; best-of-N; retry at `>` instead of `>=`; median replaced by min of three; floor clamp removed; calibration-only turned into calibrated; scale "none" normalised; run-count check removed; unknown state check removed; throttled/unthrottled reference swapped.
- SURVIVED (3):
  1. The calibration statistic. Replacing `medianOf(runs)` with `Math.min(...runs)` or `Math.max(...runs)` still passes. Every calibrated test uses five identical runs (`runsAt`) or the `steady` list with an unchecked median. So the "median of 5, not best-of-N" rule for F is untested (NON-BLOCKING; it is the core statistic, so add a non-uniform test, for example runs [90,100,110,100,300] with an exact F).
  2. Evidence validation. The test only passes `""`. `null` or `undefined` evidence is not checked. (NON-BLOCKING)
  3. `CALIBRATION_MAX_SPREAD = 0.9` survives because the test imports the constant. The 0.35 value is not pinned by any assertion. The docs state 0.35. (NON-BLOCKING)
- The mutation I tried for "no recalibration on retry" was a no-op, so I cannot claim that was killed by mutation. The test at test.mjs:397-427 counts calibrations (2) and does cover the behaviour directly.

## 4. Docs and decision log
- ux-quality-gates.md and ci-cd.md describe the code accurately: pinned workload, F, which metrics are normalised, fail-closed rules, calibration-only until R0, logging, unchanged retry rule. The 0.5-2.5 and 0.35 values match the code.
- The historical 3 results (66c736e7 attempt-1 FAIL, rerun PASS, run 37967068981 FAIL) are stated as preserved as measured, in both the gates doc and the decision log.
- Decision entry: correct scope ("method only"; budgets, workloads, counts, throttle, sample counts, retry rule unchanged). It states R0 is unpinned and that no calibrated gate is claimed. It claims an owner approval (Thomas, 2026-10-10), which matches the brief I was given. I could not verify that approval from the repository.
- Placement: prepended as the newest entry, matching the log's newest-first convention (the previous top was the 2026-10-09 entry). Append-only: old entries untouched.
- NON-BLOCKING doc points:
  1. The entry quotes an earlier owner directive: "No … performance-threshold change". I could not find that wording anywhere in docs/ or AGENTS.md (only line 232 of the log says "no ... performance threshold ... is waived"). Please confirm or cite the source of the quote.
  2. The entry says it "supersedes" parts of the 2026-10-01 G11 failure-evidence entry, and quotes "does not change ... marks, throttles, fixtures, retry policy". That wording exists in that entry. Its claim of superseding only the judged value is a reasonable, bounded statement.
  3. "G11 harness table" in ux-quality-gates.md (line 228) still says "Median of three runs; one automatic re-run" and has no cross-reference to the calibrated method. Consider a one-line pointer.
  4. ci-cd.md edit inserts a very long run-on line mid-paragraph. Cosmetic.

## 5. CI wiring and scope
- `pnpm test:ci-scripts` is `node --test 'scripts/ci/**/*.test.mjs'`, so the new test file is picked up. It runs in ci-fast.yml (lines 212-231) on every push. The G11 job is `pnpm test:perf` in ci-full.yml:164.
- Changed files are all in scope: the bench, the calibration module, its .d.mts and tests, and three docs. No budgets, workloads, workflows, or product source changed.
- ci-full.yml and the bench are in the security scope per ci-cd.md. So Sol and fresh-context review requirements apply to this candidate separately; I am only the ordinary reviewer.
- `biome check` on the changed files reported 2 infos (style, template-literal suggestion) and no errors.

## Tests and checks run
- `node --test` (24/24 pass), as above.
- 21 temp-copy mutations of performance-calibration.mjs (17 killed, 3 survived, 1 no-op). The temp directory was removed. The worktree was not modified.
- `npx biome check` on the bench, calibration module and test: 0 errors, 2 infos.
- `tsc --noEmit -p tsconfig.node.json` in apps/web: pass. The e2e bench does not appear to be part of the web typecheck config, so the bench's types were NOT type-checked by me.

## Not checked
- I did not run the Playwright G11 suite or the calibration workload in a browser. The actual workload timing, its spread on real hosted runners, and the wall time per set are unmeasured. Whether the 0.35 spread bound is satisfiable on hosted runners is unknown.
- I did not verify the diagnosis numbers against GitHub runs, or Thomas's approval, or the hosted-data R0 (not yet pinned).
- Bench types (performance.bench.ts) were not type-checked.
- Did not review `performance-calibration.d.mts` line by line against the exports (the bench imports resolve and biome passes).
- Security-scope review (Sol) is not part of this ordinary review.
<!-- END REPORT abba9a8e201e912f3 2c52f65c -->

<!-- BEGIN REPORT (agent a4000037f3bddc1d9; model claude-opus-5-5; role Sol-tier security review, round 1 (BLOCKED); candidate 48dbb9f6b83b92597563130c22e95efbf14fe2cd; sha256 5d22497602cbd1da619ba0680c8a81d0654dbb07b877dbe878dbc79dc11564c9) -->
Reviewer model: Claude Opus (claude-opus-5-5)
Reviewer context ID: claude-agent:a4000037f3bddc1d9
**Reviewed head:** 48dbb9f6b83b92597563130c22e95efbf14fe2cd
Verdict: BLOCKED

This is a fresh, independent, Sol-tier security/critical review performed by Claude Opus. It is
**not** a GPT-6 Sol review and must not be recorded as one. I did not author, direct, or
remediate this change. It was read-only: nothing in the worktree was edited, committed, or
pushed. Mutations ran on a copy under `$TMPDIR`.

- Candidate: branch `claude/g11-calibration-602`, worktree `/private/tmp/claude-501/g11-calibration-602`.
- HEAD verified with `git rev-parse HEAD` = `48dbb9f6b83b92597563130c22e95efbf14fe2cd`.
- Comparison base: `66c736e71c87b2372ba1cbf8250236ac37191565` (frozen #602 head).
- The diff has 3 commits: 5380ed6b, 2c52f65c, 48dbb9f6. It touches 7 files (+1600/-15).
- Owner decisions taken as given from the brief (Thomas, 2026-10-10):
  1. Change the method only.
  2. Budgets refer to the FAST runner class.

## Summary

The method is sound in shape and the arithmetic is correct:

- R0 and every k reproduce exactly from the cited hosted logs.
- The calibration is isolated from the app.
- The gate wiring and budgets are unchanged.
- The negative controls are real.

Two items block:

- **B1 (code):** the "stale R0" pin is tautological in the shipped wiring. If someone edits the workload and refreshes its hash, every test still passes and the runtime accepts R0. That one edit could loosen the gate by up to the factor clamp (1.75x on k = 1 metrics). The docs, the module header, and the decision log all say this case fails closed. It does not.
- **B2 (process):** the only ordinary review is at 2c52f65c. The pin commit 48dbb9f6 is the commit that turns the calibrated oracle on, and it has no ordinary review at the exact head. There is also no hosted run in calibrated mode at this head.

There is one important non-blocking finding (N1). Within the FAST class, the per-set calibration noise is about ±10%, and the retry is asymmetric. Together they let a product slightly over budget (≤ ~10%) pass with real probability on the reference class. The decision log says "a real regression is not hidden", which overclaims.

## Surfaces examined

- `scripts/ci/lib/performance-calibration.mjs` (all 483 lines)
- `scripts/ci/lib/performance-calibration.test.mjs`: the structure, the pin, k-table and negative-control tests, and the fixtures `pinned()`, `judge()` and `REFERENCE_VALUE`
- `scripts/ci/lib/performance-calibration.d.mts`: the export list only
- `apps/web/e2e/performance.bench.ts`:
  - the full diff against the base, and against 2c52f65c (the collection head)
  - `installFast4gAndCpuThrottle`
  - `measureCalibrationRuns`
  - the cleanup in `withPerformancePage`
  - the LCP DCL capture
- The unchanged files: `apps/web/playwright.perf.config.ts`, `.github/workflows/ci-full.yml` (the `performance - budgets (G11)` job), and the `ci-scripts` job in `.github/workflows/ci-fast.yml`
- Doc diffs: `docs/02-design/ux-quality-gates.md`, `docs/04-engineering/ci-cd.md`, `docs/07-planning/decision-log.md`
- Hosted logs (`gh run view --job`) for all six collection jobs. I confirmed all six runs are `workflow_dispatch` "CI - full" at `2c52f65c00974767028ef338600386043a03aac0`:
  - FAST: 113976781168, 113980309611, 113984215185
  - SLOW: 113961809231, 113966606217, 113971494970
- `g11logs/rows.json` (variance diagnosis), the Opus diagnosis, and the Sonnet ordinary review.

## Tests and reproductions run

1. `node --test scripts/ci/lib/performance-calibration.test.mjs scripts/ci/lib/performance-budget.test.mjs` in the worktree (node v26.10.0, existing node_modules): **33 tests, 33 pass, 0 fail.**
2. **R0 recomputed from the hosted logs.** I took the median of the deduplicated "G11 calibration … set N" medians.
   - FAST unthrottled: n = 6, median **51.65** (range 47.4–57.7).
   - FAST throttled: n = 21, median **230.7** (range 210.0–254.1).
   - SLOW unthrottled: n = 9, median 72.2. SLOW throttled: n = 29, median 324.1.
   - All of these match the pinned values and the doc text.
   - Classification rule: the per-job unthrottled medians are FAST 48.45–56.25 and SLOW 70.8–73.3. Every FAST job passed and every SLOW job failed. The 60 ms gap rule holds.
3. **Pins are identical between the collection head and HEAD.**
   - `CALIBRATION_SOURCE` is byte-identical between 2c52f65c and HEAD; SHA-256 `6b75d3e9…206ce5` at both.
   - The options were `{2, 5, 400, 6}` at both, and `calibrationOptionsSha256()` equals the pinned constant.
   - `measureCalibrationRuns` is functionally identical between the two heads. The only change is that options are now passed as a frozen object.
4. **k table recomputed.** I used the 43 non-p1/p2 rows from rows.json (board < 520 → FAST) plus the six runs' judged medians: 15 FAST and 34 SLOW, as cited.
   - k raw: list 1.095, board 1.061, route 0.623, create 0.741, palette 0.563, paletteNav 0.597, taskState 0.903, taskAssign 0.417.
   - This matches the table to within ±0.001 and does not change any pinned (floored) k.
   - I did not recompute LCP's post-DCL k.
5. **Mutation testing** on a temp copy of the module with the real test file:

| Mutation | Result |
| --- | --- |
| M1: ignore k (divide by full F) | killed (2), including the 25% regression control |
| M2: route k 0.62 → 1 | killed (k-table literal) |
| M3: FACTOR_MAX 1.75 → 3 | killed (3) |
| M4: spread 0.55 → 0.9 | killed |
| M5: retry keeps the best set | killed |
| M6: post-DCL scales the whole LCP | killed (3) |
| M7: calibration statistic median → max | killed (2) |
| M8: spread check disabled | killed |
| M9: R0 unthrottled lowered 10% | killed |
| M11: missing DCL floor → raw instead of throw | killed |
| M12: mixed pin → silent calibration-only | killed |
| M13: LCP k 1 → 0.5 | killed |
| **M10b: workload rows doubled in `CALIBRATION_SOURCE` + `CALIBRATION_SOURCE_SHA256` refreshed** | **SURVIVED: 30/30 pass** |
| **M10c: workload halved + hash refreshed** | **SURVIVED: 30/30 pass** |

   I also isolated the 25% negative control under M1: it fails, so the control is not vacuous.
6. **Offline replay of the HEAD calibrated rule** on the six collection logs. I applied R0, k and the post-DCL rule to the logged raw sample sets and set calibrations.
   - All six jobs pass every calibrated metric, except FAST job 113976781168 task-state set 1. There, raw 196.1 with F = 217.7/230.7 = 0.944 and k = 0.9 gives a normalised **206.6**, which fails set 1. Its retry set does not exist in the log, so the outcome is unknown.
   - SLOW normalised examples: board 449/476/478, list 331–350, LCP 2411–2438, all under budget.
   - This is a prediction only. It is not gate evidence.
7. **Noise model** (feeds N1). Per-set factors on FAST jobs: unthrottled 0.918–1.117, throttled 0.910–1.101, pooled σ ≈ 0.066. I simulated a product at a fixed true cost, with F drawn empirically from FAST sets, 1% sample noise, median of three, and one retry. P(pass) by true cost and k:

| True cost vs budget | k = 1 | k = 0.6 |
| --- | --- | --- |
| 103% | 0.66 | 0.59 |
| 105% | 0.60 | 0.26 |
| 108% | 0.28 | ≈0 |
| 110% | 0.14 | ≈0 |
| 115% | ≈0 | ≈0 |

## Findings

### BLOCKING

**B1. The stale-R0 pin is tautological. A workload edit plus a hash refresh passes every test and every runtime check.**

- `scripts/ci/lib/performance-calibration.mjs:185-186`: `PERFORMANCE_REFERENCE.sourceSha256 = CALIBRATION_SOURCE_SHA256` and `optionsSha256 = CALIBRATION_OPTIONS_SHA256`. These are the *same identifiers* that `resolveCalibration` uses as its defaults for comparison (`:320-321`, checked at `:293-302`).
- `scripts/ci/lib/performance-calibration.test.mjs:96-97` asserts each identifier equals itself.
- `assertCalibrationSourcePinned()` (bench `measureCalibrationRuns`) only checks the source against `CALIBRATION_SOURCE_SHA256`. A refreshed hash satisfies it.
- Result (M10b/M10c): change the workload, refresh its hash, and R0 is still accepted. Every unit test passes and the runtime does not throw.
- Gate impact:
  - Making the workload ~1.4x heavier sets F ≈ 1.4 on FAST runners. That silently admits a ~40% regression on list, board and LCP post-DCL (k = 1), and less on k < 1 metrics.
  - The ceiling is the clamp (F ≤ 1.75), and it applies with the whole suite green.
  - A lighter workload has the opposite effect: a stricter gate and false fails.
- Truthfulness: these texts all state that a different source hash throws and that changing the workload invalidates R0 until it is re-recorded:
  - the module header (`:18`)
  - the comments at `:41-43` and `:181-182`
  - `ux-quality-gates.md` (R0 bullet)
  - `ci-cd.md` ("a stale … R0 pin fails the job")
  - the decision log ("recorded against the workload source hash and a hash of the workload options")

  That claim is not mechanically true.
- Options are partly protected. The literal `deepEqual` at `test.mjs:77-80` catches an options change in `ci-scripts`, but nothing at G11 runtime computes the options hash (see N2). The source has no independent protection.
- Minimal fix:
  1. Record the literal hex values in `PERFORMANCE_REFERENCE` as captured at collection: `sourceSha256: "6b75d3e90b6a3ea297ad3ace423166e3602a185d865cb3ec9a2889bbce206ce5"` and `optionsSha256: "2f4c9448c86ed2cb1ed2e62cff530dd1d4eed6b589acdf7bd58af7833d1961df"`.
  2. Have `resolveCalibration` and the bench compare against `sha256Hex(CALIBRATION_SOURCE)` and `calibrationOptionsSha256(CALIBRATION_OPTIONS)` computed at run time, not against exported constants.
  3. Add a regression test: mutate the source with a refreshed source constant and assert `resolveCalibration` throws against the shipped `PERFORMANCE_REFERENCE`.

  After the fix, a workload change forces a visible edit to the R0 record itself, which is the documented intent.
- Caveat: anyone with commit access can still edit the R0 literals. The pin is meant to make that edit explicit, not impossible. Today it does not.

**B2 (process). There is no ordinary review at the exact candidate head, and no calibrated hosted evidence.**

- `g11-calibration-ordinary-review-sonnet.md` reviewed **2c52f65c** (calibration-only; clamp 0.5–2.5; spread 0.35; R0 unpinned).
- Commit 48dbb9f6 is the one that pins R0, adds the per-metric k, narrows the clamp to 0.75–1.75 and widens the spread to 0.55. It changes acceptance semantics, so it needs its own exact-head ordinary review before the security tier closes.
- `gh run list --branch claude/g11-calibration-602` shows only the six 2c52f65c collection runs. No hosted G11 run exists in calibrated mode at 48dbb9f6.
- This is a merge-gate gap, not a code defect. It must be closed before the delta is folded into #602.

### NON-BLOCKING

**N1. Calibration noise plus the asymmetric retry widens the pass zone on the reference class. The "not hidden" claim overclaims.**

- Within one FAST job, the per-set F varies about ±6–10%. For example, job 113976781168 has throttled set medians of 217.7–245.0. Because this happens on the same runner, it is noise, not runner speed.
- F divides every sample in its set, and a failing set gets a second draw. So a k = 1 metric at 105% of budget passes about 60% of the time, and at 110% about 14% (model in test 7). Raw render metrics with 1–3% sample noise would almost always have failed.
- The converse also happens. Replay 6 shows a FAST, raw-PASS job failing task-state set 1 (196.1 → 206.6).
- The decision-log sentence "a real regression is not hidden, because normalisation divides by at most F^k …" should be qualified: a regression larger than calibration noise is not hidden, and a marginal one (≲10%) can pass.
- Suggested hardening, as a follow-up and an owner choice:
  - Use a per-job pooled F per throttle state, or bracket each set with calibration before and after and take the median.
  - Alternatively, log and track the normalised margin so that marginal passes are visible.

**N2. The options hash is not computed at G11 run time.**

- The bench never calls `calibrationOptionsSha256()`. The comparison is constant against constant.
- Drift is caught only by the literal `deepEqual` in `ci-scripts` (ci-fast).
- Fold this into the B1 fix.

**N3. The k values come from small, selection-biased samples.**

- The class medians use *judged* medians. When a retry ran, the second set is the one counted.
- The interaction metrics have n = 15/34, and their values are frame-quantised.
- k is clamped to at most 1 and floored, which bounds the risk. A k above a metric's true sensitivity still over-normalises SLOW runs by up to F^(k_true − k).
- The docs already advise re-recording. I agree, and it should happen before relying on k < 1. A recurring re-record cadence should be set.

**N4. The LCP floor edge case.**

- `normaliseSample` accepts `floorMs = 0` (`:396`), which would scale the whole LCP by F^1.
- `domContentLoadedEventEnd` is effectively never 0 by the time LCP is read, so this is low risk.
- Rejecting `floorMs <= 0` would be stricter.

**N5. Some numbers in the spread-statistics comments do not reproduce.**

- Location: `performance-calibration.mjs:33-37`, and the corresponding text in ux-quality-gates.md.
- The comment says "50 hosted calibration sets; fast median 0.32–0.35; slow median 0.31–0.34". The six collection jobs contain 65 sets (27 FAST, 38 SLOW), with per-job medians of 0.324–0.360 (FAST) and 0.275–0.371 (SLOW).
- The maxima (0.39 / 0.43) are correct, and the 0.55 bound can only fail closed. This is cosmetic, but it is gate-evidence text.

**N6. The bench is not type-checked.**

- No `apps/web` tsconfig includes `e2e/`, and Playwright transpiles without type-checking.
- The `CalibratedMetricId` and `CalibrationSample` typing in the bench is therefore unverified.

**N7. Future runner-class drift.**

- If GitHub's FAST class drifts faster (F < 0.75) or a new class appears beyond 1.75, the job fails closed. That is good.
- Drift inside [0.75, 1.75] silently re-anchors what the budgets mean.
- The logged F per set allows monitoring. A periodic R0 re-record or drift alarm is recommended. R0 itself rests on 3 FAST jobs; the throttled value is better supported (n = 21).

## Answers to the adversarial questions

1. **Always-pass and hidden regressions.**
   - The design cannot become always-pass: k ≤ 1, F is in [0.75, 1.75] and fails closed outside it, the spread is ≤ 0.55 and fails closed above it, and the DCL floor is unscaled.
   - The maximum loosening is F^k ≤ 1.75 on a genuinely slow runner, which is the owner-accepted reference-class consequence.
   - It can hide regressions in two ways: a workload edit (B1), and marginal (≲10%) regressions through calibration noise (N1).
   - Isolation is good:
     - The calibration runs in a fresh `browser.newContext()` on `about:blank`, with no API route fixture and no app navigation.
     - The throttled path navigates only to `about:blank` before CDP throttling.
     - Earlier sample contexts are closed in `finally`, so their workers end.
     - The perf config is `fullyParallel: false` with a single file, so execution is serial.
     - The API is page-route mocked. The only candidate-built host process is the static `vite preview`.
   - I found no route by which candidate code can persist a CPU hog into the calibration context. A hog that slowed both would also be capped by the clamp.
   - The spread bound only ever fails closed.
2. **R0 truthfulness and reproducibility.** R0 is truthful and reproducible to the published precision (test 2). The source pin is checked at run time before every calibration. The options pin is not (N2). The R0 pin's "stale" check is vacuous (B1).
   - Fail-open review:
     - `resolveCalibration` swallows errors only in the R0-unpinned branch (`:332-354`). That branch is unreachable at HEAD because both values are pinned.
     - In calibrated mode, every malformed or unstable input throws.
     - A `calibrate()` rejection propagates to the test.
     - A missing DCL floor throws.
     - A mixed pin throws.
     - Reverting R0 to null returns the gate to the old raw method, which is the pre-change behaviour, not a pass.
3. **Negative controls.**
   - The per-metric 25% regression at F = 1.4 is real: M1 kills it.
   - Its baseline is placed at 81% of budget, so it proves that normalisation inverts F^k exactly. It does not prove that every 25% regression is caught; a metric at 60% of budget regressing 25% passes under both old and new methods.
   - The LCP floor and DCL controls, the median, factor-1 and faster-is-stricter controls, and the retry control are all real (M5–M7, M11 killed).
4. **Wiring.** The diff touches no workflow and no Playwright config.
   - The job name `performance - budgets (G11)`, the `pnpm test:perf` step, and the budgets all appear unchanged in the diff. The budgets are 500/2500/300/200 ms, and CLS 0.1.
   - Throttling (4x, fast-4G) and the workloads (500 rows / 200 tasks) are unchanged, `retries: 0` is unchanged, and the raw-judged metrics are untouched.
   - The calibrated wrapper keeps `expect(result).toBeLessThan(budget)`.
5. **Docs and decision log.**
   - The scope ("method only" plus the FAST reference class) is stated correctly.
   - The entry is prepended newest-first and no prior entry was edited.
   - Historical results (66c736e7 attempt-1 FAIL, rerun PASS, run 37967068981 FAIL) are explicitly preserved and not re-judged.
   - Collection runs are labelled as calibration evidence, not gate evidence.
   - The inaccuracies are the B1 claim, the N1 overclaim, and N5.
6. **Residual risks.** See N1, N3 and N7, plus the following:
   - R0 rests on 3 FAST jobs; the unthrottled value has n = 6.
   - Calibrated mode has never executed on a hosted runner.

## Residual risk

After B1 and B2 are fixed, the remaining risks are:

- the marginal-regression pass window from calibration noise (N1);
- the k estimates from few, frame-quantised samples (N3);
- re-anchoring under runner-class drift within the clamp (N7).

All three are bounded by the clamp and by k ≤ 1, and all are visible in the per-set logs.

## Not checked

- I did not run the Playwright G11 suite or the workload in a browser locally. The calibrated behaviour on hosted runners is unobserved (no run at 48dbb9f6). The offline replay (test 6) is a prediction only.
- I did not recompute LCP's post-DCL k (284.1 / 419.3, from 12/30 LCP diagnostics).
- I did not type-check the bench (N6), and I did not compare `performance-calibration.d.mts` line by line with the module.
- I could not verify Thomas's 2026-10-10 decisions from the repository; I took them from the brief.
- I did not review the rest of `performance.bench.ts` outside the diff and the helpers named above.
- I did not re-verify the earlier 43-job diagnosis classifications beyond the board < 520 split used here.
<!-- END REPORT a4000037f3bddc1d9 48dbb9f6 -->

<!-- BEGIN REPORT (agent abba9a8e201e912f3; model claude-sonnet-5-5; role ordinary delta review, round 2; candidate 48dbb9f6b83b92597563130c22e95efbf14fe2cd; sha256 e97c2c77a98000f4a9180674e76fffc9d1887ae7ee8934b7fb994f20c12af29f) -->
Reviewer model: Claude Sonnet (claude-sonnet-5-5)
Context id: fresh independent Sonnet ordinary-review context (same reviewer as the 2c52f65c review; did not implement or direct the follow-up; verifying closure of own findings)
Candidate SHA: 48dbb9f6b83b92597563130c22e95efbf14fe2cd (rev-parse confirmed). Reviewed `git diff 2c52f65c..48dbb9f6` and the coherence of `66c736e7..48dbb9f6` (7 files, +1600/-15; same 7 paths as before, nothing outside scope).
Verdict: CLEAR WITH NON-BLOCKING

## (1) Closure of my earlier findings
| Earlier finding | Status | Evidence |
|---|---|---|
| Calibration statistic (median of 5) untested; min/max mutants survived | CLOSED | New tests "median of five, not min, max or mean" and "factor uses that median". Mutation `medianOf -> Math.max` now killed. |
| Null/undefined evidence untested | CLOSED | Test "null, empty and non-string evidence throws"; mutant removing the evidence check is killed. |
| 0.35 bound not pinned (constant imported) | CLOSED | Test "the spread bound and factor clamp are the recorded values" asserts 0.55, 0.75, 1.75 literally; mutants 0.9 spread / 2.5 max / 0.5 min all killed. |
| Workload options (rows, columns, runs, warm-ups) not in the hash | CLOSED | `CALIBRATION_OPTIONS` frozen, `CALIBRATION_OPTIONS_SHA256` in R0, checked in `referenceFor`; mutants "options hash ignored" and "hash drops columns" are killed. |
| Mixed pin (one throttle state) silently raw | CLOSED | `referenceFor` throws on a mixed pin; mutant killed; test covers both states. |
| Single global F over-corrects metrics with lower slow/fast ratios; clamp 2.5 too wide | CLOSED (by design, see (3)) | Per-metric F^k with k clamped to [0,1], clamp tightened to [0.75, 1.75]. |
| Post-DCL part may contain non-CPU time | OPEN, accepted | k for LCP is clamped to 1 (raw 1.145), i.e. the LCP post-DCL portion is normalised no more than the calibration itself. The network-bound share inside the post-DCL part is still not separated. Evidence ratio (1.45-1.48) is above the calibration ratio (1.405), so the observed data show no over-correction. |
| calibrate() rejection fails the job in calibration-only mode | N/A | R0 is now pinned, so the gate is calibrated (fail-closed by design). |
| Decision-log quote "No ... performance-threshold change" unverifiable | PARTLY CLOSED | The entry now gives the full quote and cites "policy session 412b91f1, about 17:06 UTC 2026-10-09". I cannot verify that session or quote from the repository; it is an unverified external citation. NON-BLOCKING. |
| Typecheck of the bench not done | OPEN | Still not covered by the web tsconfig; biome reports only the same 2 style infos. |
| Fast hosted runner stricter / depends on R0 class | CLOSED | Owner chose FAST; the decision log now states the consequence truthfully (see (4)). |
| "retry >=" boundary | NEW REGRESSION IN TEST COVERAGE | See below. |

## (2) Reproducibility from the cited runs (re-extracted with `gh run view --job <id> --log`, all six logs fetched)
- Calibration medians (set medians from every "G11 calibration ... set N [state]" line, including retry sets):
  - FAST unthrottled n=6, median 51.65 (matches R0 51.65).
  - FAST throttled n=21, median 230.7 (matches R0 230.7).
  - SLOW unthrottled n=9, median 72.2; SLOW throttled n=29, median 324.1.
  - Ratios 72.2/51.65 = 1.398 and 324.1/230.7 = 1.405, as documented.
- Ranges cited in docs all reproduce: FAST unthrottled 47.4-57.7, SLOW 66.6-73.6; FAST throttled 210.0-254.1, SLOW 277.8-386.1; per-set factors 0.910-1.674 (doc: 0.91-1.67); spread maxima 0.392 fast and 0.433 slow (doc 0.39 / 0.43).
- Classification: the unthrottled gap (fast max 57.7, slow min 66.6) is clean around the 60 ms line.
- k table: I rebuilt the metric class medians from rows.json (43 non-p1/p2 jobs, board < 520 = FAST: 12 FAST, 31 SLOW) plus the six runs' "Performance ... median" lines (15 FAST, 34 SLOW). Results: list 343.1/495.2, r 1.443, k raw 1.095; board 455.4/649.8, 1.427, 1.061; route 88.4/109.2, 1.236, 0.623; create 124.8/160.6, 1.286, 0.741; palette 161.7/195.8, 1.211, 0.563; paletteNav 131.6/161.2, 1.225, 0.597; taskState 149.1/202.7, 1.359, 0.903; taskAssign 159.7/184.1, 1.152, 0.417. All agree with the table within rounding (list k raw 1.095 vs 1.096 documented). Floors 0.62/0.74/0.56/0.59/0.90/0.41 are correct (rounded down). LCP post-DCL: from the six runs' diagnostics alone (9 fast, 18 slow samples) the ratio is 1.449 (fast 289.8, slow 420.0 ms); the doc's pooled 1.476 (284.1/419.3) uses the diagnosis' 15 extra samples, which I did not re-extract. Either way k_raw > 1, so the clamp to 1 holds.
- NON-BLOCKING doc discrepancy: the docs and constants say the spread was observed "across 50 hosted calibration sets". The six logs contain 65 sets (27 FAST, 38 SLOW). Maxima and medians are right; the count is not. Fix the number or state what the 50 refers to.
- Note: R0 and ratios come from 3 + 3 runs only. The class split uses the job's own G11 pass as part of the rule (FAST = unthrottled calibration < 60 ms AND G11 PASS). Here the two conditions agree for all six, so it makes no difference on this data, but the rule is partly circular if it were reused. Recommend re-recording from more runs (the code comment already advises this for k < 1).

## (3) Can a metric be over-normalised? Negative controls and mutations
- By construction normalisation is `value / F^k` with 0 <= k <= 1 (validated at call time; `normaliseSample` throws otherwise, including for NaN/undefined), F in [0.75, 1.75], so the largest possible divisor is 1.75 (k=1) and for k<1 at most 1.75^k (taskAssign 1.26, route 1.42). No metric is normalised more than the calibration itself, and k pinned reproduces the observed slow/fast ratio at F = r_cal. Spot check: slow-class values normalised at F = 1.4 land at or above fast-class medians for list, board and LCP (stricter by about 1-3%) and within 1-2% for the others.
- Residual: at the F ceiling (1.75, k = 1) up to about 43% of a raw value is divided away. This is the designed bound, and a real runner that slow is far outside the observed 1.67 maximum. The decision-log sentence "a real regression is not hidden" is an overstatement; it should say a regression is hidden at most by the F^k bound, up to the runner-speed difference. NON-BLOCKING wording.
- Operational note: the observed maximum factor 1.674 sits only 4.5% under the 1.75 clamp, and spread 0.433 sits 21% under 0.55. A slightly slower hosted machine fails closed (job fails) instead of passing. That is safe but can cause failures that need rerunning. NON-BLOCKING.
- Tests: `node --test performance-calibration.test.mjs performance-budget.test.mjs`: tests 33, pass 33, fail 0. Full `node --test 'scripts/ci/**/*.test.mjs'` (what `pnpm test:ci-scripts` runs): tests 1150, pass 1150, fail 0.
- The per-metric negative control (test.mjs:454-498) builds raw = v * F^k at F = 1.4 for each of the 8 full-scale metrics plus LCP, asserts the baseline passes without retry, and a 25% regression fails after the retry. The control is partly algebraic (it uses the same k as the code), but it does prove the end-to-end pipeline cannot hide 25% at F = 1.4 and that the baseline is not vacuous (explicit pass assertion).
- Mutations on a temp copy (21 runs; worktree untouched): killed: F instead of F^k; k upper check removed; k range check removed; taskAssign k 0.5; list k 1.2; clamp max 2.5; clamp min 0.5; spread 0.9; mixed pin allowed; options hash ignored; options hash drops a field; evidence check removed; R0 value changed; median -> max; post-DCL not scaled; best-of-N; unknown metric unchecked; stale source hash ignored; state swapped. Two survivors:
  1. `if (result > budget)` instead of `>=` for the retry condition: SURVIVED. The previous test suite caught this (exact-budget case at F=1); the rewritten controls use 506 vs 500 and never hit equality. Effect of the mutation: a result exactly equal to the budget would skip the retry, then still fail the `toBeLessThan` check, so it cannot create a pass; but the "at or over budget" rule is the old gate's and should be tested. NON-BLOCKING, small fix (add an exact-equality retry test).
  2. My evidence-id mutation replaced only the first occurrence (a comment), so it is an invalid mutant, not a test gap.

## (4) Docs and decision log truthfulness
- Accurate: R0 values, hashes, evidence ids (all 6 jobs, matching the code), classification rule, observed ranges, clamp and spread bounds, k table (matches the code to the digit), retry rule unchanged, logging (bench prints k and F^k), CI test-count statement.
- Scope statement is still truthful: method only; budgets, workloads, throttling, counts, sample counts and retry unchanged. The entry adds "Source: Thomas, directly to the Claude Opus conductor session" and "Reference class (Thomas, 2026-10-10, directly to the conductor)". I cannot verify these approvals from the repo; they are consistent with your brief.
- States "calibration evidence, not gate evidence" and "None of these six runs is a calibrated gate result or a merge claim". Correct: the collection ran at 2c52f65c with R0 unpinned. The candidate 48dbb9f6 has not itself run under the pinned gate, and the docs do not claim it has.
- Historical G11 results (66c736e7 FAIL, rerun PASS, 37967068981 FAIL) remain recorded as measured.
- Placement: still the newest entry at the top of the log.
- NON-BLOCKING doc points: "50 hosted sets" (should be 65, or say which 50); "a real regression is not hidden" overstatement; the "policy session 412b91f1 about 17:06 UTC" citation is unverifiable from the repo; the decision-log consequence paragraph says a faster-than-reference runner is stricter, which matches the code.

## Other checks
- Bench wiring: ten `calibration: { browser, metric }` entries map to the right ids (list, lcp, route, create, palette, paletteNav, taskState, taskAssign, board), throttle state derived from `CALIBRATED_METRICS`, options passed from the hashed `CALIBRATION_OPTIONS`. Raw metrics (sign-in, comment, drag, CLS, G13) are unchanged. `biome check` on bench, module, d.mts, tests: 0 errors, 2 infos (style).
- CI: new tests are in `scripts/ci/lib/` and run under `pnpm test:ci-scripts` (ci-fast.yml). ci-full.yml and the bench are security-scope, so the separate Sol review still applies.

## Not checked
- Did not run the Playwright G11 suite or the calibration workload in a browser; no gate run at 48dbb9f6 exists, so whether the pinned gate passes on the fast class (and fails closed correctly on a slow one) is unobserved.
- Did not re-extract the diagnosis' 15 extra LCP samples; the LCP post-DCL pooled ratio 1.476 is unverified (my six-run subset gives 1.449; the conclusion k = 1 is unchanged).
- Did not verify Thomas's approvals or the cited policy session.
- Bench types not type-checked (outside tsconfig).
<!-- END REPORT abba9a8e201e912f3 48dbb9f6 -->

<!-- BEGIN REPORT (agent abba9a8e201e912f3; model claude-sonnet-5-5; role ordinary delta review, round 3; candidate c1b9ea3b894b51dc7de14c3bb4045160de752798; sha256 4feea75332069f8d4635a17de8ae83b62c7d433739f823f7edb0233627d2d771) -->
Reviewer model: Claude Sonnet (claude-sonnet-5-5)
Context id: fresh independent Sonnet ordinary-review context (same reviewer as the 2c52f65c and 48dbb9f6 reviews; did not implement or direct this commit)
Candidate SHA: c1b9ea3b894b51dc7de14c3bb4045160de752798 (rev-parse confirmed). Reviewed `git diff 48dbb9f6..c1b9ea3b` (7 files, +396/-190; same 7 paths as before, no workflow or config change). Full `66c736e7..c1b9ea3b` is the same 7 files.
Verdict: CLEAR WITH NON-BLOCKING

## Summary
- B1 is fixed in the code. I confirmed it by editing the workload in a temp copy and refreshing the exported hash constant: `resolveJobCalibration` and `assertCalibrationSourcePinned` both throw against the shipped R0. Before this commit that edit passed.
- The job-level factor is correct and R0 stays comparable (details in (2)).
- The new tests are real for every behaviour except one: nothing in the suite guards the live-hash wiring that B1 relied on (finding T1 below). That is a test gap, not a defect, so it is non-blocking, but I recommend closing it.
- Tests pass: calibration + budget files 40/40; full `scripts/ci` suite 1157/1157. `biome check` on the bench, module, d.mts and tests: clean (0 errors, 0 infos).

## (1) B1: literals checked against live hashes
- `PERFORMANCE_REFERENCE.sourceSha256` and `optionsSha256` are now literal hex strings (module :194-200), equal to the hashes in force at the collection run (source `6b75d3e9...206ce5`, options `2f4c9448...1961df`, as in the 48dbb9f6 review).
- `resolveJobCalibration` defaults compute `sha256Hex(CALIBRATION_SOURCE)` and `calibrationOptionsSha256(CALIBRATION_OPTIONS)` live. The bench calls it with only `{batches, state}`, so the live defaults are what run. `CALIBRATION_OPTIONS_SHA256` is removed. `assertCalibrationSourcePinned` now defaults to the R0 literal (falling back to the constant only when R0 is null). The bench also runs this assertion before every calibration batch.
- Real edit, in a temp copy: workload `rows` doubled and the exported source-hash constant refreshed. Result: "recorded against a different calibration workload; re-record it" (throws), and `assertCalibrationSourcePinned()` throws. B1 is closed in behaviour.
- The remaining exported `CALIBRATION_SOURCE_SHA256` constant is now only a fallback when R0 is null and no longer feeds the gate. Cosmetic: could be removed or documented.
- Test coverage of the pin (see T1 below): the literal values are asserted, and the override-parameter route is tested. The default live wiring is not.

## (2) Job-level factor and R0 comparability
- Design: `beforeAll` takes `CALIBRATION_BATCHES = 3` batches per state (unthrottled, then throttled), each with the recorded options unchanged (2 warm-ups + 5 runs). The job median is the median of the 3 batch medians; the spread bound is checked on every batch (max); F = job median / R0; the same calibration object is reused by every metric and set, retry included. `calibratedMedianOfThreeWithRetry` now rejects a missing or wrong-state calibration.
- Comparability: R0 is the median of single-batch medians (all sets, 5-run batches, same options, same code). The job factor is a median of 3 such batch medians. Same location statistic, lower variance, so R0 stays comparable. I checked this on the six collection logs (the per-set medians as a proxy for batches):
  - FAST jobs, job-median F against R0: throttled 1.000 / 0.922 / 1.075; unthrottled 0.985 / 0.938 / 1.089. Within a job the per-set F barely moves (job-level spread of 0.91-1.12 is mostly between jobs, i.e. real runner speed).
  - SLOW jobs: throttled 1.399 / 1.343 / 1.523; unthrottled 1.404 / 1.371 / 1.419. All inside [0.75, 1.75]. The worst single set (1.674) is not what is judged any more; the job median 1.523 leaves 13% margin to the clamp (better than before).
  - First-set F (taken at job start, after the 2 warm-ups) against later sets on FAST jobs: 1.006/1.000, 0.922/0.995, 1.063/1.069. There is no systematic cold-start inflation, so job-start batches are representative.
- Residuals (NON-BLOCKING; the docs already state the first two):
  1. One draw per state per job means a calibration error biases all of that job's metrics together (before, per-set errors were independent). The median of 3 reduces it; it does not remove it. Marginal regressions below the residual noise can still pass (docs now say so).
  2. A factor taken at job start cannot follow speed drift during the job (the board test runs last). Per-set F in the logs moves little within a job, so the observed risk is small.
  3. Playwright restarts the worker after a failing test and re-runs `beforeAll`, so after a failure later tests get a freshly taken calibration, not the job-start one. This is still a valid calibration, but "one factor per job" is really "one per worker". Docs could say "per worker process". A calibration failure in `beforeAll` also fails the non-calibrated tests in that worker (fail-closed).
  4. Up-front cost: 6 batches (about 7 workload runs each, 4x throttled for half of them) well inside the 180 s test timeout in `playwright.perf.config.ts`.

## (3) Tests and mutations
Non-vacuous (killed on a temp copy of the module with the real tests; worktree untouched):
- job median to max / min / first batch; job spread to min; batch count unchecked; `CALIBRATION_BATCHES` 3 to 5; state mismatch unchecked; F^k to F; clamp max 2; throttled R0 250; spread check removed; retry `>=` to `>` (the old gap, now killed by "the retry fires at exactly the budget"); floor `>= value` allowed; floor `<= 0` allowed.
- Test "editing the workload fails closed..." passes `sourceSha256: refreshed` as an override and asserts the literal R0 rejects it. Good for the comparison itself.

SURVIVED (T1, NON-BLOCKING, recommend fixing): these four mutations leave 40/40 passing:
  1. `resolveJobCalibration` default `sourceSha256` reverted to a constant/literal instead of `sha256Hex(CALIBRATION_SOURCE)`;
  2. same for `optionsSha256`;
  3. `PERFORMANCE_REFERENCE.sourceSha256` redefined as `sha256Hex(CALIBRATION_SOURCE)` (the exact B1 self-comparison);
  4. `assertCalibrationSourcePinned` default reverted to the exported constant.
  All pass because the tests never edit the real workload; they only pass overrides, so any equivalent value at HEAD is indistinguishable. In practice this means the B1 regression could be reintroduced with a green suite. Fix: a test that spawns Node on a temp copy of the module with an edited workload (and refreshed constant) and asserts `resolveJobCalibration` with default args throws, or a source-text assertion that the defaults reference `sha256Hex(CALIBRATION_SOURCE)` / `calibrationOptionsSha256(CALIBRATION_OPTIONS)` and that `PERFORMANCE_REFERENCE` hashes are literals. I verified by hand that the shipped code behaves correctly today.

Other test notes:
- The per-metric 25% regression control at F=1.4 is unchanged, still real (it fails under F^k to F).
- "reused by every set" asserts the same calibration object is attached to both sets, and the batch tests cover noise (+/-25%), spread-out batches, count, and per-batch spread.

N4 (floor validation) review: `normaliseSample` now throws unless `0 < floor < LCP`. This closes the `floor = 0` hole. One side effect (NON-BLOCKING): if a product improvement ever lets LCP paint at or before DOMContentLoaded end, the gate throws instead of treating the whole LCP as network-floor time (the earlier behaviour was to leave it unscaled, which is safe). Current data has LCP about 250-430 ms after DCL, so no impact today, but consider returning the raw value in that case with a logged note.

## (4) Docs and decision log truth
- Accurate against the code: three batches per state at job start, job median, one factor reused by every set, per-batch spread check, live-vs-literal hash wording, floor rule, `>=` retry, logging (batch lines, job factor, F^k per metric).
- Spread statistics now reproduce from the six logs: 65 sets (27 fast, 38 slow); fast median 0.344 (per-job 0.324/0.337/0.360), max 0.392; slow median 0.331 (per-job 0.371/0.312/0.275), max 0.433. This closes the earlier "50 sets" error.
- The old overclaim is replaced by an honest bound ("can mask at most F^k, F capped at 1.75; a regression smaller than residual calibration noise can still pass; drift inside the clamp shifts what the budgets mean; R0 rests on three FAST jobs"). The R0 literals are honestly described as editable by anyone with commit access, with the pin making that an explicit reviewable edit.
- Scope remains method-only; collection runs still labelled calibration evidence, not gate evidence; historical results still preserved. Decision-log placement unchanged (newest first).
- Doc nits (NON-BLOCKING): "one factor per job" is really per worker (see residual 3); the decision log still says "Source: Thomas, directly to the conductor", which I cannot verify from the repo.
- Still true: no hosted run exists at c1b9ea3b in calibrated mode; that stays an external evidence item for the merge gate, not for this review.

## Tests run
- `node --test scripts/ci/lib/performance-calibration.test.mjs scripts/ci/lib/performance-budget.test.mjs`: tests 40, pass 40, fail 0.
- `node --test 'scripts/ci/**/*.test.mjs'`: tests 1157, pass 1157, fail 0.
- 18 module mutations on a temp copy: 14 killed, 4 survived (T1). One hand-built workload-edit scenario against the shipped code: throws as required.
- `npx biome check` on the changed bench, module, d.mts and tests: clean.
- Offline recomputation of per-job F from the six hosted logs (above).

## Not checked
- Did not run the Playwright G11 suite or the workload in a browser; calibrated behaviour on a hosted runner is unobserved at this head.
- The Playwright worker-restart behaviour of `beforeAll` is from my knowledge of the framework, not run here.
- The bench file is not type-checked (outside tsconfig).
- Did not re-verify the k table or R0 in this round (unchanged since 48dbb9f6, which I reproduced).
- Did not verify Thomas's decisions; taken from the brief.
- This is an ordinary review only; the Sol-tier security review remains separate.
<!-- END REPORT abba9a8e201e912f3 c1b9ea3b -->

<!-- BEGIN REPORT (agent a4000037f3bddc1d9; model claude-opus-5-5; role Sol-tier security closure review; candidate c1b9ea3b894b51dc7de14c3bb4045160de752798; sha256 1ef30c16219b48a0b247dcdbf7706d402303cfc902d61e8a27364d71da0c98a1) -->
Reviewer model: Claude Opus (claude-opus-5-5)
Reviewer context ID: claude-agent:a4000037f3bddc1d9
**Reviewed head:** c1b9ea3b894b51dc7de14c3bb4045160de752798
Verdict: CLEAR WITH NON-BLOCKING

**Merge conditions.** The verdict covers the code at this head. Merge also needs:

- **(a)** the exact-head ordinary review of c1b9ea3b, which is currently running.
- **(b)** one hosted G11 run in calibrated mode at exactly this head, green. This run **is a precondition for merge**. Reasons are under "B2" below.

This is a closure review by Claude Opus (claude-opus-5-5). It is **not** a GPT-6 Sol review and must not be recorded as one.

- My earlier review was at 48dbb9f6 (`g11-calibration-security-review-opus.md`, BLOCKED).
- The conductor directed the repair. I did not author, direct, or remediate it.
- This review was read-only: no worktree edits, commits, or pushes. Mutations ran on a copy under `$TMPDIR`.
- Worktree: `/private/tmp/claude-501/g11-calibration-602`. I confirmed HEAD with `git rev-parse HEAD`.
- Delta reviewed: `48dbb9f6..c1b9ea3b`, 1 commit, 7 files (+396/-190).
- Full candidate confirmed: `66c736e71c87b2372ba1cbf8250236ac37191565..c1b9ea3b`, 4 commits, 7 files (+1806/-15).

## Closure status

| Finding | Status | Basis |
| --- | --- | --- |
| B1: tautological stale-R0 pin | **CLOSED** | See B1 below; the original surviving mutants are now caught |
| N2: options hash not computed at run time | **CLOSED** | Computed live in `resolveJobCalibration` defaults |
| B2: no exact-head ordinary review or hosted calibrated evidence | **OPEN as process precondition** | Not a code defect; see below |
| N1: calibration noise plus asymmetric retry | **MITIGATED and disclosed** | Job-level factor; overclaim removed |
| N4: LCP floor 0 or ≥ LCP | **CLOSED** | Floor must satisfy 0 < floor < LCP |
| N5: spread-statistic numbers | **CLOSED** | Text now matches my recomputation |
| Retry at exactly budget (`>=`) | **Covered** | New test; mutation `>` is killed |
| Docs truthfulness | **CLOSED** | B1 claim now true; overclaim replaced; residuals stated |

## B1 / N2: literal pins and live hashes

- **Source:** `PERFORMANCE_REFERENCE.sourceSha256` and `optionsSha256` are now literal strings (`performance-calibration.mjs:194-200`): `6b75d3e9…206ce5` and `2f4c9448…1961df`. These are the hashes in force at 2c52f65c, where R0 was collected. I verified that in my first review.
- **Live comparison:**
  - `resolveJobCalibration` now defaults `sourceSha256 = sha256Hex(CALIBRATION_SOURCE)` and `optionsSha256 = calibrationOptionsSha256(CALIBRATION_OPTIONS)`, computed on every call. `referenceFor` compares those values with the literals.
  - `assertCalibrationSourcePinned` now defaults `expected` to the R0 literal.
  - The exported `CALIBRATION_OPTIONS_SHA256` constant was removed.
- **Tests:** `test.mjs:24-28` holds independent literals that are deliberately not imported. New tests at `:420`, `:445` and `:465` cover a workload edit with a refreshed hash, each option edited, and a stale or missing options hash.
- **My original surviving mutants, re-run against the real test file:**

| Mutant | Before (48dbb9f6) | Now |
| --- | --- | --- |
| M10b: rows ×2 in source + `CALIBRATION_SOURCE_SHA256` refreshed | 30/30 pass (SURVIVED) | **26 fail (killed)** |
| M10c: workload halved + hash refreshed | 30/30 pass (SURVIVED) | **26 fail (killed)** |
| M14: option `rows: 560` | not in my original set | 24 fail (killed) |

- **Runtime:** with M10b applied, `resolveJobCalibration` throws ("different calibration workload"), and so does the bench's `assertCalibrationSourcePinned`.
- **Single-layer mutants that survive** (NON-BLOCKING, see NB1). Each one removes only one of several defences:
  - **M15:** the R0 `sourceSha256` literal is replaced by `CALIBRATION_SOURCE_SHA256`.
  - **M16:** the live source hash default is replaced by the constant.
  - **M17:** the live options default is replaced by a literal.
  - **M26:** the `assertCalibrationSourcePinned` default is replaced by the constant.
- **Combined attack** (M15 + workload edit + refreshed constant): the runtime would accept it ("calibrated 1"). However, the unit suite fails it in 10+ tests, because the test file's independent literal no longer matches the edited source (`test.mjs:73`). It is therefore caught in the `ci-scripts` job in ci-fast, not at G11 run time.

## N1: job-level factor

**What changed** (`performance.bench.ts` `beforeAll`; `resolveJobCalibration`; `calibratedMedianOfThreeWithRetry`):

- At job start, the bench runs 3 batches per throttle state. Each batch is the unchanged options `{2 warm-ups, 5 runs, 400×6}` in a fresh context.
- The job median is the median of the 3 batch medians.
- The spread is checked for every batch (maximum of the batch spreads ≤ 0.55).
- The batch count must be exactly 3, or it throws.
- The resulting factor is reused for every set, including the retry. The retry no longer re-draws F, which removes the asymmetric re-roll I identified.

**R0 comparability:**

- R0 is the median of single-batch medians with identical options. The job value is a median of 3 such batch medians, so it is the same statistic in the same units, with less variance.
- The only protocol difference is timing: job start, versus just before each metric.
- From the collection logs, the first calibration of each job read slightly *lower* than later ones on FAST jobs:
  - unthrottled list vs board: 48.0/53.8, 47.4/49.5, 54.8/57.7;
  - throttled first set vs the median of the rest: within ±2%.
- Lower readings give a lower F, which is stricter, not looser. The sample is small, so the first hosted calibrated run should confirm FAST F ≈ 1 (see B2).

**Noise:**

- Within-job per-set noise in the six collection jobs is σ ≈ 3.6% (65 sets; range 0.897–1.099 of the job median).
- Model: a k = 1 metric, 1% sample noise, F as the median of 3 noisy batches, and the retry reusing F. P(pass):
  - true cost at 103% of budget: about 0.11;
  - true cost at 105%: about 0.02;
  - true cost at 108% or more: about 0.
- With the per-set re-draw and retry under that same within-job noise, the figures were 0.33 at 103% and 0.15 at 105%.

**Fail-open check:**

- A missing job calibration throws in the bench, and `calibratedMedianOfThreeWithRetry` also throws if `calibration` is missing or for the other throttle state. Mutant M23 confirms this is tested.
- An exception in `beforeAll` fails every test.
- The calibration-only catch is reachable only when R0 is null; it is pinned at HEAD.
- Wrong batch count and per-batch spread are fail-closed and tested (M19, M20 killed).
- The median-of-batches statistic is tested (M18 and M18b, min and max, both killed).
- I found no new fail-open path.

## N4, retry equality, docs

- **N4.** Location: `performance-calibration.mjs:425-430`. The rule is now `!Number.isFinite(floorMs) || floorMs <= 0 || floorMs >= value` → throw. The `Math.min` clamp is gone.
  - Test `:775` covers 0, -1, equal to LCP, greater than LCP, and ∞. Mutant M21 is killed.
  - In all 27 collection LCP diagnostics, LCP − DCL was between 281 and 432 ms. The new throw is therefore not expected to trigger on current data.
- **Retry equality.** Test `:707` covers both cases: at exactly budget the retry fires, and at 499.99 it does not. Mutant M22 (`>`) is killed. M27 (best set kept) is killed.
- **Docs and decision log.**
  - The R0 bullet in ux-quality-gates.md, ci-cd.md, and the decision log now describe literal pins compared with live hashes. That is true at this head.
  - The new "Bound on what normalisation can mask" paragraph replaces the overclaim. It states three residuals:
    - a regression smaller than the residual calibration noise can pass;
    - drift inside the clamp shifts what the budgets mean;
    - R0 rests on 3 FAST jobs.
  - The decision-log sentence "a real regression is not hidden" is gone.
  - The spread statistics (65 sets; 0.344 and 0.331 medians; 0.392 and 0.433 maxima) match my recomputation.
  - Against the base, the decision-log diff contains only additions. The 2026-10-10 entry was revised in place, but it is new in this unmerged branch, so no merged entry changed.
  - The scope (method plus FAST reference class) and the preserved historical results are unchanged.

## Gate wiring (full 66c736e7..c1b9ea3b)

- No workflow or Playwright config is touched. The changed files are the bench, the calibration module with its d.mts and tests, and three docs.
- No `budget:` value, throttle rate, network profile, row/task count, or test name changed. The only changed `budget` line is the wrapper's pass-through.
- `npx biome check` on the bench, module, and test: clean.

## Tests run

- `node --test scripts/ci/lib/performance-calibration.test.mjs scripts/ci/lib/performance-budget.test.mjs`: **40 tests, 40 pass, 0 fail** (node v26.10.0).
- 18 mutations on a temp copy: 14 killed (M10b, M10c, M14, M18, M18b, M19, M20, M21, M22, M23, M24, M25, M27, M28). The 4 single-layer pin mutants M15, M16, M17, M26 survived (NB1).
- One combined mutation (M15 + workload edit + refreshed constant): the unit tests kill it; the runtime accepts it.
- Offline analysis of the six collection job logs: LCP − DCL gaps, first-of-job versus later calibration readings, and the within-job noise model.

## NON-BLOCKING

- **NB1. The fix's own layers are not individually locked by tests.**
  - M15, M16, M17 and M26 each survive alone.
  - Reverting the R0 literal to the constant (M15) and then editing the workload is caught only by the unit-test literal in `ci-scripts`, not at G11 run time.
  - Suggested follow-up: a test that reads the module text and asserts that `PERFORMANCE_REFERENCE` contains the hex literals. Alternatively, call `resolveJobCalibration` and `assertCalibrationSourcePinned` with an edited source and only the *exported constant* refreshed, through the default parameters.
  - This is defence in depth, and `ci-scripts` is a required pre-merge job.
- **NB2. The factor is "one per job" only while the worker lives.**
  - Playwright replaces the worker after a failed test, and `beforeAll` then re-runs. Tests after a failure get a freshly measured factor, and its batches are logged.
  - This is not a fail-open: a failing test is never re-judged, and `retries: 0`.
  - The docs' "one factor per job" is slightly inaccurate. It should say "per worker; a new worker after a failure recalibrates".
- **NB3. N3 (k sample noise) and N7 (runner-class drift inside the clamp) remain.** They are now disclosed in the docs.
- **NB4. The new LCP throw makes the gate fail when LCP ≤ DCL.** That is fail-closed and not seen in the data. If a future change paints LCP before DCL, G11 will fail and need a deliberate method decision.

## B2: preconditions

- **Ordinary review:**
  - A Sonnet delta review at 48dbb9f6 exists (per the conductor). That head is superseded.
  - The exact-head ordinary review of **c1b9ea3b** is running and must be CLEAR at this exact SHA.
- **A hosted calibrated G11 run at exact head c1b9ea3b is a precondition for merge.** I am clearing the code; a green run is not something I can verify yet. The reasons:
  - The calibrated oracle has never executed on a hosted runner.
  - The new job-start protocol (3 batches, then reuse) has not been checked against R0 on real hardware.
  - G11 is a required acceptance gate and must be green at the exact candidate SHA in any case.
- What the run's log should show:
  - per-state job factors in the expected band, ≈ 0.9–1.12 on FAST and ≈ 1.3–1.5 on SLOW;
  - every batch spread ≤ 0.55;
  - no LCP-floor throw;
  - each metric printed raw and normalised.
- If that run fails closed (factor, spread, or floor), it is a blocking result to diagnose. It is not grounds for a waiver or a rerun-until-green.
- A green run on one runner class shows the oracle works. It does not by itself re-validate R0. Record which class the runner was, using the logged CPU model and unthrottled median.

## Residual risk

- A regression smaller than the residual calibration noise can pass: below about 3–5% over budget on a k = 1 metric, with low probability.
- The k estimates are noisy for the interaction metrics.
- Drift inside [0.75, 1.75] re-anchors what the budgets mean.
- R0 rests on 3 FAST jobs.

All four are disclosed in the docs and visible in the logs.

## Not checked

- No local Playwright or browser run. No hosted calibrated run exists yet.
- I did not type-check the bench; no tsconfig includes `e2e/`.
- I did not re-derive the LCP post-DCL k.
- I did not read the Sonnet delta reviews; I relied on the conductor's statement of their existence and status.
- I could not verify Thomas's decisions from the repository; I took them from the brief.
<!-- END REPORT a4000037f3bddc1d9 c1b9ea3b -->
