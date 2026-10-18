# #765 regression-conservation test review record

**Reviewed head:** `2ab0c94f7673b9327fe140f379f73838abdd5ea4`
**Accepted base:** `2cd47571e4a9d39c437bbe23c61a3a4911720fdc`
**Source tree:** `3b36f91ea3fc276e014d0e671aca744db66d3983`
**Source parents:** `b5ad07488edef862406f146ddcbaffa7be95ba01` and `2cd47571e4a9d39c437bbe23c61a3a4911720fdc`
**Scope:** `tests/api-integration/leaf-module-repositories.test.ts` only relative to accepted main. This record publishes evidence; it does not change product code or test source.

## Review and test history

The initial `fa15d1d8b468ea3211e45cdf28e67840e0faee0b` attempt used a direct helper that was not an exported API. Its historical run failed 1 of 7 tests; that failure is preserved below. At `058ff60be959b4f6e8e832bba65554a8087cc3ef`, the test used the real portal submission path and passed the complete seven-test file, but fresh reviewer A found a P2 gap: requester, workspace, project, and catalogue organization IDs coincided, so the test did not distinguish which organization supplied the default. That review was BLOCK and remains preserved as historical evidence.

At `b5ad07488edef862406f146ddcbaffa7be95ba01` (tree `784b5bbebc700f52a64a1ddf89b4508f9da3ce90`), the test added a second customer organization, explicitly mapped the request type to that organization, set opposite customer-visibility defaults for requester and seeded project/customer organizations, submitted through the real portal endpoint, and asserted persisted requester organization, requester person, and visibility. Two fresh independent ordinary review contexts returned CLEAR/PASS. The root-run complete-file integration test passed 1 file / 7 tests at `b5ad` (native exit 0, 6.799 seconds).

Current source `2ab0c94f7673b9327fe140f379f73838abdd5ea4` cleanly composes the reviewed `b5ad` source with accepted main. Its accepted-base diff still changes only the test file; the test blob, API subtree, and all 29 recorded runtime pins are unchanged. The two reviewers supplied exact-head delta confirmations at `2ab0`; these are not additional independent reviews, and the local 7/7 run was not repeated at `2ab0`. The source-conservation receipt records the input equivalence and requires final hosted checks on the publication head.

This is a test-regression review record, not an acceptance declaration for PR #765, issue #580, or the wider product. Every applicable current-publication-head hosted check and normal review/protection condition remains required. No gate is waived.

## Review tier and provenance

The changed source path is an API integration test outside the documented CI/security-scope path list. It changes no authority, permission implementation, CI control, or gate pass/fail semantics. The ordinary tier is two fresh independent GPT-6 Luna contexts at `b5ad`, followed by their limited exact-head confirmations at `2ab0`. Reports self-describe GPT-6 contexts assigned the Luna role; native metadata records configured model/effort and does not attest served weights. Configured reviewer sessions are recorded in the provenance payload. The current-head confirmations do not enlarge the independent-review count.

GPT-6 Luna prepared the test implementation. Root applied and formatted it, shortened one comment, and prepared publication; root is a material fixer and is not an independent reviewer. No GPT-6 Sol security review is required for this test-only path scope; none is claimed. No UI changed; no product-screen or browser journey is claimed.

## Evidence payloads

Each fenced payload below is copied byte-for-byte from its named private evidence file. The private manifest records exact hashes and byte lengths.

### Historical 058 ordinary review (BLOCK)

