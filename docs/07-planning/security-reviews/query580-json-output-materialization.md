# Persisted JSONB output materialization — independent review record

**Reviewed head:** `24f52870a70a21b7e81332343ea879081955e2a9`
**Comparison base:** `d2f4b708e576da2239c733218aceb4501ec76d43`

This note publishes two authentic, unedited reports. The source changes only named physical JSONB output leaves in nine repositories, four corresponding backend type boundaries and two existing tests. No SQL, authorization, decoder, schema or query-checker control changes. One strong independent ordinary review and a further full independent security review cleared this bounded candidate. Neither author nor material adviser supplies approval.

## Provenance and scope

- Implementation: `/root/remaining580_type_boundary_plan_luna`, native `gpt-6-luna/medium`, session `01a14a9d-3c92-73e3-8a6a-e0db3e1d07e9`.
- Ordinary: fresh `/root/json24f5_strong_ordinary_luna`, explicit `gpt-6-luna/high`, `fork_turns=none`, session `01a14b23-0616-7023-bbc8-881a4573dbac`. Its original generic GPT-6 self-description is preserved below. Independent native turn-context metadata corroborates GPT-6 Luna; no hidden serving fingerprint is claimed.
- Security: further fresh `/root/json24f5_full_security_sol`, explicit `gpt-6.1-sol/high`, `fork_turns=none`, session `01a14b24-4fc5-76e2-9e1c-64a3be4d4d0f`. Native turn-context metadata corroborates GPT-6.1 Sol. Both fresh reviewer contexts have the conductor as parent and no inherited author turns. Session metadata itself contains no model field.
- The conductor verified actual source hashes, ran local verification, performed the normal source commit/push and transports these reports. The conductor is not an independent reviewer. Material diagnoses and earlier adverse candidates remain preserved and are not approvals.

## Conductor verification and limits

Actual source-bound PostgreSQL: fourteen complete files / 197 tests passed, native zero, 54.961 seconds; exact owned temporary container removed and all container/volume/network inventories conserved. API five TypeScript projects passed. Workspace types/build dependencies: nine successful tasks, six executed and three unchanged dependency builds cached. Notification unit file: 49 passed. Checker: three passed, zero failures/skips/cancellations. OpenAPI matches 284 operations. Repository lint: 2,409 files checked, native zero, 240 warnings and one info, no fixes. Permissions: sixteen files / 107 tests passed, native zero. Normal commit hooks left all fifteen source hashes unchanged. Earlier failed type attempts and static fixture defects remain adverse evidence with their corrections.

The unchanged checker remains red and unwired: 2,791 overlapping instances / 151 paths / 1,546 path-line locations, nine unresolved exported-type modules, zero explicit exported-builder rows and zero TypeScript diagnostic instances. Comparable prior input had 2,794 / 154 / 1,549 / twelve modules. Thirty-eight export/member findings disappear with zero added; this is not a count of unique queries or a progress percentage. A first private comparison split internal semicolons incorrectly; its preserved correction changes only parsing, not native results. Generic callbacks, Error statics, projection metadata, invitation expressions, portal Record-of-unknown and preexisting unchecked domain assumptions remain unblessed.

Current-head hosted checks and shipping-image build/boot/migrations/health remain required before protected acceptance. No #580 activation/completion, Carrier acceptance, signed combined release, laptop SIT, NONEMPTY-attachment recovery proof, final audit or stage completion is claimed. N1 and other held lanes remain unresolved/unwaived. No UAT or production change.

## Authentic ordinary report

# Strong ordinary review — #580 JSONB output type materialization

**Candidate:** `24f52870a70a21b7e81332343ea879081955e2a9`
**Comparison base:** `d2f4b708e576da2239c733218aceb4501ec76d43`
**Role:** Fresh strong ordinary review, assigned for the bounded #580 materialization candidate.
**Model:** GPT-6 (the model identity exposed to this context; no Luna/Sol suffix was exposed).
**Context and independence:** Fresh review context. I did not author, direct, or remediate the candidate. I relied on no other reviewer's verdict. Root-provided private evidence and diagnostics were treated as leads; findings below come from my source inspection.
**Checkout:** `/Users/heinthura/.codex/worktrees/query580-json-materialization/Ticketing.v2`, branch `codex/query580-json-materialization`, clean at review start; `HEAD` matched candidate SHA.

## Scope checked

