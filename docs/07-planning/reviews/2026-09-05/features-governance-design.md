# TaskDesk v2 — audit: governance features + design system

Scope: `docs/03-features/` (governance/insight set) and `docs/02-design/`, cross-checked
against `docs/01-architecture/{data-model,rbac,plugin-architecture}.md`, ADR 0012, ADR 0013,
and `docs/05-operations/configuration-reference.md`.

Question answered per document: **could an implementer build this without guessing?**

Verdict scale: **ready** · **ready-with-fixes** (gaps are real but bounded and local) ·
**not-ready** (an implementer must invent load-bearing behaviour, or two documents disagree).

---

## 0. The rules being audited against (`docs/03-features/README.md`)

The template mandates, per feature spec: Purpose · Concepts · **Data** · **Behaviour**
(numbered, testable) · **Permissions** (a table) · Screens · **API** (endpoints with
policies) · **Edge cases** · Out of scope · **Testing** (named tests) · **Open questions**
(must be empty before implementation).

Two rules are load-bearing for this audit and are quoted verbatim:

- "Behaviour rules are numbered, so tests and code comments can cite them (`WI-14`)."
- "'Open questions' must be empty before implementation starts."

Note the template itself is ambiguous on one point that then bites nearly every spec below:
it says "Testing — Unit, integration, E2E. **Named tests.**" Some specs read that as
*prose descriptions of tests*, others as *test file names* (`god-mode.md` names
`secrets-never-serialised.spec.ts`). This inconsistency is recorded once here rather than
repeated per document.

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| medium | "Named tests" is interpreted two ways across the corpus. Only **two** of the ten specs audited actually name test files — `god-mode.md` (`secrets-never-serialised.spec.ts`, `impersonation-audited.spec.ts`, `godmode-requires-instance-admin.spec.ts`) and `reports-and-dashboards.md` (`customer-cannot-read-reports.spec.ts` and three more). The other eight describe tests in prose. And **no spec cites its own rule ids from its Testing section**, so the numbering (`RL-4`, `NO-8`) — the README's stated reason for numbering at all — is never actually exercised. | Define in README: "Testing lists test **file names** (`kebab-case.spec.ts`) each annotated with the rule ids it covers, e.g. `role-rank-guard.spec.ts` → `RL-4`." Add a CI lint asserting every numbered rule is cited by at least one named test. |
| low | The template has no slot for the **feature flag key's registration**, yet `plugin-architecture.md` and `configuration-reference.md` each keep a canonical `feature.*` list, and they disagree (see §2). | Add a README rule: "A spec's `Feature flag:` value must appear in the single canonical list in `plugin-architecture.md`; `configuration-reference.md` links to it rather than restating it." |
| low | No rule requiring that every screen a spec mentions exists in the screen inventory, though the inventory's own Rules section requires the reverse direction. | Add to README Rules: "Every screen named in a spec must have a row in the screen inventory in the same pull request." |

---

## 1. `roles-and-permissions-ui.md`

**Verdict: ready-with-fixes.** Structurally the strongest spec in the set: 13 numbered
rules, a permissions table, 9 routes each with a capability, a genuine edge-case table,
"Open questions: None." The gaps are all *vocabulary* gaps — the spec describes a UI that
renders data (capability groups, plain-English descriptions, implication rules) that no
document actually defines.

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| high | `RL-5`: "Some capabilities imply others. Ticking `work_item:update` auto-ticks `work_item:read`." The **implication graph is defined nowhere** — not in `rbac.md`, not here, not in the data model. `GET /api/capabilities` is said to return "implication rules", so the implementer must invent them for ~60 capabilities. Guessing wrong is a security bug: an under-specified implication silently grants or withholds authority. | Add an `implies` column to the capability list in `rbac.md` (single source of truth, alongside `packages/permissions/src/capabilities.ts`), e.g. `work_item:update → work_item:read`, `comment:create_internal → comment:create`, `*:manage → *:read`. State whether implication is transitive and whether it is enforced server-side at grant time or only expanded at evaluation time. |
| high | `RL-4`: "You cannot edit a role ranked **above** your own." Strictly read, equal rank is editable — so a rank-50 lead may edit another rank-50 role. Combined with the absence of any rule on **what rank you may set**, a rank-80 admin can create a rank-100 role they can then never edit, or a peer can rewrite a peer role. | State the comparison explicitly (`role.rank >= actor.maxRank ⇒ read-only`, or `>` with a stated rationale) and add `RL-14`: "You cannot create or set a rank greater than or equal to your own highest rank." Add both to the permission-matrix fixture. |
| medium | `RL-1` names capability groups "Work items, Projects, SLA, Approvals, Administration"; the screen mock shows "Projects · Approvals · Time & cost · Administration". Neither is a complete partition of the ~60 capabilities in `rbac.md` (where do `label:*`, `kb_article:*`, `service:manage`, `intake:triage`, `api_key:manage`, `report:*` go?). | Add a `group` column to the capability list in `rbac.md` so the grouping is data, not a UI decision, and assert in a unit test that every capability has exactly one group. |
| medium | `RL-2` requires "a one-line, plain-English description" for every capability; none of the ~60 are written down. An implementer writes 60 strings by guesswork, and they become user-facing security language. | Add a `description` column to `rbac.md`'s capability list (or a `capabilities.ts` excerpt in this spec) covering all of them. |
| medium | The role editor mock shows a **`History ▾`** affordance and `RL-10` mandates audit rows, but **no API route returns role history**. Same for `RL-12` "Test as this role" — no endpoint, and it cannot be computed client-side without the full route-policy map. | Add `GET /api/roles/{id}/history` (`workspace:read`) and `POST /api/roles/{id}/preview` (`workspace:read`) returning the navigation entries and work-item actions a holder would see. |
| medium | `GET /api/capabilities` is policed with `workspace:read`, but the path carries **no workspace**, so the scope of that capability check is unresolvable. `rbac.md` requires `{ capability, scope }` per route. | Either move it to `GET /api/workspaces/{id}/capabilities`, or declare it `{ authenticated: true, reason: 'static vocabulary, no tenant data' }` once that policy kind exists (see §3). |
| medium | Role `key` — "Names need not be unique; the stable `key` is" — but nothing says who supplies it, how it is slugified, its uniqueness scope (per workspace? per scope+workspace?), or what happens on collision. | Add `RL-15`: key is server-generated from the name as a kebab slug, unique per `(scope, workspace_id)`, immutable after creation, with a numeric suffix on collision. |
| medium | The spec covers workspace-scope roles only, but `role.scope` is `instance \| workspace \| project` in both `rbac.md` and the data model. Project-scope roles are punted to `settings-hierarchy.md`, which mentions only "per-project role overrides" on the Members screen and specifies no editor. **No document specifies how a project-scope role row is created or edited.** | Either declare project-scope roles out of scope for P4 and remove `project` from `role.scope`, or add the rules and routes here. |
| low | The spec references `role.description`; the data model's §2 `role` table omits it (`rbac.md`'s DDL block includes it). | Add `description` to the `role` row in `data-model.md` §2. |
| low | Edge case "Editing your own role to remove your own access — allowed but requires typed confirmation; you may lock yourself out". This can strand a workspace even though `RL-7` protects the *last role*, because the last role could still be held by a suspended person. | Extend `RL-7` to "at least one **active** person must hold `workspace:manage_roles` after any save", and test it. |
| low | Testing section describes tests in prose while `god-mode.md` names files. | Name them: `role-privilege-escalation.spec.ts` (`RL-3`), `role-rank-guard.spec.ts` (`RL-4`), `capability-implication.spec.ts` (`RL-5`), `last-admin-role-protected.spec.ts` (`RL-7`). |

Data references: `role` ✓ (data model §2). Capabilities used — `workspace:read`,
`workspace:manage_roles`, `workspace:manage_members` — all present in `rbac.md` ✓.

---

## 2. `god-mode.md`

**Verdict: not-ready.** Thirteen prose sections describing fifteen screens, governed by
only **six** numbered rules (`GM-1`–`GM-6`). The template says Behaviour "is the bulk of
the document"; here it is roughly 8% of it. Most of the actual behaviour — impersonation
limits, health thresholds, organisation suspension, key rotation — lives in unnumbered
prose or in the edge-case table, so no test can cite it. There is **no Permissions table**
and **no Data section**, and the route list covers maybe a third of the described surface.

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| high | **Contradiction with `configuration-reference.md`.** That document lists two runtime God Mode sections that do not exist here and have no screen in the inventory: **Observability** (Sentry DSN, OTLP endpoint and headers, trace sample rate, metrics bearer token, log level per module) and **AI** (provider, endpoint, API key, model, which features may use it). It also promises "An export of non-secret configuration is available from God Mode as JSON" — no section, no rule, no route. | Add an Observability section + screen (or move it under Plugins and say so), state that AI is configured through the Plugins screen as `ai.*` plugin rows, and add `GET /api/instance/config-export` (`instance:admin` + re-auth) with a rule that secrets are excluded. |
| high | **The `feature.*` enumeration differs between the two documents that both present it as canonical.** `plugin-architecture.md` lists 13 flags ending `feature.gantt · feature.calendar · feature.pages`. `configuration-reference.md` lists 17, adding `feature.reports`, `feature.automations`, `feature.mcp`. An implementer building the Features screen cannot know which list is the enumeration. | Make `plugin-architecture.md` the single source, add the three missing flags to it, and have `configuration-reference.md` link rather than restate. Add a CI test asserting the flag enum in code equals the doc list. |
| high | **`instance:manage_plugins` exists in `rbac.md` but no route uses it.** Every plugin route here is `instance:admin`. Either the capability is dead vocabulary or the routes are under-specified — and `rbac.md`'s route-coverage test cannot catch an *unused* capability. | Decide: either police `GET/POST/PATCH /api/instance/plugins*` with `instance:manage_plugins` (and state that `instance:admin` implies it), or delete the capability from `rbac.md`. Add a CI test: "every capability in `capabilities.ts` is referenced by at least one route policy or one documented domain rule." |
| high | **`GM-2`'s elevated-action list disagrees with `rbac.md`'s.** `GM-2`: identity provider change, granting `instance:admin`, rotating the encryption key, starting impersonation, **exporting all data**. `rbac.md`: identity provider change, granting `instance:admin`, **deleting a workspace or a project**, starting impersonation, rotating the encryption key. Neither is a superset. Separately, the Audit section says CSV export "is itself audited" but does not say whether it is *elevated* — and it is unclear whether "exporting all data" covers it. | Make `rbac.md` the single list, add "exporting instance data (audit CSV, config export, full export)" to it, and have `GM-2` cite it rather than restate it. Name each elevated action's route. |
| high | Impersonation's entire rule set is prose in the Users section: "shows a persistent banner, is capped at 30 minutes, is doubly audited, and cannot target another instance administrator." Untestable as written — "doubly audited" is undefined, there is no rule for what the impersonator may *do* (may they act as a customer? write comments? approve?), no **stop-impersonation** route, and no statement of what happens at the 30-minute cap. | Promote to numbered rules `GM-7`–`GM-11` covering: session TTL and expiry behaviour, the two audit rows written (start on actor, and every action tagged `impersonated_by`), forbidden targets, forbidden actions (approvals, elevated actions, further impersonation), and add `DELETE /api/instance/impersonate` (self, always allowed). |
| medium | **No `## Permissions` table** — the template requires one. The API block carries capabilities, but there is no action→capability mapping for the many actions with no listed route. | Add the table. |
| medium | **No `## Data` section.** The spec never names `instance_setting`, `instance_branding`, `instance_plugin_config`, `instance_feature_flag`, `terminology_override`, `job_lease`, `audit_log`, `organisation`, `import_run`, though every one of them backs a section. | Add a Data section linking to `data-model.md` §1, §2, §11. |
| medium | **The API list is roughly a third of the described surface.** Missing entirely: organisation PATCH/DELETE/suspend, user suspend/unsuspend/force-sign-out/reset-MFA/delete, storage test/usage, notification channel test send, terminology CRUD + preview, encryption key rotation, audit CSV export, import runs, `DELETE /api/instance/plugins/{id}`, per-job enable/disable and cadence edit. Every one of these is an implementer inventing a route name and a policy. | Complete the route table. Each entry must carry `{ capability, scope }` or `{ public, reason }` per `rbac.md`. |
| medium | The Health landing page lists what it shows ("disk headroom", "each scheduled job's last successful run") but defines **no thresholds and no status vocabulary**. Green/amber/red on what? A job "last successful run" older than what is a failure? | Add a rule defining the status enum (`ok \| degraded \| failing \| unknown`) and the threshold per check, or state that thresholds are themselves God Mode settings and add them to General. |
| medium | Encryption key rotation appears in `GM-2` and in the edge-case table but has **no route, no screen, and no section**. `configuration-reference.md` calls it "a God Mode operation". | Add it to the General or Plugins section with `POST /api/instance/rotate-encryption-key` (`instance:admin` + re-auth) and numbered rules for the two-key window. |
| medium | Terminology: this spec and ADR 0012 both place the editor at God Mode → General, but ADR 0012 also defines **workspace-scope** overrides, and the screen inventory has a `Workspace — terminology` screen. God Mode never mentions the workspace level, and `settings-hierarchy.md` mentions the screen without behaviour. **No document states the precedence UI, the term-key enumeration in a testable form, or the plural-validation rule** ("1 Case" vs "1 Cases" is called out in ADR 0012 as mitigated "by the live preview" — a human eyeball, not a check). | Add numbered rules: the term-key enum (list all ten from ADR 0012), the resolution order, that a workspace override requires `workspace:manage_settings`, and a save-time warning when `plural === singular`. |
| medium | ADR 0012 says "Portal-facing terminology … is itself just the default override applied to the `customer` portal scope". But `terminology_override.scope` in the data model is only `instance \| workspace` — there is **no portal/audience dimension**, so a customer-facing "request" vs agent-facing "work item" cannot be stored. | Add `audience` (`agent \| customer \| both`, default `both`) to `terminology_override` in the data model, or drop the claim from ADR 0012 and specify portal wording as fixed locale strings. |
| low | "Fifteen screens" ✓ — the inventory's God Mode section has exactly 15 rows, matching the 13 sections with Authentication and Organisations each split into list + detail. Worth stating that mapping in the spec so the count does not silently drift. | Replace "Fifteen screens" with the explicit list, or link to the anchor. |
| low | Edge case "Feature flag locked off while a project uses the feature — existing data is retained and hidden" restates `settings-hierarchy.md`'s identical edge case. Duplication drifts. | Keep it in `settings-hierarchy.md` only; link from here. |