Source: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-18/query765-058-ordinary-a-luna/report.md`

````text
# Ordinary test review A — #765 regression conservation

- **Reviewer context:** GPT-6 context, assigned the Luna-tier ordinary-review role. This runtime did not expose a finer model variant/build fingerprint; no model-weight attestation is claimed.
- **Independence:** I did not author, fix, or direct this candidate. The assigned author/fixer and root’s formatting work are separate contexts.
- **Exact source:** `058ff60be959b4f6e8e832bba65554a8087cc3ef`, tree `bd152d48f991f58b7f02598ef59cb7133e13571d`.
- **Base:** accepted main `01516b2e366c88356f8fe81158b5022a62d3e70c`.
- **History:** normal commits `fa15d1d8b468ea3211e45cdf28e67840e0faee0b` then `058ff60be959b4f6e8e832bba65554a8087cc3ef`; the failed first-run evidence is retained.
- **Branch/worktree:** `codex/query765-regression-conservation-20261018`, `/Users/heinthura/.codex/worktrees/query765-current-luna`; clean and unpushed at review.
- **Scope:** complete base-to-head diff in `tests/api-integration/leaf-module-repositories.test.ts`; fixture/source/spec comparison; read-only inspection of exact-head run and conservation receipts. No production code changed.
- **Verdict:** **BLOCK** — one P2 blocking test-coverage finding. No production-code correctness finding is made.

## Finding

**P2 — The intake-default test does not deterministically distinguish the requester’s organization lookup from another organization source.** At `tests/api-integration/leaf-module-repositories.test.ts:214-229`, the test changes the default on `seeded.customer.orgId` and submits only as that same customer. `seedIntake` creates the request type and customer in one tenant; the helper also aligns that tenant’s workspace and project organization with the customer organization (`tests/api-integration/helpers/intake-http.ts:35-57, 89-92`; `tests/api-integration/helpers/approval-fixtures.ts:406-427`). Thus the tested requester, workspace, project and catalogue organization IDs coincide. The test verifies that both enum values can be read and persisted through the real portal route, but it does not provide a deterministic differing-organization oracle for a lookup that uses a different organization source or an unscoped/ambiguous row. The source contract is explicitly per-organisation (`docs/03-features/customer-portal.md`, CP-16; `docs/01-architecture/data-model.md:129`), and the current implementation reads `identity.organisationId` at `apps/api/src/intake/repository.ts:805-820`. The earlier `fa15` direct-helper test had two organizations with different defaults, but its helper was not an exported API and the recorded run failed. The replacement correctly goes through `submitAs`, yet the changed fixture no longer establishes that cross-organization distinction. This leaves the intended organization-selection regression insufficiently guarded.

## What I checked

1. Verified exact source, tree, ancestry and worktree state with `git status --short --branch`, `git rev-parse`, `git show -s`, and `git diff-tree`. From accepted main through both commits, the only changed path is `tests/api-integration/leaf-module-repositories.test.ts`; there are no product or CI/security-control edits.
2. Read the applicable repository operating guides (`AGENTS.md`, active mission, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, and `docs/04-engineering/ci-cd.md`), plus the intake and customer-portal contracts and the relevant decision-log entry. The changed path is outside the documented security-review path list and does not change authority or gate pass/fail semantics, so this is an ordinary test review.
3. Read the full diff and current test file. The accepted-main file has five `it` declarations; all five remain in the final source. The final file has seven declarations. Two cases were added (intake visibility and WebSocket reach), and the existing positive comment/link case was strengthened. The default `seedTask` arguments preserve its prior single-task fixture behavior. Other baseline test bodies are unchanged.
4. Compared the tests with their repository queries. The comment fixture covers chronological ordering, task binding, author/name/content shape, non-comment activity, null author/content, and sibling-task exclusion; the post-revocation assertions remain. The link fixture checks the requested task and excludes a sibling task. The WebSocket fixture exercises a reachable live item/project plus archived, deleted, unreached and missing cases against `findLiveWorkItemSocketScope` and `findReachableLiveProject`. Those new assertions align with the inspected SQL predicates in `apps/api/src/comment/repository.ts`, `apps/api/src/external-link/repository.ts`, and `apps/api/src/ws/repository.ts`; I found no material fixture or false-positive issue in those cases.
5. Confirmed the intake test calls `submitAs`, which posts through `/api/portal/submissions`, omits `customerVisibility` so it exercises the default branch, and reads the persisted submission row. The seeded type is published/customer-visible and does not set `forcePrivate`; request-type defaults therefore leave the organization default branch available. `findOrganisationDefaultCustomerVisibility` does not exist as an exported current API; the accepted-main query is inline inside `createSubmission`’s transaction.
6. Inspected root’s pinned test evidence without rerunning it: `query765-regression-conservation-root/intake-default-repair/run-output/root-verified-result.json` binds to this exact source and reports one complete file, seven passes, native exit 0, 6.892 seconds, clean source pre/postflight, conserved Docker inventory, and owned cleanup. The 1,800-byte raw Vitest log SHA-256 is `baa315db6fb307572c6135bc748b184d49f8a630703c2bc0b488c4677cc3a675`. The raw log retains existing Vite config warnings and a `realtime.failure` fixture log; this review makes no realtime journey claim. The earlier `fa15` six-of-seven failure receipt remains separate and source-bound.
7. Read-only GitHub state for PR #765 remains OPEN at different head `d0f481402987fb0eeec010fb79fab11a0905b2df`; this review applies only to the specified unpushed source SHA.

## Commands and limits

Read-only commands included `git status`, `git rev-parse`, `git show`, `git log`, `git diff`, `git diff-tree`, `git show <revision>:<path>`, `git grep`, `rg`, `sed`, `nl`, `wc`, `gh pr view`, and standard-library JSON/hash inspection of pinned E18 receipts. I did not run tests, builds, compilers, browsers, or application/runtime commands; did not inspect secrets, environment or launch-file contents; and did not modify the candidate or direct its implementation. I did not claim whole #580 or #765 acceptance.
````

### Historical 058 root test receipt

Source: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-18/query765-regression-conservation-root/intake-default-repair/run-output/root-verified-result.json`

