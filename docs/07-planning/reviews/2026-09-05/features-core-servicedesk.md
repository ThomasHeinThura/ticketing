# Spec audit — core work management + service desk (TaskDesk v2)

**Question answered:** could an implementer build each feature from its spec without guessing?

**Baseline documents used for cross-checking**

- `docs/03-features/README.md` — the template and the four rules
- `docs/01-architecture/data-model.md` — table/column existence
- `docs/01-architecture/rbac.md` — capability names, customer rules, 404/403, route policy rule
- `docs/01-architecture/adr/0011-ticket-lifecycle-engine.md` — state groups are the only fixed vocabulary
- `docs/01-architecture/api-design.md` — read as supporting context (concurrency `version`, filter grammar, `/api/portal/*`)

**Verdict scale:** ready · ready-with-fixes · not-ready
**Severity:** high = wrong/insecure implementation or a document-to-document contradiction · medium = a real gap the implementer must guess at · low = polish

---

## 1. `work-items.md` — P1

## 2. `views.md` — P1

**Verdict: ready-with-fixes** (behaviour is excellent; the template sections that guard security are the weak part)

31 numbered rules, genuinely testable, with good accessibility detail (`VW-14` keyboard drag) and a correct restatement of ADR 0011 in `VW-9` (drag = transition, not field write). Edge cases are answered well.

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| High | `VW-23` "Export the current view to CSV" has **no capability**. rbac.md defines `report:export`, and this spec's Permissions section says only that reading a view needs `work_item:read`. A bulk data-egress path with no declared capability is the exact class of hole the rbac route-coverage test exists to prevent. | Add `report:export` (or a new `work_item:export`) to the permissions table and to the export route; decide whether export is server-side (a route, hence a policy) or client-side from already-fetched rows, and say which. |
| High | `VW-2` (layout per project per user), `VW-6` (density), `VW-15` (collapsed groups persist), `VW-19` (chosen columns persist per project per user), `VW-21` (column widths persist) all require **per-user UI preference storage that does not exist** in the data model. `saved_view` is a shared/query object, not a preference store. | Add a `user_preference (person_id, scope, scope_id, key, value jsonb)` table to the data model, or state explicitly that all five are `localStorage`-only and therefore not synced across devices. |
| Medium | **No permissions table.** The template requires one ("Which capability guards which action. A table."); this spec has one prose paragraph. Per-layout actions (inline edit in `VW-17`/`VW-22`, drag-to-set-field in `VW-13`, calendar date drag in `VW-26`, timeline resize in `VW-29`) each need a capability and none is named. | Add the table: inline state edit → `work_item:transition`; inline assignee → `work_item:assign`; priority → `work_item:set_priority`; date drag → `work_item:update`; rank drag → `work_item:rank`; export → `report:export`. |
| Medium | **No API section with policies.** The template requires "Endpoints, with their policies"; this spec says only "All layouts read from `POST /api/work-items/search`". The CSV export and the persistence of column/layout choices imply further routes that are never listed. | List every route the feature touches with its policy, including export and preference persistence, or state that none exists beyond `POST /api/work-items/search` (`work_item:read`). |
| Medium | `VW-31` offers **"SLA state"** as a filter and `VW-16` an SLA badge in list rows, but the data model is explicit that "**SLA state is never stored** … computed on read". The spec never says how a computed value is filtered or sorted in SQL over 10,000 rows. This is the single hardest thing in the spec and it is unaddressed. | Specify the mechanism: a generated/denormalised `sla_due_at` column maintained on write, a SQL function the filter grammar compiles to, or a documented restriction that SLA filtering is post-fetch and therefore only valid inside a page. Cross-reference `sla.md`. |
| Medium | `views.md` is P1 but `VW-16`/`VW-31` depend on SLA (P2), and `VW-31` also filters by cycle, module and epic (P5, `agile.md`). "Depends on: work items, states" omits both. | Split the filter list by phase, and update **Depends on**. |
| Low | `VW-31` includes an `organisation` filter, but `work_item` has no `organisation_id`; it is reachable only via `project.organisation_id`. | Say the filter resolves through the project join, so the filter-grammar whitelist has a defined field path. |
| Low | Feature flag is `feature.gantt` but the layout is called **Timeline** everywhere else. | Rename the flag `feature.timeline`. |
| Low | Tests are described ("filter grammar compilation; grouping; rank arithmetic") rather than **named**, which the template asks for. Same pattern in every spec in this group. | Give each test an id/name that cites the rule it proves, e.g. `VW-9 illegal drag transition is refused`. |

---

## 3. `projects-and-engagements.md` — P1 (structure in P2)

## 4. `relations-and-hierarchy.md` — P1

## 5. `comments-and-activity.md` — P1

