# PR #705 security review record: bind customer-serving projects to an organisation at creation

PR #705 implements issue #701, under the decision-log entry "Bind customer-serving projects at creation" (originally 2026-10-04).

What it changes:
- `POST /api/project` accepts an optional `organisationId`. The organisation is validated in the creating transaction while its row is locked `FOR SHARE`: it must exist, be active, be a customer organisation and not be deleted, and the workspace must belong to the internal organisation. Every failure returns one uniform 422.
- A new `GET /api/project/organisations` lists active customer organisations.
- Both the list and binding paths require the strict `project:create` capability. So does a new `bindProjectOrganisation` flag in `/api/capabilities`.
- The create-project modal shows a customer-organisation selector only to callers who hold that flag.
- General updates cannot rebind a project.

It is security-scope because it adds new API surface, permission-matrix entries and a capability flag.

A Claude Sonnet 5.5 lane implemented it, including the merge commit `1cc5b1c2`. The reviewers below are fresh, independent contexts that did not author, direct or remediate the change.

## Review chain

- Ordinary review A by Claude Sonnet 5.5 (API and tests): APPROVE at `a6856607`.
- Ordinary review B by Claude Sonnet 5.5 (web, i18n, `pairs.json`, docs, #513 absorption): APPROVE at `a6856607`.
- Security review by Claude Opus 5.5: BLOCK at `a6856607`. The new list route used the legacy permission gate, so an ordinary member could list every customer organisation and bind projects to them, contrary to the matrix and the docs.
- Security rebind by the same Opus context: CLEAR at `1cc5b1c2`. The strict `project:create` capability now gates the list and binding paths, and member, lead, viewer and API-key probes are all refused. The race test is deterministic. The reviewer found one user-visible regression: members saw a permanent error in the modal.
- Ordinary delta review by the reviewer-A context: APPROVE at `1cc5b1c2`. The hand-made changes were isolated against `git merge-tree`, and gate and lock mutations make the tests fail.
- Security rebind by the same Opus context: CLEAR at `613f04a3`. The new `bindProjectOrganisation` flag is computed strictly and leaks no organisation data, and the `pairs.json` edit only relocates occurrences.
- Ordinary delta review by the reviewer-A context: APPROVE at `613f04a3`. Mutations of the modal condition, the query enablement and the server flag each make a test fail.
- Security rebind by the same Opus context: CLEAR at `0db35191`. That commit merges `main` `53344c8f` (#696). Non-conflict files equal git's own merge, `pairs.json` is the exact union, and the capabilities response keeps `manageServiceCalendars` and `bindProjectOrganisation`.
- Security rebind by the same Opus context: CLEAR at `2eee045c`. That commit is a clean merge of `main` `ee499594` (#707, e2e only); its tree equals `git merge-tree`, and no product or contract file changed.
- Light security rebind by the same Opus context: CLEAR at `1d6bca6f`. A test-only commit derives the all-false capability-map check from the schema. Mutations (a true flag, a stray key) each fail 3 of 13.

**Reviewed head:** `a685660742d3418fa3c25d4f0228be3eabd05de4`
**Reviewed head:** `1cc5b1c2be7a1d3b6c671d2d62a68ab8e7b699c8`
**Reviewed head:** `613f04a3acc3c78d4ed6de29a2291a8a2c9643a5`
**Reviewed head:** `0db351910f3fe1c14ae7ad54b533400217ea4032`
**Reviewed head:** `2eee045c99203f73b4309fddee69db029d8236a3`
**Reviewed head:** `1d6bca6f4ad47cee567fa8522645b434bf855d76`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `705-ordinary-a-sonnet.md` | Ordinary review A (af663a0c..a6856607) | Claude Sonnet 5.5 | `a6856607` | APPROVE | `48c4ba6705fc9fdd895ba22d61bd769991057390f15694080b212c720ee500b3` |
| 2 | `705-ordinary-b-sonnet.md` | Ordinary review B (af663a0c..a6856607) | Claude Sonnet 5.5 | `a6856607` | APPROVE | `b05bb4d94ec024db679b0318f5b7a275390903f1d193a89161e4dfcc9f3665ce` |
| 3 | `705-security-opus.md` | Security review (af663a0c..a6856607) | Claude Opus 5.5 | `a6856607` | BLOCK | `3ab6c4866f1753c482f13e2ca78abdf5882c6e2f8e95949dea0a9fb38bda8042` |
| 4 | `705-1cc5-security-rebind-opus.md` | Security rebind (a6856607..1cc5b1c2) | Claude Opus 5.5 | `1cc5b1c2` | CLEAR | `f20c47f1aafac9c464a7c4a9a7fd6ff996434870dae808155e24b40b91c22f23` |
| 5 | `705-1cc5-ordinary-a-sonnet.md` | Ordinary delta review A (a6856607..1cc5b1c2) | Claude Sonnet 5.5 | `1cc5b1c2` | APPROVE | `acebc96c6aa317b944e70ee2b63f77024ad54a35941ee9640a8ac6dea5e8f0b8` |
| 6 | `705-613f-security-rebind-opus.md` | Security rebind (1cc5b1c2..613f04a3) | Claude Opus 5.5 | `613f04a3` | CLEAR | `e3ca9732576b1e71ef5a92599d37a5e74e66049e2c00ff248d8a3560414eb60f` |
| 7 | `705-613f-ordinary-a-sonnet.md` | Ordinary delta review A (1cc5b1c2..613f04a3) | Claude Sonnet 5.5 | `613f04a3` | APPROVE | `6fd1234a75a1b421b7dd988a68d9dab79fb15ff1e92bc769e371eb4a255979c5` |
| 8 | `705-0db3-security-rebind-opus.md` | Security rebind (613f04a3..0db35191) | Claude Opus 5.5 | `0db35191` | CLEAR | `7e39185ed7ac05f5cd4325782063dfe9c10cde18f422b3472064b789910ea52d` |
| 9 | `705-2eee-security-rebind-opus.md` | Security rebind (0db35191..2eee045c) | Claude Opus 5.5 | `2eee045c` | CLEAR | `a926d40b10dc58a97f0b5d0c344e2ca2357ccfa34c93a2174de253d4e2aba00f` |
| 10 | `../2026-10-14/705-1d6b-security-rebind-opus.md` | Security rebind (2eee045c..1d6bca6f) | Claude Opus 5.5 | `1d6bca6f` | CLEAR | `e92b523abfb78dd425e8873dac9723d4d4bd862184af4687d5b5848a974ed4ac` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/705-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 48c4ba6705fc9fdd895ba22d61bd769991057390f15694080b212c720ee500b3) -->
# PR #705 ordinary review A (API correctness and tests)

Model: Claude Sonnet 5.5 (fresh independent context; did not author or direct the change)
**Reviewed head:** a685660742d3418fa3c25d4f0228be3eabd05de4
Base: origin/main af663a0c (closes #701)
Scope: API and tests (reviewer A). Web modal, i18n and pairs.json were not reviewed.

## Files examined
apps/api/src/project/controllers/create-project.ts, project/index.ts, project/policy.ts, project/schema.ts, project/response.ts, project/controllers/update-project.ts, tests/api-integration/project-organisation-binding.test.ts, tests/api-contract/openapi.json, tests/permissions/matrix.fixture.json, docs data-model/multi-tenancy/rbac, decision-log entry, implementer notes, issue #701. Greps over apps/api/src for every writer of project / project.organisation_id.

## Commands and results (scratch worktree at the exact head, since removed)
- pnpm install --frozen-lockfile: ok.
- pnpm check:openapi: matches (281 operations). pnpm check:route-policy: pass. pnpm test:permissions: 14 files / 88 tests pass (turbo reported 4/5 tasks cached; the outputs are for this head's inputs).
- CI=true vitest integration, --no-file-parallelism: project-organisation-binding + intake-*.test.ts = 9 files / 48 tests pass.
- Mutation checks on create-project.ts (each reverted afterwards, scratch tree clean):
  - drop `active = true`: 1 test fails (inactive).
  - drop `isInternal = false` on the organisation: 1 fails (internal org).
  - drop the workspace-is-internal guard: 1 fails.
  - drop `deletedAt is null`: 1 fails (soft-deleted).
  - drop `.for("share")`: 11/11 still pass (see finding 1).

## Answers to the focus questions
1. Validation and locking. Check and insert run in the same db.transaction (create-project.ts:~139-148, insert later in the same tx). Org row is selected with the active/internal/deleted predicate and `FOR SHARE` (lines 100-118). In READ COMMITTED a concurrent deactivate/delete UPDATE needs a row lock that conflicts with FOR SHARE, so it blocks until our tx commits; if it committed first, the predicate re-evaluates on the new row version and fails to 422. So no bind-after-deactivate window. All failures throw one error mapped to one 422 message (index.ts), no existence oracle. Note: no route in apps/api/src currently deactivates or deletes an organisation (only `GET /api/instance/organisations/{id}/identity` exists), so the race is presently theoretical; the lock is future-proofing.
2. List route. `GET /api/project/organisations` (index.ts:164, handler 744) is gated by workspaceAccess.fromQuery + project:create (policy.ts:82; matrix row added). project:create is held by owner/admin/manager (rbac.md, roles.ts) and by custom staff roles granted it; matrix shows viewer/others 403. Returns only {id,name} of active, live, non-internal orgs, ordered by name; no slug, domains or counts. There is no pre-existing staff org-list route to compare with. rbac.md/multi-tenancy.md say internal staff routinely work across customer organisations and only customers may never see another org; so exposing names to staff with project:create is consistent. It is instance-wide (not filtered by any relation), same as #513. Acceptable; see finding 2.
3. Workspace-to-customer relation. Independently confirmed none exists: workspace.organisation_id is the owning (internal) org (data-model.md:132); organisation_request_type is a request-type catalogue (data-model.md:403), not a workspace link; multi-tenancy.md says workspace is a container, not a boundary. No organisation_workspace table. The implementer's only workspace-derived rule (workspace owner must be internal) is reasonable and fail-closed. Issue text "may be served from this workspace" is therefore satisfied vacuously today; recommend the PR/decision log state this explicitly so the issue wording is not read as an unmet requirement.
4. No rebind. update-project.ts `.set` writes name/icon/slug/description/kind/supportLevel/serviceCalendarId only; updateProjectBody is non-strict so organisationId is stripped; test covers other-org and null. Other project writers (archive, unarchive, delete, reorder, health, claim-work-item-number, claim-task-numbers) set unrelated columns. Only create-project.ts:179 inserts it; apps/api/scripts/seed-profile.ts inserts projects (dev seed, no org). Confirmed.
5. Contract artefacts: regenerated and verified as above; 422 documented; organisationId on request (nullable optional) and Project response.
6. Tests: 11 tests, non-vacuous for four of five validations (mutation-verified). Includes slug-claim-not-leaked on refusal and an end-to-end intake acceptance.

## Findings
1. NON-BLOCKING: the FOR SHARE lock has no test (mutation drop passed 11/11). apps/api/src/project/controllers/create-project.ts:116. A race test (hold a tx that UPDATEs the org active=false, assert create blocks then 422) would pin it; acceptable to defer because no deactivation route exists yet. Suggest a follow-up issue/comment when the org deactivate route lands.
2. NON-BLOCKING: customer org names are listed instance-wide to any staff user with project:create in any workspace, with no per-workspace restriction. apps/api/src/project/index.ts:744-760. Consistent with the docs today; if a workspace-to-customer relation is ever decided, both this route and assertServableCustomerOrganisation (create-project.ts:100) must be constrained together. Worth a sentence in docs/03-features/projects-and-engagements.md.
3. NON-BLOCKING: the workspace guard (create-project.ts:120-129) reads the workspace's org without a lock; irrelevant today since workspaces cannot be re-parented, and failure is closed.
4. NON-BLOCKING (process): the issue's "refusal for another tenant's organisation" has no distinct meaning in this data model; the PR notes say so. A one-line record in the PR body is advised.

No blocking findings.

## Residual risk
Not run: web tests, lint, typecheck, full integration suite, Playwright, contract (oasdiff) test, image build. Concurrency behaviour reasoned from Postgres semantics, not exercised. Security-scope GPT-6 Sol review remains required per policy (project policy/permission matrix touched). One docker container (id da2bf3556749) appeared in `docker ps` after my run that was not present before; I did not create it by name and did not remove it (likely Testcontainers/ryuk or another lane).

## Verdict
APPROVE
<!-- END REPORT (sha256 48c4ba6705fc9fdd895ba22d61bd769991057390f15694080b212c720ee500b3) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/705-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 b05bb4d94ec024db679b0318f5b7a275390903f1d193a89161e4dfcc9f3665ce) -->
# PR #705 ordinary review B (web, i18n, pairs.json, docs, alignment)

Model: Claude Sonnet 5.5 (fresh independent context; did not author or direct the change)
**Reviewed head:** a685660742d3418fa3c25d4f0228be3eabd05de4
Base: origin/main af663a0c (closes #701)
Scope: reviewer B. API and API tests were covered by reviewer A.

## Files examined
apps/web/src/components/shared/modals/create-project-modal.tsx and .test.tsx; apps/web/src/fetchers/project/create-project.ts, get-customer-organisations.ts; hooks/mutations/project/use-create-project.ts; hooks/queries/project/use-customer-organisations.ts; i18n/en-US.json, schema.json and de/ja/ru/hi/tr/ko spot checks; packages/ui/src/styles/pairs.json (full structural diff); docs/03-features/projects-and-engagements.md; decision-log entry "Recovered record: Bind customer-serving projects at creation"; 696-ordinary-b-sonnet.md.

## Commands and results (scratch worktree at the exact head, since removed)
- pnpm install --frozen-lockfile: ok.
- web vitest (full): 143 files / 604 tests pass.
- pnpm typecheck: 9/9 tasks successful (turbo cache replay for these inputs).
- check:i18n: all 19 locales in sync with en-US. check:tokens (incl. check:contrast): pass, 418 pairs meet thresholds in light/dark built CSS. check:ui: pass. check:inventory: pass. check:bundle-size: pass (agent 228.6/350 KB, portal 163.5/200 KB).
- node scripts/ci/check-reviews.mjs --spec docs/03-features/projects-and-engagements.md: pass (empty review section).
- Mutation checks on create-project-modal.tsx (each reverted, tree clean):
  - organisationId always null: 1 test fails.
  - drop retry onClick: 1 fails.
  - query enabled ignoring `open`: 1 fails.
  - initial selection "org-1" instead of internal: 1 fails.
  - remove reset of selection on close: 6/6 still pass (finding 1).
  - drop the stale-selection fallback to internal: 6/6 still pass (finding 1).

## Answers to the focus questions
1. Modal. Optional selector using @taskdesk/ui Select, Label (htmlFor matches the trigger id), Button; classes are tokens only (text-muted-foreground, text-destructive); no raw colours or elements. Loading (role=status), error (role=alert) with Retry, empty and populated states all present; the default and every failure path produce organisationId null, and the fetcher omits the field for internal. Query is gated on `open` and a workspace id. Six tests, four of them mutation-verified. The error-state test also proves an internal project can still be created.
2. i18n. 7 new keys x 19 locales plus schema.json. de, ja, ru, hi, tr, ko read as correct, consistent terminology ("customer organisation"), no placeholders (the keys use none), check:i18n passes.
3. pairs.json. 418 rows before and after; scalar fields of every row identical; only occurrenceIds/occurrences appended (8 new occurrence ids across 6 rows, 4 distinct ids repeated in light and dark rows, all from create-project-modal.tsx Select/Popup/Value and its caller chain); no id removed or reordered; no duplicate rows; minRatio and category unchanged. The 4 "-" lines in the textual diff are only trailing-comma changes on the previous last array element. check:contrast re-derives and passes.
4. Docs. The paragraph matches the decision-log entry (null internal; creation-only; no rebind; no backfill) and the implementation reviewer A confirmed (active, non-deleted, non-internal org; internal workspace; one 422 with no oracle; list route gated by project:create). check:reviews passes.
5. Absorption. 696-ordinary-b flagged the #513 "project customer-organisation selector and its API half" as UNACCOUNTED. This PR delivers both halves of the create-time binding (API plus selector), so that unit is covered for creation. Not covered: showing the binding anywhere on an existing project (the Project response carries organisationId but no web surface displays it), and any workspace-to-customer scoping. Recommend a small follow-up issue "display customer organisation on project settings/overview (read-only)", and recording in #513 that the selector unit is absorbed by #701/#705.

## Findings
1. NON-BLOCKING: two behaviours are not pinned by tests: selection reset when the modal closes (create-project-modal.tsx:87) and the fallback to internal when the selected org disappears from the list (:58-62). Mutation of each passed 6/6. Suggest one test each (reopen modal after choosing an org: expect None; refetch without the chosen org: expect null).
2. NON-BLOCKING: in the loading, error and empty states the Label (create-project-modal.tsx:245) has no associated control (htmlFor points at an id that is only rendered in the populated state). Minor a11y; the status/alert regions carry the information. Optionally render the label only with the select or use aria-labelledby on the status region.
3. NON-BLOCKING: the fetcher's omit-when-null behaviour (fetchers/project/create-project.ts:~21) has no direct test (the modal test mocks the mutation hook). Low risk; API treats omitted and null identically.
4. NON-BLOCKING (docs): per reviewer A finding 2, the docs paragraph could say the list is instance-wide for staff with project:create. Also state explicitly that "served from this workspace" is satisfied vacuously because no workspace-to-customer relation exists.
5. NON-BLOCKING (follow-up): no read-only display of the binding on an existing project; file an issue (see 5 above).

No blocking findings.

## Residual risk
Not run: Playwright/visual/a11y suites (the Select popup is new UI; check:contrast covers its tokens but there is no screenshot evidence), API integration tests, image build/boot. The Select interaction in tests relies on a pointer/mouse event sequence against Base UI; passes today but may be brittle across a Base UI upgrade. Security-scope review (GPT-6 Sol) remains required for the API/policy part. Docker: I created no containers and removed none.

## Verdict
APPROVE
<!-- END REPORT (sha256 b05bb4d94ec024db679b0318f5b7a275390903f1d193a89161e4dfcc9f3665ce) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/705-security-opus.md; Claude Opus 5.5; sha256 3ab6c4866f1753c482f13e2ca78abdf5882c6e2f8e95949dea0a9fb38bda8042) -->
# PR #705 security review (bind customer-serving projects at creation, issue #701)

**Model:** Claude Opus 5.5. Fresh, independent context. I did not author, direct or remediate this change.
**Role:** security reviewer requested by the orchestrator. This is not the GPT-6 Sol gate and does not replace it (CLAUDE.md, "Opus 5.5 -- sampled big reviewer").

**Reviewed head:** a685660742d3418fa3c25d4f0228be3eabd05de4
**Merge base:** af663a0cd65e872c2b368d69e29392e89acfbad3 (origin/main). `git ls-remote` at review time: main = af663a0c, refs/pull/705/head = a6856607, so main had not moved.
**Scratch tree:** detached worktree /Users/heinthura/.codex/worktrees/review-705-sec at the exact head. Removed after the review. The author worktree was not modified.

## Surfaces examined

- apps/api/src/project/controllers/create-project.ts (the binding check, FOR SHARE lock, transaction order, error mapping)
- apps/api/src/project/index.ts (the new `GET /api/project/organisations` route at :164 and its handler at :744; create handler at :770-810), policy.ts:82, schema.ts:251, response.ts
- apps/api/src/project/controllers/update-project.ts, and every other writer of `project`: archive, unarchive, delete, reorder, health (index.ts:828), claim-work-item-number, claim-task-numbers, apps/api/scripts/seed-profile.ts
- Live authorization path: utils/require-workspace-permission.ts, utils/workspace-access-middleware.ts, utils/validate-workspace-access.ts, utils/authenticate-api-request.ts, utils/require-api-key-permission-scope.ts, utils/require-workspace-capability.ts, the host-routing guard in apps/api/src/index.ts, packages/permissions/src/legacy-better-auth-access-control.ts, packages/permissions/src/evaluator.ts (`reaches`)
- Consumers of `project.organisation_id`: intake/repository.ts (convertSubmissionInTransaction :846-866, acceptSubmission :1138, requireAutoAcceptProject :212-255, suggestDuplicateWorkItems :1792), work-item/repository.ts:115 (mention context), work-item/search/repository.ts:415 (customer search reach)
- Writers of `organisation_request_type` (none in apps/api/src; it is read-only from the API)
- Docs: decision-log entry "Recovered record: Bind customer-serving projects at creation", multi-tenancy.md, rbac.md (role table :402-406, reach :457/:481), data-model.md, events.md (`project.created` is not audited), projects-and-engagements.md
- Prior notes: 705-ordinary-a-sonnet.md, 705-ordinary-b-sonnet.md, project-org-binding-impl-sonnet.md

## Tests and probes run (scratch tree, exact head)

- `pnpm install --frozen-lockfile`: ok. `turbo build --filter=@taskdesk/api^...`: ok (cached).
- `CI=true vitest --config vitest.integration.config.ts` (serialized: fileParallelism false, maxWorkers 1; Testcontainers Postgres 18): project-organisation-binding.test.ts plus all eight `intake-*.test.ts` files gave **9 files / 48 tests, all passed**.
- `test:permissions` (vitest.permissions.config.ts): **14 files / 88 tests, all passed**. `check:route-policy`: passed. `check:openapi`: matches (281 operations).
- I wrote probe file tests/api-integration/zz-705-security-probes.test.ts in the scratch tree only, with the same CI=true serialized run. A copy is kept beside this report as 705-security-opus-probes.test.ts. Result: **11 / 11 passed**. Several of these tests characterise behaviour rather than assert the intended policy:

| Probe | What it does | Observed |
| --- | --- | --- |
| P1 | An admin of workspace B lists or binds with workspace A's id, or with a non-existent workspace id | 403 "You don't have access to this workspace" for both, with no organisation names in the body. Their own workspace returns 200 with the instance-wide list. |
| P2 | Viewer lists and creates | List and create both 403, no names in the body |
| P3 | Customer-portal session on the agent host, then on the portal host | 401 on the agent host, 404 on the portal host |
| P3b | Customer-side person who has (through misconfiguration) a workspace `admin` row and an API key scoped `project:create` | **200 on the agent host with every customer organisation**; 404 on the portal host. See finding 3. |
| P4 | API keys scoped `project:read`, scoped null, and scoped `project:create`; a viewer-owned key scoped `project:create` | 403, 403 and 200; the viewer-owned key gets 403 |
| P5 | Unknown, inactive, soft-deleted and internal org ids; malformed ids `""`, NUL, 123, `["x"]`; an org with `portal_access=false` | The four refusals return identical bodies: 422 `organisation_must_be_an_active_customer_organisation`. Malformed ids return 400 before any lookup. `portal_access=false` returns 200 (see finding 5). Only one project is created. |
| P6 | Holds an uncommitted `UPDATE organisation SET active=false`, then creates | The create blocks until the writer commits, then returns 422 and creates no project. **Mutation:** with `.for("share")` removed, the create does not block and returns **200, binding to the organisation being deactivated**. |
| P6b | Holds `FOR SHARE` on an organisation, then a writer deactivates it | The writer blocks |
| P7 | Sends `organisationId` and `organisation_id` to PUT `/{id}`, PATCH `/{id}/health`, PUT `/reorder`, PUT `/{id}/archive` and PUT `/{id}/unarchive` | The binding is unchanged after every call |
| P8 | Org X's submission in workspace W1. (a) W2 accepts into its own X-bound project. (b) W1 accepts into W2's X-bound project. (c) W1 accepts into a W1 project bound to Y. | (a) 404 "Submission not found". (b) and (c) 422 "Destination project is unavailable for this organisation". No work items are created. |
| P9 | Seeded `member` role (matrix fixture says 403) lists organisations and creates with an `organisationId` | **List 200 with every customer org; create 200, bound to the org.** See finding 1. |

- Docker: the Testcontainers Postgres and Ryuk containers were created by these runs and stopped themselves. Afterwards no container with the `org.testcontainers=true` label remained. I removed nothing, and the `taskdesk-*` containers were untouched.

## Answers to the challenge questions

**1. Tenant isolation.**
- Today a caller who passes the live `project:create` check in a workspace can bind a new project to any active, non-deleted, non-internal organisation. This matches the decision log ("Project creation may choose an active organisation explicitly") and multi-tenancy.md: internal staff work across all customer organisations, and no workspace-to-customer relation exists in data-model.md.
- The open problem is who actually holds the live `project:create` check. It is not the set the PR documents and tests (finding 1).
- Callers outside the workspace, viewers, customer-portal sessions, and keys without `project:create` scope cannot list or bind. Only finding 3's misconfigured customer-side member gets through.
- Listing every active customer org (id and name) to staff who genuinely hold canonical `project:create` (owner, admin, manager) does not break a written isolation rule. The 404 rule protects customer-side reach, and a staff manager is expected to choose the customer when creating a customer-serving project. It is the first non-instance-admin route that enumerates the customer directory, though, so it should be recorded as intended (finding 2).

**2. Intake impact.**
- The target workspace is fixed by the request type: `submission → request_type.workspace_id`. Acceptance re-reads the submission scoped to the actor's workspace, then requires the destination project to be in that same workspace with `project.organisation_id = submission.organisation_id` (intake/repository.ts:846-866). Auto-accept enforces the same rule through `requireAutoAcceptProject`.
- Customer audiences (`organisation_request_type`) have no API writer. A project creator therefore cannot pull X's submissions into another workspace by binding a project there; P8 confirms this.
- Inside the right workspace, binding is what makes a project an eligible destination, and the triager picks the destination when accepting. This PR adds no cross-workspace path.
- Binding is not purely an intake setting, however. It confers customer reach: rbac.md:481 (step 6) and :457, evaluator `reaches()`, work-item search :415, and mention context :115 (X's customer contacts become mentionable on public comments). A mis-bound project exposes whatever staff later put in it to the wrong customer, and the binding cannot be corrected (no rebind) or traced (no audit row). See finding 4.

**3. Races and uniformity.**
- The FOR SHARE lock is correct and load-bearing. P6 shows the mutation binds to an organisation in the middle of deactivation without it. The FK insert alone takes only KEY SHARE, which does not conflict with an `active` update.
- The 422 body is byte-identical for unknown, inactive, deleted and internal ids, and for a non-internal workspace. No refusal reveals which check failed.
- Any active customer org is already disclosed by the list route, so the remaining oracle value is nil.
- Lock order (org FOR SHARE, then the workspace advisory lock) has no inverse acquirer today, so I found no deadlock path.

**4. No rebind.** The only `insert(projectTable)` is create-project.ts:179. No `.set()` on `project` anywhere in apps/api/src includes `organisationId`. `updateProjectBody` strips the field. P7 confirms this through all five project write routes. Confirmed.

## Findings

1. **BLOCKING: the new route's real gate is wider than its declared, tested and documented gate.**
   - **Where:** apps/api/src/project/index.ts:175 (and :143 for the binding branch of create); policy.ts:82; tests/permissions/matrix.fixture.json:7367; docs/03-features/projects-and-engagements.md:103.
   - **The gap:** the route uses the legacy `requireWorkspacePermission({ project: ["create"] })`. The seeded legacy `member` role holds `project: ["create","read"]` (packages/permissions/src/legacy-better-auth-access-control.ts:64), so every ordinary member can do two things. They can read the full directory of active customer organisations. They can also create projects bound to any customer, which confers customer reach (rbac.md:481).
   - **What the PR claims:** the committed matrix row says `member → 403`, `lead → 403`. The docs and both ordinary reviews state that the gate is owner/admin/manager.
   - **Evidence:** P9, live: member gets 200 with every org, and creates a bound project with 200.
   - **Pre-existing part:** the same divergence already exists for `POST /api/project` on main (its matrix row says member 403, while members can create live). This PR does not change that middleware.
   - **What this PR adds:** a new route and a new security-relevant power (customer directory, customer binding) on top of that divergence. This is the defect class described in the header of utils/require-workspace-capability.ts: the route policy, the matrix and the runtime give three different answers. The green permission suite does not catch it, because the matrix tests the declarative policy, not the live middleware.
   - **Fix:** add `requireWorkspaceCapability("project:create")` to the list route. For `POST /api/project`, require the same canonical check when `organisationId` is non-null (or for the whole route). Add P9 as the regression test, asserting member and lead get 403.
   - **Side effect of the fix:** `requireWorkspaceCapability` fails closed for custom roles, which is the intended behaviour until #7's capability migration.
2. **NON-BLOCKING: the customer directory is instance-wide.** Even with the gate fixed, owner, admin and manager in any workspace see every active customer's id and name (index.ts:744-760). This is consistent with multi-tenancy.md and the decision log, but it is the first non-God-Mode enumeration of customers. It should be recorded in the docs paragraph. If a workspace-to-customer relation is ever introduced, this route and `assertServableCustomerOrganisation` (create-project.ts:100) must be narrowed together.
3. **NON-BLOCKING (pre-existing, made more visible): no customer-side check on legacy workspace gates.**
   - A customer-side person who holds a `workspace_user` row can use an API key on the agent host. The legacy gates never consult `person.side`, so with a built-in admin role they list every customer organisation (P3b). Fixing finding 1 does not close this, because `requireWorkspaceCapability` does not check side either.
   - Reaching this state needs an admin to add a customer identity to a workspace. The portal host and customer sessions are correctly refused.
   - This conflicts with multi-tenancy.md's "Customer scoping" (customer reach "cannot be widened by any role"). It should be filed as a follow-up: refuse customer-side persons in `workspace_user` writes and in `hasWorkspacePermission`.
4. **NON-BLOCKING: no audit or recovery for a security-relevant choice.**
   - Binding grants a customer organisation reach into the project, yet `project.created` is not audited (events.md:118) and the binding cannot be changed. A wrong binding can only be fixed by deleting the project. The decision log authorises "no rebind", and there is no audit requirement today.
   - The implementer notes record this. Neither ordinary review raised it.
5. **NON-BLOCKING: organisations with portal access disabled are bindable.** An org with `portal_access=false` passes validation (P5). That is acceptable, because the decision log names only "active", and intake from such an org is blocked elsewhere. It should still be stated in the docs.
6. **NON-BLOCKING: the race lock has no test.** The FOR SHARE lock (create-project.ts:116) is mutation-proven load-bearing (P6) but untested in the PR. Adopt P6 or an equivalent as a regression test.
7. **NON-BLOCKING (style): the org query sits in the router.** The list handler queries `organisationTable` inline in index.ts rather than in a repository helper (multi-tenancy.md "Query scoping"). The lint rule does not cover `organisation`, and the query is unscoped by design. Cosmetic.

## Residual risk / not checked

- Not run: the web, Playwright, visual and a11y suites, `test:contract` (oasdiff), image build and boot, or the full integration suite. Only the binding file and the eight intake files ran, plus my probes.
- `TASKDESK_POLICY_SHADOW=on` was not exercised. It would log finding 1's divergence but not block it.
- No portal route currently reads a project by `organisation_id`. The customer reach in finding 4 was traced through the evaluator, search and mention paths, not exercised end to end in the portal.
- Concurrency was probed with one writer and one creator, not under load.
- I did not check whether `workspace_user` writers can actually admit a customer-side identity in production flows (finding 3 assumes misconfiguration).

## Owner (Thomas) decision needed

Finding 1 needs a choice before merge:

- **Option A (recommended):** add the canonical `requireWorkspaceCapability("project:create")` to `GET /api/project/organisations`, and to `POST /api/project` when `organisationId` is non-null. Add the member/lead 403 regression test. Small, local change. Members can still create internal projects through the existing legacy path until the S7 cutover.
- **Option B:** accept that legacy `member` may enumerate customers and bind projects until the S7/#8 cutover. Record this as an explicit decision-log entry with an owning issue, and correct the docs paragraph and PR body so they do not claim owner/admin/manager. This leaves the committed matrix row stating a denial that the runtime does not enforce.

Findings 2-7 need no decision. They need follow-up issues and doc sentences only. Finding 3's follow-up should be owned by the S7/#8 retrofit lane.

## Verdict

**BLOCK.** The binding validation, lock, uniform 422, no-rebind and intake routing are correct and well defended. The block is finding 1 only: the new route's live gate admits ordinary `member`s, contradicting its own matrix row and documentation. It clears with Option A plus a re-run of the probes, or with an explicit Option B decision from Thomas.
<!-- END REPORT (sha256 3ab6c4866f1753c482f13e2ca78abdf5882c6e2f8e95949dea0a9fb38bda8042) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/705-1cc5-security-rebind-opus.md; Claude Opus 5.5; sha256 f20c47f1aafac9c464a7c4a9a7fd6ff996434870dae808155e24b40b91c22f23) -->
# PR #705 security re-review after the BLOCK (Option A remediation)

**Model:** Claude Opus 5.5. Fresh, independent context. I did not author, direct or remediate this change; I raised the original BLOCK (705-security-opus.md, at a6856607).
**Role:** security re-review requested by the orchestrator. It does not replace the GPT-6 Sol gate (CLAUDE.md).

**Reviewed head:** 1cc5b1c2be7a1d3b6c671d2d62a68ab8e7b699c8
**Parents:** a685660742d3418fa3c25d4f0228be3eabd05de4 (previous PR head) and bf23f525e047d986780d724340044f94d865b77c (origin/main, brings #698).
**Merge base of the parents:** af663a0cd65e872c2b368d69e29392e89acfbad3.
**Main at review time:** `git ls-remote` gave refs/heads/main = bf23f525 and refs/pull/705/head = 1cc5b1c2, so main had not moved.
**Hand-edit baseline:** `git merge-tree --write-tree a6856607 bf23f525` gives tree 9355057a. Its only conflict is packages/ui/src/styles/pairs.json. `git diff 9355057a 1cc5b1c2` gives the hand-made changes.

## Hand edits in the merge commit (complete list)

| File | Change | Assessment |
| --- | --- | --- |
| apps/api/src/project/index.ts (+26/-1) | The list route's legacy gate is replaced by `requireWorkspaceCapability("project:create")`. In the create handler, `assertCallerHasCapability(workspaceId, userId, "project:create", capabilityCredential(apiKey))` runs when `organisationId != null`. It is the first statement after body validation, before the managed-service checks and before any organisation lookup. | This is the described fix and nothing else. |
| tests/api-integration/project-organisation-binding.test.ts (+152) | Adds a strict-capability block: member, lead and viewer get 403 on the list, on bind and on bind with an unknown id; owner, admin and manager succeed. Also adds a FOR SHARE race test using `pg_blocking_pids` and a member internal-create test. | Described |
| docs/03-features/projects-and-engagements.md (+5/-1) | States that the list is instance-wide and that the strict capability applies to the list and to bind | Described |
| packages/ui/src/styles/pairs.json | Conflict resolution | Verified below |
| apps/web/src/components/shared/modals/create-project-modal.test.tsx (+51) | Two new tests: the selection resets on close, and it falls back to internal when the chosen organisation disappears | **Not in the coordinator's description.** These are test-only additions that close ordinary-review-B finding 1. Benign, no production code. |

There are no other hand edits. Every other path in the merge equals the automatic merge tree.

## pairs.json union

I ran a three-way check, matching rows by their scalar fields plus position among duplicates. Base af663a0c had 418 rows, and so do ours, theirs and the result.
- The result's row set equals base ∪ ours ∪ theirs.
- For every row, `occurrenceIds` and `occurrences` each equal (ours ∪ theirs) minus anything either side removed from base.
- No row has a duplicate entry. Exactly 2 rows were changed on both sides, and both were unioned correctly.
- **0 mismatches.** `pnpm check:tokens` (including contrast) passes at the head.

## Interaction with #698

- #698 (approvals detail/withdraw) touches only apps/web approvals components and fetchers, an e2e spec, a Linux visual baseline, i18n catalogues plus schema.json, pairs.json, and a review note.
- `git diff a6856607...bf23f525` touches nothing under apps/api, packages/permissions, tests/permissions, tests/api-integration or tests/api-contract.
- The i18n catalogues auto-merged cleanly, and `check:i18n` passes. The create-project modal tests (8) pass on the merged tree.
- I found no functional interaction.

## Tests and probes (scratch worktree at the exact head, removed afterwards)

- `pnpm install --frozen-lockfile` and `turbo build --filter=@taskdesk/api^...`: ok.
- `CI=true` serialized integration run (Testcontainers Postgres 18), project-organisation-binding.test.ts plus the eight `intake-*.test.ts` files: **9 files / 56 tests, all passed**. The binding file has 19 tests, as reported.
- `test:permissions`: **14 files / 88 tests, all passed**. `check:route-policy`, `check:openapi`, `check:i18n` and `check:tokens`: all pass. The web test create-project-modal.test.tsx: 8/8 pass.
- **Fail-before, independently reproduced:**
  - With index.ts restored to the merge-tree version, the 3 strict-capability tests fail (member, lead and viewer get 200 on the list). The fixture deliberately gives all three the legacy `project:["create","read"]` so that only the canonical check separates them.
  - With `.for("share")` removed from create-project.ts, the new race test fails. Both mutations were reverted.
- **My probe suite, re-run and extended** (12/12 pass; copy kept as 705-1cc5-security-rebind-opus-probes.test.ts):

| Probe | Result at 1cc5b1c2 |
| --- | --- |
| P9, session role matrix on both routes. Each role is given the legacy `project:create` row, to isolate the canonical check. | owner, admin and manager: list 200, bind 200, unknown id 422. **lead, member and viewer: list 403 with no names in the body, bind 403, unknown id 403 (no oracle).** Internal create (no `organisationId`) still follows the legacy check: member and lead 200, viewer 403, as declared and tracked in #708. |
| P10, API keys on both routes, owned by admin and by member, scoped `project:read`, null, `project:create` and `project:create+read` | Only an admin-owned key with `project:create` scope gets list 200, bind 200, unknown 422. Every other combination gets 403 on list, bind and unknown-id bind, with no names leaked. |
| P1, a foreign or non-existent workspace id | 403 "You don't have access to this workspace" for both |
| P3, a customer-portal session | 401 on the agent host, 404 on the portal host |
| P3b, a customer-side person with a built-in `admin` workspace row and a `project:create` key | **Still 200 with every org** (agent host); 404 on the portal host. Unchanged and pre-existing; see finding R2. |
| P5, refusal uniformity and malformed ids | 422 bodies are byte-identical for unknown, inactive, deleted and internal ids; malformed ids get 400 |
| P6 and P6b, FOR SHARE | The create blocks behind an uncommitted deactivation, then gets 422; a writer blocks behind FOR SHARE |
| P7, rebind via PUT, health, reorder, archive and unarchive | The binding is unchanged |
| P8, cross-workspace or wrong-org intake acceptance | Refused (404 or 422); no work item is created |

- Docker: the Testcontainers Postgres and Ryuk containers started by my runs stopped themselves. One `org.testcontainers=true` container (d405ce2a523a) was already present before my runs. It is not mine, and I left it alone. I removed nothing, and the `taskdesk-*` containers were untouched.

## Is the BLOCK closed?

**Yes.**
- Both routes now enforce the canonical `project:create`, so live behaviour matches the committed matrix rows: owner, admin and manager are allowed; lead, member, viewer and customer get 403.
- The bind-time check runs before any organisation lookup, so a refused caller gets 403 for real and unknown ids alike.
- The API-key scope is intersected with the role on both paths.
- There are regression tests for this in the PR, and they fail without the fix.

## Findings at this head

- **R1. NON-BLOCKING (UX): members see an error in the create-project modal.**
  - The modal still fetches `/api/project/organisations` for every user who opens it (create-project-modal.tsx:54). Since that route now returns 403 to member and lead, they will see the error alert with a Retry button (:258-271) every time they open create-project.
  - Members can still create an internal project, so this is functional. It is a confusing state, and Retry can never succeed for them.
  - Suggested fix: gate the query and the selector on the caller's `project:create` from `/api/capabilities`, or treat a 403 as "selector hidden". It can be a follow-up and does not affect security.
- **R2. NON-BLOCKING (pre-existing, unchanged): customer-side workspace membership.** A customer-side person given a built-in staff workspace role can still list every customer organisation with an API key on the agent host (P3b). `requireWorkspaceCapability` does not consult `person.side`. This needs an admin misconfiguration to reach, and the original report recorded it as finding 3. It still needs a follow-up issue owned by the S7/#8 lane: refuse customer-side persons in `workspace_user` writes and in workspace capability checks.
- **R3. NON-BLOCKING: custom roles cannot bind.** The canonical check fails closed for custom roles, so a custom role carrying legacy `project:create` cannot bind or list. This is the intended behaviour until #7's capability migration. One docs sentence would help.
- Original findings 4, 5 and 7 (no audit or recovery for bindings; `portal_access=false` orgs are bindable; inline org query) are unchanged and still non-blocking. Original findings 2 (docs) and 6 (no race test) are now addressed.

## Residual risk / not checked

- Not run: the full integration suite, Playwright, visual and a11y suites, `test:contract` (oasdiff), image build and boot, typecheck, lint.
- I did not re-review #698's own code, which has its own reviews; I checked only that it does not interact with this PR.
- `TASKDESK_POLICY_SHADOW=on` was not exercised.
- Concurrency was probed with one writer and one creator.

## Owner (Thomas) decision needed

None for merge. The Option A remediation matches the recommended option. R1 and R2 need follow-up issues; they do not need decisions.

## Verdict

**CLEAR** at 1cc5b1c2be7a1d3b6c671d2d62a68ab8e7b699c8. The previous BLOCK is closed, and the merge has no unexplained hand edits. The required GPT-6 Sol security review at this exact head is still outstanding, as is CI.
<!-- END REPORT (sha256 f20c47f1aafac9c464a7c4a9a7fd6ff996434870dae808155e24b40b91c22f23) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/705-1cc5-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 acebc96c6aa317b944e70ee2b63f77024ad54a35941ee9640a8ac6dea5e8f0b8) -->
# PR #705 delta ordinary review A (security-fix merge)

Model: Claude Sonnet 5.5 (fresh independent context; did not author or direct the change)
**Reviewed head:** 1cc5b1c2be7a1d3b6c671d2d62a68ab8e7b699c8
Parents: a685660742d3418fa3c25d4f0228be3eabd05de4 (PR branch, my earlier APPROVE) and bf23f525e047d986780d724340044f94d865b77c (origin/main, #698).
Delta method: `git merge-tree --write-tree a6856607 bf23f525` (tree 9355057a) diffed against HEAD. Hand-made changes are exactly 5 files: apps/api/src/project/index.ts, tests/api-integration/project-organisation-binding.test.ts, create-project-modal.test.tsx, docs/03-features/projects-and-engagements.md, packages/ui/src/styles/pairs.json (conflict resolution).

## Examination
- index.ts: list route middleware is now `requireWorkspaceCapability("project:create")` (strict, BUILT_IN_ROLES-based, no instance-admin bypass, fail-closed for custom role slugs, sets shadow authorization). Create handler calls `assertCallerHasCapability(workspaceId, userId, "project:create", capabilityCredential(apiKey))` when `organisationId != null`, before any organisation lookup, so a refused caller learns nothing about ids and gets a 403 not a 422. Internal creation (no organisationId) keeps its legacy check unchanged (test covers a member still creating an internal project). API-key scope is honoured through capabilityCredential. Reasoning: correct and matches the permission matrix (owner/admin/manager). Non-issue: the explicit-null case is treated as internal (`!= null`), consistent with the controller.
- pairs.json: merge-tree conflict markers (select.tsx/create-project-modal entries vs the new work-item-approvals entries) are resolved by keeping both sides in both occurrence blocks; no markers remain, JSON parses (check via the web/permission checks below; check:contrast not rerun).
- docs: accurate; states instance-wide list and strict capability.

## Commands and results (scratch worktree at the exact head, removed afterwards)
- pnpm install --frozen-lockfile ok; check:openapi ok (281 operations); check:route-policy ok; test:permissions 14 files / 88 tests pass.
- CI=true, serialized: project-organisation-binding + intake-*.test.ts = 9 files / 56 tests pass (19 binding tests).
- Race test ("serializes a concurrent organisation deactivation ..."), run alone 3 times: 3/3 pass. Design reviewed: a second pg client holds an uncommitted `UPDATE organisation SET active=false`; the test polls pg_stat_activity/pg_blocking_pids until a backend running the organisation `FOR SHARE` select is lock-waiting on the writer (5 s deadline, no fixed sleep), then commits and asserts 422 and zero projects. Deterministic in structure; client cleanup in finally with ROLLBACK guard.
- Web: create-project-modal.test.tsx 8 tests pass.
- Mutations (each reverted; scratch tree clean):
  A. list gate back to legacy requireWorkspacePermission: 3 of 19 fail (member, lead, viewer tests).
  B. drop the create-time capability assert: the same 3 fail.
  C. drop `.for("share")`: the race test fails (5 s timeout, blocked never observed); the other 18 pass. This closes my earlier non-blocking finding 1.

## Findings
1. NON-BLOCKING: the member/lead/viewer tests assert the list and the create in a single test each, so a mutation of only one gate fails the same three tests and does not say which gate regressed. Both gates are individually load-bearing (A and B each fail), but splitting would sharpen diagnostics. index.ts tests: project-organisation-binding.test.ts (member/lead/viewer 403 tests).
2. NON-BLOCKING: an instance admin who is not a workspace owner/admin/manager cannot list or bind (no bypass). Consistent with the other strict-capability routes and fail-closed; noted for docs awareness only.
My earlier non-blocking findings 2-4 stand unchanged (instance-wide list by design; doc now states it).

No blocking findings.

## Residual risk
Not run: full integration suite, lint, typecheck, check:contrast / Playwright, oasdiff contract test, image build. The pairs.json merge was checked by diff inspection only. Security-scope GPT-6 Sol re-review at this head remains required by policy; this note does not replace it. Docker: containers before/after my run were compared; none added by me, none removed.

## Verdict
APPROVE
<!-- END REPORT (sha256 acebc96c6aa317b944e70ee2b63f77024ad54a35941ee9640a8ac6dea5e8f0b8) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/705-613f-security-rebind-opus.md; Claude Opus 5.5; sha256 e3ca9732576b1e71ef5a92599d37a5e74e66049e2c00ff248d8a3560414eb60f) -->
# PR #705 security re-review (capabilities flag commit)

**Model:** Claude Opus 5.5. Fresh, independent context. I did not author, direct or remediate this change; I raised the original BLOCK and the CLEAR at 1cc5b1c2.
**Role:** security re-review requested by the orchestrator. It does not replace the GPT-6 Sol gate (CLAUDE.md).

**Reviewed head:** 613f04a3acc3c78d4ed6de29a2291a8a2c9643a5
**Parent:** 1cc5b1c2be7a1d3b6c671d2d62a68ab8e7b699c8 (my previous CLEAR). This is a single ordinary commit, reviewed as `git diff 1cc5b1c2 613f04a3`.
**Main at review time:** `git ls-remote` gave refs/heads/main = bf23f525e047d986780d724340044f94d865b77c and refs/pull/705/head = 613f04a3, so main had not moved.

## Change surface (9 files)

- **apps/api/src/capabilities/controllers/get-capabilities.ts** adds `bindProjectOrganisation` = `hasCanonicalCapability(c, "project:create")`. That helper calls the same `assertCallerHasCapability(workspaceId, userId, capability, capabilityCredential(apiKey))` used by the list route (`requireWorkspaceCapability`) and by the bind check in the create handler. A 403 maps to false; any other error is rethrown.
- **apps/api/src/capabilities/response.ts** and **tests/api-contract/openapi.json** add the boolean as a required field. No other contract changes.
- **apps/web:**
  - `use-workspace-permission.ts` exposes `canBindProjectOrganisation`, true only when the flag is `=== true`.
  - `create-project-modal.tsx` passes `open && canBindOrganisation` as the list query's `enabled`, and renders the selector only when the flag is true. Otherwise `selectedOrganisationId` falls back to internal, so `organisationId` is null.
  - The modal test gains hidden/shown and fetch-enabled assertions.
- **tests/api-integration/capabilities-scope.test.ts** adds one test: member has `createProjects` true and `bindProjectOrganisation` false; admin has true.
- **docs/03-features/projects-and-engagements.md** gains one sentence, about custom roles before #7 and the selector being driven by the flag. Cosmetic issue: the first edited line exceeds the file's wrap width.
- **packages/ui/src/styles/pairs.json** is covered below.

## Leak and strictness analysis for `/api/capabilities`

- The route is `requireSessionOnly()` plus `workspaceAccess.fromQuery()` (capabilities/index.ts:25; policy.ts:19 has `sessionOnly: true`).
- The new field is a boolean about the caller's own authority in a workspace they already reach. It carries no organisation ids, names or counts, so it cannot serve as an oracle about organisations.
- It is computed by the identical canonical predicate as the two protected routes, so the UI flag and server enforcement cannot disagree. A mismatch would at worst hide the selector or show an error; it could never grant anything.

## Tests and probes (scratch worktree at the exact head, removed afterwards)

- `pnpm install --frozen-lockfile` and `turbo build --filter=@taskdesk/api^...`: ok.
- `CI=true` serialized integration run (Testcontainers Postgres 18): my probe suite + project-organisation-binding + capabilities-scope + the eight `intake-*` files gave **11 files / 81 tests, all passed**.
- `test:permissions`: **14 files / 88 tests, all passed**. `check:route-policy`, `check:openapi`, `check:i18n`, `check:tokens` (including contrast): pass. `tsc --noEmit` for apps/api and apps/web: pass. create-project-modal.test.tsx: 10/10 pass.
- **The probe suite was re-run in full and extended with P11** (13/13 pass; copy kept as 705-613f-security-rebind-opus-probes.test.ts).
  - **P1-P10 are unchanged from 1cc5b1c2.** Members, leads and viewers get 403 on the list and on bind, including with an unknown org id. Owner, admin and manager succeed. Only an admin-owned key with `project:create` scope can list or bind. The 422 is uniform, FOR SHARE serialises, there is no rebind, and cross-workspace intake is refused.
  - **P11 `/api/capabilities`:**

| Caller | Status | `bindProjectOrganisation` | `createProjects` |
| --- | --- | --- | --- |
| owner | 200 | true | true |
| admin | 200 | true | true |
| manager (legacy row `project:create,read`) | 200 | true | true |
| lead (legacy row `project:create,read`) | 200 | **false** | true |
| member | 200 | **false** | true |
| viewer | 200 | **false** | false |
| API keys owned by admin (scoped read / null / create), member (create) and viewer (create) | **403** for every key: the route is session-only | absent |
| Admin of workspace A querying workspace B | 403 "You don't have access to this workspace" | absent |

  No response body contained an organisation name. The session flag matches the enforcement in P9 exactly. Because the route refuses all API keys, the flag never needs key-scope intersection; the protected routes still apply it (P10).

- Docker: the containers started by my runs stopped themselves. Nothing was removed, and the `taskdesk-*` containers were untouched.

## pairs.json: occurrence relocation only

- Old and new files both have 418 rows. **No scalar field changed in any row** (fg, bg, category, `minRatio`, themes, usage, backdrop, foreground/background class, surfaceContext). So no threshold or category changed.
- Exactly 4 rows changed: rows 36-37 (comment-card, light and dark) and rows 38-39 (comment-editor, light and dark). Each swaps occurrence ids one for one: 3+3+1+1 = **8**, with the arrays the same length.
- In every swapped pair, the only differing fields are `id` and `chain`. In both, the JSX path `form[0]/div[2]/...` became `form[0]/div[0]/...`, which is the wrapper move. The backdrop link (`DialogContent -> DialogPopup > bg-popover`) and every other occurrence field are identical.
- `check:tokens` re-derives the occurrences and passes.

## Findings

- **No new security findings.**
- **R1 from the previous report is closed:** members no longer fetch the list or see the error state.
- **R2 is unchanged and still non-blocking:** a misconfigured customer-side person with a staff workspace role still passes canonical checks on the agent host with an API key. That needs the S7/#8 follow-up.
- **Cosmetic:** the docs line wrap at projects-and-engagements.md:108.

## Residual risk / not checked

- Not run: the full integration suite, Playwright, visual and a11y suites, `test:contract` (oasdiff), image build and boot, lint.
- The modal's behaviour while `/api/capabilities` is loading (the selector stays hidden until the flag arrives) was read from code, not exercised in a browser.

## Owner (Thomas) decision needed

None.

## Verdict

**CLEAR** at 613f04a3acc3c78d4ed6de29a2291a8a2c9643a5. The required GPT-6 Sol security review at this exact head and CI remain outstanding.
<!-- END REPORT (sha256 e3ca9732576b1e71ef5a92599d37a5e74e66049e2c00ff248d8a3560414eb60f) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/705-613f-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 6fd1234a75a1b421b7dd988a68d9dab79fb15ff1e92bc769e371eb4a255979c5) -->
# PR #705 delta ordinary review A (capabilities flag + modal gate)

Model: Claude Sonnet 5.5 (fresh independent context; did not author or direct the change)
**Reviewed head:** 613f04a3acc3c78d4ed6de29a2291a8a2c9643a5
Base of delta: 1cc5b1c2be7a1d3b6c671d2d62a68ab8e7b699c8 (my prior APPROVE); the head is one commit on top.
Files examined: apps/api/src/capabilities/controllers/get-capabilities.ts, capabilities/response.ts, apps/web/src/components/shared/modals/create-project-modal.tsx (+ .test.tsx), apps/web/src/hooks/use-workspace-permission.ts, tests/api-integration/capabilities-scope.test.ts, tests/api-contract/openapi.json, docs/03-features/projects-and-engagements.md; pairs.json checked via check:contrast only.

## Review
- Server: `bindProjectOrganisation` is computed by the existing `hasCanonicalCapability(c, "project:create")` helper, i.e. the same `assertCallerHasCapability` + API-key credential path the list and create gates use, so the flag cannot disagree with the actual 403 rule. A 403 maps to false; other errors propagate (same as sibling flags). Added to the CapabilityMap type, zod response (required boolean) and OpenAPI (required, documented).
- Web: `canBindProjectOrganisation: () => can.bindProjectOrganisation === true` is fail-closed (false while capabilities load, or if absent). The modal passes `open && canBindOrganisation` as the query enabled flag and renders the selector block only when the flag is set, so a member sees no selector and no permanent error and no request is sent; submit then sends organisationId null. The diff to the JSX block is re-indentation only (verified by reading the hunk); no behavioural change inside.
- Docs: one accurate sentence added (the first inserted line is a long un-wrapped line; cosmetic).

## Commands and results (scratch worktree at the exact head, removed)
- pnpm install --frozen-lockfile ok; check:openapi ok (281 operations); check:tokens ok (check:contrast: 418 pairs meet thresholds, so the relocated pairs.json occurrences are consistent with built CSS).
- pnpm typecheck: 9/9 tasks successful.
- Web vitest, full: 145 files / 631 tests pass.
- CI=true integration, serialized: capabilities-scope + project-organisation-binding = 2 files / 31 tests pass.
- Mutations (each reverted, scratch tree clean):
  - W1 modal renders the selector unconditionally: the new "hides the selector..." test fails (1 of 10).
  - W2 query enabled ignoring the flag: the same test fails (it asserts the enabled arg is false).
  - S server flag hard-wired true (legacy-like): the capabilities test "reports bindProjectOrganisation from the strict project:create capability, not the legacy createProjects" fails (1 of 12).

## Findings
1. NON-BLOCKING: the modal tests mock `useWorkspacePermission`, and no test covers the hook's `canBindProjectOrganisation` reading `can.bindProjectOrganisation` end to end. The server test and modal test each pin their side; the one-line hook mapping (`=== true`) is untested. A small hook test would close the gap.
2. NON-BLOCKING: cosmetic doc line length (docs/03-features/projects-and-engagements.md, the sentence starting "Custom roles cannot bind").
No blocking findings. Earlier non-blocking notes (instance-wide list by design; combined member/lead/viewer 403 tests) stand.

## Residual risk
Not run: lint, Playwright/visual, oasdiff contract test, the full API integration suite, image build. UI behaviour verified through unit tests only, not a browser. Security-scope GPT-6 Sol re-review at this head is still required by policy. Docker: one container (id 6fe6fa5d098a) appeared after my run that was not there before; it is not one I named or created deliberately (likely Testcontainers/ryuk or another lane), and I did not remove it.

## Verdict
APPROVE
<!-- END REPORT (sha256 6fd1234a75a1b421b7dd988a68d9dab79fb15ff1e92bc769e371eb4a255979c5) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/705-0db3-security-rebind-opus.md; Claude Opus 5.5; sha256 7e39185ed7ac05f5cd4325782063dfe9c10cde18f422b3472064b789910ea52d) -->
# PR #705 security re-review (merge of main with #696)

**Model:** Claude Opus 5.5. Fresh, independent context. I did not author, direct or remediate this change; I gave the earlier CLEARs at 1cc5b1c2 and 613f04a3.
**Role:** security re-review requested by the orchestrator. It does not replace the GPT-6 Sol gate (CLAUDE.md).

**Reviewed head:** 0db351910f3fe1c14ae7ad54b533400217ea4032
**Parents:** 9481cb5263d8dd340b6ddd961359a0f12dc11784 (613f04a3 plus the review note) and 53344c8fb9ab815e9229ce39b5d4f932996d0e60 (origin/main, brings #696).
**Merge base of the parents:** bf23f525e047d986780d724340044f94d865b77c.
**Main at review time:** `git ls-remote` gave refs/heads/main = 53344c8f and refs/pull/705/head = 0db35191, so main had not moved.

## What changed since my CLEAR at 613f04a3

- **9481cb52** adds one file: the review note (705-project-organisation-binding.md, +499). It is docs only.
- **0db35191** is a merge of origin/main 53344c8f.
  - `git merge-tree --write-tree 9481cb52 53344c8f` gives tree 32f3c131, with a single conflict: packages/ui/src/styles/pairs.json.
  - `git diff 32f3c131 0db35191` touches **only** packages/ui/src/styles/pairs.json.
  - **So every non-conflict file equals git's own merge.**
- `git diff 613f04a3 0db35191 -- apps/api tests/api-contract tests/permissions tests/api-integration` is **empty**. The server side of #705 is byte-identical to the head I cleared.

## #696 interaction

- #696 changes (bf23f525..53344c8f, 81 files) touch nothing outside apps/web, i18n/* and pairs.json except docs. It touches no apps/api, permissions, OpenAPI contract or integration-test file.
- No #696 web change references `/api/project/organisations`, `bindProjectOrganisation`, `organisationId`, the create-project modal or the project create fetcher. Its only `createProjects` mentions are `createProjects: false` entries in its own test mocks of the capabilities map.
- **Capabilities shape:**
  - Server: apps/api/src/capabilities/response.ts has `manageServiceCalendars: z.boolean()` (:21, pre-existing on main before #705) and `bindProjectOrganisation` (:24). openapi.json lists both as properties and in `required` (:208, :211). `check:openapi` passes (the contract matches the app).
  - Web: use-workspace-permission.ts auto-merged cleanly. `EMPTY_CAPABILITIES` gains #696's `manageServiceCalendars: false` and `canManageServiceCalendars` (:107). #705's optional `bindProjectOrganisation` and `canBindProjectOrganisation` (:110, `=== true`) are both intact. Web `tsc --noEmit` passes.
  - The two flags are independent. The selector still defaults to hidden when the flag is absent.

## pairs.json: exact union, no threshold change

- I ran a three-way check of base bf23f525, ours 9481cb52, theirs 53344c8f and result 0db35191, matching rows by all scalar fields plus position among duplicates. All four have 418 rows.
- The result's row set equals base ∪ ours ∪ theirs. Neither side added or removed a row. Because rows are matched on every scalar field, **no `minRatio`, category, theme or colour value changed**.
- For every row, `occurrenceIds` and `occurrences` each equal (ours ∪ theirs) minus anything either side removed from base: **0 mismatches**. No row has a duplicate entry, and every occurrence id is present in its row's `occurrenceIds`.
- Two rows changed on both sides, and both were unioned correctly.
- I noted that 82 rows have `occurrenceIds` and occurrence ids that differ as multisets. The count is identical in all four files, so it is a pre-existing property of the manifest, not a merge artefact.
- `check:tokens` (including contrast) passes at the head.

## Tests (scratch worktree at the exact head, removed afterwards)

- `pnpm install --frozen-lockfile` and `turbo build --filter=@taskdesk/api^...`: ok.
- `CI=true` serialized integration run (Testcontainers Postgres 18): my 13-test probe suite + project-organisation-binding + capabilities-scope + the eight `intake-*` files gave **11 files / 81 tests, all passed**. This is the same count and result as at 613f04a3, including P9 (role matrix on list and bind), P10 (API-key matrix) and P11 (`/api/capabilities` flag).
- `test:permissions`: **14 files / 88 tests, all passed**. `check:route-policy`, `check:openapi`, `check:i18n`, `check:tokens`: pass.
- Web: create-project-modal.test.tsx + use-workspace-permission.test.tsx gave 2 files / 19 tests, all passed. Web `tsc --noEmit`: pass.
- Docker: the containers started by my runs stopped themselves. Nothing was removed, and the `taskdesk-*` containers were untouched.

## Findings

- **No new findings.**
- Earlier non-blocking items stand: R2 (customer-side workspace membership, S7/#8 follow-up) and the docs line wrap at projects-and-engagements.md:108.

## Residual risk / not checked

- Not run: the full web vitest suite (the conductor reports 659 passing), the full integration suite, Playwright, visual and a11y suites, `test:contract` (oasdiff), image build and boot.
- I did not review #696's own code beyond confirming it does not interact with the #705 surfaces.

## Owner (Thomas) decision needed

None.

## Verdict

**CLEAR** at 0db351910f3fe1c14ae7ad54b533400217ea4032. The required GPT-6 Sol security review at this exact head and CI remain outstanding.
<!-- END REPORT (sha256 7e39185ed7ac05f5cd4325782063dfe9c10cde18f422b3472064b789910ea52d) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/705-2eee-security-rebind-opus.md; Claude Opus 5.5; sha256 a926d40b10dc58a97f0b5d0c344e2ca2357ccfa34c93a2174de253d4e2aba00f) -->
# PR #705 security re-review (clean merge of main with #707)

**Model:** Claude Opus 5.5. Fresh, independent context. I did not author, direct or remediate this change; I gave the earlier CLEARs at 1cc5b1c2, 613f04a3 and 0db35191.
**Role:** security re-review requested by the orchestrator. It does not replace the GPT-6 Sol gate (CLAUDE.md).

**Reviewed head:** 2eee045c99203f73b4309fddee69db029d8236a3
**Parents:** b393e52d26452a7780705c3b860e7dea9bc2e3c9 (0db35191 plus the review note) and ee499594a90896fbb6edb61850b3f4e5001c5266 (origin/main, brings #707).
**Merge base of the parents:** 53344c8fb9ab815e9229ce39b5d4f932996d0e60.
**Main at review time:** `git ls-remote` (2026-10-14) gave refs/heads/main = ee499594 and refs/pull/705/head = 2eee045c, so main had not moved.

## Checks

1. **Merge tree equals git's own merge.**
   - `git merge-tree --write-tree b393e52d ee499594` gives af78ca86f34250c5fc23f83c0f1f072d569ab2ff and reports no conflicts. `git rev-parse 2eee045c^{tree}` gives the same af78ca86f34250c5fc23f83c0f1f072d569ab2ff.
   - **Identical: the merge has no hand edits at all.**
2. **b393e52d** changes exactly one file: the #705 review note (docs, +68).
3. **Everything changed since my CLEAR at 0db35191** (`git diff --name-only 0db35191 2eee045c`) is 13 files, all under apps/web/e2e/, tests/e2e/, apps/web/src/test/ or docs/:
   - apps/web/e2e/realtime.spec.ts and work-item-comments-journey.spec.ts
   - seven tests/e2e/*-journey or negative specs (+7 lines each; the redaction hook)
   - apps/web/src/test/e2e-secret-redaction.test.ts (the widened guard test)
   - docs/04-engineering/error-fix-loop.md and two review notes

   No file under apps/api, packages/, tests/api-integration, tests/api-contract, tests/permissions, i18n, pairs.json or apps/web/src outside `src/test` changed. That covers the capabilities controller and schema, project routes, policy, create-project modal, fetchers and hooks. The guard-test diff does not mention project, organisation or capabilities.
4. **#707 itself** (`git diff --name-only 53344c8f ee499594`) touches only the same e2e, test-guard and docs paths.

## Tests

- I re-ran no suites this round. Every product, API, contract, permission, i18n and token file is byte-identical to 0db35191.
- At that head I ran: 11 integration files / 81 tests (including my 13-test probe suite, the binding, capabilities-scope and all intake suites), `test:permissions` 14 / 88, `check:route-policy`, `check:openapi`, `check:i18n`, `check:tokens`, 19 web tests, and web `tsc`. All passed (report 705-0db3-security-rebind-opus.md).
- The new e2e hooks and the guard test are outside the #705 security surface. I did not run them.

## Findings

- **No new findings.**
- Earlier non-blocking items stand: R2 (customer-side workspace membership, S7/#8 follow-up) and the docs line wrap at projects-and-engagements.md:108.

## Residual risk / not checked

- I did not run the #707 e2e specs or the guard test, and did not review #707 beyond its paths.
- Not run, as before: the full integration suite, Playwright, `test:contract`, image build and boot.

## Owner (Thomas) decision needed

None.

## Verdict

**CLEAR** at 2eee045c99203f73b4309fddee69db029d8236a3. The required GPT-6 Sol security review at this exact head and CI remain outstanding.
<!-- END REPORT (sha256 a926d40b10dc58a97f0b5d0c344e2ca2357ccfa34c93a2174de253d4e2aba00f) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/../2026-10-14/705-1d6b-security-rebind-opus.md; Claude Opus 5.5; sha256 e92b523abfb78dd425e8873dac9723d4d4bd862184af4687d5b5848a974ed4ac) -->
# PR #705 security re-review (light: capability-map test helper)

**Model:** Claude Opus 5.5. Fresh, independent context. I did not author, direct or remediate this change; I gave the earlier CLEARs at 1cc5b1c2, 613f04a3, 0db35191 and 2eee045c.
**Role:** light exact-head rebind requested by the orchestrator. It does not replace the GPT-6 Sol gate (CLAUDE.md).

**Reviewed head:** 1d6bca6f4ad47cee567fa8522645b434bf855d76
**Parent:** 2bdb8d93f65e2ce71f5c1ffedee081f8f33ba647. That commit is 2eee045c (my last CLEAR) plus one docs-only commit, the #705 review note (+54).
**Main at review time:** `git ls-remote` gave refs/heads/main = ee499594a90896fbb6edb61850b3f4e5001c5266 and refs/pull/705/head = 1d6bca6f, so main had not moved.

## Scope of the commit

`git diff --stat 2bdb8d93 1d6bca6f` shows exactly one file: tests/api-integration/multi-role-membership-remediation.test.ts (+15/-1). It adds an import of `capabilitiesResponseSchema` and rewrites the body of `expectAllFalseCapabilityMap`. There is no other change: no production code, schema, contract or other test changed.

## Does the helper still guard what it did?

**Old helper:** status 200; exactly 21 keys; every value `=== false`.

**New helper:**
- status 200;
- the returned keys contain every required (non-optional) field of `capabilitiesResponseSchema.shape`;
- every returned key is an own key of the schema shape, so stray keys fail;
- every value `=== false` (unchanged).

**Schema at this head:** 20 required booleans, including `bindProjectOrganisation`, plus 2 optional (`createPublicComments`, `createInternalComments`), so 22 in total. The old count of 21 was therefore 19 required plus both optional keys.

**Assessment:**
- The two security properties are preserved: no flag may be true for a malformed or ambiguous membership, and no key may exist outside the contract. The comparison is now tied to the contract rather than to a hand count.
- **The only loosening:** the new helper would accept a response that omits one of the two *optional* comment flags, where the old exact count would not. That does not weaken the all-false guarantee. An absent optional flag reads as not granted, and the web side treats both flags as `=== true` only.
- The guard is not vacuous: an empty object fails the `arrayContaining(requiredFlags)` check.

## Verification (scratch worktree at the exact head, removed afterwards)

- `pnpm install --frozen-lockfile` and `turbo build --filter=@taskdesk/api^...`: ok.
- `CI=true` serialized integration run, multi-role-membership-remediation.test.ts + capabilities-scope.test.ts: **2 files / 25 tests, all passed** (13/13 in the remediation file, as reported).
- **Mutations** on apps/api/src/capabilities/controllers/get-capabilities.ts (return object, line 70), each reverted afterwards:
  - `bindProjectOrganisation: true` (a flag granted to a malformed membership): **3 tests fail**, 10 pass.
  - an extra `strayKey: false` in the response: **3 tests fail**, 10 pass. This is the "outside the schema" check.
  - The fourth call site (:499, "still no authority") follows a separate assertion path in that test and was not needed to show the guard bites.
- Docker: my run's containers stopped themselves.
  - Two Testcontainers containers (60a1aa5314b0 postgres and cfe8dc00ec7c ryuk, session ff053e7ac548) were running when I finished. Postgres was still up and healthy after my run had already exited and torn down its own container, so I judged them another lane's run. I did not remove them.
  - The `taskdesk-*` containers were untouched.

## Findings

- **No new security findings.**
- **Non-blocking note:** the helper no longer detects a missing optional comment flag. It is acceptable as explained above. If exactness is wanted, compare against the full shape key set when the membership is known to resolve to a workspace.
- Earlier non-blocking items stand: R2 (customer-side workspace membership, S7/#8 follow-up) and the docs line wrap at projects-and-engagements.md:108.

## Residual risk / not checked

- Only these two integration files were run at this head.
- Everything else is byte-identical to 2eee045c, whose evidence is in 705-2eee-security-rebind-opus.md (2026-10-13) and 705-0db3-security-rebind-opus.md.

## Owner (Thomas) decision needed

None.

## Verdict

**CLEAR** at 1d6bca6f4ad47cee567fa8522645b434bf855d76. The required GPT-6 Sol security review at this exact head and CI remain outstanding.
<!-- END REPORT (sha256 e92b523abfb78dd425e8873dac9723d4d4bd862184af4687d5b5848a974ed4ac) -->