````text
{
  "at": "2026-10-18T14:06:26.925896+00:00",
  "source": "058ff60be959b4f6e8e832bba65554a8087cc3ef",
  "nativeExit": 0,
  "completeFiles": 1,
  "passedTests": 7,
  "vitestSeconds": 6.892,
  "rawBytes": 1800,
  "rawSha256": "baa315db6fb307572c6135bc748b184d49f8a630703c2bc0b488c4677cc3a675",
  "sourceConserved": true,
  "dockerInventoryConserved": true,
  "ownedCleanup": true,
  "testEnvRemovedWithoutReading": true,
  "wholeIntegrationSuite": false
}
````

### b5ad fresh ordinary review A (CLEAR)

Source: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-18/query765-b5ad-ordinary-a-luna/report.md`

````text
# Ordinary test review A — #765 requester-organization oracle

- **Reviewer context:** GPT-6 context assigned the Luna-tier ordinary-review role. This runtime does not expose a finer model variant or build fingerprint; no model-weight attestation is claimed.
- **Independence:** I did not author, fix, direct, or remediate this candidate. This is a fresh review of the exact updated head; root supplied the candidate and run evidence.
- **Exact source:** `b5ad07488edef862406f146ddcbaffa7be95ba01`, tree `784b5bbebc700f52a64a1ddf89b4508f9da3ce90`.
- **Base:** accepted main `01516b2e366c88356f8fe81158b5022a62d3e70c`.
- **Delta/history:** parent `058ff60be959b4f6e8e832bba65554a8087cc3ef`; the full base-to-head change remains limited to `tests/api-integration/leaf-module-repositories.test.ts`. The 058-to-b5ad repair adds a separate requester tenant/customer, an explicit catalogue association for the seeded request type, opposite requester/project organization defaults, and persisted requester identity assertions.
- **Branch/worktree:** `codex/query765-regression-conservation-20261018`, `/Users/heinthura/.codex/worktrees/query765-current-luna`; clean and unpushed at review.
- **Verdict:** **CLEAR** — the earlier P2 test-oracle gap is closed. No remaining material finding in the reviewed test change.

## Review

The added fixture now creates the submitting customer through `buildTenant`/`addCustomer`, so its customer organization is distinct from the organization associated with the seeded project. The test asserts that distinctness, then inserts the `organisation_request_type` row for that requester organization. That satisfies the catalogue contract and permits a real submission under the second customer identity without relying on an invalid or invisible request type.

Each iteration sets requester and project/customer organization defaults to opposite values, then calls `submitAs` with the second customer. The helper posts to `/api/portal/submissions` and does not supply `customerVisibility`, so the route must use its default branch. The test reads the persisted row and checks `organisationId`, `requesterId`, and `customerVisibility`. The two opposite combinations distinguish the requester-organization lookup from a project/seeded-customer organization lookup in either direction; the recorded requester identity also confirms the intended portal principal was used.

I traced the fixture and assertion path against `tests/api-integration/helpers/intake-http.ts` and `tests/api-integration/helpers/approval-fixtures.ts`. The helper creates a customer-side person and an organization membership for that tenant’s customer organization. The second catalogue mapping is scoped to that same organization. In `apps/api/src/intake/repository.ts`, `portalIdentity` resolves the active customer person from the authenticated user; `portalCatalogue` and the transactional request-type recheck filter by `identity.organisationId`; and `createSubmission` reads the default for that same identity organization before inserting its organization, requester, and visibility. The submitted type is published and customer-visible, is explicitly mapped to both customer organizations, and the fixture leaves `forcePrivate` unset. The test therefore exercises the specified default behavior through the real API while respecting RT-7/RT-8 catalogue rules and CP-16’s per-organization visibility rule.

The two new opposite-value combinations are sufficient to detect either a constant project-organization source or an incorrect selection between these two organizations. The old six integration cases remain in the final file; this repair changes only the intake-default case and import. The full base-to-head change remains within that single test file, so no product implementation, authorization, API contract, permission, CI, or gate-semantic change is implicated.

## Evidence and scope

I verified exact `HEAD`, tree, parent, changed-path list, clean status, and the 058-to-b5ad diff with read-only Git commands. I read the changed test in full, the fixture helpers, the portal identity/catalogue/submission implementation, the request-type catalogue and customer-portal specifications, and the earlier blocked review to confirm the specific deficiency was addressed. `git diff --check` returned no output.

I inspected root’s pinned exact-head run receipt at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-18/query765-regression-conservation-root/org-oracle-repair/run-output/root-verified-result.json`. It binds to this source SHA and tree and reports one complete file, 7/7 tests passing, native exit 0, and 6.799 seconds. The receipt records a 2,297-byte raw log with SHA-256 `4e8706dfac65adc52606d2a29cfb58f21177afc799bbb2b07724e92a65ec40c0`, unchanged source, conserved Docker inventory, owned-container cleanup, and private-environment removal without reading. These are root-run observations; I did not rerun tests or independently reproduce those runtime results. Existing config warnings and the `realtime.failure` fixture log are retained; this is not a realtime-journey claim.