Data references: every table implied exists in `data-model.md` ✓ (though never named — see
above). Capabilities used — `instance:admin`, `instance:read_audit` — present in `rbac.md`
✓; `instance:manage_plugins` present but unused (above).

---

## 3. `settings-hierarchy.md`

**Verdict: not-ready.** The document's own thesis — "Every setting below appears at exactly
one level" — is contradicted twice inside the document and once against `god-mode.md`. It
also lacks four of the template's required sections (Data, Permissions table, Out of scope,
Open questions) and depends on a database table that does not exist in the data model.

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| high | **`workspace_feature_flag` does not exist in the data model.** `ST-1` resolves flags "project → workspace → instance → built-in default" and `plugin-architecture.md` lists all three tables, but `data-model.md` defines only `instance_feature_flag` (§1) and `project_feature_flag` (§3). The middle level of the product's central configuration mechanism has no storage. | Add `workspace_feature_flag (workspace_id, feature_key, enabled)` to `data-model.md` §2 or §3, with a unique index on `(workspace_id, feature_key)`. |
| high | **`ST-3` contradicts `ST-4`.** `ST-3`: "**Nothing else inherits.** A workspace does not inherit an SLA policy from the instance." `ST-4`: "Where a setting exists at two levels — **SLA policy on a workspace and on a project** — the more specific wins, and the interface says so: 'Inherited from workspace (Standard Support). Override ▾'." One says SLA does not inherit; the other describes SLA inheritance with a UI affordance for it. | Rewrite `ST-3` as "Only feature flags inherit *across* the instance→workspace boundary. Within a workspace, a project inherits its workspace's SLA policy, service calendar and default assignee unless overridden," and enumerate exactly which settings are in that list. |
| high | **Three levels of SLA policy, not one.** `god-mode.md`'s Organisations section says each organisation carries a "service calendar, default SLA policy". `settings-hierarchy.md` puts SLA policies at workspace, and SLA at project. So an SLA policy resolves from organisation *and* workspace *and* project, with no stated precedence — directly violating "every setting appears at exactly one level". | Decide and state the precedence chain (`project → workspace → organisation`), or remove `default SLA policy` and `service calendar` from the God Mode organisation record. Add a numbered rule and a resolution unit test either way. |
| high | **Two API policy kinds are used that `rbac.md` does not define:** `GET/PATCH /api/me/settings → self` and `GET /api/features/resolved?project=… → any authenticated session`. `rbac.md`'s `PolicyMap` admits only `{ capability, scope }` or `{ public: true, reason }`. The route-coverage CI test — which "fails if any route has no entry in a policy map" — has nothing to match these against, so either the test fails or someone marks them `public: true`, which for `/api/me/settings` is a data leak. | Add a third policy kind to `rbac.md`: `{ authenticated: true, scope: 'self' }`, define its semantics (the handler may only touch rows keyed to `identity.personId`), and add it to the permission-matrix fixture. `notifications.md` uses the same undefined `(self)` marker — fix both. |
| medium | **No `## Permissions` table**, no `## Data` section, no `## Out of scope`, and **no `## Open questions` section at all** (not "None." — absent). The README rule is "'Open questions' must be empty before implementation starts"; an absent section is indistinguishable from a forgotten one. | Add all four. Data should name `instance_setting`, `instance_feature_flag`, `workspace_feature_flag`, `project_feature_flag`, `terminology_override`, `audit_log`. |
| medium | **The screen lists here and in the screen inventory disagree.** This spec gives Workspace a **Danger zone** screen — the inventory has no `Workspace — danger zone` row (only `Project — danger zone`). It gives Project **Labels** and **SLA** screens — the inventory has neither. | Add `Workspace — danger zone` (`…/danger`), `Project — labels`, `Project — SLA` rows to the inventory, or delete them here. |
| medium | **No routes for workspace- or project-level feature flags.** `god-mode.md` has `PATCH /api/instance/features`; `ST-1`/`ST-2` require the other two levels and the inventory has a `Project — features` screen, but nothing can write them. | Add `GET/PATCH /api/workspaces/{id}/features` (`workspace:manage_settings`) and `GET/PATCH /api/projects/{key}/features` (`project:manage_settings`), and a rule that a write is rejected `409` when the instance flag is `locked`. |
| medium | `ST-6`: "Every settings screen has a History affordance showing its audit rows inline" — no route returns audit rows scoped to a settings screen, and `audit_log` has no `section`/`screen` dimension to filter on (only `entity_type`, `entity_id`). | Either add `GET /api/audit?entity_type=…&entity_id=…` (`instance:read_audit` or the screen's own capability) and state the entity mapping per screen, or narrow `ST-6` to the screens where the entity is unambiguous. |
| medium | Edge case "Project moved between workspaces — workspace-scoped configuration is remapped where equivalents exist and reported where they do not" is unimplementable as written. Which config? Matched on what — `key`, `name`? What happens to work items referencing a label or custom field with no equivalent? | Enumerate the remapped entities (labels, custom-field values, work item types, workflows, SLA policies, states) and the matching rule per entity (`key` match, else report and leave null), or refuse the move in P4 and say so. |
| medium | `settings-hierarchy.md`'s instance list omits Observability and AI, matching `god-mode.md` and contradicting `configuration-reference.md` (see §2). Three documents, two answers. | Fix in `configuration-reference.md` and here together. |
| low | `ST-7`'s blast-radius numbers ("This affects 340 open work items") need a count endpoint per destructive save; none is specified. | Add a documented convention: every `PATCH` that triggers `ST-7` supports `?dryRun=true` returning `{ affected: { people, workItems, projects } }`. |
| low | Testing is prose; no file names, no rule ids cited. | Name `flag-resolution.spec.ts` (`ST-1`, `ST-2`), `locked-flag-cannot-be-overridden.spec.ts` (`ST-2`), `inheritance-indicator.spec.ts` (`ST-4`). |

Capabilities used — `instance:admin`, `workspace:manage_settings`, `project:manage_settings`
— all present in `rbac.md` ✓.

---

## 4. `custom-fields.md`

**Verdict: not-ready.** Behaviour, permissions, API and edge cases are all present and
well-judged; the format table matches the data model exactly. But **four of the eleven
numbered rules describe state the data model cannot store**, which is the clearest kind of
"the implementer must guess" in this corpus.

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| high | `CF-6` "Fields support conditional visibility: show only when another field has a given value" — `custom_field` in `data-model.md` §5 has no column for a condition (`workspace_id`, `section_id`, `key`, `name`, `format`, `options`, `is_required`, `default_value`, `position`). No storage, no rule for the condition grammar (which operators? one condition or many? AND/OR?), no evaluation-order rule for chained conditions. | Add `visibility_condition jsonb null` to `custom_field` and specify the grammar in this spec: `{ field_key, op: 'eq'|'neq'|'in'|'is_set', value }`, single-level only (a controller may not itself be conditional), evaluated client- and server-side with the server authoritative for `CF-4`. |
| high | `CF-11` "Fields may be marked customer-visible" — no `customer_visible` column on `custom_field`. The sibling `attachment` and `kb_article` tables both have one, so the omission is an oversight, but an implementer would have to invent it. | Add `customer_visible boolean not null default false` to `custom_field`. |
| high | `CF-8` "Deleting a field soft-deletes it. Values are retained and restorable for 30 days" — no `archived_at`/`deleted_at` on `custom_field`, no restore route, and `data-model.md`'s Retention table does not list custom fields among the soft-deleted data with a purge window. | Add `archived_at timestamptz null`, `POST /api/custom-fields/{id}/restore` (`custom_field:manage`), and a "Soft-deleted custom fields — 30 days" row to the Retention table. |
| medium | **A field cannot declare which entity it applies to.** "Entities that support custom fields: Work items in P4. Projects and people in P5." `custom_field_value` has `entity_type`, but `custom_field` has no `entity_type`, and the only visibility table is `custom_field_type_visibility` keyed to `work_item_type_id`. There is no way to define a project field. | Add `entity_type` to `custom_field` (`work_item` in P4) and state that `custom_field_type_visibility` applies only when `entity_type = 'work_item'`. |
| medium | The Field editor screen lists "help text"; no column exists. | Add `help_text text null` to `custom_field`. |
| medium | **Missing routes.** No `PATCH`/`DELETE` for `custom-field-sections`, no section reorder (`CF`-level "Reorder sections" is in the permissions table with no route), no route to write the per-type visibility matrix, no restore route (`CF-8`), no route for the "report [that] lists non-compliant items" promised in the first edge case. | Complete the route table; each entry needs `{ capability, scope }`. |
| medium | `GET /api/custom-fields` is policed `workspace:read` but carries **no workspace in the path or query**, and **no document in the repository defines how a workspace-less route resolves its workspace** — no `X-Workspace` header convention, no subdomain rule, nothing in `api-design.md` or `multi-tenancy.md`. This affects `GET /api/custom-fields`, `GET /api/custom-field-sections`, `GET /api/capabilities` (§1) and `GET /api/notifications` (§5). An implementer will invent a mechanism, and getting it wrong is a cross-tenant read. | Add a section to `api-design.md`: "Workspace context is carried by the `X-Workspace-Id` header (or `?workspace=`), validated against the identity's memberships before any policy check; a route policy with `scope: 'workspace'` and no path parameter reads it from there and returns `400` if absent." |
| medium | Screens: the spec describes **Field list**, **Field editor** and **Section manager**; the screen inventory has one row, `Workspace — custom fields`. | Add `Custom field editor` (`…/custom-fields/{id}`) and either fold Section manager into the list screen or give it a row. |
| medium | **No `## Open questions` section** at all. Also no `## Out of scope` section, though "The problem to avoid" and the formula/rollup paragraph do that job informally. | Add `## Open questions` / `None.` and promote the formula-field exclusion into `## Out of scope`. |
| low | `CF-4` blocks transitions into `started` or `completed` state groups. The data model's groups are `backlog\|unstarted\|started\|completed\|cancelled`; `cancelled` is silently excluded — probably right, but not stated. | Say so explicitly: "`cancelled` is deliberately exempt — you may always abandon incomplete work." |
| low | Edge case "Conditional field whose controller is deleted — **Publish validation** refuses the deletion". Custom fields have no publish step; "publish validation" is workflow vocabulary. | Reword to "The delete is refused with the list of fields whose condition references it." |
| low | `CF-10` "Fields are filterable, sortable and available as table columns" — needs the saved-view query DSL in `search-and-saved-views.md` to admit custom-field keys. Not cross-referenced from either side. | Cross-link, and state the filter key form (`cf.<key>`). |

Data references: `custom_field_section`, `custom_field`, `custom_field_type_visibility`,
`custom_field_value` all exist ✓. Capability `custom_field:manage` present in `rbac.md` ✓.

---

## 5. `notifications.md`

**Verdict: not-ready.** 21 numbered rules, a strong events table and a good edge-case
table — the best *behavioural* spec of the governance set. It is let down by the same
class of problem as custom fields: the three-level preference model it specifies cannot be
stored in the table the data model provides, and its channel-test route contradicts God
Mode's.

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| high | **The preference model does not fit `notification_preference`.** The spec defines three levels ("per event, per channel"; "per workspace"; "per project"), plus quiet hours (`NO-3`) and digest cadence (`NO-5`). `data-model.md` §11 gives `notification_preference (person_id, channel, event_kind, enabled)` — no scope, no `workspace_id`, no `project_id`, no quiet-hours columns, no digest column. Levels 2 and 3, quiet hours and digests are all unstorable. | Add `scope (global\|workspace\|project)`, `scope_id text null`, and `digest (off\|hourly\|daily)` to `notification_preference`; add `quiet_hours_start`, `quiet_hours_end`, `quiet_hours_timezone` to `person` (or a `notification_setting` singleton per person). Add a unique index on `(person_id, scope, scope_id, channel, event_kind)`. |
| high | **Two different routes test a notification channel.** This spec: `POST /api/instance/notify/{channel}/test` (`instance:admin`). `god-mode.md`: `POST /api/instance/plugins/{id}/test` (`instance:admin`). Channels *are* plugins, and `notify.slack` etc. may be multi-instance, so `{channel}` cannot address a specific configured instance. | Delete `POST /api/instance/notify/{channel}/test`; use the generic plugin test route and say so here. |
| high | **`work_item.mentioned` and `mention.in_comment` are two events with identical default recipients ("The mentioned person").** An implementer cannot know whether to emit one, the other, or both — and a user configuring preferences sees two switches for one thing. | Delete one. Keep `work_item.mentioned` (consistent with the `work_item.*` prefix) and state that it covers mentions in descriptions and comments alike. |
| medium | **The `channel` vocabulary is never enumerated.** Is `notification_preference.channel` the plugin id (`notify.email`) or a short name (`email`)? Where does `in-app` sit, given it is "always on. Cannot be disabled" and is not a `notify.*` plugin in `plugin-architecture.md`? | State it: `channel ∈ {'in_app'} ∪ {plugin ids of kind 'notify'}`, `in_app` always enabled and not writable. Add the enum to `plugin-architecture.md`'s notify table. |
| medium | `NO-9` "Dead letters after six attempts and are visible in God Mode" and the edge case "SMTP down for hours — God Mode shows the backlog" both require a **God Mode outbox / dead-letter screen that does not exist** in `god-mode.md` or the screen inventory. | Add a `God Mode — Delivery / outbox` screen and `GET /api/instance/outbox` (`instance:admin`), with requeue and discard actions. |
| medium | **"Per-workspace notification rules" is listed under Screens with no row in the screen inventory** and no route. It is also the only place a *workspace administrator* (rather than a person) touches notifications, so its capability is undefined. | Add the screen and route, or delete it from Screens if `NO-1`'s defaults plus per-person preferences are the whole story. |
| medium | `NO-2` "Every notification email carries a working one-click link to the exact preference that produced it." No token scheme, no route, no expiry, no rule about whether the link authenticates. An unauthenticated link that mutates a preference is a real security decision being left to the implementer. | Specify: a signed, single-purpose token (`purpose: 'notification_pref'`, `person_id`, `event_kind`, `channel`, 30-day expiry) redeemed at `GET /api/notification-preferences/unsubscribe?token=…`, which lands on an authenticated page pre-filtered to that setting rather than mutating on GET. |
| medium | `NO-11` duplicate suppression "within five minutes" — no dedupe key is defined and `outbox` has no column to hold one. Suppression on what tuple? | Define the key (`event_kind + resource_type + resource_id + person_id + channel`), add `dedupe_key text` + a partial index to `outbox`, and state whether suppression is at write time or at drain time. |
| medium | **No `## Permissions` table** (the template requires one) — replaced by a prose paragraph. **No `## Open questions` section** at all. | Add both. The Permissions table can be short and should include the God Mode channel actions and the workspace-rules screen. |
| medium | `NO-3` quiet hours "queue until they end" — no mechanism. Does the outbox row get `next_attempt_at` set forward, or is the decision made at drain time? The two differ observably when a preference changes mid-window. | State it: computed at drain time against the recipient's current quiet hours, so a preference change takes effect immediately (consistent with `RL-9` and `ST-7`). |
| medium | `work_item.overdue` and `sla.breached` route to "then **the escalation path**". The escalation path is `stakeholder.escalation_order` / `escalation_wait_minutes` in the data model, but no rule here or cross-reference says how it is walked (wait then next? notify all? stop on acknowledgement?). | Cross-reference `sla.md` if it owns the algorithm; if not, add numbered rules `NO-22`–`NO-24` here. |
| low | `NO-17` "Read notifications are purged after 90 days" vs `data-model.md` Retention: "`notification` — 90 days once read — **configurable: yes**". The spec states it as fixed. | Reword `NO-17` to "after the instance's notification retention period (default 90 days)". |
| low | `NO-21` gives customers "the same preference control as staff", but the portal screen list has no preferences screen — only `/portal/account`. | Say preferences live under `/portal/account`, and add a row or a note to the inventory. |
| low | Testing is prose; no file names. `NO-19` (a customer never receives an internal-comment notification) is a security assertion and deserves a named test. | Name `customer-never-sees-internal.spec.ts` (`NO-19`, `NO-20`), `outbox-transactional.spec.ts` (`NO-8`), `preference-resolution.spec.ts` (`NO-1`, preferences).

Data references: `notification`, `outbox` ✓; `notification_preference` present but
under-specified (above). Channels align with `plugin-architecture.md`'s `notify` kind ✓
except `in-app`, which is correctly not a plugin but is not documented as an exception.

---

## 6. `automations.md`

**Verdict: not-ready.** The design stance ("one trigger, a flat list of conditions, a flat
list of actions") is excellent and the edge cases are genuinely thought through. But the
feature **has no tables in the data model at all**, and its actor model conflicts with the
`activity` schema.

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| high | **No `automation` or `automation_run` table exists in `data-model.md`.** `grep -i automation docs/01-architecture/data-model.md` returns nothing. `AU-6` needs rule ordering and a "stop processing" flag; `AU-8` needs a run record with per-action outcomes retained 30 days; `AU-3` needs a stored effective role. None of it has storage, and the spec has no `## Data` section to point at. | Add `automation (project_id null, workspace_id, name, enabled, trigger jsonb, conditions jsonb, actions jsonb, effective_role_id, position, stop_processing, created_by)` and `automation_run (automation_id, work_item_id, triggered_at, matched, results jsonb)` to `data-model.md` §11, plus a "Automation runs — 30 days" row in the Retention table. Add a `## Data` section here. |
| high | **`AU-4` conflicts with the `activity` schema.** "Every action taken writes an activity entry attributed to the automation by name, **never to a person**." `activity.actor_id` is a person reference; there is no system-actor concept, no nullable actor, and no `actor_type` in the data model. The same problem applies to `audit_log.actor_id`. | Add `actor_type ('person'\|'automation'\|'system'\|'api_key')` and make `actor_id` polymorphic (or add `automation_id` null) on both `activity` and `audit_log`, and state how the UI renders each. |
| high | **Three incompatible event vocabularies.** Automations' triggers, `notifications.md`'s events and `webhooks-and-api-keys.md`'s events overlap but none is a subset of another: `work_item.field_changed` exists only in automations; `work_item.due_soon`/`overdue`, `approval.expiring`, `submission.replied` only in notifications; `work_item.updated`/`deleted`, `sla.met`, `submission.accepted`/`declined`, `project.created`/`archived`, `approval.expired` only in webhooks. `approval.expiring` (notifications) and `approval.expired` (webhooks) are near-homographs for what may or may not be the same thing. `outbox.kind`, `webhook.events[]` and `notification_preference.event_kind` all draw from this vocabulary. | Create one canonical event catalogue — a table in `data-model.md` or a new `docs/01-architecture/events.md` — listing every event key once, with which subsystems may subscribe (automation trigger / webhook / notification) as columns. Have all three specs link to it instead of restating. Add a CI test asserting the code enum matches. |
| high | **No workspace-scope automation route or screen.** "Scope: Rules are per project by default, **or per workspace** with `workspace:manage_settings`. A workspace rule may be restricted to certain projects." The permissions table has "Create workspace rules — `workspace:manage_settings`". The API has only `/api/projects/{key}/automations`; the screen inventory has only `Project — automations`. Half the specified feature has no surface. | Add `GET/POST /api/workspaces/{id}/automations` (`workspace:manage_settings`), a `Workspace — automations` screen row, a `Workspace` row in `settings-hierarchy.md`, and a rule for how the project restriction list is stored and evaluated. |
| medium | **The condition grammar is delegated but not linked.** "Field comparisons using the same grammar as filters" — no link to `search-and-saved-views.md`, and that grammar must additionally support `age`, `SLA state`, `comment visibility` and `actor role`, which are automation-specific and may not exist in the filter DSL. | Link explicitly, and list the automation-only condition keys with their operand types. |
| medium | `AU-5` caps automation chains "at depth 5". Nothing says how depth is carried — the event bus (`packages/domain/events/`, per `monorepo-layout.md`) is not documented to carry a causation chain or an originating-automation id, which `AU-5`'s "an automation's own changes do not re-trigger it" also needs. | Specify the event envelope: `{ id, kind, payload, causationId, depth, originAutomationId }`, and state that the depth counter is incremented on every automation-emitted change. |
| medium | Feature flag `feature.automations` is listed in `configuration-reference.md` but **not** in `plugin-architecture.md`'s flag table. An implementer reading `plugin-architecture.md` as the authority would find the flag undefined. | Covered by the §2 fix — one canonical flag list. |
| medium | **No `## Data` and no `## Open questions` section.** | Add both. |
| low | `POST /api/automations/{id}/enable` exists with no matching disable; `AU-10` makes enabling the deliberate act but disabling is equally consequential and should be as explicit. | Add `POST /api/automations/{id}/disable`, or state that `PATCH { enabled }` covers both and drop the enable route. |
| low | `AU-9`'s dry-run runs "against recent history" — the window (7 days in the example) is not specified as fixed or as a parameter, and there is no statement that dry-run is bounded in cost for a large instance. | State the window (default 7 days, max 30) as a query parameter with a hard row cap. |

Capabilities used — `project:read`, `project:manage_settings`, `workspace:manage_settings`
— all present in `rbac.md` ✓.

---

## 7. `webhooks-and-api-keys.md`

**Verdict: ready-with-fixes**, with one high-severity storage gap. The SSRF rules
(`WH-9`–`WH-12`, especially `WH-10`'s connect-time re-check against DNS rebinding) are the
best security writing in the corpus and need no change. The problems are the columns the
rules need and do not have.

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| high | **`webhook_delivery` cannot store what `WH-6` and `WH-8` require.** `WH-6`: "Delivery history is visible per webhook: status code, duration, error, **payload**." `WH-8`: "Redelivery of a specific event is available from the UI." The table is `(webhook_id, event_id, status_code, duration_ms, error, attempted_at)` — no payload, no attempt number, no response body. Once the `outbox` row is drained there is nothing left to redeliver or inspect. | Add `attempt integer`, `request_body jsonb`, `response_body text` (truncated) to `webhook_delivery`, or state that `outbox` rows are retained for the 30-day `webhook_delivery` window and redelivery reads from there. |
| high | **`webhook` has no owner.** `WH-7` "A webhook failing continuously for 24 hours is auto-disabled and **the owner is notified**"; the same edge case appears for removed events. The table is `(workspace_id, url, secret, events[], active)` — there is nobody to notify. | Add `created_by` (person) to `webhook`, and a `webhook.auto_disabled` event to the canonical event catalogue with the owner plus `webhook:manage` holders as recipients. |
| high | **API-key storage is undefined.** `data-model.md` says better-auth owns `apikey` and adds nothing. But `AK-3` needs a capability subset, `AK-4` an expiry, an IP allowlist and a per-key rate limit, `AK-5` last-used time and IP, and `AK-7` a **workspace-owned service key with no person** — better-auth's `apikey` is user-scoped. Every one of these columns is an implementer's invention. | Add an explicit `api_key` extension table to `data-model.md` §2: `(apikey_id, workspace_id null, person_id null, capabilities jsonb, ip_allowlist inet[], rate_limit_per_minute, expires_at, last_used_at, last_used_ip, prefix)`, with a check that exactly one of `workspace_id`/`person_id` is set. |
| medium | **Three API policies use forms `rbac.md`'s `PolicyMap` cannot express**: `(self) | api_key:manage` (an OR of two policy kinds, one of which — `self` — is undefined; see §3) on three routes. The route-coverage CI test cannot validate them and the permission-matrix fixture has no cell shape for "either". | Split the routes (`/api/me/api-keys` → `{ authenticated, scope: 'self' }`; `/api/workspaces/{id}/api-keys` → `{ capability: 'api_key:manage', scope: 'workspace' }`), which also removes the ambiguity about which one a service key uses. |
| medium | **A third, different elevated-action list.** `POST /api/webhooks/{id}/rotate-secret` is marked `webhook:manage + re-auth`, but secret rotation for a webhook is not in `rbac.md`'s elevated list nor in `GM-2`'s. | Fold into the single list per the §2 fix, or drop the re-auth requirement and say why. |
| medium | **Secret rotation has no overlap window.** `webhook.secret` is a single column; the edge case says queued deliveries "sign with the secret current at send time", so the instant an admin rotates, every in-flight and future delivery fails verification until the consumer is updated — with no way to stage the change. | Add `secret_previous` + `secret_rotated_at` and sign with both (two `X-TaskDesk-Signature` values, or `v1=…,v1=…`) for a 24-hour window, mirroring how Stripe and GitHub handle this. State it as `WH-13`. |
| medium | **Missing screen rows.** The spec describes a webhook list, a webhook editor, a **delivery history with payload inspection and redelivery**, an API key list and a creation dialog. The inventory has `Workspace — webhooks` and `Profile — API keys` only. | Add `Webhook editor` (`…/webhooks/{id}`) and `Webhook delivery history` (`…/webhooks/{id}/deliveries`) rows. |
| medium | `WH-12` "HTTPS only, **except for explicitly allowlisted hosts in development**". Where does the allowlist live? It is not in `configuration-reference.md`, not a God Mode setting, and not a bootstrap variable — and a runtime-editable SSRF allowlist is itself a security decision. | Make it a bootstrap-only, development-only variable (`TASKDESK_WEBHOOK_INSECURE_HOSTS`, ignored when `NODE_ENV=production`) and add it to `configuration-reference.md`, or delete the exception. |
| medium | **No `## Data`, no `## Out of scope`, no `## Open questions` section.** | Add all three. |
| low | `GET /api/webhooks` is policed `webhook:manage` with no workspace in the path — the unresolved workspace-context problem from §4. | Same fix: define the workspace-context convention in `api-design.md`. |
| low | The webhook event list omits `work_item.field_changed`, which automations has, and `work_item.updated` does not say whether a field change emits both. | Resolved by the canonical event catalogue (§6). |
| low | Testing is prose. The SSRF and signature tests in particular are security-critical and deserve named files. | `webhook-ssrf-guard.spec.ts` (`WH-9`–`WH-12`), `webhook-signature.spec.ts` (`WH-1`, `WH-2`), `api-key-clamped-to-owner.spec.ts` (`AK-3`). |

Data references: `webhook`, `webhook_delivery`, `outbox` present ✓ but under-columned
(above). Capabilities `webhook:manage`, `api_key:manage` present in `rbac.md` ✓.

---

## 8. `mcp-server.md`

**Verdict: not-ready.** The core architectural claim — "a thin client over the public API…
there is **one** authorization surface, not two" — is right and is the single most valuable
sentence in the document. But the spec omits three of the template's required sections
(Permissions, API, Data, Open questions), specifies an entire alternative auth flow in one
sentence, and its feature flag is not enforceable as described.

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| high | **`MC-14`'s feature flag cannot be enforced.** "The instance can be disabled from serving MCP entirely with `feature.mcp`." But by `MC`-architecture the MCP server is an external npm package holding a normal API key and calling ordinary `/api/*` routes — there is no MCP-specific request for the flag to reject, and `plugin-architecture.md`'s rule is that "a disabled feature returns `404` from the API". As written the flag does nothing. | Either (a) require MCP clients to send `X-TaskDesk-Client: mcp` and mark the API key `is_mcp`, rejecting those requests with `404` when the flag is off, or (b) mark the key itself as MCP-scoped at creation and reject the key. State which, and add the marker to the API key extension table (§7). |
| high | **`MC-3` "OAuth device flow is offered as an alternative for interactive setup" is a whole authentication mechanism in one sentence** — no endpoints, no grant, no token lifetime, no relationship to better-auth, no statement of whether the resulting credential is an API key (`AK-8`: `Bearer tdk_…`) or an OAuth access token, and no mention in `god-mode.md`'s Authentication section or in the auth architecture. | Either specify it fully (device authorization endpoint, verification URI, poll interval, code TTL, what capability subset the issued credential gets, and where an admin disables it) or move it to `## Out of scope` for P4 with a pointer to the phase that owns it. |
| high | **`MC-4` has no storage.** "Every MCP request is audited with the key's identity, and **the audit row is marked as agent-originated**." `audit_log` is `(actor_id, actor_ip, action, entity_type, entity_id, before, after, created_at)` — no origin, no key id, no actor type. Same root cause as `AU-4` in §6. | Add `actor_type` and `api_key_id` to `audit_log` per the §6 fix, and state that every MCP-originated write writes one. |
| medium | **No `## API` section.** ~30 tools are listed with no mapping to routes, and several have no route anywhere in the corpus: `bulk_create_work_items`, `get_sla_status`, `create_import_mapping`/`get_import_mapping`, `list_saved_views`. `testing-strategy.md` promises a "tool-to-route parity" test (`pnpm test:mcp`) which cannot be written without this table. | Add a two-column table: tool → route → policy. It is also the fixture the parity test consumes. |
| medium | **No `## Permissions` table** and **no `## Data` section**, both required by the template. | Add them; Permissions can be short ("every tool inherits its route's policy; the key's capability subset is intersected first"). |
| medium | **`MC-10` and `api-design.md` disagree on rate limiting.** `MC-10`: "Rate limited per key, **more strictly than the human API**." `api-design.md`'s table: "API keys — **Configurable per key**", and `AK-4` says the same. So is the MCP limit a fixed stricter ceiling or the key's configured limit? No numbers are given for either. | State the rule: `min(key.rate_limit, mcp_ceiling)` with `mcp_ceiling` a God Mode setting (default e.g. 60 writes/minute), and add it to `api-design.md`'s table. |
| medium | **"In God Mode: MCP usage — which keys, how many calls, which tools, error rates" is a screen that does not exist.** `god-mode.md` has no MCP section and asserts "Fifteen screens"; the inventory's God Mode section has no MCP row and no MCP anywhere. | Add a `God Mode — MCP usage` screen row and section, plus `GET /api/instance/mcp/usage` (`instance:admin`), and update the "fifteen" count — or delete the claim from this spec. |
| medium | The edge case "a burst above threshold disables the key and notifies the owner" names no threshold, no notification event, and key auto-disable is not in the canonical event list. | Define the threshold as a God Mode setting and add `api_key.auto_disabled` to the event catalogue (§6). |
| medium | **No `## Open questions` and no `## Out of scope` section.** Given `MC-3` and the `MC-14` problem, an empty Open questions here would be untrue rather than merely missing. | Add both; `MC-3` belongs in one of them until it is specified. |
| low | `MC-7` gates "destructive tools — **delete**, bulk operations above 50 items" behind `confirm: true`, but no delete tool appears in the tool list. | Either add the delete tools or reword to "bulk operations above 50 items". |
| low | The `Idempotency-Key` store `MC-5` calls mandatory is specified in `api-design.md` ("key, request hash and response are stored for 24 hours") and swept by the `session-cleanup` job, but **has no table in `data-model.md`**. | Add `idempotency_key (key, person_id, request_hash, response jsonb, status_code, expires_at)` to `data-model.md` §11. |
| low | `create_import_mapping` writes `import_mapping`, whose `import_run_id` implies a parent `import_run` row that an ad-hoc agent session never creates. | State that an MCP-driven import opens an `import_run` with `plugin_id = 'import.mcp'` on first mapping write. |

Capabilities: the spec names none directly, relying on route inheritance — acceptable given
the architecture, but the missing API table makes it unverifiable.

---

## 9. `time-and-cost.md`

**Verdict: not-ready.** Twenty-two well-numbered rules, a good permissions table, a real
edge-case table and an honest Out of scope — but the capability vocabulary it needs does
not exist, so the spec authorises **writes with a read capability**, and four rules have no
columns behind them.

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| high | **A read capability is used to authorise writes.** `TC-5` "Editing anyone else's requires `time_entry:read_any`"; `TC-4` logging beyond the backdating limit "requires `time_entry:read_any`"; the permissions table maps both "See anyone's entries" and "**Edit** anyone's entries" to `time_entry:read_any`; `PATCH`/`DELETE /api/time-entries/{id}` are policed `owner | time_entry:read_any`. `rbac.md` states "`*_any` means 'including records you do not own'" and offers only `time_entry:create`, `time_entry:read_any`, `time_entry:manage_rates` — so anyone granted visibility of the team's timesheet silently gains the power to rewrite and delete it. That is a genuine authorisation hole of exactly the kind `rbac.md`'s two-axis design exists to prevent. | Add `time_entry:update_any`, `time_entry:delete_any` and `time_entry:log_backdated` to `rbac.md`, assign them to `manager`/`lead` in the built-in role fixture, and re-point `TC-4`, `TC-5` and the two routes at them. |
| high | **A running timer has no storage.** `TC-6` "A timer is offered — start, stop, and **it survives a page reload**", with `POST /api/time-entries/timer/start` and `/stop`. `time_entry` is `(work_item_id, person_id, date, minutes, activity_id, description, billable)` — there is no `started_at`, no running-timer row, and the edge case "Timer left running overnight — capped at 12 hours" needs server-side state to cap. | Add `running_timer (person_id pk, work_item_id, started_at, activity_id, description)` to `data-model.md` §9, one row per person, with the 12-hour cap enforced by the `stop` handler and a scheduled sweeper. |
| high | **`TC-14` "Cost entries attach to a work item **or directly to a project**" has no storage.** `cost_entry` is `(work_item_id, cost_type_id, person_id, date, units, rate, description)` — no `project_id`, and `work_item_id` is not documented as nullable. | Add `project_id` to `cost_entry`, make `work_item_id` nullable, and add a check that exactly one is set. |
| high | **`TC-19` multi-currency fails for cost entries.** "Multi-currency is supported by **storing the currency per row**." `hourly_rate` and `budget` have `currency`; `cost_entry` and `cost_type` do not. A travel cost in EUR on a GBP project cannot be recorded, and the edge case "Two currencies in one project — reported separately, never summed" cannot be implemented. | Add `currency` to `cost_type` (default) and `cost_entry` (captured at entry time, alongside `rate`). |
| medium | **`TC-17`'s "committed" is not computable.** "committed includes **estimated remaining work valued at current rates**." Estimates may be `points`, `categories` or `time` (`estimate.system`); for the first two there is no defined conversion to hours, and no rule says whose rate values unassigned remaining work. | Define it: committed is computed only when `estimate.system = 'time'`; otherwise the project budget shows "committed: not available (estimates are in points)". State the rate used for unassigned work (the project default rate). |
| medium | **`TC-18`'s budget thresholds are not in the event catalogue and the recipient is undefined.** "Thresholds — 75% and 90% — raise notifications to **the project manager**." `notifications.md`'s event table has no budget event, and no `project_manager` exists — `project` has `default_assignee_id`, and `stakeholder` has a free-text `role`. | Add `budget.threshold_reached` to the canonical event catalogue (§6) with the payload carrying the threshold, and define the recipient as "holders of `budget:manage` on the project, plus its `default_assignee_id`". State whether the thresholds are fixed or configurable per budget. |
| medium | **`TC-4`'s backdating limit has no home.** "up to a configurable limit (default 30 days)" — not in `configuration-reference.md`, not a God Mode section, not in `settings-hierarchy.md`. | Add it to workspace settings (it is a policy per organisation, not per deployment) and to `settings-hierarchy.md`'s Workspace table. |
| medium | **`TC-3`'s project default has no column.** "A `billable` flag, **defaulting from the project**" — `project` has no `default_billable`. | Add `default_billable boolean not null default true` to `project`. |
| medium | **Three screens the spec requires have no inventory row.** **Project budget** (planned/actual/committed with a burn chart), **Rates** ("under workspace settings, gated by capability"), and configuration screens for `time_activity` (`TC-2` makes an activity type **required**, so someone must create them) and `cost_type` (`TC-12`). The inventory has `Timesheet` and the work-item `Time entries` section only. `settings-hierarchy.md`'s Workspace table also lists none of them. | Add `Project — budget`, `Workspace — rates`, `Workspace — time activities`, `Workspace — cost types` rows to the inventory and to `settings-hierarchy.md`, with routes and capabilities. |
| medium | **Route policies use two undefined forms**: `time_entry:create | read_any` and `owner | time_entry:read_any` — an OR of capabilities, and an `owner` policy kind `rbac.md` does not define. Same class as §3 and §7. | Define the `owner` policy kind in `rbac.md` (`{ capability, scope, orOwner: true }` with "owner" meaning `row.person_id === identity.personId`), or split the routes. |
| medium | **No `## Data` and no `## Open questions` section.** | Add both; Data should name all seven tables in `data-model.md` §9. |
| low | Edge case "Entry crossing midnight — **split by the client** into two dated entries before submission" puts a data-integrity rule in the client. A direct API call bypasses it. | Enforce server-side: reject a timer stop that spans a date boundary, or split it server-side and say so. |
| low | `TC-11` "Rates are visible only with `time_entry:manage_rates`" is a cross-cutting redaction rule that must hold in reports and exports (the Testing section says so), but `reports-and-dashboards.md` does not restate it. | Cross-reference from the reports spec's permissions table. |

Data references: `time_entry`, `time_activity`, `hourly_rate`, `cost_type`, `cost_entry`,
`budget`, `available_hours` all exist in §9 ✓ but are missing the columns above.
Capabilities `time_entry:create`, `time_entry:read_any`, `time_entry:manage_rates`,
`budget:read`, `budget:manage` present in `rbac.md` ✓; the three new ones are not.

---

## 10. `reports-and-dashboards.md`

**Verdict: not-ready.** The honesty rules (`RP-1`–`RP-6`) are the best product thinking in
the corpus and `RP-18` is an admirably specific correction of a named v1 defect. But the
document promises "the fourteen canned reports below" and then lists **twenty**, none of
which has a definition; three tables it depends on do not exist; and the tier 2/3 mechanism
routes to a different endpoint than the saved-views spec it claims to reuse unchanged.

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| high | **Twenty reports are listed, described as fourteen, and none is defined.** "The fourteen canned reports below" / "**Tier 1 — Fixed reports.** The fourteen reports below" — the tables contain 4 + 3 + 5 + 4 + 4 = **20**. Worse, each report is one line of English ("Cycle time — Created to resolved, bucketed"): no metric formula, no `RP-1` minimum sample (the rule's own example says "3 of 10 needed" but no report states its *m*), no `RP-2` bucket boundaries, no default window, no denominator for the percentages. The Testing section asks for "bucket boundaries" tests against values that exist nowhere. An implementer would invent twenty report definitions. | Fix the count, and add a definition block per report: `key`, entity, measure (with the exact formula), dimensions, bucket boundaries, minimum sample *m*, default window, drill-down target. This is the single largest missing artefact in the audited set — consider a `docs/03-features/report-definitions.md`. |
| high | **`metric_snapshot` does not exist in `data-model.md`.** `RP-9` reads closed periods from it; `background-jobs.md` schedules `metrics-snapshot` hourly to write it "(dimension keys + measures)"; `scaling.md` and ADR 0009 both cite it. Four documents depend on a table that was never defined, including its dimension keys, its grain and its retention. | Add `metric_snapshot (period_start, period_end, grain, metric_key, dimensions jsonb, measures jsonb, computed_at)` to `data-model.md` §11, with a unique index on `(metric_key, grain, period_start, dimensions)` and a retention row. |
| high | **`dashboard` and `dashboard_widget` do not exist.** `RP-13`–`RP-16` define a grid of resizable, draggable widgets whose "layout persists", plus personal and workspace dashboards, and three `/api/dashboards*` routes. No storage of any kind. | Add `dashboard (owner_id null, workspace_id, name, scope, is_default)` and `dashboard_widget (dashboard_id, report_key, saved_view_id null, query jsonb, chart_type, x, y, w, h)`. |
| high | **CSAT has no storage.** The "Satisfaction — CSAT by customer and by request type" report and `customer-portal.md`'s `CP-9` ("A satisfaction rating is offered on resolution") and the `/portal/requests/{ref}/rate` screen all need a rating row. `data-model.md` has none. | Add `satisfaction_rating (work_item_id, person_id, score, comment, created_at)` to `data-model.md` §7, and define the scale in `customer-portal.md`. |
| high | **Tier 2/3 route to `/api/saved-views`; `search-and-saved-views.md` — the spec they claim to reuse verbatim — routes to `/api/views`.** Two prefixes for one resource (`saved_view`), and the route-coverage test would see two independent route families. **Their policies also differ**: creating a saved view is "Any authenticated session" in `search-and-saved-views.md`'s permissions table but `report:read` here; editing is `owner \| workspace:manage_settings` there and unspecified here. | Pick one prefix (`/api/views`, since it ships in P1 and reports arrive in P5), delete the duplicate route family here, and state that a tier 2/3 report is a `saved_view` created through the P1 routes with `layout: 'table'\|'chart'` — with reports contributing *no new policy*. |
| high | **`POST /api/saved-views` is listed twice in the same API block** (once for tier 2, once for tier 3) with the same policy. A `PolicyMap` is keyed by route, so this cannot be expressed, and it signals that the tier distinction is not actually carried by the API. | Collapse to one entry and describe the tier distinction as a property of the request body (`layout`, presence of `groupBy`/`aggregate`), not of the route. |
| high | **Four route policies are not policies.** `GET /api/dashboards → (scoped)`; `POST /api/dashboards → (self \| workspace:manage_settings)`; `GET /api/dashboards/{id}/widgets/{wid}/data → (per widget's report, any tier)`; `GET /api/reports/{key} → report:read \| report:read_all`. The widget-data route is exactly where `RP-18`'s v1 defect would recur: a widget embedding a cross-project report, fetched through a route whose policy is described as deferring to the widget's contents. | Give each a concrete `{ capability, scope }`. For widget data: resolve the widget's underlying report key server-side and apply *that* report's policy plus `RP-17` reach filtering before returning a byte — and name a test for it alongside `customer-cannot-read-reports.spec.ts`. |
| medium | `RP-18` "**Customers see no reports**" is enforced only by not granting `report:read` to the `customer` role — a configuration fact, not a behavioural guarantee, and roles are editable rows (`RL-*`), so an administrator can grant it. `rbac.md`'s "Customers may never" table — the list of *behavioural* constraints "enforced regardless of capabilities" — does not mention reports. | Add "Read any report or dashboard" to `rbac.md`'s "Customers may never" column, so it is enforced in `packages/domain` and cannot be misconfigured away. |
| medium | Edge case "Export of 500,000 rows — **queued as a job; a download link is emailed when ready**". No job in `background-jobs.md`, no storage for the generated file, no expiry, and — most importantly — **no statement of whether the emailed link is authenticated**. An unauthenticated link to a full report export is a data-leak waiting to be implemented. | Specify: the export is written to the configured storage backend with a random key, the email links to an authenticated route (`GET /api/reports/exports/{id}` → `report:export` + owner), the row expires after 7 days, and the download is audited per `RP-10`. Add the `report-export` job. |
| medium | **`metric_snapshot`'s existence undermines `RP-17`.** Snapshots are precomputed aggregates; reach filtering is per viewer. Nothing says how a snapshot row is filtered to a viewer's reach — aggregate rows cannot be filtered after the fact without the underlying ids. | State the rule: snapshot dimension keys always include `project_id` (and `organisation_id`), and a viewer's query sums only the dimension rows within reach. Reports whose measure cannot be decomposed that way must be computed live and marked as such. |
| medium | Two reports name entities with no definition. "**Escalations** — volume and resolution of escalations": the only escalation concept in the model is `work_item:escalate_priority` and `stakeholder.escalation_order`; there is no escalation record to count. "**Predictability** — committed versus delivered per cycle": nothing stores what a cycle *committed to* at its start. | Define an escalation as an `activity` row with `verb = 'escalated'` and say so; add a cycle-commitment snapshot (or drop Predictability to P6). |
| medium | **No `## Data` section and no `## Open questions` section.** Given four missing tables, the absent Data section is exactly where the problem would have been caught. | Add both. |
| medium | Tier 3 "adds grouping, aggregation and a chart-type choice" over "the same filter grammar", but `search-and-saved-views.md`'s `SV-12` says "Field names are **whitelisted**. The grammar compiles to parameterised SQL" — it describes no aggregate functions, no `groupBy`, and no chart metadata. The two specs describe one grammar with two different capability sets. | Extend the grammar definition in `api-design.md` with the `groupBy` / `aggregate` clause and the allowed aggregate functions, and have both specs reference it. |
| medium | Feature flag `feature.reports` is in `configuration-reference.md`'s list and **not** in `plugin-architecture.md`'s. | Covered by the §2 fix. |
| low | **Dashboard editor** is named under Screens with no screen-inventory row (the inventory has `Dashboard` but no editor). | Add `Dashboard editor` (`/agent/dashboard/edit` or a modal) to the inventory. |
| low | `RP-9` "the boundary is stated" and `RP-4` "as-of time" imply a snapshot lag of up to an hour; the reports index's "KPI strip" would show stale numbers with no indicator. | State that the KPI strip carries the same as-of line. |

Capabilities `report:read`, `report:read_all`, `report:export` present in `rbac.md` ✓.
Data references: `saved_view` ✓, `cycle` ✓, `project.health` ✓; `metric_snapshot`,
`dashboard`, `dashboard_widget`, satisfaction rating all missing (above).

---

# Part B — design documents

## 11. `design-principles.md`

**Verdict: ready-with-fixes.** Not a buildable spec and not meant to be — it is the
rationale the gates enforce, and it is unusually good at it (principle 12's microcopy table
is directly usable). The risk is that its governing rule delegates the entire visual
specification to a repository outside this one.

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| medium | **The design specification is an unpinned sibling working copy.** "The reference is in the workspace at `../kaneo`… When you are unsure how something should look or behave, **open kaneo and look**." It is present on this machine (`/Users/heinthura/Documents/Workfolder/Development/kaneo`, with `plans/001`–`007`), but it is not vendored, not submoduled, not pinned to a commit, and not available to CI or to an agent working from a fresh clone. `H1` ("Open kaneo. Open this.") is a merge gate that depends on it. | Vendor the reference: add kaneo as a git submodule or `git subtree` at a pinned SHA, or extract the load-bearing parts (the `plans/` motion specs, the token values) into `docs/02-design/` so this repository is self-contained. Record the pinned SHA in `ADR 0001`. |
| medium | Principle 9 points at "kaneo's motion specs in `plans/001-motion-tokens-and-easing.md` **and the related documents**" — an unenumerated set. `motion.md` does enumerate seven, so the principles doc is the looser of the two. | Replace with a link to `motion.md`, which owns the list. |
| low | Principle 2's colour table and `design-tokens.md`'s status tokens are two vocabularies for one thing: "Blue / accent — primary action, current selection" has no token (`--color-info` is "neutral informational", `--color-primary` is the action); "Amber — at-risk SLA, warnings, pending approval" maps to `--color-warning`. | Add the token name to each row of principle 2's table so the mapping is explicit. |
| low | Principle 4 ("Filters, tabs, lenses, selected records, open panels — all URL state") is stated as absolute but `G5` only checks route *registration*, not URL-encoded view state — see §18. | Cross-reference the gate's actual coverage, or strengthen the gate. |

---

## 12. `design-system.md`

**Verdict: ready-with-fixes.** The primitive inventory is concrete and complete for the
core product, the twelve TaskDesk additions map cleanly onto the features that need them
(`capability-matrix` → `RL-1`, `plugin-config-form` → `GM-5`, `sla-badge` → the SLA
tokens), and the composition rules are lintable. Two features audited above have no
primitive and no library.

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| high | **No charting library and no chart primitive, in a product with a whole reporting tier built on charts.** Foundations names Tailwind, Radix, cva, lucide, Framer Motion and Storybook — nothing that draws a chart. `reports-and-dashboards.md` requires "a chart type (bar, line, table, single number)", `RP-11` requires an accessible table equivalent per chart, and `RP-2` requires bucketed distributions. An implementer picks Recharts, visx, Chart.js or D3 unilaterally, and `G2` (tokens only) and `G3` (contrast) then apply to a library whose colour API nobody chose. | Name the library in Foundations, add `chart` (with `bar`/`line`/`number` variants) and `chart-table` to the TaskDesk primitives table, and state that series colours come from a fixed token ramp so `G3` can check them. |
| high | **No dashboard grid primitive** for `RP-15`'s "widgets are resizable and draggable, and layout persists". dnd-kit is named in `accessibility.md` for board drag but not in Foundations, and a resizable grid is a different problem from a kanban board. | Add `dashboard-grid` to the primitives table, name the library, and state its keyboard path (as `accessibility.md` does for board drag) — otherwise it lands in the Known exceptions table by default. |
| medium | **"Instance branding overrides a small set of variables" contradicts `plugin-architecture.md` and `configuration-reference.md`, both of which offer "custom CSS variable **overrides**" with no stated bound.** An arbitrary admin-supplied CSS variable set is a styling-injection surface, and it defeats `G3` — the CI contrast check runs over the committed tokens, not over what an administrator types at runtime. | Bound it: enumerate the overridable variables (accent, logo, login background, favicon), reject anything else server-side, and run the same contrast check on the submitted accent before saving — surfacing a warning rather than accepting an unreadable theme. |
| medium | **The `icon` columns have no vocabulary.** `project.icon`, `work_item_type.icon`, `request_type.icon` are data; "Icons — `lucide-react`, and nothing else. Never an inline SVG… never an emoji as an icon" is the rule; but nothing says the stored value is a lucide icon name, nor what happens when a stored name is not in the installed lucide version — which is exactly the v1 failure this section cites ("buttons with empty icon paths"). | State that icon columns store a lucide icon name from a checked-in allowlist, that the picker only offers allowlisted names, and that an unknown name renders a documented fallback rather than nothing. |
| low | "**Chromatic-style** visual snapshots run against Storybook in CI" names no tool, and `G8` depends on it. | Name it (Chromatic, Playwright component snapshots, Loki) and say where baselines live. |
| low | The primitives list has no editable week-grid for `time-and-cost.md`'s timesheet ("a week grid, person by day, with inline entry, keyboard navigation between cells"), which is a materially different component from `data-table`. | Either add `grid-editor` or state that the timesheet composes `data-table` with an editable-cell variant. |

---

## 13. `design-tokens.md`

**Verdict: not-ready.** Structurally this is the right document — two layers, semantic-only
in application code, a named enforcement script with four specific failure conditions. But
**it contains almost no values for the tokens that are unique to this product**, so the CI
contrast gate it defines cannot run and an implementer chooses the palette.

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| high | **No colour values anywhere.** `--color-background`, `--color-card`, `--color-primary`, the four status colours, the four priority colours and the six SLA colours are named with prose meanings and no hex/oklch value in either theme. "Base scale is zinc, from kaneo" covers the neutrals by reference; it does not cover the fourteen status/priority/SLA tokens, which by `design-principles.md`'s own admission have no kaneo equivalent ("If kaneo has no equivalent — SLA badges…"). Fourteen brand-defining colours are an implementer's guess, in two themes. | Add a values table: token → light value → dark value, for every semantic token. This is the one thing a token document must contain. |
| high | **`G3`/`check-tokens.mjs` fails on "any **declared** foreground/background pair below WCAG AA" — but no pairs are declared anywhere.** The script has no input. `accessibility.md` repeats the same phrase ("over every declared pair"). | Add a `pairs.json` (or a `theme.css` convention the script can parse) enumerating every legitimate foreground/background combination, and commit it alongside the values. |
| high | **`--ease-spring: spring(1, 100, 15, 0)` is not valid CSS.** `spring()` is not a CSS timing function; assigned to `transition-timing-function` it is invalid and silently falls back to `ease`. Both `design-tokens.md` and `motion.md` publish it in a `motion.css` block, and `motion.md`'s "Board card drop — normal — **spring**" row depends on it. | Move the spring to a JS token consumed by Framer Motion (`{ type: 'spring', stiffness: 100, damping: 15 }`) exported from `packages/ui`, and remove it from the CSS token block — or express it as a CSS `linear()` easing approximation and say so. |
| medium | **No shadow values.** `--shadow-sm subtle lift`, `--shadow-md floating`, `--shadow-lg modal` — three names, three prose descriptions, no `box-shadow`. `motion.md`'s drag rule ("the dragged card lifts: `scale(1.02)` plus `--shadow-md`") depends on it. | Add the three `box-shadow` values for both themes. |
| medium | **The one breakpoint that matters is not a token.** "The meaningful application breakpoint is **900 px**" — it is not in the `sm/md/lg/xl/2xl` scale (it falls between `md` 768 and `lg` 1024), so every implementer writes `@media (max-width: 900px)` by hand, which `G2` does not catch. `design-system.md` and `information-architecture.md` both restate 900 px independently. | Add an `app: 900px` screen to the Tailwind preset and a `--breakpoint-app` token, and reference it from the other two documents. |
| medium | **`G2` as written does not enforce the density rule the document states.** "Hard-coding `py-3` on a table row defeats the preference" — but `G2` fails only on *arbitrary* Tailwind values (`p-[13px]`, `bg-[#fff]`), and `py-3` is a standard-scale utility. So the failure mode the document names is caught only by `H5`, a human gate. | Extend `check-tokens.mjs`: inside `apps/web`, forbid the vertical-padding and gap utilities on rows, cards, sections and fields, requiring `--space-row-y` etc. — or list the specific utilities that are banned in which component classes. |
| medium | **Font sizes are declared in px, and `accessibility.md` forbids that.** The type table gives "12 / 16", "14 / 20", …; `accessibility.md` says "Text resizes with browser font settings — `rem` units, **no `px` font sizes**." One of the two is wrong. | Express `--text-*` in `rem` (0.75/1rem, 0.875/1.25rem, …) and keep the px equivalents as a comment. |
| low | "Geist Variable, Geist Mono Variable" with no fallback stack and no statement of how the font is served. For a self-hosted, no-phone-home product, a Google Fonts CDN link would violate the product's own stance. | State that the fonts are self-hosted from `packages/ui`, and give the fallback stack. |
| low | `--ease-in` is defined in `motion.md` and **omitted** from `design-tokens.md`'s motion summary, which lists only `--ease-out`, `--ease-in-out`, `--ease-spring` — yet `motion.md`'s table uses "in" for row removal. | Add `--ease-in` to the summary, or delete the summary and link to `motion.md` as the single source. |

---

## 14. `information-architecture.md`

**Verdict: ready-with-fixes.** The navigation, the project-tab model, the work-item detail
layout and the URL scheme are all concrete and match the screen inventory closely. Three
places contradict a sibling document.

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| high | **The naming table is a third terminology mechanism, unreconciled with ADR 0012.** "Work item → Agent UI: **Ticket / Task, per its type** → Portal UI: Request" makes the rendered noun vary by `work_item_type`. ADR 0012 makes it vary by `terminology_override` (instance/workspace × locale), and the i18n locale file is the third source. No document says how the three compose — does a per-type name beat an admin's workspace override? Does the portal's "Request" beat both? | State the resolution order once, in ADR 0012: `work_item_type.name` (when the context is a specific typed item) → workspace override → instance override → built-in locale string, with the portal audience selected first (which needs the `audience` column from §2). Then have this table cite it rather than assert its own answer. |
| medium | **`Calendar` and `Timeline` appear both as project tabs and as `Work` layouts, in the same document.** The tab strip is `Overview │ Work │ Backlog │ Cycles │ Modules │ Timeline │ Calendar │ Pages │ Settings`, while the layout switcher immediately below is `[ Board ] [ List ] [ Table ] [ Calendar ] [ Timeline ]`. The screen inventory has only the layouts (`…/work?layout=calendar`, `…?layout=timeline`) and no tab rows — and the document's own rationale is that v1's separate work views were the mistake. | Delete `Timeline` and `Calendar` from the tab strip. |
| medium | **The Workspace settings list here differs from `settings-hierarchy.md`'s and from the screen inventory.** This document lists "…labels, estimates, **integrations**, webhooks, import" — `integrations` appears in no other document and has no screen — and omits **terminology** and **danger zone**, both of which the other two have. | Reconcile to one list; `settings-hierarchy.md` should own it and the other two link to it. |
| medium | **The Dashboard has no navigation entry.** The sidebar lists Inbox, My work, Triage, Projects, Views, Reports, Knowledge base, Service management, Timesheet — no Dashboard, though the inventory has `/agent/dashboard` and `RP-16` promises "a sensible default dashboard [so] a new user sees something useful immediately". Is `/agent` (Workspace home) the dashboard, or a different screen? | Decide and state it: either add `Dashboard` to the sidebar, or say `/agent` renders the default dashboard and delete the separate route. |
| low | The URL scheme block is illustrative but omits `/agent/timesheet`, `/agent/dashboard`, `/portal/requests/{ref}/rate` and every God Mode route but one, while `lib/routes.ts` is described as "the single declaration of these". | Add a line saying the block is illustrative and `lib/routes.ts` is authoritative, or complete it. |

---

## 15. `motion.md`

**Verdict: ready-with-fixes.** The most lintable document in `02-design`: a duration/easing
table per interaction, an explicit "what does not animate" list, a performance rule
(`transform` and `opacity` only) that a stylelint rule can enforce, and a real reduced-motion
test strategy. Two of its code blocks do not work as written.

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| high | **The reduced-motion block is invalid CSS.** `@media (prefers-reduced-motion: reduce) { --duration-fast: 0ms; … }` — custom-property declarations need a selector. As written the block parses to nothing and reduced motion silently does not work, which `G9` would only catch if a test asserts the *duration*, not merely that the suite passes. | Wrap in `:root { … }`. And have `G9` assert the computed value of `--duration-normal` is `0ms` under `reducedMotion: 'reduce'`, not only that the E2E suite passes. |
| high | `--ease-spring: spring(1, 100, 15, 0)` in the CSS token block — invalid CSS, as in §13. The "Board card drop — normal — **spring**" row and "On drop, the card settles with `--ease-spring`" both depend on it. | Same fix: a JS spring token for Framer Motion; remove from `motion.css`. |
| medium | **The 60 fps budget has no measurement harness.** "Budget: 60 fps. A dropped frame during a board drag is a bug, and is caught by **the performance assertion in CI**" — no tool, no method, and `G11` restates the same claim with no more detail. Frame-level assertions in headless CI are the single most flake-prone thing in this document. | Name the mechanism (a Playwright trace with `Animation` events, or a `requestAnimationFrame` sampler asserting p95 frame time < 16.7 ms over a scripted drag), state the sample size, and state the flake policy. |
| low | "Skeletons pulse at `--duration-slow` with a shimmer" — 300 ms is a plausible transition but an implausible pulse *period*; it reads as if the whole shimmer cycle is 300 ms, which would be a strobe. `accessibility.md` separately requires "nothing flashes more than three times per second" (i.e. period ≥ 333 ms), which a 300 ms cycle violates. | State the shimmer period explicitly (e.g. 1.5 s) and note that it is deliberately not `--duration-slow`. |
| low | The document is explicitly derivative of seven kaneo `plans/` files it calls "the source"; those live outside the repository (see §11). | Same fix as §11 — vendor or extract them. |

---

## 16. `accessibility.md`

**Verdict: ready-with-fixes.** The strongest document in `02-design`. Specific, testable
rules (the `SUP-1234` announcement rule, focus-on-cancel for destructive dialogs, the
dnd-kit keyboard path), a tool-per-layer testing table, and an honest Known-exceptions
table with a documented alternative for each. Three cross-document conflicts.

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| high | **ADR 0012's terminology mitigation, implemented as written, is a WCAG 2.5.3 (Label in Name, Level A) failure.** ADR 0012 mitigates support drift "by keeping the default English noun and the internal key visible in tooltips and **`aria-label`s**, so a support agent can always ask 'what does your instance call a Ticket?'". An `aria-label` *replaces* the accessible name: a control reading "New Case" on screen would be announced "New Ticket", so a speech-input user saying "click New Case" would not activate it. `accessibility.md` does not mention terminology at all. | Put the default noun in a `title` attribute or a visible tooltip — never `aria-label`. Add a rule to this document: "The accessible name always matches the visible label, including under a terminology override," and add a test to the overlay's snapshot suite. |
| medium | **Three different minimum viewport widths across three documents.** This document commits to "usable at **320 px** viewport width" (the WCAG 1.4.10 threshold); `ux-quality-gates.md`'s `H6` asks "does it work at **375 px**?"; `design-tokens.md` treats **900 px** as the meaningful breakpoint. `H6` is the merge gate, and it is laxer than the standard the product commits to. | Change `H6` to 320 px, and add a Playwright viewport project at 320 px so it is automated rather than a human question. |
| medium | "Text resizes with browser font settings — `rem` units, **no `px` font sizes**" contradicts `design-tokens.md`'s px type scale (§13). | Same fix — convert `--text-*` to `rem`. |
| medium | "Automated in `check-tokens.mjs` over **every declared pair**" — the same undefined input as `G3` (§13). This document is where the contract for a "declared pair" should be stated, since it owns the contrast requirement. | Define the manifest format here and point `check-tokens.mjs` at it. |
| low | The Known exceptions table names "**Gantt**"; the screen inventory and `information-architecture.md` call the same surface "**Timeline**" (`…?layout=timeline`), while the feature flag is `feature.gantt`. Three names for one thing. | Pick one (the flag suggests `gantt`; the UI says `timeline`) and note the alias once. |
| low | No mention of RTL or of locale-driven layout, though `instance_setting.default_locale` exists, ADR 0012 scopes overrides *per locale*, and God Mode offers a default locale — and **no document in the repository specifies the i18n layer** ADR 0012 says it builds on. | Either state that P4 ships LTR locales only and RTL is a later phase, or add an i18n architecture note. Flagged again in §18. |

---

## 17. `screen-inventory.md`

**Verdict: not-ready.** As a register it is well-formed — route, phase, status per row, and
three good rules. But its own arithmetic is wrong, it is missing roughly twenty screens the
audited specs require, and it contains a P4 screen for a feature that **has no spec at
all**.

### Coverage: screens the audited specs require that have no row

| Spec | Missing screen |
| --- | --- |
| `settings-hierarchy.md` | `Workspace — danger zone`, `Project — labels`, `Project — SLA` |
| `custom-fields.md` | Custom field editor, Section manager |
| `notifications.md` | Per-workspace notification rules; God Mode outbox / dead-letter; portal notification preferences |
| `automations.md` | `Workspace — automations` |
| `webhooks-and-api-keys.md` | Webhook editor, Webhook delivery history |
| `time-and-cost.md` | `Project — budget`, `Workspace — rates`, `Workspace — time activities`, `Workspace — cost types` |
| `reports-and-dashboards.md` | Dashboard editor |
| `mcp-server.md` | `God Mode — MCP usage` |
| `god-mode.md` / `configuration-reference.md` | Observability, config export |

### Coverage: rows with no owning spec

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| high | **`Workspace — teams` is a P4 screen with no feature spec.** `docs/03-features/` has no `teams.md`, yet `team` and `team_member` are in the data model, `SV-17` gives team leads edit rights on team views, `saved_view.shared_with_team_id` is the sharing mechanism, `automations.md` sends notifications "to a person, **a team** or a channel", `reports-and-dashboards.md`'s Capacity report reads `team.capacity_days_per_week`, and `rbac.md`'s reach resolution step 5 is "**Team membership** where the team owns the project" — a reach rule with no document defining how a team comes to own a project. An implementer would invent the entire teams model, including a reach path. | Write `docs/03-features/teams.md` before P4, covering team CRUD, membership, capacity, team-owns-project (the reach rule), and team leads (`SV-17`). Add it to the README's Governance table. |
| medium | `Workspace — terminology` (P4) has a row, is listed in `settings-hierarchy.md`'s table, and is required by ADR 0012 — but **no document states its behaviour, its capability, or its routes**. `god-mode.md` covers only the instance level. | Own it in `god-mode.md` (both levels, since the term-key enum and preview are the same) or in a new terminology section of `settings-hierarchy.md`; either way add numbered rules and routes. |
| low | `Profile — appearance` (P1) owns theme, density and default layouts — the preference `design-principles.md` principle 8 and gate `H5` both depend on — with no feature spec. | Fold into a short section of `settings-hierarchy.md`'s Profile table with the storable keys named. |

### The register itself

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| medium | **The Counts table does not match the rows.** Stated: P0 4, P1 27, P2 15, P3 20, P4 18, P5 23, P6 2, total **109**. Actual: P0 **6**, P1 **28**, P2 **16**, P3 **19**, P4 **20**, P5 23, P6 2, total **114**. Every phase but P5 and P6 is wrong, and the document is cited as "the answer to 'what is left?'" and as input to phase planning. | Regenerate the counts, and add a CI check that recomputes them from the rows so they cannot drift again — the same discipline the rest of the corpus applies to route policies. |
| medium | **The register's first rule contradicts its own contents.** "A screen is not on this list until it is in `lib/routes.ts`" — but `Command palette` (overlay), `Error boundary` (—), `Create work item` (dialog), `Bulk edit` (overlay), `Relations editor` (section), `Approvals panel` (section) and six more have no route. `G5` fails on "a route rendered by the router that is not declared in `lib/routes.ts`", so these rows are outside both the rule and the gate. | Add a `kind` column (`route` / `overlay` / `section` / `dialog`) and restate the rule as "every row of kind `route` is in `lib/routes.ts`". Exclude other kinds from `G5` explicitly. |
| low | Several routes are abbreviated with a leading ellipsis (`…/appearance`, `…?layout=list`) whose base is inferred from the preceding row. Machine-checking the inventory against `lib/routes.ts` requires expanding these by hand. | Write routes in full, or define the ellipsis convention formally so a script can expand it. |

---

## 18. `ux-quality-gates.md`

**Verdict: ready-with-fixes.** The strongest governance idea in the repository — "a pull
request that fails any gate does not merge", plus a waiver process that explicitly forbids
an AI agent from self-approving. Assessed against the question asked: **are the 13 gates
each mechanically checkable as written?**

### Gate-by-gate

| Gate | Mechanically checkable as written? |
| --- | --- |
| `G1` No bespoke primitives | **Yes.** A JSX lint rule on five element names, with a comment escape hatch. |
| `G2` Tokens only | **Partly.** Catches hex/`rgb()`/`hsl()`/`oklch()` and *arbitrary* Tailwind values — but not the density violation the token doc names (`py-3`, a standard-scale utility). See §13. |
| `G3` Contrast | **No.** "Any **declared** foreground/background pair" — no pair manifest exists and no token has a value. The script has no input. See §13. |
| `G4` Accessibility | **Yes.** axe critical/serious over E2E screens and Storybook stories; tools named in `accessibility.md`. |
| `G5` Every screen has a URL | **Partly.** Route registration and round-trip are checkable; the *principle* it enforces ("filters, tabs, lenses, selected records, open panels — all URL state", and `RP-8`) is not checked at all. |
| `G6` Four states | **No, as written.** The title says four states; the fail condition names **three** ("empty, loading and error"), silently dropping `partial` from `design-principles.md` principle 7. And "'Meaningful' excludes a bare 'No results' or an unstyled error" is a human judgement inside an automated gate. |
| `G7` Storybook coverage | **Yes.** Exported component without a story — a trivially scriptable check. |
| `G8` Visual regression | **No.** No tool named ("Chromatic-style" in `design-system.md`), and "any **key screen** snapshot" leaves the set of key screens undefined. |
| `G9` Reduced motion | **Yes** as a suite-passes check — but see §15: the reduced-motion CSS is invalid, so the suite would pass while reduced motion does nothing. The gate needs to assert the computed duration. |
| `G10` Keyboard reachability | **Yes.** Eight core journeys are enumerated; each is a Playwright keyboard-only test. The best-specified gate. |
| `G11` Performance budgets | **Partly.** Nine budgets with real numbers, but no measurement harness, no throttling profile, no target screens for LCP/INP/CLS, and "any board drag frame — 60 fps, no dropped frames" has no stated method. See §15. |
| `G12` Portal bundle purity | **Yes.** Module-graph assertion on two named directories. Precise and valuable. |
| `G13` No layout shift on data arrival | **Partly.** CLS < 0.1 is measurable, but the "during the transition from skeleton to content" window is not defined, and it duplicates `G11`'s CLS budget with a different scope. |

**Six of thirteen** (`G1`, `G4`, `G7`, `G9`, `G10`, `G12`) are checkable exactly as written.
`G3`, `G6` and `G8` cannot be implemented at all without additional decisions.

| Severity | Issue | Concrete fix |
| --- | --- | --- |
| high | **`G3` cannot run** — no declared-pair manifest, no token values (§13). It is listed as an automated merge gate that would fail open or fail the build permanently. | Ship the values and the pair manifest with the gate. |
| high | **`G6` contradicts itself and the principle it enforces**: heading and principle 7 say four states (empty, loading, error, **partial**); the fail condition names three. `partial` is the hardest of the four and the one most likely to be skipped. | Either add `partial` to the fail condition and define how the E2E suite mocks it, or amend principle 7 to three states and say why partial is not gated. |
| high | **The terminology overlay has no gate**, though ADR 0012 rests its whole "exhaustively tested" claim on one: "a snapshot test can assert every screen re-renders correctly under a worst-case override (very long strings, a plural that looks nothing like the singular)". That test is promised in an ADR and appears in no gate, no testing document and no spec. | Add `G14 · Terminology overlay`: the visual-regression suite runs a second pass under a worst-case override fixture, and the accessible name still matches the visible label (§16). |
| high | **No document specifies the i18n layer** that ADR 0012 declares it builds on ("rendered through the existing i18n layer as an override on top of the built-in translation"), and no gate covers locale rendering. There is no library choice, no message format, no pluralisation strategy, no locale list, no RTL position — while `instance_setting.default_locale`, `person.locale` and `terminology_override.locale` all exist in the data model. | Write a short `docs/01-architecture/i18n.md` (library, message format, pluralisation, locale list, RTL stance, how an override is layered) before ADR 0012 is implemented. It is a prerequisite for God Mode → General → Terminology. |
| medium | **`G8` names no tool and no key-screen list**, so it cannot be implemented or reviewed. | Name the tool, list the key screens (or derive them from the inventory's `route`-kind rows), and say where baselines are stored and how a diff is approved. |
| medium | **`G11` has numbers but no harness.** Which page is measured for LCP? Under what CPU/network throttling? How is "route transition < 300 ms" instrumented? How is a dropped frame detected in headless CI? | Add a measurement appendix: tool per metric, throttling profile, target route per metric, sample count, and the flake policy for the frame assertion. |
| medium | **`G2` does not enforce density tokens** (§13), leaving `design-tokens.md`'s stated failure mode to `H5`, a human gate — in a document whose premise is "a person under deadline is not a reliable gate". | Extend `check-tokens.mjs` per §13. |
| medium | **`G5` does not check the thing principle 4 is about.** Route registration is necessary but not sufficient; `RP-8` ("the full filter state is in the URL") and `SV-19` ("every view has a URL that fully encodes it") are the substance, and nothing gates them. | Add to `G5`: for each list surface, an E2E assertion that applying a filter changes the URL and that reloading the URL restores the filter — a round-trip test on view state, not only on routes. |
| medium | **`H6`'s 375 px is laxer than `accessibility.md`'s 320 px commitment** (§16), and mobile is a human gate rather than an automated viewport project despite the portal being described as phone-first for customers. | Change to 320 px and add an automated 320 px Playwright project for the portal's core journeys. |
| low | `G13` overlaps `G11`'s CLS budget with an undefined measurement window. | Fold `G13` into `G11` as a scoped CLS assertion, or define the window (from skeleton mount to content paint). |
| low | The gate list is 13 automated + 6 human + 6 phase, and `screen-inventory.md`'s rule says "a screen is not ✅ until it passes **every** UX quality gate" — which, read literally, blocks every screen on `P3` (keyboard-only day) and `P4` (fresh-eyes test), which are phase-level, not per-screen. | Reword the inventory rule to "every automated gate (`G1`–`G13`) plus the human gates at review". |

---

## Summary

Eighteen documents audited: ten feature specs and eight design documents, cross-checked
against `data-model.md`, `rbac.md`, `plugin-architecture.md`, ADR 0012, ADR 0013 and
`configuration-reference.md`.

### Verdicts

| Verdict | Documents |
| --- | --- |
| **ready** | *(none)* |
| **ready-with-fixes** | `roles-and-permissions-ui.md`, `webhooks-and-api-keys.md`, `design-principles.md`, `design-system.md`, `information-architecture.md`, `motion.md`, `accessibility.md`, `ux-quality-gates.md` |
| **not-ready** | `god-mode.md`, `settings-hierarchy.md`, `custom-fields.md`, `notifications.md`, `automations.md`, `mcp-server.md`, `time-and-cost.md`, `reports-and-dashboards.md`, `design-tokens.md`, `screen-inventory.md` |

**Could an implementer build from these without guessing? No — not from ten of the
eighteen.** The specs are unusually well written as *prose*: the numbered-rule discipline
holds (`RL-1`…`RL-13`, `NO-1`…`NO-21`, `TC-1`…`TC-22`), the edge-case tables are genuinely
adversarial, and several rules (`WH-10`'s DNS-rebinding re-check, `RP-1`'s "not enough
data", `AU-3`'s effective-role clamping) are better than most shipped products manage. The
failures are not of thought but of *closure*: the documents were written faster than the
schema, the capability list and the screen register could keep up with them.

### The five patterns behind almost every finding

1. **Rules that outran the data model.** Fourteen behaviour rules describe state that has
   nowhere to live. Missing outright: `automation`, `automation_run`, `metric_snapshot`
   (referenced by four documents), `dashboard`, `dashboard_widget`, a satisfaction rating,
   `workspace_feature_flag`, a running timer, an idempotency-key store, the API-key
   extension. Missing columns: conditional visibility, `customer_visible` and `archived_at`
   on `custom_field`; scope, quiet hours and digest on `notification_preference`; payload on
   `webhook_delivery`; owner on `webhook`; `project_id`/`currency` on `cost_entry`;
   `actor_type` on `activity` and `audit_log`; `version` for the optimistic-concurrency
   `409`s that four specs promise.
2. **Route policies that the policy system cannot express.** `rbac.md` admits
   `{ capability, scope }` or `{ public, reason }`. The specs also use `(self)`, `owner`,
   `(scoped)`, `any authenticated session`, `A | B`, and — on the dashboard widget-data
   route — "per widget's report, any tier". The route-coverage CI test, the mechanism named
   as the structural answer to v1's eleven authorization holes, cannot validate any of them.
3. **Capability vocabulary that does not match the actions.** `time-and-cost.md`
   authorises editing and deleting other people's time entries with `time_entry:read_any`
   because no write capability exists — visibility silently confers the power to rewrite.
   `RL-5`'s implication graph is defined nowhere. `instance:manage_plugins` exists and is
   used by no route. `RL-4`'s rank comparison is ambiguous at equality.
4. **Multiple sources of truth that disagree.** Two `feature.*` lists; three event
   catalogues (automations / webhooks / notifications); three elevated-action lists; three
   terminology mechanisms (per-type name, `terminology_override`, i18n string); two route
   prefixes for `saved_view` (`/api/views` vs `/api/saved-views`) with different policies;
   two channel-test routes; three minimum viewport widths; a screen inventory whose counts
   are wrong in five of seven phases.
5. **Design tokens without values.** `design-tokens.md` names fourteen product-specific
   colours and three shadows and gives values for none, so `G3` — an automated merge gate —
   has no input, and `--ease-spring: spring(…)` plus the reduced-motion block are both
   invalid CSS that would fail silently.

### What is missing entirely

- **A `teams.md` feature spec**, though `Workspace — teams` is a P4 screen, `team` is in
  the data model, and `rbac.md`'s reach resolution has a team-ownership step no document
  defines. This is a reach rule with no specification.
- **An i18n architecture document**, which ADR 0012 declares it builds on.
- **Report definitions** — twenty reports (described as fourteen), each one line of
  English, with no formula, no minimum sample and no bucket boundaries.
- **A canonical event catalogue** and a **canonical `feature.*` list**.
- **Colour values.**

### Recommended sequence before P0

1. Close the data-model gaps (pattern 1) — one migration-design pass, mechanical once the
   list above is agreed.
2. Extend `rbac.md` with the third and fourth policy kinds, the implication graph, the
   capability groups and descriptions, and the missing `time_entry:*` write capabilities
   (patterns 2 and 3). This is the security-critical one.
3. Create the single-source artefacts: event catalogue, feature-flag list, elevated-action
   list, report definitions, colour values + contrast-pair manifest (patterns 4 and 5).
4. Write `teams.md` and `i18n.md`.
5. Reconcile the screen inventory (add ~20 rows, fix the counts, add the `kind` column) and
   close `G3`, `G6` and `G8` so all thirteen gates can actually run.

The corpus is closer to ready than the ten not-ready verdicts suggest — most fixes are
additive and mechanical rather than requiring rethinking. But items 1–3 are prerequisites,
not polish: an AI agent implementing from these documents today would invent a schema, an
authorization vocabulary and a colour palette, and each of those inventions would then be
load-bearing.
