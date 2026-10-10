# Migration 0119 — tenant-composite FKs (M1 forward item N2) — review record

**Reviewed head:** `960120da853c1b738b0f1a869ed6d52e318c6b99`

0119 adds composite tenant FKs for `saved_view → team` and `notification_delivery → outbox`, with their parent unique keys. Four other N2 references are recorded as not applicable, with reasons. A structural guard test blocks runtime code from referencing the three still-unanchored tables.

- **Implementation:** Claude Sonnet context `acc8626aaec2ee9a1`.
- **Ordinary reviews:** Claude Sonnet A (`af0e970c5c890f597`) and B (`ad4e55f137b986f23`), both APPROVE at `b6e1a293`.
- **Security review:** Claude Opus 5.5 (`aecdf41355eabfd70`), CLEAR WITH NON-BLOCKING, then closure CLEAR at `6237e291` and rebind CLEAR at `960120da` after rebasing onto main `d743ae32`. It is not a GPT-6 Sol review.
- **Context ID:** that report's first header carried a placeholder context ID, which the reviewer itself corrected and recorded.

Each report is inserted unmodified, with its SHA-256.

<!-- BEGIN REPORT (agent af0e970c5c890f597; model claude-sonnet-5-5; role ordinary review A (static); candidate b6e1a29382a63f5e358e2385e3a0235aa2554e42; sha256 1078b1bb50098d0376bda54cda5f2d9e86e9da673d9c6ee3f74d03e7688eb37a) -->
Reviewer model: Claude Sonnet (claude-sonnet-5-5)
Context id: 3a9e9ce4-8409-47d4-b1be-1f1544697e70 (fresh static-review context, reviewer A)
Reviewed head: b6e1a29382a63f5e358e2385e3a0235aa2554e42 (branch claude/m0119-tenant-fks, base 6568fc3e)
Verdict: APPROVE (no blocking findings; 3 non-blocking notes). Static review only; nothing executed against a database.