This review does not claim whole #765 or #580 acceptance, and it does not attest any later docs-only composition. Any later source-head change requires exact-head delta review.

## Limits

I performed read-only source, Git, and pinned evidence inspection. I did not run tests, builds, compilers, Docker, browsers, or application/runtime commands; did not mutate Git/GitHub state; did not inspect secrets, environment values, or launch-file contents; and did not author or direct implementation. Commands included `git status`, `git rev-parse`, `git diff`, `git diff --check`, `rg`, `sed`, and standard-library JSON/file inspection of the pinned receipt.
````

### b5ad fresh ordinary review B (PASS)

Source: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-18/query765-b5ad-ordinary-b-luna/report.md`

````text
# Ordinary test review B — #765 regression conservation repair

- **Reviewer context:** GPT-6 context assigned the Luna-tier ordinary-review role. This runtime did not expose a finer model variant/build fingerprint; no model-weight attestation is claimed.
- **Independence:** Fresh reviewer context; I did not author, fix, or direct this candidate, and did not participate in reviewer A's report.
- **Exact source:** `b5ad07488edef862406f146ddcbaffa7be95ba01`, tree `784b5bbebc700f52a64a1ddf89b4508f9da3ce90`.
- **Comparison base:** accepted `main`, `01516b2e366c88356f8fe81158b5022a62d3e70c`.
- **Scope:** complete base-to-head diff, limited to `tests/api-integration/leaf-module-repositories.test.ts`; checked the repaired intake oracle against its API, fixtures, and CP-16 / RT-7 / RT-8 contracts, and inspected the pinned exact-head run receipt. No production source changed.
- **Verdict:** **PASS** — no blocking or non-blocking findings in the assigned scope.

## Review notes

The repair addresses reviewer A's organization-selection gap. `seedIntake` makes the seeded customer's organization the default project organization and assigns the request type to that organization. The test creates a second tenant and customer, asserts their organization IDs differ, and explicitly assigns that same request type to the second organization. This satisfies the catalogue's per-organization mapping required by RT-7/RT-8, so the real portal `POST /api/portal/submissions` is eligible for the requester without bypassing catalogue checks. `submitAs` omits `customerVisibility`, and the persisted row is checked for the requester's organization and person.

Each loop iteration sets opposite `defaultCustomerVisibility` values on the requester's organization and the seeded customer's/project organization's organization. It then checks the stored visibility equals the requester's value. This is a deterministic oracle for CP-16: a lookup using the project/customer organization returns the opposite value and fails. The inspected implementation derives `identity.organisationId` from the customer person, selects that organization's default, and writes the same identity organization and person into the submission. The seeded request type is customer-visible and does not force privacy. I found no catalogue or fixture ambiguity that weakens this oracle.

All five tests present at the accepted base remain, and the two added tests remain, for seven final cases. Relative to the immediate `058ff60be959b4f6e8e832bba65554a8087cc3ef` parent, the six non-intake test bodies are unchanged; only the intake test body is repaired. The shared `seedTask` helper gains an optional number used to create a sibling task while preserving its original default number and position for existing callers. No test is focused, skipped, or todo in the reviewed file.

The other assertions exercise the repository queries meaningfully. The comment fixture distinguishes chronological comment bodies on the requested task from a sibling-task comment, non-comment activity, null-author rows, and null-content rows, then confirms reads stop after persisted project reach is revoked. Its positive result also checks task, author ID/name, and content. The external-link query is given one link for the selected task and one for a sibling task; only the selected task's ID is expected, and both reads go empty after revocation. The socket case has a reachable live project/item as a positive control and separately checks archived/deleted items, archived/deleted projects, an unreached project, and a missing key against `findReachableLiveProject` and `findLiveWorkItemSocketScope`. I found no apparent false-positive path in those fixtures. The remaining linked-item, custom-provider-token, column, and workflow-rule cases remain present.

## Evidence and limits

- Read repository instructions: `AGENTS.md`, `docs/07-planning/active-mission.md`, `docs/04-engineering/agent-workflow.md`, and `CLAUDE.md`.
- Read the full accepted-base-to-head diff, the immediate-parent repair diff, intake fixtures and repository query, CP-16 and RT-7/RT-8 specs, WebSocket/comment/link repository queries, and reviewer A's report at `query765-058-ordinary-a-luna/report.md`.
- Read-only Git commands used: `pwd`, `git status --short --branch`, `git rev-parse`, `git show -s`, `git log`, `git diff --stat`, `git diff --name-status`, `git diff --no-ext-diff --unified`, `git diff --check`, and `git show <revision>:<path>`. Also used `sed`, `rg`, and `find` to inspect source and the pinned evidence files.
- The root-owned exact-head receipt at `query765-regression-conservation-root/org-oracle-repair/run-output/root-verified-result.json` reports one complete file, 7/7 tests, native exit 0, source unchanged, Docker inventory conserved, and owned container removed. Its raw Vitest log is 2,297 bytes with SHA-256 `4e8706dfac65adc52606d2a29cfb58f21177afc799bbb2b07724e92a65ec40c0`. I inspected this receipt and did not run tests.
- No builds, compilers, browser sessions, Docker commands, Git mutations, or GitHub writes were performed. This verdict covers this exact tree and file-level regression review only; it does not establish PR #765 or issue #580 acceptance.
````

### b5ad root complete-file test receipt

Source: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-18/query765-regression-conservation-root/org-oracle-repair/run-output/root-verified-result.json`