Read the accepted checkout's `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `docs/07-planning/active-mission.md`, `docs/04-engineering/ci-cd.md`, and the Query ownership and coding standards section of `docs/04-engineering/coding-standards.md`. The mission is Integration Freeze. Review sizing by semantic risk supports one strong ordinary review plus a full independent Sol security pass for a bounded narrow pass/fail type-boundary repair. `apps/api/src/**/index.ts` is in the authoritative security-review path set, so the changes to intake, view, and work-item route modules still require the full Sol pass. This report is ordinary review only and does not clear that gate.

Inspected the complete base-to-candidate diff and all 15 changed files:

- `apps/api/src/auth/repository.ts`
- `apps/api/src/database/repositories/notification-delivery.repository.ts`
- `apps/api/src/identity/repository.ts`
- `apps/api/src/intake/index.ts`
- `apps/api/src/intake/repository.ts`
- `apps/api/src/service-calendar/repository.ts`
- `apps/api/src/sla-policy/evaluation.ts`
- `apps/api/src/sla-policy/repository.ts`
- `apps/api/src/view/index.ts`
- `apps/api/src/view/repository.ts`
- `apps/api/src/work-item/index.ts`
- `apps/api/src/work-item/repository.ts`
- `apps/api/src/work-item/search/repository.ts`
- `tests/api-integration/notification-outbox-delivery.test.ts`
- `tests/api/notification-current-eligibility.test.ts`

Reviewed output materialization, replacement types, nested bundle replacements, the two legacy consumer assignments, schema-derived HTTP assignments, and the notification driver-value test. Read the complete changed SQL/query sections in the diff to compare predicates, joins, ordering, locks, limits, selected columns, transaction placement, and effects.

## Findings

**Blocking: none found.**

The production edits consistently use `Omit<..., leaf>` followed by a concrete replacement property for the persisted JSONB leaves. Identity and intake helpers use nested replacement types for changed parents; I found no generic `T & { leaf: JsonValue }` retention that leaves the original unknown member in the result. Each materializer spreads the already-returned row and assigns the same leaf reference/value through a type assertion; no parsing, cloning, defaulting, normalization, or serialization was added.

The SQL-producing expressions I compared retain their original selected columns, predicates, joins, ordering, limits, lock clauses, executor/transaction use, and result cardinality. Materialization occurs after each statement. I found no authority, tenant reach, validation, callback, public response-schema, or query-ownership change. The intake response schemas moved from inline definitions to named constants with the same fields and validators; route handlers assign values to types inferred from those schemas before `c.json`. View and work-item handlers similarly bind values to their already-existing schema-derived response types. Date-valued response fields are not pre-serialized by these edits.

The `PortalSubmissionSource` assignment restores the complete preexisting table-row input views for the portal operation. The existing `FormSchema` / `FormValue` assertions and resulting behavior remain in place; this is not new validation and does not bless that legacy assumption. The SLA evaluation input assignment likewise preserves its old `unknown` input fields and existing downstream assertions. These are explicit compatibility boundaries, not evidence that persisted JSON is a valid form or calendar.

The notification test adds a typed Drizzle versus raw executor comparison for top-level JSON text (`"123"`), ordinary strings, nested JSON, JSON `null` distinguished from SQL `NULL`, and the `1e400` numeric driver result. The existing notification eligibility test changes only object construction to omit an undefined `id`; the rejection case is retained. Source inspection found no weakened assertion or skipped test. I did not execute tests or reproduce runtime behavior.

**Non-blocking residuals:** The two preexisting unchecked legacy input assumptions above remain unchecked. The patch does not claim they are safe or validated. Existing JSON boundary and HTTP behavior still depend on the runtime evidence and exact test counts recorded by the conductor; this static review does not substitute for those proofs.

## Verdict

**Ordinary review clears at the exact candidate SHA**, with no blocking finding. The candidate remains subject to its required full independent GPT-6 Sol security review because route `index.ts` security-scope paths changed, plus the conductor's ordinary integration gates. This review makes no claim about checker activation, #580 progress, PR/main acceptance, or runtime success.

## Commands and evidence used by this reviewer

Read-only commands run in the candidate worktree: `pwd`; `git status --short --branch`; `git rev-parse HEAD`; `git diff --stat <base>...<candidate>`; `git diff --name-only <base>...<candidate>`; `git diff --no-ext-diff --unified=60 <base>...<candidate> --` for auth, notification delivery, and identity; `git diff --no-ext-diff --unified=4 <base>...<candidate> --` for identity, intake repository, calendar, and SLA files; `git diff --no-ext-diff --unified=5 <base>...<candidate> --` for route/repository/test files; `git diff --numstat <base>...<candidate>`; `git status --porcelain=v1`; `rg -n` for `JsonValue` and review-policy sections; `sed` for active mission, review policy, security path list, and changed intake consumer source; and `cat` for the named policy documents and the two supplied private manifest/diagnosis documents.