## Checks
1. Immutability / journal: PASS. `git diff --name-only 6568fc3e..HEAD -- apps/api/drizzle` lists only 0119 sql, 0119 snapshot and _journal.json. No migration 0-118 file or snapshot touched. Journal diff is purely additive (one entry idx 119, `when` 1791609109777 > 0118's 1791344327180; tabs/trailing format match). SQL SHA-256 recomputed = 7ce96b3b...110b, matches the ledger.
2. SQL (apps/api/drizzle/0119_tenant_composite_fks.sql:3-10): PASS. Order is parent UNIQUEs (outbox(event_id,workspace_id), team(workspace_id,id)), drop old single-column FKs, add composite FKs. Nothing destructive: only constraints change, no data/column/table dropped. No DEFERRABLE issues; MATCH SIMPLE means NULL shared_with_team_id (private views) is unchecked, which is intended, and the CHECK saved_view_team_visibility_consistency still ties it to visibility. Delete semantics: notification_delivery cascade kept; saved_view no action kept (verified vs 0114 line 81 and the prior schema comment). Matches the 0112 pattern (composite, ON UPDATE no action).
3. Dispositions: PASS. Confirmed from the SQL: custom_field_type_visibility (0098:38-45) has no workspace_id; custom_field_value (0098:47-59) has no workspace_id, project_id nullable, entity_id generic; approval (0116:7-27) has no workspace_id and its FKs are single-column at lines 23-24. 0090 membership_grant/oidc_group_mapping/scim_group_mapping carry scope + scope_id text with scope in ('organisation','workspace'), so polymorphic. The three still-open items are recorded as open forward items gated on a runtime slice (migration-ledger.md "Open forward items after 0119").
4. schema.ts vs SQL/snapshot: PASS. Python structural diff of 0118 vs 0119 snapshot shows exactly: 2 unique constraints added, 2 FKs added, 2 old FKs removed, new id, prevId = 0118 id. Constraint names, columns, onDelete/onUpdate in schema.ts equal the SQL. Snapshot formatting (tab indent, trailing newline) identical to 0118.
5. Runbook preflight (docs/05-operations/runbook.md, new section): PASS. Query 1 correct (join on team, workspace mismatch; null team skipped, which matches MATCH SIMPLE). Query 2 correct, `is distinct from` catches NULL-workspace instance events. Both read-only. Remediation consistent with the CHECK constraint. Claim "written by no runtime" verified: grep finds saved_view/notification_delivery only in schema.ts.
6. Test (tests/api-integration/tenant-composite-fks-migration.test.ts): PASS, non-vacuous. Dedicated DB, migrates to exactly 0118 via copied folder, seeds same-tenant rows, applies shipped 0119 SQL split on breakpoints, asserts survival, exact constraint inventory (new present, old gone), insert AND update cross-tenant rejection (23503) for both FKs, NULL-workspace event rejection, positive same-tenant controls, cascade retained, direct team delete refused, workspace delete cascades. The second `it` (last journal entry is 0119) is weak and will go stale when 0120 lands.

## Non-blocking findings
N-1 ON UPDATE behaviour change: both old FKs were ON UPDATE cascade (0114:81; snapshot diff shows saved_view old onUpdate cascade). 0119 makes them no action. This is correct for composite keys (cascading workspace_id/id is hazardous) and consistent with 0112, but the ledger (migration-ledger.md, disposition table) says "ON UPDATE no action" without stating it changes from cascade. Suggest one sentence noting the deliberate change. Surrogate ids are not updated in practice.
N-2 Runbook remediation (runbook.md, the delete of notification_delivery rows): outbox_dedupe_reservation.owner_delivery_id references notification_delivery ON DELETE cascade (0114:91), so deleting a delivery also removes its dedupe reservation. Worth a half-sentence. Also "regenerated by the notification runtime" is an unverified forward claim (no runtime exists yet); soften to "if the runtime later reprocesses the event".
N-3 tenant-composite-fks-migration.test.ts last test: replace `last.tag === MIGRATION_TAG` with "0119 is in the journal and its `when` exceeds 0118's" to avoid breaking on the next allocation.
Minor ledger note: custom_field_value.entity_id is called polymorphic, yet the CHECK restricts entity_type to 'work_item' today; the follow-up row is still right, just less polymorphic than described.

## Not checked
No DB execution (test suite, drizzle-kit generate/check, image build). Person/outbox insert column sets in the test were not verified against live schema; they depend on the integration run.
<!-- END REPORT af0e970c5c890f597 b6e1a293 -->

<!-- BEGIN REPORT (agent ad4e55f137b986f23; model claude-sonnet-5-5; role ordinary review B (runtime); candidate b6e1a29382a63f5e358e2385e3a0235aa2554e42; sha256 8e4db9eb49de0f5fb7d8a9579eb85063e40e6b9cd4a491cbc605e5d9878a4caf) -->
# Migration 0119 review B (runtime verification)

- Model: Claude Sonnet 5.5 (claude-sonnet-5-5), Luna tier, fresh independent context. Context id: 3a9e9ce4-8409-47d4-b1be-1f1544697e70 (subagent of that session)
- Candidate SHA: b6e1a29382a63f5e358e2385e3a0235aa2554e42 (HEAD of /private/tmp/claude-501/m0119, parent 6568fc3e). Worked on a `git archive` export under scratchpad/b-export (node_modules symlinked); candidate never modified.
- Verdict: APPROVE. No blocking findings. Two non-blocking observations below.

## Commands and results (container m0119-review-b-pg, postgres:18-alpine, port 55439)
1. Clean bootstrap 0-119 via drizzle-orm node-postgres migrator: 120 journal entries, 120 rows in drizzle.__drizzle_migrations, 0 mismatches of row hash vs SHA-256(file) and of created_at vs journal `when`. Constraints present: both composite FKs and both unique keys; both old single-column FKs absent. Ledger SHA for 0119 (7ce96b3b...110b) equals the file.
2. Upgrade 118->119, same-tenant seed (saved view shared with own-workspace team, private view, delivery for own event): migrator succeeded, 119->120 rows, all seeded rows preserved, constraint set as expected. Preflight queries (verbatim from runbook) returned 0 rows beforehand.
3. Cross-tenant seed at 118 (saved view in wsA shared to wsB team; delivery wsA for wsB event):
   - Runbook preflight 1 returned svX, preflight 2 returned dX: both queries find their offender.
   - Migrator failed (SQLSTATE 23503 on notification_delivery_workspace_event_fk). Atomic: __drizzle_migrations stayed at 119, old FKs still present, neither new unique key nor new FK present.
   - Separate saved_view-only cross-tenant DB: failed on saved_view_workspace_shared_team_fk, 119 rows, 0 of the new unique constraints left (atomic).
   - Runbook remediation (saved_view to private/null, delete offending delivery) then re-preflight 0/0, migrator succeeded to 120 and surviving rows intact (CHECK team_visibility_consistency satisfied by moving both columns).
   - Instance-scoped (NULL workspace_id) outbox event with a delivery: preflight 2 flags it (IS DISTINCT FROM), migration fails as the runbook says.
4. New test file tests/api-integration/tenant-composite-fks-migration.test.ts: 2/2 pass (vitest integration config, TASKDESK_DATABASE_URL pointing at review_test; CI unset so no Testcontainers). Mutations of a temp copy of the SQL:
   - drop saved_view FK ADD: test FAILS (constraint inventory assertion)
   - drop notification_delivery FK ADD: FAILS (constraint inventory assertion)
   - saved_view FK made single-column (team id only): FAILS (expected 23503, got null)
   - delivery FK made single-column (event only): FAILS (expected 23503, got null)
   So the negatives are non-vacuous. Mutants 1 and 2 are caught by the inventory check rather than a behavioural rejection, which is still a failure.
5. `drizzle-kit check`: "Everything's fine". `drizzle-kit generate`: "No schema changes, nothing to migrate" (no new files). API `npm run typecheck` (4 tsconfigs): clean, exit 0.

## Non-blocking observations
- ON UPDATE changed from CASCADE to NO ACTION on both FKs (documented in ledger). Key columns (team.id, outbox.event_id) are not updated by runtime in practice; harmless, but it is a behaviour change worth the ledger note it already has.
- Runbook states both tables are written by no runtime; I did not verify runtime claims, only the SQL behaviour.

## Cleanup proof
`docker rm -fv m0119-review-b-pg` executed (container started with --rm; anonymous volume removed). Afterwards `docker ps -a --format '{{.Names}}'` no longer lists m0119-review-b-pg. Baseline before I created anything: 19 containers total (5 running). After cleanup the total is 20 (6 running) because a different reviewer's container, `m0119-sec-pg` ("Up 42 seconds" at check time), appeared concurrently; it is not mine and was not touched. Excluding it the count is 19, identical to baseline (the 19 other containers unchanged). Scratch export dirs remain in the scratchpad (b-export, b-scripts).
<!-- END REPORT ad4e55f137b986f23 b6e1a293 -->

<!-- BEGIN REPORT (agent aecdf41355eabfd70; model claude-opus-5-5; role Sol-tier security review, closure and rebind; candidate 960120da853c1b738b0f1a869ed6d52e318c6b99; sha256 3f735049d10613b1412471f481a0122a8906f6bacc32dd62e21386991725944d) -->
Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:aecdf41355eabfd70 (corrected; the original draft carried the placeholder "claude-agent:m0119-sec-opus")
**Reviewed head:** b6e1a29382a63f5e358e2385e3a0235aa2554e42
Verdict: CLEAR WITH NON-BLOCKING (no blocking findings; three non-blocking items, N-1 to N-3)

# Migration 0119 `tenant_composite_fks` (forward item N2): independent security review

## Role and independence

- Role: independent Sol-tier security reviewer, run as a fresh Claude Opus 5.5 context. This is
  **not** a GPT-6 Sol context. Whether an Opus review can satisfy the GPT-6 Sol gate that
  CLAUDE.md requires is the orchestrator's decision, not mine. I am stating this so the record
  does not imply otherwise.
- I did not author, direct or remediate this candidate. The review was read-only. The
  candidate worktree is clean afterwards (`git status --short` printed nothing).

## Scope

- Candidate `/private/tmp/claude-501/m0119`, HEAD `b6e1a29382a63f5e358e2385e3a0235aa2554e42`
  (one commit). Base and merge base: `6568fc3e545b36580f8a8248f4dcf3fa48257854` (main).
- Files: `apps/api/drizzle/0119_tenant_composite_fks.sql`, `meta/0119_snapshot.json`,
  `meta/_journal.json`, `apps/api/src/database/schema.ts`, `docs/05-operations/runbook.md`,
  `docs/07-planning/migration-ledger.md`, and
  `tests/api-integration/tenant-composite-fks-migration.test.ts`.
- Background I read: `docs/07-planning/security-reviews/m1-migration-spine.md` (N2 at about
  line 373 and the 0110/0111 row), the notification data-model rows in
  `docs/01-architecture/data-model.md`, and `docs/03-features/notifications.md` (recipients of
  instance events, lines 60-70 and 366-379).

## Findings

### Focus 1: do the composite FKs close cross-tenant references? Yes.

- `saved_view_workspace_shared_team_fk (workspace_id, shared_with_team_id) -> team(workspace_id, id)`
  uses MATCH SIMPLE.
  - `saved_view.workspace_id` is NOT NULL (catalog: `attnotnull = t`).
  - The only NULL that skips the check is `shared_with_team_id IS NULL`. In that case
    `saved_view_team_visibility_consistency` (`(visibility = 'team') = (shared_with_team_id IS NOT NULL)`)
    forces the view to be private or workspace-visible, and nothing is shared with a team.
    The skip is correct by design, not a hole.
  - Tested live: a NULL team with `team` visibility is refused by the CHECK, and a
    workspace-visible view naming a foreign team is also refused by the CHECK.
- `notification_delivery_workspace_event_fk (event_id, workspace_id) -> outbox(event_id, workspace_id)`
  uses MATCH SIMPLE.
  - Both child columns are NOT NULL (catalog), so MATCH SIMPLE can never skip the check on any
    delivery row. The FK is never vacuous.
  - Because `outbox.event_id` is the primary key, the parent UNIQUE `(event_id, workspace_id)`
    is technically redundant for uniqueness. Postgres needs it as the FK target, and a parent
    row with a NULL `workspace_id` simply cannot be matched.
- Live negatives, all refused with 23503 or a CHECK error:
  - cross-tenant insert and update on both FKs;
  - moving a saved view to another workspace while it keeps its team;
  - moving a team to another workspace while a view shares it;
  - moving an outbox event to another workspace, or setting its workspace to NULL, while a
    delivery exists;
  - a delivery for an instance (NULL-workspace) event with any workspace.
- These tests also cover the parent-side drift that the candidate's own test does not exercise
  (team or outbox `workspace_id` changes). Both FKs are `ON UPDATE NO ACTION`, never CASCADE,
  as required by PR #191 O1.

### Focus 2: is replacing the single-column event FK a weakening? No. It is strictly stronger.

- Event existence is still enforced. The old FK's only extra property was `ON UPDATE CASCADE`
  on `event_id` and `team.id`. Renaming a PK is now refused instead of cascaded (tested). No
  runtime renames these ids. `ON DELETE CASCADE` on the outbox side is kept (tested), so
  retention purge of outbox envelopes still removes their children.
- Instance events: before 0119, a delivery `dI` was accepted for event `identity.deprovisioned`
  (NULL workspace) with an arbitrary `workspace_id = wsA`. I demonstrated this live at 0118, and
  it was a real gap. After 0119 such a row is impossible. That matches the 0110/0111 review's
  stated invariant ("instance events cannot fan out into a workspace delivery").
- Does it break a legitimate flow? Not today: no runtime in `apps/api/src` or `packages/*/src`
  writes `notification_delivery`. But `notifications.md:64-69` does name recipients for
  `pending_action.requested`/`executed` and `identity.deprovisioned`, and those are NULL-workspace
  events. External delivery of those events through `notification_delivery` is now
  structurally impossible. Item N-1 covers this.
- A workspace-id rename that cascades `notification_delivery.workspace_id`, but not the
  FK-less `outbox.workspace_id`, is now refused (tested). Before 0119 it would have silently
  produced a delivery whose workspace differs from its event's. That is fail-closed and
  stronger. (Renaming a workspace with teams was already refused by `team_workspace_id_workspace_id_fk`.)

### Focus 3: are the "not applicable" dispositions truthful? Yes. The label is generous, and the risk is latent, not live.

- I checked the creating SQL:
  - `custom_field_type_visibility` (0098:38-45) has no `workspace_id`;
  - `custom_field_value` (0098:47-59) has no `workspace_id`, a nullable `project_id` and a
    polymorphic `entity_id`;
  - `approval` (0116:7-24) has no `workspace_id`.
  So a composite FK genuinely needs a new column, which is a design change.
- The 0090 grant and mapping rows have a polymorphic `scope_id` and a scope-nullable
  `role.workspace_id`. An FK cannot express "role belongs to the scope's workspace", so the
  `wellAnchored` resolver residual is accurate.
- "Not applicable here" really means "deferred, still open". The ledger says so explicitly
  ("Still open", plus the gate in "Open forward items after 0119"), so the record is not
  misleading.
- Live risk today: none that I found. No file in `apps/api/src` or `packages/*/src` (outside
  `schema.ts`, `migration-schema.ts` and the shadow schema) reads or writes these tables.
- What must be true **before** each runtime slice lands:
  1. `custom_field_type_visibility`, `custom_field_value` and `approval` gain a NOT NULL
     `workspace_id`, plus composite FKs. Each FK needs `(workspace_id, id)` parent keys:
     - `custom_field` and `work_item_type` (the latter already has
       `work_item_type_workspace_id_id_unique`);
     - `project`, for `custom_field_value`;
     - `work_item` (already has `work_item_workspace_id_id_unique`) and `workflow_transition`
       (none yet), for `approval`.
     All of them `ON UPDATE NO ACTION`, each with a cross-tenant negative test, or else a
     decision-log waiver.
  2. Every new tenant column is NOT NULL. Under MATCH SIMPLE, a nullable tenant column would
     make the FK vacuous for those rows. If the column must stay nullable (for example
     `custom_field_value.project_id`), add a CHECK or MATCH FULL.
  3. Any grant- or mapping-backed membership producer must apply `wellAnchored`, with a
     negative test.
  4. The custom-fields and approvals runtime PRs must cite these rows and must not merge while
     they are open. Today that is a ledger-recorded gate, not a machine gate. Item N-3 covers
     this.

### Focus 4: migration safety

- Ordering: parent UNIQUE constraints come first, then the old FKs are dropped, then the new FKs
  are added. Every step runs inside the migrator's single transaction, so there is no window
  without an FK.
- Atomic failure on bad data was reproduced live:
  1. Migrated a database to 0118 with the real `drizzle-orm/node-postgres/migrator`.
  2. Seeded a cross-tenant saved view, a cross-tenant delivery and an instance-event delivery.
  3. Ran the full migrator. It failed with
     `23503 ... notification_delivery_workspace_event_fk`.
  4. Afterwards: 119 history rows, max `created_at` still 1791344327180, the old FKs still
     present, and none of the four 0119 constraints present.
  So the failure fully rolled back.
- Applied history:
  - Journal entries 0-118 are deep-equal to main.
  - 0119's `when` (1791609109777 = 2026-10-10T05:11:49Z) is greater than every earlier `when`.
    The non-monotonic pairs 5/6 and 24-26 are pre-existing and frozen.
  - The snapshot `prevId` equals the 0118 snapshot `id`.
  - The SQL SHA-256 `7ce96b3b…110b` matches the ledger.
  - A fresh bootstrap (0000 to 0119) and an upgrade from 0087 (0087 to 0119) both succeed with
    120 rows.
- Locking: the `outbox` UNIQUE build and the FK validation take strong locks on `outbox`, the
  live table since 0078. This is acceptable inside the upgrade window. I note it as
  operational, not as a security issue.
- Drift: I ran `drizzle-kit generate` against a copy of the migrations folder and got
  "No schema changes". `drizzle-kit check` reported "Everything's fine". The candidate worktree
  was not modified.
- The candidate's own test passed on Postgres 16.15: 1 file, 2 tests.

### Focus 5: runbook preflight and remediation

- The preflight is complete. Both queries inner-join, which is sufficient because the old
  single-column FKs guarantee the parent row exists. `is distinct from` correctly catches the
  NULL-workspace instance-event case: my seeded `dI` was detected along with `svX` and `dX`.
- The remediation works:
  - Moving only `shared_with_team_id` to NULL is refused by the CHECK, as the runbook warns.
  - `visibility='private', shared_with_team_id=null` together, plus deleting the deliveries,
    cleared the preflight. The upgrade then succeeded.
  - Deleting a delivery cascades its `outbox_dedupe_reservation` rows, which is harmless.
- The runbook requires a backup first. The remediation statements are targeted by id, not
  bulk.

## Non-blocking items

- **N-1 (forward design constraint, not a defect in 0119).** `notifications.md` lists external
  recipients for the NULL-workspace instance events (`pending_action.requested`/`executed`,
  `identity.deprovisioned`), but `notification_delivery.workspace_id` is NOT NULL and is now
  composite-anchored to the event. When the notifications runtime lands, instance-event
  delivery needs its own path, as AU-14 already uses for `audit_write_failed`
  (`notifications.md:370-379`).
  - It must **not** make `notification_delivery.workspace_id` nullable. Under MATCH SIMPLE that
    would silently disable this FK for those rows, including the event-existence check and
    `ON DELETE CASCADE`.
  - Related wording fix: the runbook says a deleted delivery "is regenerated from its outbox
    event by the notification runtime". That is unverifiable today (no runtime), and false for
    instance-event rows, which can never be regenerated. Suggest "is not preserved; it would
    have been unauthorised under 0119".
- **N-2 (documentation authority drift).** `data-model.md:450` still describes
  `notification_delivery.event_id` as an "FK to `outbox.event_id`". The `saved_view` row (458)
  does not mention the composite anchoring, and the `team` and `outbox` rows do not list the
  new `(workspace_id, id)` / `(event_id, workspace_id)` unique keys. The house convention is to
  record composite FKs there (see `work_item`, `activity`), and CLAUDE.md names `data-model.md`
  as the authority for tables. Add a follow-up doc edit.
- **N-3 (gate is prose only).** The three remaining N2 tables are gated "before any runtime
  slice writes the table" only by the ledger text. Consider a machine guard, for example a test
  that fails if `apps/api/src` references `custom_field_type_visibility`, `custom_field_value`
  or `approval` while those tables lack a `workspace_id`.

## Commands and evidence

- `git rev-parse HEAD` printed `b6e1a29382a63f5e358e2385e3a0235aa2554e42`.
  `git merge-base 6568fc3e HEAD` printed `6568fc3e545b36580f8a8248f4dcf3fa48257854`.
  `git diff --name-status` shows 7 files.
- `shasum -a 256 apps/api/drizzle/0119_tenant_composite_fks.sql` printed
  `7ce96b3bea45e477f10bc346158cd191e8d27fb306198a9a551fc3056e1c110b`.
- A Python check confirmed journal entries 0-118 equal main, the 0119 `when` is above the
  earlier maximum, and the snapshot `prevId` chains.
- Disposable container `m0119-sec-pg` (`postgres:16-alpine`, `--rm`, `127.0.0.1:55419`).
  - `TASKDESK_DATABASE_URL=…/sec_test npx vitest run --config vitest.integration.config.ts ../../tests/api-integration/tenant-composite-fks-migration.test.ts`
    reported 1 file, 2 tests passed.
  - Probe database `probe1`, using the stock migrator via a scratchpad `migrate.mjs`:
    1. Migrated to 0118 and seeded cross-tenant rows.
    2. Ran the full migration. It failed atomically (shown above).
    3. Ran the runbook preflight, which returned 1 + 2 rows.
    4. Applied the remediation. The preflight then returned 0 + 0 rows.
    5. Ran the full migration again. It succeeded (120 rows).
    6. Ran 15 post-0119 behavioural probes (listed under Focus 1 and 2) plus the workspace-id
       rename probe.
  - Catalog: `confmatchtype = 's'` and `confupdtype = 'a'` for both FKs, `confdeltype` is `c`
    for the delivery FK and `a` for the saved-view FK, and neither is deferrable.
  - Databases `fresh` (0000 to 0119) and `from87` (0087 to 0119) both migrated OK.
- `drizzle-kit generate` and `check` used a temporary config whose `out` pointed at a
  scratchpad copy. The output was "No schema changes" and "Everything's fine". I deleted the
  temporary config, `git status` is clean, and `diff -rq` showed no new files.
- `grep` found no remaining references to the dropped FK names outside 0119 and its test. It
  also found no runtime writers of `notification_delivery`, `saved_view`,
  `custom_field_type_visibility`, `custom_field_value` or `approval`.
- Containers:
  - Baseline was 20 containers, which included another reviewer's `m0119-review-b-pg`.
  - After `docker stop m0119-sec-pg` (`--rm` auto-removed it and its anonymous volume), the
    count was **19**. That is the baseline names minus `m0119-review-b-pg`, which its owner
    removed during my run. I did not touch it.
  - No other container or context was touched (context `orbstack`).

## Residual risk

- The three N2 tables without `workspace_id`, and the 0090 grant and mapping scope anchoring,
  still rely on future application code and the ledger gate (N-3).
- `notification_delivery.organisation_id` is still only "verified by the atomic writer"
  (data-model.md:450) and is not DB-anchored to the event's organisation. This was outside the
  N2 scope.
- `team_member.team_id` and other pre-M1 single-column references were not in scope.

## Not checked

- Postgres 18, which the live `taskdesk-postgres-1` uses. All runs here were on 16.15. The
  semantics involved (MATCH SIMPLE, NO ACTION timing) are unchanged between versions.
- The full integration, permissions and contract suites. I ran only the 0119 test file.
- Image build, container boot and UAT deployment.
- CI status and PR review state on GitHub. I did not query `gh`.
- Concurrency under live load during the upgrade (lock duration on a large `outbox`).

---

# Closure re-check at 6237e291 (N-1, N-2, N-3)

Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:aecdf41355eabfd70
**Reviewed head:** 6237e2915e47ecee3b791e1d48b69c7a0af21341
Verdict: CLEAR. N-1, N-2 and N-3 are closed. Two new non-blocking observations, O-1 and O-2, do not gate this candidate.

This is still an Opus context, not GPT-6 Sol.

## Range checked

`b6e1a293..6237e291` contains two commits: 96d790b4 (fixes) and 6237e291 (biome format).

- Files changed: `data-model.md`, `runbook.md`, `migration-ledger.md`, the 0119 integration test, and a new `tests/api/database/unanchored-tables-unreferenced.test.ts`.
- `git diff --stat b6e1a293..6237e291 -- apps/api/drizzle apps/api/src` is empty. **No SQL or TypeScript behaviour changed**, so the earlier live results still hold for this head.

## N-1: closed

- The runbook no longer claims that deleted deliveries are regenerated. It says the delete is final and that it cascades to `outbox_dedupe_reservation`. It also says to keep the printed rows in the release record.
- The ledger adds a "Forward design constraint (notifications runtime)" paragraph. It says instance events must not fan out through `notification_delivery`, and that the table's `workspace_id` must not be made nullable. Instance events need a separate delivery path.
- The ledger now also records the ON UPDATE change from cascade to no action on both replaced FKs.

## N-2: closed

`data-model.md` now records each change with its constraint name and migration number:

- `team_workspace_id_id_unique` on `team`;
- `outbox_event_id_workspace_id_unique` on `outbox`;
- the `notification_delivery` composite FK, including ON DELETE CASCADE, ON UPDATE NO ACTION and the null-workspace consequence;
- the `saved_view.shared_with_team_id` composite FK.

## N-3: closed by a structural guard

The new guard test is non-vacuous.

- **Clean export:** `git archive 6237e291` was extracted into the scratchpad, with node_modules symlinked. `vitest run --config vitest.config.ts tests/api/database/unanchored-tables-unreferenced.test.ts` passed 2 of 2. Its built-in temp-copy self-test also passed.
- **Mutation on the exported real `apps/api/src`:** I added `src/zz/probe.ts` once per shape. The guard **failed** and named `zz/probe.ts` for:
  - an `approvalTable` import;
  - `select * from custom_field_value`;
  - `DELETE FROM approval`.
- After the probe was removed, the guard passed again. I deleted the export afterwards. The candidate worktree is clean.

## New non-blocking observations

- **O-1: the guard is a tripwire, not a proof.**
  - It did **not** detect these shapes:
    - `select * from public.approval` (schema-qualified);
    - `sql.identifier("approval")`;
    - computed property access to the schema export;
    - `db.query.approval`.
  - It only scans `apps/api/src`; `packages/*` and `apps/web` are outside it.
  - Today those packages do not touch the database. Code review on the custom-fields and approvals runtime PRs is still the real gate.
  - Optional hardening: also match `\.approval\b` / `"approval"` and `public\.`-qualified names.
- **O-2: stale outbox row in `data-model.md` (pre-existing, not introduced here).** The `outbox` row still says `workspace_id` is **not null**. That has been stale since 0110, and it now contradicts the new `notification_delivery` text about events with a null workspace. Correct it in a follow-up doc edit.

## Not re-run

- Live Postgres probes. The SQL and TypeScript are byte-unchanged since b6e1a293, so the earlier container results carry over.
- The integration test edit, which replaces "last journal entry" with a `when` greater than 0118's. I reviewed it by reading only; it is correct and less brittle.
- CI and GitHub state.

No container was started for this re-check.

---

# Rebind after rebase onto main d743ae32 (#619)

Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:aecdf41355eabfd70
**Reviewed head:** 960120da853c1b738b0f1a869ed6d52e318c6b99
Verdict: CLEAR. The rebased head is equivalent to 6237e291. My earlier findings (CLEAR, with O-1 and O-2 non-blocking) carry over unchanged.

This is an Opus context, not GPT-6 Sol.

## Checks

- **Base:** `origin/main` = `d743ae32591ff603d1e338712e63537fe6844080`, and it is the merge base of 960120da.
- **Range-diff:** `git range-diff 6568fc3e..6237e291 origin/main..960120da` maps all 3 commits with `=`:
  - b6e1a293 to d88d84c4;
  - 96d790b4 to de9ec290;
  - 6237e291 to 960120da.
- **The patches are byte-identical:** `git diff 6568fc3e..6237e291` and `git diff origin/main..960120da` compared equal with `cmp`.
- **#619 does not overlap with 0119.**
  - #619 changed 11 files:
    - `apps/api/src/{attachment/index.ts, index.ts, openapi.ts, storage/shared.ts, task/index.ts, utils/request-origin.ts}`;
    - `docs/07-planning/security-reviews/599-public-origin-rebuild.md`;
    - `tests/api-integration/{attachment, task-image-upload}.test.ts`;
    - `tests/api/{request-origin, two-entry-host}.test.ts`.
  - None of these is a file the 0119 candidate touches. The file lists share no entries.
- **The tree delta matches #619 exactly.** `git diff --name-only 6237e291 960120da` lists exactly #619's 11 files. Nothing under `apps/api/drizzle`, `apps/api/src/database`, the 0119 tests, `data-model.md`, `runbook.md` or `migration-ledger.md` differs.
- **Main added no migration** in `6568fc3e..d743ae32`, so 0119 is still the next index.
- **The 0119 SQL SHA-256 at 960120da is still `7ce96b3b…110b`**, which matches the ledger.
- `apps/api/src/index.ts` changed on main, but it is not a 0119 file, and 0119 does not change runtime code.

## Not re-run

- Tests and live database probes. The patch is byte-identical and does not interact with #619's files.
- CI and GitHub state.

No container was started, and the worktree is clean.
<!-- END REPORT aecdf41355eabfd70 960120da -->