**Verdict: not-ready** (the visibility model is excellent; the activity-visibility rule that protects it is left to the implementer's judgement, and three referenced entities have no schema)

`CA-3` (filter internal comments server-side in the portal router, "never in the client, never by a CSS class") and `CA-4` (visibility immutable after posting) are exactly right and align with `api-design.md`'s separate `/api/portal/*` router and rbac.md's customer rules. The named test `portal-never-returns-internal.test.ts` is the best test in the corpus.

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| High | `CA-7` "Activity rows have visibility too. State changes are **usually** public; assignee changes are internal, because customers do not see staff names." "Usually" is not testable, and this is the rule that decides whether rbac.md's "Customers may never see staff names on internal activity" holds. An implementer must invent the field→visibility mapping — and a wrong default leaks staff identity to customers. | Replace with an exhaustive table: every `activity.verb`/`field` the system writes, mapped to `public` or `internal`, with `internal` as the default for anything unlisted. Make the fallback explicit ("an unmapped verb is internal") so adding a field later fails closed. |
| High | `CA-17` "Editing is allowed for 15 minutes by the author, after which the comment shows 'edited' with a **hover-revealed history**." The `comment` table has `edited_at` and nothing else — there is no comment-version table, so previous bodies are not retained and the history cannot be rendered. The rule is also ambiguous: is editing *forbidden* after 15 minutes, or merely marked? | Decide and state: editing is refused after 15 minutes except with `comment:update_any`; and add a `comment_version (comment_id, number, body, edited_by, created_at)` table to the data model, or drop the history affordance. |
| High | `CA-19`/`CA-20` canned responses reference a workspace-level snippet entity with placeholder substitution. **No such table exists** in the data model, no permissions row governs creating them, and no API route is listed. | Add a `canned_response (workspace_id, name, body jsonb, ...)` table, a capability (or reuse `workspace:manage_settings`), and CRUD routes with policies — or move canned responses to a later phase and delete `CA-19`/`CA-20`. |
| Medium | `CA-2` "The default is configurable **per project**" — no column exists on `project` for default comment visibility, and `settings-hierarchy.md` is P4 while this spec is P1. | Add `project.default_comment_visibility` to the data model, with the recommended `internal` default stated as the seed value. |
| Medium | **No `## Open questions` section, no `## Data` section, no `## Out of scope`.** The README rule is that Open questions "must be empty before implementation starts"; an absent section cannot be confirmed empty. | Add the three sections; Data should name `comment`, `activity`, `attachment` and the new tables above. |
| Medium | `PATCH /api/comments/{id} → "author within window, or comment:update_any"` and `DELETE /api/comments/{id} → "author, or comment:delete_any"` are not policy declarations in rbac.md's `{ capability, scope }` form, so the route-coverage CI test has nothing to bind to. The permissions table compounds this by guarding *editing* with `comment:create`. | Express as a capability plus a documented ownership predicate, e.g. `{ capability: 'comment:update_own', scope: 'work_item' }` with `comment:update_any` as the override — and add `comment:update_own`/`comment:delete_own` to rbac.md, which currently has only the `_any` forms. |
| Medium | `CA-16` "Drafts persist per work item per user, surviving a closed tab" — no storage mechanism named and no table exists. Same missing per-user store as `views.md`. | State `localStorage` (and therefore per-device), or add the table. |
| Medium | Edge case "Comment on a deleted work item → Deleted with it" collides with `WI-21` (deletion is soft for 30 days). If comments are removed at soft-delete, a restore within the window returns an empty conversation. | Say comments are hidden at soft-delete and removed at purge. |
| Low | `CA-10` "Activity is never edited or deleted" versus `WI-21` "purged with its comments, activity and attachments" after 30 days. Reconcilable (archive ≠ delete ≠ purge) but the reader has to do that work. | Add a clause to `CA-10`: "…except when the parent work item is purged at the end of the soft-delete window." |
| Low | `CA-11` lists Tiptap marks including tables and images, but no maximum document size or node-count limit is given for a `jsonb` body. | State a size cap, consistent with the 422 validation contract. |

---

## 6. `attachments.md` — P1

**Verdict: not-ready** (one cross-spec behavioural contradiction, plus the upload state machine has no columns to run on)

`AT-2` (presigned direct upload, API never proxies bytes), `AT-5` (five-minute presigned download after a policy check) and `AT-4` (an attachment on an internal comment is always internal, whatever its own flag says) are all correct and defensively worded.

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| High | Edge case "Customer uploads to a resolved request → Allowed within the reopen window; **reopens the request**". This is a state transition performed by a customer, but rbac.md gives customers no `work_item:transition`, ADR 0011 says every state change goes through the workflow graph, and `WI-9`/`VW-9` say state changes are never a plain field update. Nothing says which transition is used, whether it must be legal in the workflow, what happens when no legal reopen transition exists, or how long the "reopen window" is. | Specify: the reopen is a system-actor transition to the workflow's designated reopen target; if the workflow has no such transition the upload is accepted and the item stays resolved with a flagged activity row. Define the window length and where it is configured. Cross-reference `workflows.md` and `customer-portal.md` so all three agree. |
| High | `AT-7` "Deleting is soft; the object is removed the following night by `attachment-gc`" and the edge case "Row stays `pending`; cleaned up after an hour" both require columns the `attachment` table does not have — there is **no `status` and no `deleted_at`** in the data model, only `object_key`/`filename`/`mime_type`/`size`/`customer_visible`/`uploaded_by`. The presign→complete flow (`AT-2`, and the MIME-vs-magic-bytes rejection "at `complete`") is unimplementable without a status column. | Add `status ('pending'\|'ready'\|'deleted')` and `deleted_at` to `attachment` in the data model, and state the two GC jobs (`attachment-gc` nightly, pending-cleanup hourly) in `background-jobs.md`. |
| High | Permissions: "Delete anyone's → `comment:delete_any`". An attachment on a *work item* (not a comment) would be deleted using a *comment* capability; rbac.md has no attachment capabilities at all. This grants attachment deletion to anyone holding comment moderation, and denies it to project admins who do not. | Add `attachment:delete_any` to rbac.md, or state that attachment deletion is governed by `work_item:update` plus ownership with `comment:delete_any` as the override — and make the API row match. |
| Medium | `AT-1` says files attach to "a work item, to a specific comment, or to a **submission**", but the data model's `attachment` has only `work_item_id \| comment_id` — no `submission_id` — and no non-portal route exists for submission attachments. Attachments arriving with an intake submission are a core service-desk flow. | Add `submission_id` to `attachment` (nullable, with the three-way exclusive check stated) and list the route. |
| Medium | Two routes have no policy in rbac.md's form: `POST /api/portal/requests/{ref}/attachments/presign → "(portal session)"` and the Permissions row "Upload → `work_item:update`, **or portal session on own request**". "Portal session" is an authentication fact, not an authorisation policy. | Declare the portal policy explicitly, e.g. `{ capability: 'portal:attach', scope: 'submission', requires: 'requester is the session person' }`, and add the capability to rbac.md. |
| Medium | **No `## Open questions`, `## Data`, `## Screens` or `## Out of scope` sections.** | Add them; Data should name `attachment` and its new columns. |
| Medium | "Defaults, all configurable in God Mode" (25 MB, 100 files) names no setting keys and no table. `instance_setting` is a singleton row with no such columns declared. | Name the keys and where they live, so the God Mode spec and this one agree. |
| Low | `AT-6` "Every download writes an audit row" — with `audit_log` retained 12 months and downloads being frequent, this is a volume decision with no stated action name. | Name the action (`attachment.download`) and confirm the retention policy is intended to cover it. |
| Low | `AT-9` "PDFs preview in a sandboxed viewer" — no CSP/sandbox requirements stated, though `security-model.md` presumably owns them. | Link to the security model's sandbox requirements. |

---

## 7. `search-and-saved-views.md` — P1

**Verdict: not-ready** (the saved-view sharing model does not map onto the `saved_view` table, and half the routes carry no policy)

The search half is strong: `SV-3` (scoped to reach, out-of-reach records simply absent) matches rbac.md's 404 doctrine, `SV-12` (whitelisted fields, parameterised SQL, "can never express arbitrary SQL") matches `api-design.md`, and `SV-5`'s 100 ms budget is a real, testable requirement.

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| High | `SV-15` "Views have three scopes — **private, team, workspace**" does not map onto `saved_view (owner_id, scope, scope_id, name, query, shared_with_team_id, layout)`. In the data model `scope`/`scope_id` read as the *context* the view applies to (a workspace or a project), and `shared_with_team_id` handles team sharing — so "private vs team vs workspace" is a *different* axis with no column. An implementer must guess whether to overload `scope` or add a column, and guessing wrong makes private views visible. | Add `visibility ('private'\|'team'\|'workspace')` to `saved_view` in the data model and state that `scope`/`scope_id` remain the query context. Then restate `SV-15`–`SV-18` against the two axes. |
| High | Five of the nine routes declare no capability: `GET /api/search → "(scoped to reach)"`, `GET /api/views → "(scoped)"`, `POST /api/views → "(per scope)"`, `GET /api/views/{id} → "(per scope)"`, `POST /api/views/{id}/pin → "(self)"`, and `GET /api/views/{id}/count → "(cached 30s)"` — which is a caching note, not a policy at all. rbac.md's route-coverage test fails the build on exactly this. | Give every route a `{ capability, scope }` or `{ public: true, reason }`. Introduce `saved_view:create_shared` (or reuse `workspace:manage_settings`) and a documented ownership predicate for the private ones. |
| High | `SV-17` "editable by the owner and **team leads**" and the edge case "ownership transfers to a **team lead**, or to the workspace" — there is no team lead concept. `team_member` is `(team_id, person_id, allocation_pct)` with no role or lead flag; the only `lead_id` in the data model is on `module`. Two rules therefore depend on an entity that does not exist. | Add `team_member.is_lead boolean` (or `team.lead_id`) to the data model, and name the background job that performs ownership transfer when a person is deactivated. |
| Medium | `SV-14` "A saved view stores: filter, sort, grouping, layout, and **chosen columns**", but `saved_view` has only `query` and `layout`, and `api-design.md` states that `saved_view.query` holds *exactly* the filter document ("the same document is what `saved_view.query` stores"). Sort, grouping and columns have nowhere to live. | Either widen `query` to a documented envelope (`{ filter, sort, groupBy, columns }`) and correct `api-design.md`, or add columns. Say which. |
| Medium | `SV-20` "Views can be pinned to the sidebar, **per user**" — no pin table, and the same missing per-user preference store as `views.md` `VW-2`/`VW-19`/`VW-21`. `POST /api/views/{id}/pin` implies server-side persistence. | Resolve with the single `user_preference` table proposed in §2, and have both specs cite it. |
| Medium | `SV-1` says the palette searches "work items, projects, **people**, saved views, knowledge base articles". Whether customers get the palette at all, and what "reach" means for a *people* search, is never stated — rbac.md is explicit that customers must never see other organisations and must not see staff names on internal activity. | State that the palette is agent-side only (`/api/search` is not exposed through `/api/portal/*`), or define the customer-visible subset per kind. |
| Medium | `SV-9` "Trigram similarity as a fallback for typos" requires the `pg_trgm` extension and its own index; neither appears in the data model's indexing section, which defines only the `tsvector` GIN index. | Add the extension and the trigram index to the data model. |
| Medium | **No `## Open questions`, `## Data`, `## Screens` or `## Out of scope` sections.** | Add them. |
| Low | `SV-22`/`SV-23` queue counts "cached for 30 seconds" — cache location unspecified (Valkey is optional per `api-design.md`'s rate-limit note). | State the cache and the behaviour when Valkey is absent. |
| Low | `SV-10` gates a Meilisearch plugin on Postgres being "measured to be insufficient" but names no threshold, while `SV-5` gives a hard 100 ms budget. | Tie them together: the plugin is considered when the `SV-5` budget is missed at a stated corpus size. |

---

## 8. `assignment.md` — P1

**Verdict: ready-with-fixes** (the best-formed spec in the group — full template, Open questions empty, a genuinely good test plan)

`AS-6` (compare by person id, not display name), `AS-8`/`AS-9` (never silently unassign) and `AS-5` (assignable list is the project roster, filtered server-side — "the client never filters this itself") are precise and testable. `AS-15` explicitly rules round-robin out of scope, which is exactly what an "Out of scope" section is for.

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| High | `AS-13` "A workflow transition may set or clear the assignee" requires **transition effects**, and `workflow_transition` has no column for them — it has `note_policy`, `note_visibility`, `requires_approval`, `requires_cab` and `guard` jsonb, all of which are gates, not actions. The same missing mechanism is implied by `sla.md`'s pause-on-transition and `workflows.md`. An implementer must invent an effects schema. | Add `workflow_transition.effects jsonb` to the data model with a documented, whitelisted effect vocabulary (`set_assignee`, `clear_assignee`, `pause_sla`, `resume_sla`, `set_field`), and have `workflows.md` own the vocabulary so `assignment.md` and `sla.md` both cite it. |
| High | `AS-1` "A **manager or lead** may assign work to anyone on the project roster" and `AS-2` "A **member** may assign work to themselves" state authority in terms of role names, which rbac.md lists verbatim as an anti-pattern (`// ✗ role name check in a handler`). The permissions table below correctly uses capabilities, so the two halves of the spec disagree about what is being enforced. Worse, **no document states which capabilities each built-in role holds**, so an implementer cannot derive the seed roles or rbac.md's "permission matrix test" fixture from anything. | Reword `AS-1`/`AS-2` in capability terms (`work_item:assign` for others; `work_item:update` for self). Separately — and this is corpus-wide — add a role × capability matrix to rbac.md as the source for both the seed data and the fixture. |
| Medium | `AS-12` "A **request type** may set a default assignee, overriding the project's" — `request_type` has no default-assignee column in the data model (`project.default_assignee_id` does exist, so `AS-11` is fine). | Add `request_type.default_assignee_id` to the data model, or delete `AS-12`. |
| Medium | Edge case "Assignee's account deleted → Assignment **tombstoned to 'Former member'**. History preserved." The data model requires every FK to declare an explicit `ON DELETE`; `SET NULL` loses the tombstone and `CASCADE` is catastrophic. The spec does not say how the identity survives deletion, and `person.active` (soft deactivation) is a different thing from deletion. | State that people are never hard-deleted (`person.active = false` only), and that `work_item.assignee_id` is `ON DELETE RESTRICT` — or define a tombstone mechanism. |
| Medium | Edge case "Two people self-assign simultaneously → **Optimistic concurrency**; the second is told who won", but assignment is a `POST` action route, and `api-design.md` scopes `If-Match`/`version` to `PATCH`. How an action route participates in optimistic concurrency is undefined. | Either accept an optional `If-Match` on the assign action, or specify a conditional update (`WHERE assignee_id IS NULL`) returning 409 with the winner. |
| Medium | `POST /api/work-items/bulk/assign → "per-item capability"` — same non-policy as `work-items.md`'s bulk route; the route-coverage test rejects it. | Declare the route's own policy plus a per-item re-check rule. |
| Low | `AS-16`–`AS-18` describe three notification behaviours but name no event kinds, so `notifications.md` and `notification_preference.event_kind` have nothing to bind to. | Name them (`work_item.assigned`, `work_item.unassigned`). |
| Low | `AS-10` "A report lists work assigned to inactive people" — no route, no screen, no capability; reporting is P5. | Either mark it P5 and cross-reference `reports-and-dashboards.md`, or make it a saved view with a stated definition. |
| Low | The `person-picker` shows "current open work count" — "open" again is not one of the five `state.group` values (ADR 0011). | Define as `state.group not in ('completed','cancelled')`. |

---

## 9. `agile.md` — P5

**Verdict: ready-with-fixes** (P5, so the gaps are not near-term blockers, but one directly contradicts the data model)

18 numbered rules across three sub-features, a permissions table using only capabilities that exist (`project:read`, `project:manage_settings`, `work_item:update`), and a good edge-case table. `ES-2` (store a reference to an `estimate_point` row, never a raw number) is exactly right and matches `work_item.estimate_point_id`.

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| High | `CY-3` "Status is derived from dates: `upcoming`, `active`, `completed`. It is **not stored** and cannot be set by hand" directly contradicts the data model, where `cycle` has a `status` column. An implementer will either add a column the spec forbids or ignore a column the schema declares. | Pick one. If derived, remove `cycle.status` from the data model; if stored (which `CY-6`'s completion flow arguably needs — "completed" is an *event*, not just a date passing), reword `CY-3` to say `upcoming`/`active` are derived and `completed` is set by the completion action. |
| High | `CY-7` (burndown) and `CY-9` (velocity over the last three cycles) have **no data source**. A burndown needs per-day scope/completed snapshots; nothing in the data model stores them, and `activity` would have to be replayed per render for `GET /api/cycles/{id}/burndown`. | Add a `cycle_snapshot (cycle_id, date, scope_points, completed_points, item_count)` table written by a daily job, or state explicitly that the burndown is reconstructed from `activity` and accept the cost. Name the job either way. |
| Medium | `CY-6` "incomplete items are handled **per the project's setting**" — no such setting exists on `project` or in `project_feature_flag`. | Add the column (`project.cycle_rollover_policy`) or state that the choice is made only at completion time with no stored default. |
| Medium | `ES-3` "Existing estimates **map where an equivalent exists**" gives no mapping rule. Does 5 points map to M? Does 1d map to 8? Without a stated mapping the preview and the result cannot agree, which the integration test explicitly requires. | Define the mapping (or state that no cross-system mapping exists and every estimate is cleared, which is simpler and honest). |
| Medium | The permissions table says "Create, edit, **delete**" but there is no `DELETE` route for cycles or modules, no `PATCH`/`GET` for a single module, and no route to remove a work item from a cycle. Each missing route is a missing policy under rbac.md's coverage test. | Complete the route table. |
| Medium | `projects-and-engagements.md` states plainly that a managed service has **no cycles** ("Planning: Backlog, cycles, milestones" vs "No cycles"), but `agile.md` never restricts cycles by `project.kind` — `CY-1` says only "a cycle belongs to a project". | Add a rule: cycles may not be created on a project whose `kind` is `managed_service`, enforced server-side, not only by hiding the tab. |
| Medium | **No `## Open questions` section** (and no `## Data` section). | Add both; Data should name `cycle`, `module`, `estimate`, `estimate_point`. |
| Low | `CY-9` velocity is "mean completed **points**" but `ES-1` allows `categories` and `time` systems, where "points" is undefined. | State that velocity is available only for the `points` system, or define the numeric projection for the other two. |
| Low | Routes are `/api/projects/{key}/cycles` while `api-design.md`'s canonical form is `{projectId}`. | Harmonise. |

---

## 10. `workflows.md` — P2

## 11. `sla.md` — P2

**Verdict: not-ready** (the computation model is the best-argued thing in the corpus; the configuration it computes *from* is largely missing from the data model)

`SLA-4`–`SLA-9` are precise to the minute, and the test list (DST both directions, holiday inside a pause, creation outside cover, reopen) is the strongest in the whole document set. `SLA-21` matches rbac.md's customer rule exactly. `sla-scan` at 5 minutes is confirmed present in `background-jobs.md`.

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| High | `SLA-1`'s resolution order — "work item type override → request type → project → workspace default" — has **no storage for two of its four levels**. `work_item_type.sla_policy_id` and `request_type.sla_policy_id` exist; `project` has **no `sla_policy_id`** (only `service_calendar_id` and `support_level`), and there is **no workspace-default SLA policy** column anywhere. Policy resolution is the first thing the engine does, and two of its four steps are unimplementable. | Add `project.sla_policy_id` and a workspace default (a column on `workspace`, or an `is_default` flag on `sla_policy`) to the data model. |
| High | The Data section names **`work_item_sla_cache`**, which does not exist in `data-model.md` — even though `SLA-14`, `background-jobs.md` and ADR 0009 all depend on it, and `views.md` `VW-31`'s SLA filtering has nowhere else to go. Three documents reference a table the schema does not define. | Add `work_item_sla_cache (work_item_id, metric, state, due_at, computed_at)` to the data model, with the ADR's caveat that it is for edge detection and list filtering only, never the source of truth. |
| High | `SLA-10` "A **policy** declares which states pause the clock" — `sla_policy`, `sla_policy_version` and `sla_goal` have no such column, and states are project-scoped while policies are workspace-scoped, so a policy cannot enumerate them by id anyway. See §10: this also collides with `workflows.md`'s transition-effects model. | Resolve with the single owner chosen in §10 (recommended: transition effects). If it stays on the policy, it must reference something workspace-level, which returns to the state-scoping problem. |
| Medium | `at_risk` is defined as "75%–100% consumed. **The threshold is configurable per policy**", but `sla_policy` has no threshold column. | Add `sla_policy.at_risk_threshold_pct` (default 75) to the data model. |
| Medium | Edge case "Work item moved to a project with a different policy → **New policy applies from the move**, computed against original creation time" contradicts `SLA-3` ("the version effective at the work item's **creation** is used. Changing a policy never rewrites whether past work was met") and is internally ambiguous — "from the move" and "against original creation time" describe two different computations. | Rewrite as a single unambiguous rule; recommended: the policy resolved at creation is pinned for the item's life, and a move records an activity row without changing the goal. |
| Medium | `SLA-11` opens pauses automatically on entering a pausing state, while the Permissions table and the API expose **manual** `POST /sla/pause` and `/sla/resume`. Nothing says how the two interact — whether a manual pause can nest inside an automatic one, or who wins. Testing lists "overlapping (rejected)" but not which of the two is rejected. | Add a rule: at most one open `sla_pause` per work item per metric; a manual pause while an automatic one is open returns 409; automatic close does not close a manual pause. |
| Medium | `SLA-7` "`first_response` stops at the first public comment **by a staff member**" — agrees with `comments-and-activity.md`'s table, but neither spec says what happens on an internally-raised item where the requester *is* staff, nor whether a transition-note comment (`WF-12`) counts as the first response. | Answer both explicitly; the second is a genuinely common case. |
| Medium | `SLA-15` "Once each, per work item, **per metric**" requires the cache to be keyed by metric; the Data section does not say so, and the missing table (above) means the key is unspecified. | Include `metric` in the cache's primary key when adding the table. |
| Low | Edge case "Pause never closed → Alerted after 30 days; the item appears in a 'stale paused' report" names no job and no report. `background-jobs.md` has `reminder-scan`, which is the plausible home. | Assign it to `reminder-scan` explicitly. |
| Low | `SLA-17` escalation "waiting the configured interval between levels" maps to `stakeholder.escalation_order` / `escalation_wait_minutes`, which do exist — but the spec never says what happens when a project has no stakeholders. | State the fallback (no escalation, or the project's default assignee). |

---

## 12. `service-calendars.md` — P2

## 13. `request-types-and-catalogue.md` — P2

**Verdict: not-ready** (the per-organisation catalogue — a tenant-visibility control — is specified in prose with no storage, no route and no test)

The form-schema example with `mapsTo` value translation (`RT-4`, impact → priority) is excellent product thinking, and `RT-6` (immutable versions so old submissions stay interpretable) matches `request_type_version` exactly. `RT-13` ("deflection is never coercive") is the right call.

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| High | `RT-7`/`RT-8` — "visible in the portal only if `customer_visible` **and its group is enabled for the customer's organisation**", "one customer sees eight request types, another sees three" — and the permissions row "Assign a catalogue to an organisation" together describe a **per-organisation visibility control that has no table, no column, no API route and no test**. `request_type.group` is a plain text column. This is what a customer is allowed to see, so a guess here is a tenant-visibility bug. | Add the mapping table (`organisation_request_type` or `organisation_catalogue_group`), the routes to manage it, a numbered rule for the default when no mapping exists (recommended: deny), and an integration test that a request type not assigned to an organisation is invisible **and** unsubmittable by a crafted request. |
| High | `GET /api/request-types` is guarded by `request_type:manage`, and rbac.md has no `request_type:read`. But `IQ-7` requires a triager (who holds `intake:triage`, not `request_type:manage`) to see the request type's pre-filled project and work item type when accepting a submission. As specified, triage cannot read the data it needs. | Add `request_type:read` to rbac.md and guard the list/get routes with it; keep `request_type:manage` for writes. |
| Medium | `RT-15` "A request type may be marked **auto-accept**" — no such column on `request_type`, and `IQ-4` depends on it. | Add `request_type.auto_accept boolean` to the data model. |
| Medium | `RT-5` "Fields support **conditional visibility**" and the edge case "Conditional field whose controlling field is removed → Validation at publish rejects it" both depend on a conditional syntax that the documented `form_schema` example does not contain. | Extend the example with the conditional form (e.g. `"showIf": { "field": "impact", "equals": "Everyone" }`) — the publish validator and the portal renderer both need the exact shape. |
| Medium | `RT-12` "Opening an article records a **deflection candidate** … counts as a deflection in reporting" — nothing stores deflection events, and `GET /api/portal/deflection` only reads. | Add a `deflection_event` table (or state that deflection is measured from existing analytics) and the route that records it. |
| Medium | `RT-16` "Drafts are persisted per request type per version, so a half-completed form survives a closed tab" — no storage named. Third occurrence of this gap (`VW-2`, `CA-16`). | Resolve with one decision across all three specs: browser storage, or a table. |
| Medium | Four portal routes declare "(portal session)" as their policy, which is authentication, not authorisation — rbac.md's coverage test requires a capability or an explicit `public: true` with a reason. | Define the portal policy form once (in `customer-portal.md` or `api-design.md`) and reference it here; the catalogue route in particular needs the organisation-scoping predicate spelled out. |
| Medium | No `DELETE` or unpublish route, though the edge-case table describes both behaviours ("Refused. Must be **unpublished** first"). | Add both routes with their capabilities. |
| Low | `RT-10` "The catalogue is searchable, and searching also matches knowledge base articles" — KB is P5 while this is P2. | Mark the KB half of the search as P5-gated. |
| Low | `RT-14` names `SUB-n` but the counter that generates `n` is defined nowhere (see §14). | Cross-reference the fix in `intake-queue.md`. |

---

## 14. `intake-queue.md` — P2

**Verdict: not-ready** (two high-severity issues: an SLA clock that the SLA spec cannot measure, and a durable customer page whose authentication is left open)

This is otherwise one of the better specs — `IQ-16a` (withdrawal is refused the moment a triager acts) is unusually careful, the acceptance flow is properly transactional ("Attachment fails to transfer → Acceptance rolls back"), and the answer to "intake statuses vs work-item states" is correct: submission statuses are a deliberately separate lifecycle, not a shadow copy of `state`, and `IQ-14`'s conversion boundary is explicit. No contradiction there.

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| High | `IQ-14` "The **first-response SLA clock** … starts at submission and stops at the first staff message" cannot be implemented against `sla.md`, where `dueAt` is computed from the **work item's** creation (`SLA-4`), policy resolution needs a work item type (`SLA-1`), and `sla_pause`/`work_item_sla_cache` are keyed by `work_item_id`. A submission has no work item until acceptance. Worse, nothing says whether the accepted work item's clock starts at **submission** or at **acceptance** — the difference decides whether a team is in breach the moment they accept. | Decide and document in both specs. Recommended: `submission.created_at` is copied to the work item as `sla_started_at`, the SLA engine measures from that column rather than `created_at`, and pre-acceptance SLA is computed on the submission using the request type's policy. Add `sla_started_at` to `work_item` and extend the cache key. |
| High | `IQ-3` "A submission has a **durable page** the customer can return to at any time, linkable, **surviving sign-out**." Surviving sign-out implies an unauthenticated URL, but no token, expiry or scoping mechanism is specified, and rbac.md's rules assume 401 for unauthenticated access. As written an implementer may ship a guessable-reference page exposing another organisation's request. | State the mechanism explicitly: either the page requires a portal session and "durable" only means the URL is stable, or it carries a signed, expiring token issued to the requester's email. Add a negative test that `SUB-n` alone grants nothing. |
| High | `IQ-16a` hinges on "the moment a triager takes any action on it — **a queue claim**, a message, or starting acceptance" — but there is no claim concept: `submission` has no `claimed_by`/`claimed_at`, and no claim route exists. The withdrawal rule, which is the interesting part of the spec, cannot be enforced. | Add `submission.claimed_by` / `claimed_at`, a `POST /api/submissions/{ref}/claim` route with `intake:triage`, and state precisely which actions set the flag. |
| Medium | `IQ-2` "It gets a reference `SUB-n`, **unique per instance**" — no counter exists. Work items get theirs from `project.last_work_item_number`; submissions have no equivalent. | Add an instance-level counter (or a sequence) to the data model, and say whether numbers are ever reused (they should not be). |
| Medium | `IQ-19` "Queues are saved filters over **submissions and unassigned work items**", but the filter grammar in `api-design.md` is defined over work items only, with a whitelisted work-item field set, and `saved_view.query` stores exactly that document. A query spanning two entity types has no defined shape. | Either define a submission field whitelist and a `entity` discriminator on the saved query, or make a queue two saved views presented together. |
| Medium | `IQ-15` "longer than a configurable period (**default 14 days**)" — no setting key or column. | Name where it is configured (workspace setting or per request type). |
| Medium | `IQ-18` duplicate suggestions "by text similarity over recent work items in the same organisation" — no algorithm, no threshold, no index. This is also the third reference to trigram/similarity search that the data model's index list does not support. | State the method (`pg_trgm` similarity over `title`, threshold, "recent" = N days) and add the index to the data model. |
| Medium | `IQ-9` "Attachments transfer to the work item" requires `attachment.submission_id`, which does not exist (see §6). | Fix in the data model as part of the attachments change. |
| Medium | `IQ-1` says a submission may be created "by an **API client**", but no non-portal creation route or capability exists in the API list. | Add the route and its capability, or delete the clause. |
| Low | Four portal routes carry "(portal session)" instead of a policy — same recurring defect. | As §13. |
| Low | `IQ-11` "keeping the same URL" after conversion needs the portal to resolve `SUB-n` to a work item; `submission.work_item_id` supports it, but the redirect behaviour after a *declined* or *withdrawn* submission is unstated. | Add the two remaining cases to the edge-case table. |

---

## 15. `approvals.md` — P2

**Verdict: ready-with-fixes** (one of the two best specs in the group; the gap is that the *gate* has no identity)

The "v1 defects being prevented" table with a named test per defect — `customer-cannot-request-cab.spec.ts`, `requester-cannot-self-approve.spec.ts`, `approver-email-not-leaked.spec.ts` — is exactly what the README asks for and the only place in the corpus where tests are genuinely *named*. `AP-8` (nobody approves their own request, enforced in the domain layer independent of capabilities) matches rbac.md's customer rule precisely. Data matches the `approval` table field-for-field.

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| High | `AP-15` "a transition with `requires_approval` is blocked until **a matching** approval is `approved`", plus `AP-5` "Multiple approvals may be pending on one work item. The gate is satisfied by the policy set on the transition: **any** approver, or **all** approvers." Neither "matching" nor the any/all policy has any storage: `approval` has no link to a transition or gate, and `workflow_transition` has only the booleans `requires_approval`/`requires_cab` — no approval-policy column. With two pending approvals raised for different reasons, an implementer cannot determine which satisfies which gate, and the likely guess (any approved approval of the right `kind`) lets an unrelated approval open a change gate. | Add `workflow_transition.approval_policy ('any'\|'all')` and `approval.transition_id` (or a `gate_key`), and state that only approvals raised against that gate count. Add a test with two concurrent approvals of the same `kind`. |
| Medium | `AP-13` "A reminder is sent to the approver at 50% and 90% of the window" — `approval` has no column recording which reminders were sent, so `reminder-scan` (every 15 min) will re-send on every pass. | Add `reminder_50_sent_at` / `reminder_90_sent_at`, or a generic `approval_reminder` row per send. |
| Medium | Permissions: "Decide a CAB approval → `approval:decide_cab` — Must be a **CAB member**", with CAB membership deferred to `service-management.md`. If that spec does not define CAB membership as a queryable set, this rule is unenforceable (see §18 — it does not). | Define CAB membership concretely (recommended: a `team` flagged as the CAB, so `team_member` answers the question) and cross-reference it from both specs. |
| Medium | "Request a CAB approval — Staff only, **change-type items only**" identifies a work item type by its meaning, not by a flag, in a system where types are workspace-editable rows. Same defect as `WF-14`. | Key it off a `work_item_type.is_change` boolean, added alongside the existing `is_epic`. |
| Medium | `GET /api/my/approvals → "(self)"` and `GET /api/portal/approvals → "(self, portal router)"` are not policies under rbac.md's coverage test. | Give both a capability plus a documented self-scoping predicate. |
| Low | Edge case "Work item deleted with a pending approval → The approval is deleted with it" collides with the 30-day soft delete (`WI-21`); a restore would return an item whose gate history has vanished. | Align with the soft-delete decision from §1. |
| Low | Nothing says what happens to a pending approval when the gating transition is edited or removed in a new workflow version (`WF-6`/`WF-7`). | Add an edge case. |
| Low | `AP-4` "Expiry defaults to 7 days, configurable per request, capped at 90 days" — where the 7-day default is configured (instance? workspace? per request type?) is unstated. | Name the setting scope. |

---

## 16. `audit-trail.md` — P2

**Verdict: not-ready** (three fields that the spec treats as load-bearing controls do not exist in `audit_log`, and workspace-scoped access has nothing to scope on)

The conceptual split — "`activity` is a feature, `audit_log` is a control", both append-only — is clearly drawn and is the right model. `AU-2` (record which secret keys changed, never the values) and the deliberate, documented trade in "Audit write fails → the mutation still succeeds" are both good. The generic integration test ("every mutating route writes an audit row — asserted by exercising the route table") is a strong idea.

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| High | `AU-10` "Workspace administrators see audit rows **for their workspace**" and `GET /api/workspaces/{id}/audit` — but `audit_log` has **no `workspace_id`**. Its columns are `actor_id, actor_ip, action, entity_type, entity_id, before, after, created_at`. Scoping would have to be derived per row by resolving every entity type back to a workspace, which is neither indexable nor reliably correct — and the failure mode is a workspace admin reading another tenant's audit rows. | Add `workspace_id` (nullable, for instance-scoped rows) to `audit_log`, populate it at write time, and index `(workspace_id, created_at desc)`. |
| High | `AU-4` "An impersonated action records **both** identities" is a core control (impersonation is one of rbac.md's re-authentication-gated actions), and there is **no column for the second identity**. An implementer will stuff it into `before`/`after` or lose it. | Add `impersonator_id` to `audit_log` and assert it in a test alongside the impersonation feature. |
| High | `AU-1` says rows record "actor id, actor IP, **user agent**, action, entity type, entity id, before, after, **trace id**, timestamp" — `user_agent` and `trace_id` are absent from the table. `trace_id` is what connects an audit row to `observability.md`'s logs and to the `traceId` in `api-design.md`'s error payloads, so losing it breaks the investigation path the whole document exists to support. | Add `user_agent` and `trace_id` to `audit_log`. |
| Medium | **No `## Permissions` table** (the template requires one; access is prose in `AU-10`–`AU-13`), **no `## Open questions` section**, no `## Data`, no `## Out of scope`. | Add all four. The permissions table should map: instance log → `instance:read_audit`; workspace log → `workspace:manage_settings`; entity history → that entity's read capability; export → `instance:read_audit` + re-auth. |
| Medium | `AU-7` "Deleting an organisation **tombstones** its audit rows rather than removing them" — no tombstone column or mechanism exists, and it is unclear what a tombstoned row still shows. | Define it (e.g. `actor_display_snapshot` retained, `organisation_id` nulled with a `tombstoned_at`), or state that organisations are never hard-deleted. |
| Medium | `GET /api/audit/entity/{type}/{id} → "(capability for that entity)"` is not a declarable policy — the route-coverage test needs a concrete capability, and a dynamic per-entity-type policy is exactly the kind of thing ADR 0010's route policy registry is meant to make static. | Either enumerate one route per entity type with its capability, or define a documented policy-resolver form the registry supports. |
| Medium | `AU-3` "Append-only … Enforced by **database grants** as well as by the absence of an endpoint" implies a second database role with no INSERT-only privileges, which is not mentioned in the data model's migration section or anywhere in the deployment docs. | Specify the role and where the grant is applied, or drop the claim to "enforced by the absence of any update/delete path, and tested". |
| Low | "Depends on: nothing", yet the spec audits routes introduced across every phase and mentions impersonation (P4 God Mode) and exports (P5 reporting). | List the real dependencies so the phase ordering is honest. |
| Low | `AU-13` "Reading the audit log is itself audited" combined with `audit_log` retention of 12 months and one row per read is a volume decision made in passing. | Confirm intended, and state whether audit reads are exempt from the purge. |

---

## 17. `customer-portal.md` — P3

**Verdict: not-ready** (the only spec in the group with a non-empty "Open questions", and it is a blocking one; separately, the most security-sensitive router in the product ships 22 routes with zero declared policies)

The security posture is otherwise the strongest in the corpus: `CP-2` (404 not 403), `CP-3` (server-side internal filtering), the separate origin and bundle-purity assertion from ADR 0004, and six genuinely named security E2E tests including `portal-cross-tenant.spec.ts` and `portal-bundle-purity.spec.ts`. The "What a customer may do" table matches rbac.md's customer table row for row, including escalate-but-never-de-escalate and no self-approval — no contradiction between the two documents.

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| High | **"Open questions" is not empty, and the open item blocks more than its own phase.** "Per-request visibility inside a customer organisation … Nothing says whether Alice at Customer A can see Bob's request at Customer A." The README rule is that open questions must be empty before implementation starts, and this one is not cosmetic: the recommended answer adds a `customer_visibility` column to **`work_item` and `submission`** — P1 and P2 tables — plus a God Mode default, a form control and a negative test. Deciding it "before P3" means retrofitting a column and re-auditing every portal query after both tables have shipped. | Decide it now, in P1's data-model pass. The spec's own recommendation (`private \| organisation`, defaulted per organisation, forceable to `private` by request type) is sound — adopt it, add the column to the data model, and add the negative test alongside `portal-cross-tenant.spec.ts`. |
| High | **The API section lists 22 portal routes with no policy on any of them.** rbac.md requires every route to declare `{ capability, scope }` or `{ public: true, reason }`, enforced by a CI route-coverage test; ADR 0010 makes the registry the mechanism. "Every one of these is reviewed as a set" is a process, not a declaration — and this is precisely the router where v1 shipped holes. | Add a policy to every portal route. Define the portal policy form once (session is customer-side + organisation-scoping predicate + capability) so `request-types-and-catalogue.md`, `intake-queue.md`, `approvals.md`, `attachments.md` and `knowledge-base.md` can all stop writing "(portal session)". |
| High | `CP-4` "**Staff assignee names are not shown.** The customer sees the team, not the individual" contradicts sibling specs: `approvals.md`'s portal decision screen shows "what is being asked, **by whom**" and its v1-defect table permits "an approver's display name and avatar"; `AP-17` renders "Waiting on approval from Jane Smith"; public staff comments (`comments-and-activity.md`) are authored by named staff; and this spec's own Projects screen offers "key contacts". An implementer must guess whether to anonymise comment authors in the portal — and either guess produces a visibly wrong product. | State the rule precisely: which staff identities are visible in the portal (recommended: comment and approval authors are named; the *assignee* field is never exposed) and reword `CP-4` accordingly. Add a test asserting `assignee` is absent from every portal response shape. |
| High | `CP-8` "Reopening a resolved request … resumes the SLA clock rather than restarting it", via `POST /api/portal/requests/{ref}/reopen`. Reopening is a **state transition** performed by a customer, and customers hold no `work_item:transition`; ADR 0011 and `WF-9`/`VW-9` require every state change to go through the workflow graph. Which transition is used, whether it must be legal, and what happens when the workflow has no reopen edge are all unstated. The same hole appears in `attachments.md` (§6) and in the edge case "Customer replies to a closed request → Reopens it". | Specify one mechanism for all three call sites: a designated reopen transition on the workflow, executed as a system actor on the customer's behalf, refused with a clear message when no such transition exists. |
| Medium | `CP-9` satisfaction ratings — "a simple scale plus an optional comment, once per request, changeable within the reopen window", with `POST /api/portal/requests/{ref}/rate` — have **no table** anywhere in the data model, despite rbac.md also listing "Rate a resolution" as a customer right. | Add `satisfaction_rating (work_item_id, person_id, score, comment, created_at, updated_at)` with a uniqueness constraint per work item per person. |
| Medium | `CP-7`/the may-do table give "**Escalate** priority (medium → urgent)" as the rule, but that is one example, not a ladder. Whether low → high, or medium → high, is permitted is unstated, and the identical parenthetical in rbac.md means neither document answers it. | State the rule: any strictly-increasing priority change is permitted; any decrease is refused at 403 — and cover it in `portal-cannot-deescalate.spec.ts`. |
| Medium | The Permissions section is prose ("Portal access is granted by holding a role with `scope = customer`…"), not the table the template requires — in the one spec where a table matters most. | Add the table, one row per portal action. |
| Medium | Rule numbering runs `CP-1`…`CP-10`, then **`CP-15`**, then `CP-11`…`CP-14`. Since the README's whole point is that rules are cited by number from tests and code comments, an out-of-order insert is a citation hazard. | Renumber, or append `CP-15` at the end where it belongs. |
| Medium | The Screens table includes a **Knowledge base** screen and the API includes `GET /api/portal/kb` / `{id}`, but `knowledge-base.md` is **P5** and this spec is P3. | Mark the KB screen and its two routes P5-gated behind `feature.knowledge_base`, or move KB forward. |
| Medium | `CP-8`'s reopen window ("configurable, default 14 days") and `IQ-15`'s clarification window (also "configurable, default 14 days") name no setting key, and `attachments.md` refers to "the reopen window" as though it were defined. | Define one setting, name it, and have all three specs cite it. |
| Low | Edge case "Customer replies to a closed request → otherwise **creates a linked new request**" — which request type the new request uses is unstated. | Name it (the original's request type, or the "Uncategorised" default from `IQ-16`). |

---

## 18. `knowledge-base.md` — P5

**Verdict: ready-with-fixes** (P5, and the deflection thinking is good, but four features have no columns and one route breaks the portal-separation rule)

`KB-2` (both `customer_visible` **and** `published` required, "two conditions, deliberately, so an unfinished customer-facing article cannot leak") is the right instinct and matches the `kb_article` columns exactly. `KB-11` restates the non-coercion rule consistently with `RT-13`.

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| High | `GET /api/kb/deflection?q=… → "(either session)"` — a single route serving **both** the agent and portal sessions directly contradicts ADR 0004 and `api-design.md`'s rule that `/api/portal/*` is "a small, hand-audited surface rather than the same handlers with a role check … no chance of a staff-only query parameter being honoured for a customer". `KB-12` (staff see the same suggestions) is a good feature; sharing one handler to deliver it is the exact pattern the architecture forbids. | Split into `/api/kb/deflection` (`kb_article:read`) and `/api/portal/kb/deflection` (portal policy), sharing a domain function but not a route or a request shape. |
| Medium | `KB-7` "Articles carry an **owner** and a **review date**. Overdue reviews are reported" — `kb_article` has `author_id` but no `owner_id` and no `review_due_at`, so neither the field nor the report can be built. | Add both columns; assign the overdue report to `reminder-scan`. |
| Medium | `KB-17` "Was this helpful?" with `POST /api/portal/kb/{id}/feedback`, and `KB-16` "Most-viewed" — neither a feedback table nor a view counter exists. | Add `kb_article_feedback (article_id, person_id, helpful, comment)` and a view-count mechanism (a counter column updated by a batched job, not a synchronous write per read). |
| Medium | `KB-10` records a deflection candidate — the same missing `deflection_event` storage as `RT-12`, and the E2E test ("abandon the form and confirm the deflection is recorded") depends on it. | Fix once, in the data model, and have both specs cite it. |
| Medium | `KB-4` "An optional review step … **configurable per workspace**, off by default" — no setting column. | Add it, or state that the `in_review` status is always available and simply unused when the step is off. |
| Medium | Edge case "Two authors editing concurrently → Optimistic concurrency, 409, **with a diff**" requires a `version` column, but `api-design.md` scopes `version` to work items, comments, workflows, SLA policies and plugin config — not KB articles. | Add `kb_article.version` and add KB to `api-design.md`'s list. |
| Medium | `KB-6` "Articles may embed a work item reference, rendering key, title and state **live**" — no rule covers an embedded work item the *viewer* cannot reach. The edge-case table handles a deleted reference but not an out-of-reach one, and a customer-visible article embedding an internal work item would leak its title and state. | Add the rule: an out-of-reach reference renders as an inert placeholder, resolved server-side per viewer, never client-side. |
| Medium | The permissions table has an **Archive** row and the Concepts list an `archived` status, but there is no archive route; there is also no restore route despite `KB-3`'s "History is browsable and **restorable**", and no category write routes despite "Manage categories". | Complete the route table with their capabilities. |
| Medium | **No `## Open questions` section, no `## Data` section.** | Add both; Data should name `kb_article`, `kb_article_version`, `kb_category` and the new tables. |
| Low | Three routes carry non-policies (`(scoped)`, `(portal session)`). | As §13/§17. |
| Low | "Manage categories → `kb_article:publish`" reuses the publish capability for taxonomy. | Either deliberate (say so) or add `kb_category:manage`. |

---

## 19. `service-management.md` — P5

**Verdict: not-ready** (a headline feature — service dependency and impact — has no table at all, and the CAB-membership definition that `approvals.md` delegates here never arrives)

The scoping judgement is excellent: "ITIL has thirty-four practices; we implement three", and the explicit refusal to become a CMDB is the right call, stated with its reasoning. `SV-4` (service status set by a person, not computed — "computed status from open incidents is appealing and always wrong") is a good, opinionated rule. Every capability in the permissions table exists in rbac.md, and every route carries one.

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| High | **Dangling delegation.** `approvals.md` puts "CAB membership definition" out of scope and points here; this spec never defines CAB membership. So `approval:decide_cab`'s "Must be a **CAB member**" is unenforceable — an implementer must invent the membership model for the control that gates every high-risk change. | Define it here: recommended, a `team` flagged as the CAB (`team.is_cab`), so `team_member` answers the question and the existing roster UI manages it. Cross-reference from `approvals.md`. |
| High | `SV-5` "Services may **depend on other services**, forming a graph used to show impact" and `GET /api/services/{id}/impact` have **no storage** — there is no `service_dependency` table, and `service` has no self-reference. The edge case ("Circular service dependency → permitted but flagged; impact analysis stops at the cycle") and the unit test ("impact traversal with cycles") both describe traversing a graph that does not exist. | Add `service_dependency (service_id, depends_on_service_id)` to the data model. |
| High | `RL-2` "Changes are **associated with a release**" and `RL-4` "Release notes are generated from the associated changes" have no linking column: `release` is `(workspace_id, service_id, name, planned_at, status, notes)` and `change_detail` has no `release_id`. The release feature's two most useful rules cannot be built. | Add `change_detail.release_id` (or a join table if a change may span releases — say which). |
| Medium | `SV-3` "A work item may reference **the service it affects**" — `work_item` has no `service_id`, yet this is the column that makes the spec's own headline question ("which service generates the most incidents?") answerable. `CH-1`'s "**affected services**" (plural) likewise has no storage on `change_detail`. | Add `work_item.service_id`, and a `change_service` join table for the plural case on changes. Decide whether they are the same relationship. |
| Medium | `SV-1` says a service has "a **service calendar**" and `SV-4` a **status**; `service` has neither column (`workspace_id, name, description, category, owner_team_id, support_level`), though `POST /api/services/{id}/status` exists. | Add `service.service_calendar_id` and `service.status`. |
| Medium | `CH-3` "**Risk drives the approval requirement**: low-risk changes may be pre-approved by workflow configuration, high-risk always require CAB" — `workflow_transition.requires_cab` is an unconditional boolean, and `WF-15`'s guard vocabulary has no risk condition. Conditional CAB by risk has no mechanism. | Either add a risk condition to the guard vocabulary defined in `workflows.md`, or state that risk-based gating is achieved with separate transitions and drop the "drives" language. |
| Medium | `CH-6` "A rollback plan is **required** before a change may be approved. Not a suggestion." `rollback_plan` is a `change_detail` column, but `WF-15`'s guards cover only "a required **custom field** populated" — there is no guard type for a native column on a satellite table. | Add the guard type to `workflows.md`'s vocabulary, or model the rollback plan as a required custom field on the change type. |
| Medium | `RL-3` "A release **checklist** can be defined per service and is instantiated per release" — no checklist table. This is the second appearance of an unmodelled "checklist" (see `WI-5`, §1). | Model it once (`checklist_template` + `checklist_item`) and have both specs cite it, or drop both. |
| Medium | `CH-4`/the permissions row require "**elevated** authority" to override a freeze, but rbac.md's "Elevated and audited actions" list (fresh re-authentication within five minutes) does not include freeze override — so "elevated" is undefined here. | Add freeze override to rbac.md's elevated-actions list, which is the natural home. |
| Medium | **Rule-prefix collision.** This spec numbers services `SV-1`…`SV-5`, while `search-and-saved-views.md` uses `SV-1`…`SV-23`. There is a second collision: `RL-1`…`RL-5` here (releases) versus `RL-6` in `roles-and-permissions-ui.md`. The README's stated purpose for numbering is that "tests and code comments can cite them (`WI-14`)" — duplicate prefixes make citations ambiguous. | Renumber to unique prefixes (e.g. `SVC-`/`REL-` here) and add a prefix registry to the features README. |
| Medium | **No `## Open questions` section, no `## Data` section.** | Add both. |
| Medium | `RL-5` "A release may be **published to the customer portal**" — `release` has no `customer_visible` column and `customer-portal.md` lists no release route or screen. | Add the column, the portal route with its policy, and the screen — or move `RL-5` out of v2. |
| Low | Several routes implied by the permissions table are missing: no `DELETE /api/services/{id}` (though "Service deleted with open changes → Refused" is an edge case), no `PATCH`/`DELETE` for freezes, no `PATCH` for releases, no checklist routes. | Complete the route table. |
| Low | "See services → `project:read`" guards a workspace-scoped entity with a project capability. | Either add `service:read` to rbac.md or note the reuse deliberately. |

---

## Summary

**Overall verdict for the group: not-ready.**

Of the 19 specs reviewed: **0 ready**, **8 ready-with-fixes** (`work-items`, `views`, `projects-and-engagements`, `assignment`, `agile`, `service-calendars`, `approvals`, `knowledge-base`), **11 not-ready** (`relations-and-hierarchy`, `comments-and-activity`, `attachments`, `search-and-saved-views`, `workflows`, `sla`, `request-types-and-catalogue`, `intake-queue`, `audit-trail`, `customer-portal`, `service-management`).

The prose quality is genuinely high — these read like specs written by someone who has shipped this product once and is determined not to repeat it, and the "v1 defect → prevention → named test" pattern in `approvals.md` and `customer-portal.md` is a model the rest should copy. The failures are almost never in the *reasoning*; they are in the seams: **behaviour that the data model cannot store, routes without policies, and words that mean different things in two documents.** An implementer working from any one spec alone would produce something plausible; working from two, they would find a contradiction.

To be explicit about the four cross-cutting checks that were asked for:

- **SLA pause semantics vs workflow effects** — contradictory. `SLA-10` puts pausing on the *policy*; `WF-17`/`WF-18` put stop/resume in the *workflow*. Neither has a column. See §10, §11.
- **Portal permissions vs RBAC customer rules** — consistent in substance (the may/may-not tables match row for row), but `CP-4`'s "staff names are not shown" contradicts `approvals.md` and the public-comment model. See §17.
- **Intake statuses vs work-item states** — **no contradiction.** Submission statuses are a deliberately separate lifecycle and the conversion boundary is explicit. The real problem next door is that `IQ-14` runs an SLA clock on an entity the SLA engine cannot measure. See §14.
- **Two specs defining the same behaviour differently** — yes, repeatedly: roll-up progress (`WI-19` vs `RH-14`), cross-project parentage (`RH-6` vs `RH-12`), `none` as an SLA state (`SLA` vs `CAL-5`), reopen semantics (portal vs attachments vs workflows).

### The three biggest risks

1. **States are project-scoped but workflows are workspace-scoped — the lifecycle engine cannot be built as specified.** `WF-1` attaches a workflow to a workspace and to one or more work item types; `WF-2` and `PR-17` give every project its own `state` rows; `workflow_transition` references `state_id`. A workspace workflow therefore cannot serve a second project. This is load-bearing for ADR 0011's entire "one generic lifecycle engine" claim, and it blocks `work-items`, `views`, `workflows`, `sla`, `intake-queue` and `agile` simultaneously. Nothing else in the corpus should be implemented before this is resolved. *(§10)*

2. **No document says which capabilities each built-in role holds.** rbac.md lists seven roles with ranks and one-line intents, and stakes the security story on a "permission matrix test — for every built-in role × every route, asserts the expected allow/deny … a checked-in fixture". That fixture cannot be derived from any document, and neither can the seed data. Meanwhile individual specs quietly assume answers (`AS-1` "a manager or lead may assign", `AS-2` mapping self-assignment to `work_item:update`, `SV-17` "team leads"). Every permissions table in this group is unverifiable until the matrix exists — and role seeding is a P1 task. *(§8, and every spec)*

3. **The portal and bulk/portal-adjacent routes ship without policies, in the exact places v1 leaked.** `customer-portal.md` lists 22 routes with no policy at all; `search-and-saved-views.md` has five; `comments-and-activity`, `attachments`, `request-types`, `intake-queue`, `approvals`, `knowledge-base` and `work-items` each carry "(portal session)", "(self)", "(scoped)" or "(per-item capability)" where rbac.md's CI route-coverage test demands `{ capability, scope }` or `{ public: true, reason }`. Adjacent to this: `VW-23` exports the full filtered dataset to CSV with no capability, and `KB`'s deflection route serves agent and portal sessions from one handler in direct violation of ADR 0004. The tests that were designed to prevent v1's eleven authorization holes cannot run against these specs as written. *(§2, §5, §6, §7, §13, §14, §15, §17, §18)*

### Missing documents

**No linked document is missing** — every cross-reference resolves (`screen-inventory.md`, `ux-quality-gates.md`, `accessibility.md`, `glossary.md`, `phases.md`, `roadmap.md`, `coding-standards.md`, and ADRs 0004/0009/0010/0011/0012 all exist). What is missing is *content*, in three places, and each is a document-sized gap rather than a spec-sized one:

1. **A role × capability matrix** — belongs in `rbac.md` (or `roles-and-permissions-ui.md`). See risk 2.
2. **A workflow transition-effects vocabulary** — `workflow_transition` needs an `effects` column and a closed vocabulary (`set_assignee`, `clear_assignee`, `pause_sla`, `resume_sla`), owned by `workflows.md`. Three specs (`assignment` `AS-13`, `sla` `SLA-10`/`SLA-11`, `workflows` `WF-17`–`WF-19`) currently each assume it exists somewhere else.
3. **A portal route-policy form** — one definition of what a `/api/portal/*` policy looks like, so six specs can stop writing "(portal session)". `api-design.md` or `customer-portal.md` should own it.

Additionally, `data-model.md` is missing roughly two dozen columns and eight tables that these specs actively reference — most notably `work_item_sla_cache`, which is named by `sla.md`, `background-jobs.md` **and** ADR 0009 but defined nowhere. A single data-model reconciliation pass against this audit would resolve the majority of the medium findings across all 19 specs.