````text
{
  "at": "2026-10-18T14:20:52.882656+00:00",
  "source": "b5ad07488edef862406f146ddcbaffa7be95ba01",
  "tree": "784b5bbebc700f52a64a1ddf89b4508f9da3ce90",
  "completeFileCount": 1,
  "runtimeTestsPassed": 7,
  "runtimeTestsTotal": 7,
  "nativeExit": 0,
  "durationSeconds": 6.799,
  "sourceUnchanged": true,
  "dockerInventoryConserved": true,
  "ownedContainerRemoved": true,
  "privateEnvironmentRemovedWithoutRead": true,
  "rawLog": {
    "bytes": 2297,
    "sha256": "4e8706dfac65adc52606d2a29cfb58f21177afc799bbb2b07724e92a65ec40c0"
  },
  "limits": "Existing config warnings/realtime.failure fixture logs retained; no new real-time journey or whole580 acceptance claim."
}
````

### 2ab0 exact-head delta confirmation A

Source: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-18/query765-2ab0-ordinary-a-luna/report.md`

````text
# Exact-head delta confirmation — #765 ordinary review A

- **Reviewer context:** GPT-6 context assigned the Luna-tier ordinary-review role. This runtime does not expose a finer model variant or build fingerprint; no model-weight attestation is claimed.
- **Independence:** I did not author, direct, or remediate either the test candidate or the documentation composition. I previously reviewed the unchanged test source at `b5ad07488edef862406f146ddcbaffa7be95ba01` and found it CLEAR.
- **Current exact source:** `2ab0c94f7673b9327fe140f379f73838abdd5ea4`, tree `3b36f91ea3fc276e014d0e671aca744db66d3983`.
- **Parents:** first parent `b5ad07488edef862406f146ddcbaffa7be95ba01`; accepted main second parent `2cd47571e4a9d39c437bbe23c61a3a4911720fdc`.
- **Worktree:** `/Users/heinthura/.codex/worktrees/query765-current-luna`, branch `codex/query765-regression-conservation-20261018`; clean at inspection.
- **Verdict:** **CLEAR remains valid** for the ordinary test review at the current exact source. The composition adds only dated planning/review records; it does not alter or contradict the reviewed test or its behavior.

## Delta and policy check

Read-only Git inspection confirms the first-parent delta from the previously reviewed `b5ad` head is exactly three documentation paths: `docs/07-planning/integration-execution-queue.md`, `docs/07-planning/status.md`, and the new `docs/07-planning/security-reviews/records-after810-20261018.md`. The merge’s second parent is the accepted `852` main commit named above. Relative to that accepted base, the only changed path remains `tests/api-integration/leaf-module-repositories.test.ts`. The test file has no delta from the reviewed `b5ad` source, and `git diff --check` is clean.

I read all three documentation deltas. They record a 13:59 UTC checkpoint and explicitly preserve the then-current #765 `fa15` 6/7 failure as historical evidence; they say #765 remains open and make no acceptance claim. The new review record distinguishes the historical checkpoint from subsequent work, limits its conclusion to the records review, and says the documentation-only diff does not require a Sol review. That statement does not change review tiers, merge authority, evidence reuse, gate semantics, or any security requirement. The changed documentation paths are outside the authoritative security-scope path list in `docs/04-engineering/ci-cd.md`. I found no policy contradiction with the CLEAR test verdict or the repository’s exact-head review rules.

I inspected `/Users/heinthura/.codex/taskdesk-evidence/2026-10-18/query765-b5ad-composition-root/source-conservation.json`. It binds to the current source/tree/parents, reports the one test path from accepted base and the three documentation paths since the reviewed head, and records all 29 runtime pins and the API subtree unchanged, with a clean worktree. This is root-provided conservation evidence, not an independently recomputed runtime-input proof. Because no test/API/runtime inputs changed, the previous test-run receipt remains applicable to those inputs; the run itself is still the root’s 7/7 exact-`b5ad` observation, not a run executed or repeated by me. Exact-head required hosted checks must still be observed on publication.

## Scope and limits

I verified `HEAD`, tree, both parents, current clean status, name/status diff from both parents, the test-file equality to `b5ad`, and whitespace checks. I inspected the three documentation diffs and the pinned source-conservation JSON, plus the relevant security-scope/review-policy passages in `docs/04-engineering/ci-cd.md` and `docs/04-engineering/agent-workflow.md`. Commands included `git status`, `git rev-parse`, `git diff`, `git diff --name-status`, `git diff --check`, `rg`, `sed`, and standard-library JSON inspection.

I did not rerun tests or execute builds, compilers, Docker, browsers, application/runtime commands, or GitHub writes; I did not mutate Git state, inspect secrets/environment values/launch files, or redo the unchanged product-test review. This is an exact-head delta confirmation only. It does not claim whole #765 or #580 acceptance, and any later source change needs its own exact-head delta check.
````

### 2ab0 exact-head delta confirmation B

Source: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-18/query765-2ab0-ordinary-b-luna/report.md`