No compiler, formatter, AST tool, runtime, database, Docker, test, install, build, or Git mutation command was run by this reviewer. Root's separate verification evidence was not represented as work performed by this reviewer.


## Authentic full security report

# Independent full security review — #580 JSONB output materialization

**Reviewed head:** `24f52870a70a21b7e81332343ea879081955e2a9`
**Comparison base:** `d2f4b708e576da2239c733218aceb4501ec76d43`
**Context:** `/root/json24f5_full_security_sol`; fresh context, no inherited author history.
**Role:** Full independent security review; not a phase finalizer.
**Model provenance:** GPT-6 family is visible to this context; exact dispatched model/version awaiting native dispatcher corroboration. No inference from a report filename or generic self-label.
**Independence:** I did not author, direct, or remediate this candidate. I have made no product, test, contract, branch, or GitHub changes.

## Review in progress

The source worktree is clean at the exact reviewed head. The comparison contains 15 changed files (13 backend source files and 2 existing tests), 780 added and 305 deleted lines. Read accepted repository policy, active mission, workflow review tier and exact-head rules, provider adapter, query ownership standards, raw timestamp binding rule, and security path scope. Static review only; runtime and heavy verification remain owned by the conductor.

Final findings and verdict will be appended below after full source and evidence inspection.

## Completed model provenance

**Model:** GPT-6.1 Sol
**Dispatch identity:** `gpt-6.1-sol`, reasoning effort `high`, `fork_turns=none`, as explicitly supplied by the conductor. The conductor independently corroborated native session `01a14b24-4fc5-76e2-9e1c-64a3be4d4d0f`, provider `openai`, agent path `/root/json24f5_full_security_sol`, with actual `turn_context` pair `[gpt-6.1-sol, high]`. I read the metadata-only `json24f5-native-provenance-initial.json` receipt; I did not read or publish the private native transcript. The visible GPT-6 family self-description alone was not used to infer this specific model. This resolves the initial provenance placeholder above.

The same receipt separately identifies the ordinary reviewer as `gpt-6-luna` / `high` in fresh context `/root/json24f5_strong_ordinary_luna`, session `01a14b23-0616-7023-bbc8-881a4573dbac`. Its report's original generic GPT-6 self-label is preserved. I do not count it as a Sol review. The material author/advisory contexts are separate and are not independent approvals.

## Scope and method

I read the complete base-to-head diff for all 15 changed paths, and the actual corresponding query, materialization, caller, response-schema and test source sections. The nine repository files are auth; notification delivery; identity; intake; service calendar; SLA policy; saved view; work item; and work-item search. The other source paths are intake/index.ts, view/index.ts, work-item/index.ts and sla-policy/evaluation.ts. The two tests are notification-outbox-delivery.test.ts and notification-current-eligibility.test.ts.

I compared all changed query sections for selected columns, aliases, predicates, tenant/reach conditions, joins, sort order, cursor construction, limits, executor handles, lock clauses and transaction placement. I checked every materializer and changed returned envelope, including no-row and no-op branches. I checked the named physical JSONB columns against database/schema.ts, the canonical JsonValue definition, installed pg-types 2.2.0 and Drizzle 0.45.2 JSONB decoding implementations, and the database pool configuration. Additional source inspected includes auth.ts's portal identity consumer; identity connection-admin and oidc-login parser/role checks; notification/current-eligibility.ts; view/controllers/list-views.ts; view/response.ts; work-item/response.ts; and the integration database helper and migration 0111_instance_scope_must_be_empty.sql.

The private output manifest and its append-only corrections were planning leads, not approval. The ordinary report was read as prior review evidence, not substituted for my source inspection. No source, test, schema, contract, dependency, checker, policy or frontend feature file was edited by this context.

## Security findings

**Blocking findings: none.**

1. **The trust boundary is confined to physical JSONB output leaves.** Each assertion applies to a specifically selected or returned JSONB column after its existing statement has completed. JsonValue is the existing recursive null/boolean/number/string/array/object shape; it permits JSON literal null even for a SQL NOT NULL column, and its number branch includes Infinity. It is not a capability list, identity mapping, JIT policy, event envelope, rich text document, FormSchema, FormValue, calendar or saved-view query validator. No schema `$type` change, whole-row cast, exported universal JSON trust helper, generic callback blessing, or checker exemption was added.