````text
# Exact-head delta confirmation — #765 regression conservation

- **Reviewer context:** Same GPT-6 context assigned the Luna-tier ordinary-review role as report `query765-b5ad-ordinary-b-luna/report.md`; this is an exact-delta confirmation, not a fresh independent full review. Runtime did not expose a finer model variant/build fingerprint; no model-weight attestation is claimed.
- **Independence:** I did not author, fix, or direct the candidate. This confirmation does not count as another independent reviewer context.
- **Exact source:** `2ab0c94f7673b9327fe140f379f73838abdd5ea4`, tree `3b36f91ea3fc276e014d0e671aca744db66d3983`.
- **Merge parents:** reviewed source `b5ad07488edef862406f146ddcbaffa7be95ba01` and accepted-main composition `2cd47571e4a9d39c437bbe23c61a3a4911720fdc`.
- **Accepted comparison base:** `2cd47571e4a9d39c437bbe23c61a3a4911720fdc` (merge #852).
- **Verdict:** **PASS — prior ordinary-review PASS remains valid at this exact source.** No conflicting policy or gate change was introduced by the composition.

## Delta checked

The current merge commit has the stated source/tree and parents, and the worktree is clean. Relative to accepted main, the merge tree changes only `tests/api-integration/leaf-module-repositories.test.ts`. Its blob ID is `8f6ce140b9901422e26c7a0af619ba8aa19dd884` both at reviewed `b5ad07488edef862406f146ddcbaffa7be95ba01` and current `2ab0c94f7673b9327fe140f379f73838abdd5ea4`. The `apps/api` subtree ID is `fba734c116d46fe2308bb2481da1a50b1e484e39` both at accepted base and current source. The inspected evidence receipt at `query765-b5ad-composition-root/source-conservation.json` additionally records all 29 runtime pins unchanged, API subtree unchanged, clean source, and prior 7/7 file-test evidence retained by input equivalence.

The three documentation paths in the b5ad-to-merge comparison (`integration-execution-queue.md`, `status.md`, and `security-reviews/records-after810-20261018.md`) are inherited from the accepted-main parent; none is in the accepted-base-to-current candidate diff. No permanent policy, workflow, CI gate, production, or API source path changed in this composition. The accepted-base-to-current diff passes `git diff --check`.

Because the exact reviewed test blob and runtime source inputs are unchanged, the prior review findings and PASS remain applicable without repeating the full review. This does not establish PR #765 or issue #580 acceptance, and does not replace GitHub checks on the published exact head.

## Read-only checks and limits

Commands used: `pwd`, `git status --short --branch`, `git show -s`, `git diff --stat`, `git diff --name-status`, `git rev-parse <revision>:<path>`, `git diff --quiet`, `git diff --check`, and read-only `cat` of the source-conservation receipt. No tests, builds, compilers, browsers, Docker commands, Git mutations, or GitHub writes were performed.
````

### 2ab0 source-conservation receipt

Source: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-18/query765-b5ad-composition-root/source-conservation.json`

````text
{
  "source": "2ab0c94f7673b9327fe140f379f73838abdd5ea4",
  "tree": "3b36f91ea3fc276e014d0e671aca744db66d3983",
  "parents": [
    "b5ad07488edef862406f146ddcbaffa7be95ba01",
    "2cd47571e4a9d39c437bbe23c61a3a4911720fdc"
  ],
  "acceptedBase": "2cd47571e4a9d39c437bbe23c61a3a4911720fdc",
  "changedFromBase": [
    "tests/api-integration/leaf-module-repositories.test.ts"
  ],
  "deltaFromReviewed": [
    "docs/07-planning/integration-execution-queue.md",
    "docs/07-planning/security-reviews/records-after810-20261018.md",
    "docs/07-planning/status.md"
  ],
  "all29RuntimePinsUnchanged": true,
  "apiSubtreeUnchanged": true,
  "clean": true,
  "priorRunSource": "b5ad07488edef862406f146ddcbaffa7be95ba01",
  "priorCompleteFileTests": 7,
  "limits": "Prior runtime retained by explicit input equivalence; hosted checks must run on final publication.",
  "priorMergeAttempt": "Commit-msg hook rejected merge: type; no bypass; normal chore: commit completed same merge."
}
````

### Configured native review-context provenance

Source: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-18/query765-b5ad-composition-root/native-review-provenance.json`

````text
{
  "at": "2026-10-18T14:27:04.498149+00:00",
  "candidate": "2ab0c94f7673b9327fe140f379f73838abdd5ea4",
  "rootMaterialFixer": "01a14000-d9e0-7bb1-b3fd-2c0204a4834c",
  "reviewers": [
    {
      "agent": "/root/records_bba6_ordinary_a_luna",
      "session": "01a14f52-e155-7721-9278-ba1f8bd62052",
      "nativeSession": {
        "id": "01a14f52-e155-7721-9278-ba1f8bd62052",
        "timestamp": "2026-10-18T14:03:14.156Z"
      },
      "latestTurn": {
        "timestamp": "2026-10-18T14:25:40.066Z",
        "model": "gpt-6-luna",
        "effort": "high"
      },
      "configuredModel": "gpt-6-luna",
      "configuredEffort": "high"
    },
    {
      "agent": "/root/query765_b5ad_ordinary_b_luna",
      "session": "01a14f62-c96f-7c93-8f30-31b070023eb8",
      "nativeSession": {
        "id": "01a14f62-c96f-7c93-8f30-31b070023eb8",
        "timestamp": "2026-10-18T14:20:36.623Z"
      },
      "latestTurn": {
        "timestamp": "2026-10-18T14:26:25.523Z",
        "model": "gpt-6-luna",
        "effort": "high"
      },
      "configuredModel": "gpt-6-luna",
      "configuredEffort": "high"
    }
  ],
  "servedWeightsNotAttested": true,
  "method": "Exact agent_path SQLite records plus filtered session_meta identity and turn_context model/effort only; no raw transcripts published."
}
````