2. **Replacement types actually replace unknown leaves.** The helpers consistently use Omit<T, leaf> with explicit replacement members. Intake's bundle adapter replaces each affected nested parent, and the full SCIM row replaces both nullable attributeMapping and lastFailure. Auth replaces roleCapabilities only; saved-view preference materialization is the specifically selected physical user_preference.value, retaining undefined for an absent preference. Comment-version and work-item-search return types similarly remove and replace only body/description. The code does not retain an unknown leaf through a T intersection. Non-JSON values, including Dates, native arrays and identity secret Buffers, remain the same row values. Mapping creates ordinary row envelopes but does not parse, serialize, clone or normalize the leaf.

3. **Driver behavior is preserved.** pg-types registers JSON.parse for OIDs 114/3802. Drizzle's selected JSONB column mapper attempts JSON.parse again for a string and falls back to the original string on failure; raw execute does not use that selected-column mapper. No custom parser was added. Every adapter assigns exactly the value already yielded by its original path. In particular, the raw notification claim retains pg's payload, its first-row-or-null shape, and its unchanged SQL/locking behavior. The preexisting broad rows<T> helper was not generalized further: the new raw row type deliberately keeps payload unknown until that named leaf boundary.

4. **Authority, tenancy, locks and effects are unchanged.** The SQL-producing expressions in the complete diff retain their predicates, joins, selection, ordering, locks and limits. Identity connection/role lookup and FOR UPDATE paths retain their handles and cardinality. There is no new capability, tenant scope, membership rule, provider-derived privilege or access-control schema. Existing portal customer membership checks, identity mapping/JIT parsers and role eligibility checks remain active. Intake visibility/reach checks and returned message behavior remain; calendar audit/event and admin-notification order remains; search page/count/cursor and assignee masking remain. Adapters are after the existing awaited statement or effects. The count-only search path is untouched.

5. **Legacy inputs have not been silently certified.** PortalSubmissionSource is an assignment to the whole preexisting operation input view for submission/version, not an assertion that a JsonValue is a FormSchema. The unchanged FormSchema/FormValue casts and portal Record<string, unknown> output remain. The SLA assignment similarly widens the whole fetched calendar input to timezone plus unknown windows/holidays, retaining the existing CalendarWindows/Holiday[] casts. No parse/guard was removed. The raw calendar holiday-import casts also remain unchanged. These existing assumptions remain residuals, not newly validated domain contracts.

6. **HTTP compatibility assignments preserve the existing response contract.** Intake's two inline catalogue schemas were extracted with identical validators and fields. Intake's requestTypeResponse uses its existing schema-derived type; catalogue, view and work-item handlers bind values to their existing z.infer response types before c.json. These are assignments, not whole-response assertions or runtime schema stripping. They retain formSchema/query/description unknown at the established HTTP boundary. Existing Date values and existing explicit toISOString calls stay where they were; no new Date serialization behavior is introduced. The separate root OpenAPI check reports the current generated contract matches 284 operations.

7. **The new physical-driver test uses valid production constraints.** It creates its own organisation and workspace, including the required workspace createdAt. Probe outbox rows carry workspace/organisation scope compatible with migration 0111's CHECK; it does not weaken that CHECK or use an invalid unscoped synthetic event. Raw SQL interpolations are bound through sql templates and inArray; no new identifier interpolation or Date binding is introduced. The null probe inserts JSON literal 'null'::jsonb into the NOT NULL payload column and explicitly proves payload IS NULL is false. The selected typed/raw values cover a JSON-text scalar string, an ordinary string, nested booleans/arrays/objects/null, and 1e400 overflow to positive Infinity. Existing notification missing/wrong event-id rejection remains asserted; omitting an undefined id constructs a JSON-compatible missing-property case and does not relax the expected suppression result. No test was skipped, disabled or focused by the candidate.

8. **The query control remains fail closed.** No checker, checker test, query-ownership document, route policy or activation file changed. The inspected root diagnostic comparison removes the bounded JSONB export/member findings while preserving real generic, Error static, projection metadata, invitation-expression and portal Record unknown findings. It does not convert arbitrary unknowns to JSON. The nine residual modules and disabled-gate status remain explicit. No query ownership proof or #580 activation follows from this review.

**Non-blocking findings introduced by this candidate: none.**

**Preexisting residuals:** Portal FormSchema/FormValue/Record assumptions, SLA/calendar raw domain casts and all remaining genuine query-analysis unknowns remain. JsonValue's persisted shape cannot validate them. This review does not claim those paths are domain-safe, clear their remaining findings, or authorize broadening this patch.

## Review sizing

The actual delta is the bounded known JSONB output-type pass/fail repair, with caller assignments needed to retain existing input/HTTP contracts. Although auth and route/database security-scope paths are touched, the candidate does not alter auth logic, permission semantics, migration behavior, a security control's core semantics, or create a new authority boundary. The accepted workflow's one strong ordinary review plus one full independent security pass is therefore the appropriate tier for this exact candidate. I found no semantic change requiring a larger ordinary panel. This is a full security pass, not the lightweight no-semantics confirmation and not a stage finalizer.

## Conductor verification evidence inspected

I ran **no product tests, compiler, AST analyzer, formatter, package install, build, database or Docker commands**. These results are the conductor's work. I read their receipts and selected preserved log sections, not the entirety of each raw runtime log:

- pg-focused14 invocation/result, source preflight/postflight, native log-integrity receipt, run-status, and final Vitest summary: 14 complete files, 197 tests passed, native exit 0, 54.961 seconds process duration (Vitest reports 53.27 seconds). The invocation lists identity mapping/JIT, notification delivery, intake staff/portal/conversion, calendar, SLA, saved-view repository/route, comments and structured search suites with no test-name filter. The physical-driver case is present in the frozen changed test source. The run's receipts truthfully identify base HEAD plus the dirty 15-file candidate rather than relabelling that state as a clean commit.
- Source preflight/postflight and source-commit receipt bind all 15 file hashes and diff hash `3f99d9685ea1a5d53b7d59ee72ac72399bcf756f2025309fa72de900b9e4a20f`; the commit receipt conserves those bytes at the reviewed head. I independently ran shasum over all 15 current files and matched those hashes. The source-push receipt records the exact remote branch head. The checkout was clean at both my initial and final source checks.
- PG owned-container inspection excerpts, readiness and exact-ID cleanup receipt, and inventory-conservation receipt: postgres:18-alpine, loopback binding, owned run labels, successful readiness/cleanup, no containers, networks or volumes added/missing after cleanup. I did not operate that container or inspect any connection credentials.
- final-local-verification workspace-types receipt and summary: native exit 0, 9 successful tasks. Notification unit receipt/summary: native exit 0, 1 complete file, 49 tests passed. Checker-tests receipt and complete short stdout: 3 passed, zero skipped/cancelled/failures. These receipts conserve the same candidate source diff.
- openapi-current receipt and stdout: exit 0, source unchanged, generated OpenAPI matches the current 284 operations.
- inventory-exact-rule-summary and inventory-comparison-v2: 2,794 to 2,791 overlapping instances; 154 to 151 paths; 1,549 to 1,546 locations; 12 to 9 unknown modules; 38 export/member findings removed and zero added; zero explicit exported-builder rows and zero TypeScript diagnostic instances. Raw after stderr hash is `8c7b7ae47957af63ad86f4046dcdf45e2880f9781161ef20ff3baa077df07f96`. I inspected the before/after residual lists and per-module delta sections. These are overlapping diagnostic counts, not unique-query counts, progress percentages, gate activation or an all-#580 clearance. The comparison explicitly preserves its earlier parser correction.

The conductor reported earlier failed type attempts and preserved their artifacts. I did not rerun them or treat them as successful evidence. My inspected final source includes the corrected required fixture createdAt and omitted undefined id, with no weakened assertion. This report does not certify unrelated lint, image build/boot/health, browser, GitHub required checks, protected merge readiness or SIT acceptance; the conductor retains those applicable gates. No external runtime acceptance is claimed.

## Commands actually run by this reviewer

Read-only shell commands: pwd; git status --short / --porcelain=v1; git rev-parse HEAD; git diff --stat / --name-only / path-scoped complete diffs for the exact base and candidate; cat and sed for accepted policy, actual source, installed decoder source and the private artifacts identified above; rg / rg --files (including -uuu for installed decoder source), ls, wc, tail/head for bounded discovery and evidence sections; and shasum -a 256 for the 15 changed files. Initial exploratory probes used guessed consumer/migration names that did not exist; I corrected them with rg --files and inspected the actual paths. These were read failures, not test failures or bypasses.

Python was used only to create this new private report with O_EXCL and mode 0600 and append this completion. No runtime reproduction was requested or needed. No Git ref, commit, push, PR, source or shared record mutation was performed.

## Final verdict

**FULL INDEPENDENT SECURITY REVIEW: CLEAR at `24f52870a70a21b7e81332343ea879081955e2a9`, compared with `d2f4b708e576da2239c733218aceb4501ec76d43`. No blocking or new non-blocking security finding.**

This verdict covers only the exact candidate source reviewed. Publishing authentic unchanged review records follows the accepted exact-head reuse rules; any other source delta requires the applicable review of that delta. It is not approval to waive a gate, activate #580, merge a red/stale candidate, claim a stage complete, or treat source review as runtime acceptance.
