# Foundation details

These retained technical requirements supplement the reader-shaped [schema](data-model.md), [permissions](permissions.md), [jobs](background-jobs.md) and [configuration](configuration.md) tables. Those tables remain the identifier registries; this document adds the non-table constraints they omitted. Required behavior, proposed design and observed implementation are distinct. This migration changes no product behavior and proves no runtime acceptance. Current [agent rules](../../AGENTS.md), explicit owner decisions and the maintained feature contracts take precedence over historical process or implementation claims.

## Source map

Provenance names below identify the unchanged 22 October snapshot; they are plain metadata, not links or runtime dependencies. A fresh checkout needs only the maintained destinations. Introductory rationale and historical review narratives are condensed; substantive constraints are retained here or in the named registry.

| Snapshot source and original lines | Maintained destination |
| --- | --- |
| `01-architecture/background-jobs.md` 1–91, 400–410: execution, leasing, new jobs | [Job coordination](#job-coordination) |
| Same, 92–182: inventory, cleanup, administration | [Job registry](background-jobs.md), [Retention](#retention) |
| Same, 183–217: SLA candidate query and edge cache | [Lifecycle and SLA](#lifecycle-and-sla) |
| Same, 218–354: delivery, digest, pre-wiring safeguards | [Delivery protocol](#delivery-protocol), [Integration prerequisites](#integration-prerequisites) |
| Same, 355–399: metrics, imports, telemetry | [Aggregation and imports](#aggregation-and-imports), [Job coordination](#job-coordination) |
| `01-architecture/data-model.md` 1–162: conventions, instance, identity | [Schema conventions](#schema-conventions), [Identity and membership](#identity-and-membership), [Schema registry](data-model.md) |
| Same, 163–263: external identity and proposed grants | [Identity and membership](#identity-and-membership), [Proposed grant projection](#proposed-grant-projection), [Schema registry](data-model.md) |
| Same, 264–463: domain tables, lifecycle, journal, SLA and rates | [Lifecycle and SLA](#lifecycle-and-sla), [Schema registry](data-model.md) |
| Same, 464–620: notification, audit and other tables; dedupe protocol | [Delivery protocol](#delivery-protocol), [Schema registry](data-model.md) |
| Same, 621–715: audit hash recipe and limits | [Audit hash chain](#audit-hash-chain) |
| Same, 716–743: shadow evidence | [Policy diagnostics](#policy-diagnostics), [Schema registry](data-model.md) |
| Same, 744–820: indexes, search, migrations | [Indexes and migrations](#indexes-and-migrations) |
| Same, 821–867: retention | [Retention](#retention) |
| `01-architecture/rbac.md` 1–213: axes, capabilities, role editor | [Authority and role editing](#authority-and-role-editing), [Permission registry](permissions.md) |
| Same, 214–311: diagnostics, proposed grant projection | [Policy diagnostics](#policy-diagnostics), [Proposed grant projection](#proposed-grant-projection) |
| Same, 312–450: one role, built-ins, ownership, instance authority | [Identity and membership](#identity-and-membership), [Authority and role editing](#authority-and-role-editing), [Permission registry](permissions.md) |
| Same, 451–481: customer boundary | [Customer boundary](#customer-boundary) |
| Same, 482–661: project reach and exceptions | [Reach](#reach) |
| Same, 662–905: policy declarations, scope provenance, tests | [Route policy constraints](#route-policy-constraints) |
| Same, 906–1003: status codes, elevation, deletion | [Reach](#reach), [Elevation and deletion](#elevation-and-deletion), [Permission registry](permissions.md) |
| Same, 1004–1052: MCP, API-key ceilings, forbidden shortcuts | [Credential ceilings](#credential-ceilings) |
| `05-operations/configuration-reference.md` 1–165: environment and DB process split | [Configuration registry](configuration.md), [Configuration boundaries](#configuration-boundaries) |
| Same, 166–285: runtime settings, precedence, secrets, backup | [Configuration registry](configuration.md), [Configuration boundaries](#configuration-boundaries) |
| Same, 286–347: local startup and bounded cutover exception | [Configuration boundaries](#configuration-boundaries), [Conflicts and limits](#conflicts-and-limits) |

Snapshot SHA-256 values: background jobs `6e3e418917b8862c0545994477adc9210bd722e7885409bf1e1faae5fc12f707`; data model `0cc13f166b298e4bc1cd3507269c9f62139ff8963a6ef92cc7f94295822dcf81`; RBAC `78ff06b1601f9f73b75a189c6ca3966a669078a449550c5eab7041a8fccf651b`; configuration `061dbd8fc2b37ae3a488dde2ef72b7f56ef02dd0cd41b3e13d57740cc2ba1a9b`.

## Schema conventions

Use PostgreSQL, Drizzle and journal-tracked forward migrations. Singular snake_case tables/columns; lifecycle position is `state`, never a new `status` vocabulary. IDs are CUID2 text, never sequential. Exceptions are the per-project work-item number, instance-wide submission number and internal `activity.seq` identity tiebreaker. The first two are human references; `seq` never leaves the database or becomes a reference. Every data table has UTC `timestamptz` creation/update fields; the lock-only `job_lease` has neither. Existing UTC-wall-clock `timestamp` columns require explicit UTC handling until migrated. Application and migration pools enforce UTC at connection startup, including when connection options request another timezone; existing stored values are unchanged.

Archive and soft deletion are separate columns and behaviors. Use an explicit `version integer not null default 1` on concurrently editable resources. Every persisted legacy task update also advances its compatibility version, including status, assignee, move, bulk and column-migration writes. The full-task v2 PUT checks the version under the row lock; compatible legacy PUT checks supplied `If-Match`, preserving documented omission behavior until that interface is retired.

Money is `numeric(14,4)`, durations integer minutes. JSONB has a named owning contract and is used for open shapes, not missing schema design. Foreign keys declare `ON DELETE`; polymorphic references use a typed entity pair or exactly-one nullable-FK check and cleanup in the owner deletion path. Actor IDs always carry `person|automation|system|api_key`. Enums use SQL enums/checks; priority order is `low < medium < high < urgent`. Do not reinterpret type/state names as business flags.

All table/column definitions and composite tenant FKs stay in [data-model](data-model.md). Marketplace licensing uses plugin-config rows rather than an extra table. Effective-dated rates preserve the rate applicable when an entry was logged. A managed service has support level/cover window and no cycles; a dated project has dates/backlog. Polymorphic custom-field values denormalize reach attribution at insert; the 15 field formats and entity expansion remain in [custom fields](feature-contracts-p4.md#custom-fields).

## Identity and membership

A person belongs permanently to one organisation. `(identity_connection_id, subject)` identifies an external identity; email never links tenants or staff/customer persons. Remove the inherited globally unique user-email index: the same address may represent separate unlinked persons in different organisations. Authentication owns its user/session/account/verification/factor tables; TaskDesk owns its directory and authorization. No inherited organization plugin or removed integration routers may become a second authority path. A session's host-selected `agent|customer` portal binding is set at issue and checked during auth dispatch, API authentication and WebSocket upgrade. Old unbound sessions require sign-in again; side data cannot infer their portal.

A membership contains exactly one role. Comma unions, surrounding padding and empty values fail closed; a valid single role may contain internal whitespace. Never comma-split and union a stored membership. The durable constraint rejects new malformed values. Recovery may normalize only unambiguous repeated copies of the same role; a genuine multi-role value stops migration until an operator explicitly chooses one role. Corruption in workspace A does not deny a healthy membership in workspace B: resolve the request's workspace only.

Self-introspection at `GET /api/capabilities` is the narrow exception: one unambiguous persisted workspace membership may read an all-false map for an unknown/malformed role. Missing or duplicate membership is 403; instance-wide reach does not substitute. Transition, rank and project-settings flags use their exact canonical capabilities, never a legacy statement shortcut. This endpoint is session-only.

Reserve every built-in role name case/whitespace-normalized; a custom row sharing a historical reserved name grants only its own declared permissions. In the legacy role bridge, genuine seed provenance (`is_system`) is necessary before using compiled built-in capabilities; `owner` is the explicit static exception. Distinguish that legacy seed marker from the target role's undeletable-system marker. Do not describe the target role/rank model as already implemented merely because the legacy CRUD exists.

The fixed Entra profile mapping is closed version 1 with `displayName: name`; missing/null means default, malformed non-null fails login closed. Mapping cannot select identity or authority claims. Identity stays `oid`/`tid`; email metadata precedence is `email`, `preferred_username`, `upn`. JIT policy has exactly `enabled`, `default_role_id`, `required_entra_app_role`; the exact nonempty app role is required even when disabled. Customer defaults are Customer only; agent defaults must fit the live ceiling. Previously stored above-ceiling defaults remain dormant; reserved non-Entra provider kinds stay disabled. Full provisioning rules remain in [identity provisioning](feature-contracts-p3.md).

## Proposed grant projection

The snapshot labels the complete provenance design **proposed, pending owner approval**. This migration preserves that state, never silently authorizing a schema cutover. Existing newer explicitly accepted owner decisions still apply where implemented. The proposed ledger records independent direct, JIT-default, OIDC-group and SCIM-group grants; it does not create a multi-role authorization system.

Validate every active grant against current person, role, scope, organisation, connection, mapping, side/portal and role ceiling. A valid direct grant wins alone; otherwise select highest external rank. At equal rank, `scim_group > oidc_group > jit_default` applies only for the same role ID. Different top-ranked roles suppress external effective membership and raise a visible conflict; no ID tiebreak or capability union. `sees_all` comes only from the selected explicit direct grant; external grants cannot set/inherit it.

All eligibility-changing writers, including person/organisation/workspace lifecycle, use IP-22's parent-first lock order, closure reread/retry and atomic retire/reproject protocol. Lock the external identity and person/scope key. Grant deltas, one effective membership and provisioning/audit commit together under the retained audit-failure rule; invalidate all replicas only after commit, within the existing 30-second cache bound. Role/mapping changes retire old grants and insert new ones. One connection reconciles only its own OIDC grants; SCIM removal only its corresponding grant. Final source removal deletes the effective projection internally and preserves history; it is not a user deletion. Global SCIM deactivation retires all external grants for that inactive person. Portal closure retires affected external grants with `mapping_changed`, preserves direct provenance separately, denies portal and revokes sessions; reopen alone cannot revive grants. SCIM retirement also revokes linked member history and fixes its membership pointer in the same transaction.

Before any proposed provenance DDL/backfill/projection, read-only preflight classifies **every** legacy row from durable source evidence. Null `derived_from` is not proof of a direct grant. Any ambiguity stops the whole migration before writes; never guess, discard or partially materialize. Per-row reconciliation requires owner-approved source evidence, digest and stable-snapshot proof; duplicate repair also needs an explicit decision. DDL, full backfill, projection and constraints commit once or roll back entirely. Retry against unchanged legacy data after reconciliation, with no nontransactional DDL. Keep active-grant uniqueness indexes from [schema](data-model.md); stop writing transitional `derived_from` once the ledger is authoritative and remove it only by forward migration. Provisioning/audit stores IDs and bounded reasons, never raw claims/tokens; reuse existing event/reason kinds (`claim_missing`, `claim_removed`, `claim_overage`, `mapping_changed`), adding no silent enum/event changes.

## Authority and role editing

Reach and authority are independent evaluator inputs: seeing all never grants editing power. Capabilities have one group/description and transitively expanded implications at grant and evaluation time. Unknown stored names log and grant nothing, never wildcard authority. The registry and domain/policy references reconcile in tests. Renaming/removing a persisted capability needs an intentional two-stage migration: new name plus recorded alias for one release and role/key data migration, then alias removal. New capabilities cannot widen an issued key's frozen ceiling.

Roles are runtime rows, edited through original Kaneo settings. An editor cannot grant a capability they do not hold, edit a role at/above their own highest rank, or create/set an equal-or-higher rank. At least one active person must retain `workspace:manage_roles`. Workspace/project roles, identity connections, OIDC and SCIM can never mint `instance:admin` or `sees_all`. Project-context roles use the same editor and apply only to that project. Project authority overrides workspace authority there; a project role cannot grant workspace-wide actions. Applicable authority expands implications and combines applicable capabilities subject to that override and the one-role-per-membership rule.

`workspace:transfer_ownership` is distinct from member management and held by owner alone, not admin/manager. Check the capability before the handler and re-read the owner under the transfer transaction for concurrency safety. Self-assignment is `work_item:update` plus the body naming the actor, not an unconditional assignment bypass. `instance_admin` grants `instance:*` and global reach, not workspace capabilities; actual workspace role must still authorize workspace/project reads and writes. The retained compatibility bridge projects instance administration only from the persisted Better Auth `user.role=admin`; identity-provider profiles cannot supply it. Better Auth admin HTTP endpoints are not a parallel grant mechanism.

The project-lead system role has lead's capability set at project scope and rank 50, seeded per workspace. Identity mappings cannot target it. Do not use role-name checks, reach-as-authority, type/state display-name matching or frontend-only authorization. Hide unavailable actions in the UI and enforce their real capability/predicate on the server.

## Customer boundary

Customers are portal actors outside the staff role ladder. Role editing cannot remove these domain restrictions. They may submit their published catalogue, publicly comment, re-rank their own backlog, strictly raise priority, decide addressed approvals they did not request, read their organisation's published KB/projects, rate resolution, withdraw pre-triage submissions and reopen within the allowed window. They cannot assign, see/write internal comments, rank others' items, lower priority, approve their own request, see staff assignee identities, see SLA policy internals, cross organisations, read reports/dashboards or delete anything (including their own attachment). Comment/approval author names remain visible; assignee identity does not. Show their own due time only.

Customer principals receive 403 on every agent item-scoped work-item/legacy-task route and canonical agent search even inside reach. Portal host/session predicates are mandatory. Organisation-private items/submissions reach only requester and participants, answering colleagues the same 404 as a foreign organisation.

## Reach

Resolve project reach in order: instance administrator; explicit workspace `sees_all`; project membership; ancestor-project membership; owner-team membership; matching customer organisation; otherwise 404. Hierarchy/team steps require authoritative persisted relations, never inferred URL or a legacy denial. Reach does not bypass capability checks.

The accepted 14 October owner decisions add two bounded system-written direct grants:

- Workspace owner/admin gets `sees_all` in that workspace on creation, role changes, invitation acceptance, direct add, transfer, removal/leave and reconciliation. Grant/revoke only `direct_origin=system_backfill`, leaving administrator-made and external grants alone. Audit in the grant transaction: system `membership.sees_all_granted` on grant/role change and `membership.changed` on revoke, with source/workspace/seesAll/role IDs. No-op sync writes nothing. Boot reconciliation logs/counts failures per member and retries later without aborting boot. Historical migration 0123 lacks hash-chain audit rows; do not invent them retrospectively. Managers/members/viewers/customers receive no automatic visibility.
- A staff project creator gets a direct project-lead membership (`direct_origin=project_creator`) and `project.created_by` in the create transaction, audited as actor creator, source project_creator, granted true. Skip this grant for an existing workspace `sees_all` holder, because a project override would reduce their workspace authority. No guessed creator backfill. Revoke only this origin on workspace removal/leave, account erasure, owner/admin promotion, project deletion or workspace removal, auditing system reason/granted false. Recovery does not re-grant it. This adds reach; routes retain their required capability gates.

Project `parent_id` and `owner_team_id` are roster/reach changes, not `project:update`. Use the separate ownership route: owner team must be in the same workspace and needs `project:manage_members`, audited with current team members. Re-parent needs that capability on child and prospective parent, cannot cross organisations and audits both projects.

Every item/project-scoped route checks persisted project reach before capability/body validation/writes. Missing and out-of-reach responses share status, body, headers and rate bucket. Lookup-miss uses the same reach/error path; latency equivalence is not promised. In reach without capability is 403; lawful authority blocked by workflow is 409; unauthenticated is 401. Workspace-only exemptions must explicitly state why no project resource applies.

This includes create-into-project, metadata/columns/workflow, time entries (through task), task-bound labels (body or label owner), assets and per-task bulk operations. In bulk, missing/out-of-reach targets are indistinguishable and authority is checked per reachable task. Workspace label definitions with no task remain workspace-scoped. Multi-project lists/search/rollups/counts/pages filter reachable rows **in SQL before filters/counts**, including tasks, comments, activity, projects and task-bound labels. Configuration-only lists remain workspace-scoped. Saved-view project IDs, intake acceptance destination and duplicate target require reach even when outside the URL path; a project filter can only narrow validated workspace results. Saved-view list/run/count/get/update/pin/delete and intake duplicates/accepted-detail must not expose an unreachable linked item or its carried-over comments.

Project WebSockets apply origin, persisted project reach, `project:read`, and key scope (`project:read` + `work_item:read`) before upgrade. Missing, archived/deleted, foreign/unreachable, insufficient capability or key scope all give the same pre-upgrade 401. Recheck on authority changes, at least every 60 seconds and before delivery, with at most the documented 1.5-second passing-lookup reuse. Instance reach alone grants no socket authority.

## Route policy constraints

Every runtime route declares exactly one of the five [registered policy kinds](permissions.md#policy-kinds); TypeScript and runtime registry validation enforce the closed shape. Capability policies require scope, scopeSource and reach (required or a reasoned no-single-resource exemption). Self policies require a person parameter or explicit exemption; touch only caller-bound rows. A self workspace-membership condition needs one current persisted membership. Portal policies require host-bound customer session plus registered own-request/organisation/approval/submission/self predicate. Public policies state a reason and cannot claim session/elevated authentication they cannot enforce. Delegation is the closed Better Auth/WebSocket/metrics/SCIM set, not an unexamined bypass.

Capability policy source is `row` for addressed persisted containment, `request` for collections/creation, `instance` only for instance scope. It is required only on capability policies and absent from the other four. Missing resolved evidence fails `500 policy_context_incomplete`; no fallback to a flat bag. Use branded constructors with actual loaded rows, not request IDs relabelled as row evidence. Instance scope uses its dedicated constructor. Workspace context is validated membership from path, `X-Workspace-Id`/`?workspace=`, or canonical search's top-level `workspaceId` outside query; absent context is 400. Fuzz every context source across tenants.

Owner/self branches require their **own capability and predicate**, never predicate alone; check primary capability first. Owner predicates are the registered actor-related loaded fields, optionally with a created-at edit window; self-assignment checks parsed body before handler. An elevation exemption exists only with `elevated:false` and its reason in both directions. Elevated routes are session-only; public policies reject session-only/elevated-true flags.

Route coverage enumerates real Hono routes and every non-Hono listener's runtime-exported manifest, comparing actual method/path/port/policy and rejecting missing/orphan/unknown entries. A synthetic metrics route or OpenAPI entry does not prove the separate listener. Better Auth wildcard coverage also verifies the constructed approved plugin list on every runtime rebuild and alerts on drift; `anonymous`, `deviceAuthorization`, `bearer` and fork-removed routers stay absent. Test built-in roles × routes for capability and foreign-reach denial, a custom role through the same matrix, all authority-minting/instance routes for elevation or explicit exemption, and every registry-derived session-only route. The authority-granting capability set remains in `packages/permissions/src/elevated.ts`, not a second hand-maintained route list.

## Elevation and deletion

Fresh proof uses the account's second factor when enrolled, or verified `prompt=login` for SSO-only accounts; an unsupported required proof fails closed. Proof is fresh, single-use and exact action/registered-operation-bound, never a session-wide time window. The [elevated inventory](permissions.md#elevated-and-audited-actions) and [pending-action safety contract](safety-and-runtime.md) own the target/confirmation/proof details.

Elevated actions and pending-action approval/denial reject API/MCP/impersonation credentials with `403 session_required` **before** policy or pending-action creation. Every ordinary user-initiated DELETE returns 202 plus the server-selected pending confirmation; approval rechecks current policy and exact targets. Elevated destructive targets cannot be requested through API keys in the first place; other agent/API/MCP deletes return the same pending action for the owning human's browser decision. Portal offers no DELETE. Server confirmation level cannot be downgraded by the client.

Metrics-token rotation requires instance admin, elevation and session-only operation proof. Its read/configuration companions may use genuinely resolved instance-admin authority with explicit reasoned elevation exemptions; bounded log-level edits do not mint authority. API/MCP/impersonation cannot rotate the bearer.

## Credential ceilings

MCP is a named human's alternate API client, with no MCP-only capabilities or service-key impersonation. Its effective permission is current owner RBAC ∩ frozen key subset ∩ current reach ∩ route policy ∩ feature availability. Deactivation, revocation and authority changes apply on the next call. Every personal key defaults to reads; writes are explicit warned opt-in whether `is_mcp` is set or not. Workspace service keys cannot be MCP keys. Missing/null/unloaded key capabilities grant nothing, including on swallowed resolver errors; they never mean unrestricted owner authority. Product feature flags cannot replace credential or tenant gates.

## Policy diagnostics

Shadow evaluation never changes response, authorization or handler reachability. Native allow/deny evidence comes from the actual completed native predicate, never inferred HTTP status. A shadow-only observer may add a read after a typed native **read** miss only for that exact registered live resource/persisted containment; absent/inactive/ambiguous rows remain unknown. No raw URL inference, mutation observer or post-mutation lookup. Shadow-off adds no observer reads. Request-local row facts never reach responses/log/audit. A native denial is evidence only for the legacy side; the declarative evaluator independently computes reach from current identity/persisted facts. Missing hierarchy/team/private facts mean unevaluated/reach_unavailable, never guessed allowance. A permissive native project read is a defect, not reason to downgrade policy scope or turn workspace membership into project reach.

The narrowly approved strict-terminal log witness is projected only from a completed strict decision: server-generated opaque request ID, exact registered route/source, allowed/denied category and finite provenance-validation result. No actor/tenant/resource IDs, claims, arbitrary text, payload or reach facts. Validate own enumerable primitive data and exact pairing; build a fresh projection immune to prototypes/accessors/toJSON/later mutation. Expose the generated request ID as `x-taskdesk-request-id`, ignoring inbound IDs. Witness stays diagnostic, outside response body/shadow store and cannot replace cutover evidence.

Shadow evidence tables retain 30 UTC days with bounded pruning and capped per-bucket examples. Writes are detached after response and caught/logged on failure; request behavior cannot change. Query per-router summaries from the store; adding an endpoint requires its own policy. Historical no-job/no-metrics/no-factor implementation statements are not current evidence. See [configuration boundaries](#configuration-boundaries) for promotion prerequisites.

## Job coordination

Jobs run in-process with `croner`; `web` disables scheduling and `jobs` dedicates a replica without a second worker service/language. Chunk unbounded work, yield between batches and push heavy aggregation into SQL. The [job table](background-jobs.md) alone registers names/cadences/TTLs; rule schedules are stored rows, evaluated each minute with `automation:<id>` leases, so runtime edits need no scheduler reload.

`job_lease.owner` is hostname:PID:bootId. Atomic insert-or-expired-update returning a row decides acquisition; never read then claim. Renew/release only the exact owner. Existing `timestamp without time zone` expiries store UTC wall time and compare/write through DB-owned UTC, not session local time. Required long-running lease design renews every TTL/3, aborts work on failed renewal and releases in finally. A lease offers at-least-once scheduling, not mutual exclusion: an expired holder can finish a statement, so handlers remain idempotent. The old single-lease helper's lack of heartbeat is a recorded implementation gap, not permission to run an overlong handler unprotected.

New jobs export name/schedule/TTL-or-none/handler(signal), register in the existing job registry, honor cancellation and test acquire/loss-abort/release-only-own with real integration. Global job lease does not wrap `outbox-drain`: it uses per-row claims on every replica. Job configuration/manual triggers require `instance:manage_jobs` and audit.

Each run records name, duration, processed count, outcome, trace ID, optional configured tracing span, and metrics `taskdesk_job_duration_seconds`, `taskdesk_job_runs_total{outcome}`, `taskdesk_job_last_success_timestamp`, `taskdesk_outbox_pending`, `taskdesk_nodejs_eventloop_lag_seconds`. Alert for no success beyond 3× cadence, rising outbox for 15 minutes, three consecutive failures and sustained event-loop lag >100 ms; lag motivates a dedicated jobs replica, not a relaxed budget.

## Lifecycle and SLA

Workspace `state_template` is the shared workflow vocabulary; a project's concrete `state` maps to it and owns adoption/order/default. Do not restore retired `project_state`, workspace-global concrete states or project-scoped workflows. Archiving hides pickers but preserves references. Open/closed derive from the mapped template group, never state name or nonexistent `state.group`: completed/cancelled are closed. `activity` journals every field's old/new value, supports reconstruction/baselines and carries workflow version. Immutable published versions keep history interpretable.

Workflow guards/effects are closed vocabularies owned by [workflows](feature-contracts-p2.md#workflows). Every guard must pass; unknown type fails `guard.unrecognized`, not skipped. Guards include children_closed, no_open_blockers, assignee_present, field_required (native/cf/satellite) and change_risk_at_most. Effects set/clear assignee, pause/resume SLA, set field and schedule a transition. Scheduling resolves target template to concrete project state immediately and stores concrete from/to; reminder execution cancels if from-state changed, with no new template lookup. Entering completed opens a resolved SLA pause; leaving closes it, resuming without restarting. Role-scoped legality and published immutability remain mandatory.

SLA is computed from start plus calendar-measured goal minutes minus pause intervals, never authoritative stored timer state. Candidate SQL excludes resolved/archived/deleted work and resolves type → request type → project → workspace policy; `computeSlaState()` domain computation emits only cache-detected open-item at-risk/breached edges. Completion transition owns met/missed events. Detail recomputes and overrides cache; list filtering may use cache. Newly selected pinned policy versions and live referenced calendar behavior follow the newer [SLA contract](feature-contracts-p2.md#sla), not mutable-policy reconstruction for historical items.

## Delivery protocol

Business mutation, activity/audit where applicable, one domain-event parent, distinct-recipient inbox rows, enabled external-channel children and event-time digest membership commit together. `outbox.event_id` remains DomainEvent identity/consumer idempotency; each child ID is one recipient/channel delivery. Unique constraints prevent replay duplication. Parent materialization state is independent of child provider result; one recipient/channel cannot complete/suppress/dead-letter another. Webhooks retain per-target delivery records. Providers run outside database transactions.

Claim parents, immediate children and due digest groups using row-level `SKIP LOCKED`, without a global job lease. Recheck current reach, enabled channel and quiet hours before sending; lost reach/disabled preference suppress without I/O, quiet hours defer except the explicit urgent-event exemption. Acquire recipient/channel/key reservation; live foreign owner defers without consuming an attempt. Only a **different** child with the exact tuple and committed success within five minutes suppresses a candidate; own retry does not dedupe against itself.

Reservation key is 32-byte SHA-256 of UTF-8 domain `taskdesk:outbox-dedupe-reservation:v1`, zero byte, then recipient ID/channel/dedupe-key, each prefixed by unsigned 32-bit big-endian **byte length**. Preserve exact bytes: no normalization/trim/case-fold. Also store originals with exact-tuple uniqueness; same digest/different tuple fails closed, no send. Acquire only absent/expired lease with fresh random token; same child ID cannot steal/rotate a live token. Renew/complete/release require current owner+token; renewal/completion also require unexpired lease. Failed renewal stops the request when possible and cannot commit success.

Each atomic operation samples `clock_timestamp() AT TIME ZONE 'UTC'` **once after lock waits**, reusing it for predicates/writes; transaction-start `now()` or pre-wait statement timestamp is insufficient. Recent-success query takes its own post-acquisition wall-clock sample and uses delivered_at ≥ sample − five minutes. Completion uses its same sample for delivered_at. This stronger post-lock requirement applies even when the ordinary job UTC helper still uses transaction time.

After eligibility/dedupe/all reservations pass, a fenced pre-provider transaction verifies the live token and durably increments existing immediate-child attempts once, then commits **before** I/O. Digest equivalent verifies group and all member tokens, persists canonical attempted payload hash and increments group attempts; child attempts remain zero. Failed authorization transaction consumes no attempt and permits no call. Renewal, completion, failure, timeout/recovery never repeat/refund the increment. Crash after authorization before actual send intentionally consumes a slot. Maximum is six provider-call starts, with possible fewer actual calls; never a seventh.

Adapter deadline is 30 seconds absolute including connection/response. Request cancellation and stop awaiting even if ignored. Renew group/member leases every 15 seconds to 60 seconds from post-lock DB sample. Immediate success atomically marks delivered/time and frees reservation under live fence. Definite failure uses durable attempt-number backoff 30 s, 2 min, 10 min, 1 h, 6 h, 24 h and releases; six authorizations dead-letter. Ambiguous timeout/crash/response stops renewal, retains leases until expiry and retries no earlier than all expiries. Expired sixth-attempt recovery marks dead under safe fence. A stale token never sends, commits success or releases a new owner's lease. Accepted-but-uncommitted sends can repeat: at-least-once, never exactly-once.

Digest partition is recipient/channel/workspace/optional organisation/cadence/UTC window. Resolve zone at event time from person's quiet-hours zone, else instance; persist zone and UTC boundaries for local top-of-hour/day-midnight windows, including DST. Later preference/zone edits affect future candidates. DB wall time plus group-row lock serializes attachment/sealing; ended/sealed target means next eligible window. Drain can seal due groups even if hourly sweep is late. Sealing freezes membership before deterministic bounded safe rendering. Urgent events bypass digest (`digest_id=null`). At send, suppress newly ineligible members, defer whole group for quiet hours, suppress group+children if none eligible.

Order sealed members `(created_at,id)`; include earliest eligible tuple member, suppress later ones within five minutes of an included candidate, preserve distinct later events. Acquire remaining keys in canonical order under deterministic representative children. Foreign live owner releases this call's acquired leases and defers without attempt increment. Group lease fences one call; member reservations serialize tuple dedupe. Store attempted payload hash before send; provider idempotency may use child ID or `(digestId,payloadHash)` but correctness cannot depend on it. Successful digest commit under every unexpired token delivers included children at one clock, suppresses newly ineligible ones, marks group delivered and releases reservations. Definite failure leaves children pending; ambiguous failure waits all expiries; after six group authorizations atomically dead-letter group+remaining children. Child attempts remain zero throughout group delivery.

## Integration prerequisites

The retained pre-wiring safeguards are requirements to verify against actual source/runtime, not assertions they remain open or closed today. Every inbox list/read/read-all/clear-all path must recheck all registered resource types and fail closed unknown types; instance resources remain admin-only. Approval eligibility includes still-valid approver, pending approval and workspace reach. Legacy workspace sends must use current identity-based workspace read and active/not-banned identity. Recipient/preference/digest/self-exclusion tests, authoritative ancestor/team facts, title/header CR/LF/control stripping and explicit UTC timestamp writes remain necessary.

Unresolved destination/quiet hours/evaluator error/reservation contention defers 30 seconds without provider-attempt consumption. A permanently broken evaluator's eventual age/count dead-letter policy was an undecided design change; do not invent one or call indefinite retries accepted. The adapter seam cannot default to success. An inbox-only producer with constant text and no external-channel children does not authorize worker/provider integration or waive send-time controls.

## Retention

| Data | Retained default and constraint |
| --- | --- |
| Audit | 12 months, configurable; preserve matching holds and write anchor before purge |
| Work-item activity | No age purge; journal cascades with lawful tenant/work-item hard deletion |
| Inbox | Configured notification_retention_days (default 90), read rows only |
| Terminal delivery/digest/event | 30 days after each row's terminal updated_at, with child-before-parent rules |
| Webhook delivery / automation run | 30 days, configurable |
| Idempotency keys | 24 hours |
| Sessions | On configured expiry |
| Soft-deleted work items/projects/workspaces/custom fields/comments | 30-day recovery, configurable |
| Metrics | Hourly 90 days; daily 24 months, configurable |
| Cycle snapshots | Retained with cycle |
| Temporary delivery reservations | Lease authority expires immediately; daily physical cleanup, exempt from legal hold |

Read-inbox purge checks recipient person hold, recipient organisation and resource-owning organisation; unresolved owner retains while any organisation hold is open. Unread rows never qualify. Inbox cleanup cannot delete delivery children/events. Terminal child purge checks person, source, recipient and resource-owning organisation independently; source/recipient never stand in for resource owner. Pending or held child retains its parent and shared history. A digest with any child remains; one held/unresolved-owner member conservatively retains group. Remove eligible terminal children, then empty eligible terminal group, then eligible terminal parent (own 30-day window/source hold). Test 29-day retention, 30-day eligibility, held owner differing from source/recipient, unknown owner, hold lift, and each row's own age.

Audit, attachment and soft-deleted history obey matching holds. Credential/session/invitation/idempotency/preference-handoff expiry cleanup continues under hold. Reservation rows contain coordination IDs, not history: expired takeover/cleanup is not blocked by holds, and FK cascades remove reservations with their child/person. Lawful hard deletion removes scoped children, then empty groups and applicable parents; history holds still apply to history purges.

## Audit hash chain

SHA-256 hashes exactly this ordered field list, joined by one record separator byte `0x1e`: prev_hash, created_at, actor_id, actor_type, api_key_id, impersonator_id, actor_ip, user_agent, trace_id, workspace_id, action, entity_type, entity_id, before, after. Timestamp is six-digit microsecond UTC ISO-8601; before/after use RFC 8785 canonical JSON (sorted keys, canonical numbers, no insignificant whitespace). Null JSONB/SQL NULL is empty string; other values are exact UTF-8. Digest and input previous hash are lowercase hex. Reject the separator in any hashed text field, otherwise field-boundary ambiguity permits different rows to hash alike.

Organisation tombstone and project_id are excluded from the fixed recipe. Organisation may null on hard delete; project_id remains append-only under mutation trigger despite exclusion. Do not claim every excluded column is mutable. Each writer takes the instance-wide audit advisory transaction lock, reads chain head and inserts in the same transaction: multi-replica writers cannot fork it. Purge writes anchor (last purged hash/count/time range) **before** deleting; anchor failure means no deletion. Read-only audit-verify starts at newest retained anchor, reports first break, takes no job lease and runs during restore drills.

This is an unkeyed chain without an externally held head. It detects visibly inconsistent alteration, **not** a forged internally consistent insert, owner/superuser recompute-forward alteration or tail truncation. An in-database anchor is not an independent witness. Stronger guarantees require independently protected head evidence or a key unavailable to the database role; do not claim them from this design.

## Indexes and migrations

Preserve these exact additional index/search shapes alongside the registry's composite tenant constraints. Grant-ledger indexes below remain proposed with the complete projection. They support reach-filtered counts/pages and never replace row predicates. English stemming for all content is a known limitation; journal seq is internal only.

```sql
create extension if not exists pg_trgm;

create index on work_item (project_id, state_id, position);
create index on work_item (workspace_id);                         
create index on work_item (assignee_id) where archived_at is null and deleted_at is null;
create index on work_item (due_date) where resolved_at is null;
create unique index on work_item (project_id, number);
create unique index on project (key);
create index service_calendar_workspace_name_id_idx on service_calendar (workspace_id, name, id); -- CAL-16 bidirectional keyset pages
create index on work_item using gin (title gin_trgm_ops);           -- typo tolerance, duplicate suggestions
create index on activity (work_item_id, created_at desc, seq desc);  -- seq: same-instant tiebreak
create index on activity (workspace_id);                             -- reach filtering
create index on comment (work_item_id, created_at);
create index on membership (person_id, scope, scope_id);
create unique index on membership (person_id, scope, scope_id); -- proposed effective-row invariant after duplicate audit/repair
create index on membership_grant (person_id, scope, scope_id) where revoked_at is null;
create unique index on membership_grant (person_id, scope, scope_id) where revoked_at is null and source_kind = 'direct';
create unique index on membership_grant (external_identity_id, scope, scope_id) where revoked_at is null and source_kind = 'jit_default';
create unique index on membership_grant (external_identity_id, oidc_group_mapping_id) where revoked_at is null and source_kind = 'oidc_group';
create unique index on membership_grant (external_identity_id, scim_group_mapping_id) where revoked_at is null and source_kind = 'scim_group';
create index on custom_field_value (entity_type, entity_id);
create index on custom_field_value (project_id) where project_id is not null;
create index on outbox (state, next_attempt_at) where state = 'pending';
create index on outbox (workspace_id, state);
create unique index on notification (event_id, person_id) where event_id is not null;
create unique index on notification_delivery (event_id, recipient_person_id, channel);
create index on notification_delivery (state, next_attempt_at) where state = 'pending';
create index on notification_delivery (workspace_id, state);
create index on notification_delivery (digest_id) where digest_id is not null;
create index on notification_delivery (recipient_person_id, channel, dedupe_key, delivered_at desc) where delivered_at is not null;
create unique index on notification_digest (recipient_person_id, channel, workspace_id, organisation_id, cadence, window_start_at, window_end_at) nulls not distinct;
create index on notification_digest (state, next_attempt_at) where state in ('collecting', 'pending');
create unique index on outbox_dedupe_reservation (recipient_person_id, channel, dedupe_key);
create index on audit_log (entity_type, entity_id, created_at desc);
create index on audit_log (workspace_id, created_at desc);
create index on attachment (state) where state = 'pending';
create index on attachment (workspace_id, state);
create index on attachment (organisation_id) where organisation_id is not null;  -- the storage quota sum
create index on work_item_sla_cache (state, due_at);
create index on scheduled_transition (due_at) where state = 'pending';
create unique index on workflow_transition (version_id) where is_reopen;
create unique index on legal_hold (scope, scope_id) where lifted_at is null;
create index on metric_snapshot (metric_key, grain, period_start, project_id, organisation_id);
create index on comment (work_item_id) where deleted_at is null;

-- full-text search: English stemming for all content, deliberately, as a known limitation
alter table work_item add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(description->>'text','')), 'B')
  ) stored;
create index on work_item using gin (search_vector);
```

Generate Drizzle migrations, include handwritten trigger/extension/key/grant SQL in the journal-tracked generated file, and commit them. No untracked custom migration directory or down migrations; undo with a new migration. Serialize migration runner with a database advisory lock on one connection, keep readiness false until confirmed applied, fail deployment on migration error. Destructive change expands/dual-writes/backfills/switches reads, drops only in later release. Stable releases retain schema snapshots for upgrade verification. Apply the stronger **separate migrate process** boundary below rather than the stale instruction to give the serving entrypoint owner credentials.

## Configuration boundaries

Only registered bootstrap names configure how the app reaches configuration/key material/public origins and bounded operational switches. Every customer feature/configuration is a persisted runtime setting with one shipping image. Deployment substitution and external MCP client settings are separate readers, not extra API environment authority. Keep compatibility storage/policy switches bounded and fail invalid values; do not grow them instead of runtime administration.

Serving DB role is non-superuser, owns no tables, no DDL/TRUNCATE: ordinary tables required SELECT/INSERT/UPDATE/DELETE, append-only activity/audit SELECT/INSERT only. The one-shot migration/owner process alone gets owner credentials, runs schema fixups/migrations/role-grant repair and exits without binding HTTP. Compose waits for successful migrate; Helm uses its migration Job. Long-running web/jobs/all must never receive TASKDESK_MIGRATION_DATABASE_URL and must fail startup if present. Closing an owner pool does not remove that environment secret. Local development uses the same two-process split with no development privilege exemption. Reuse existing encryption/auth keys; do not regenerate and invalidate sessions/secrets. Migration needs the registered auth/encryption bootstrap values too. No new environment credential is implicitly granted for the future maintenance-role purge path.

Proxy trust is exact measured hop count, not boolean; attribute client IP from that hop only. Production app port stays private to trusted proxy network. Wrong Compose host substitution yields proxy routing failure, not a valid app origin. HSTS preload/subdomains is an explicit operator commitment; empty means off, the supported opt-in is 1, and misleading nonempty 0 must be rejected. Runtime branding overrides use only fixed named theme slots and AA accent validation, not arbitrary CSS. Effective scope/source is visible; a locked instance flag blocks overrides.

SMTP is runtime configuration. Mailpit is a local mail-capture choice, not a required invitation provider; use an actual configured provider for external delivery. Fresh storage is durable filesystem; S3/other runtime backends need verified byte migration, public endpoint/presign constraints and quotas. Switching bootstrap driver without migration can orphan bytes and is forbidden. Secrets are masked on read, replacement/unchanged sentinel on write, encrypted AES-256-GCM and audited by changed keys only. Rotation stages new/current plus previous key, resumes row-by-row with key_id, reports progress, removes old key only after all rows verified, and backs up both while open. Configuration backup/restore preserves all settings/branding/plugins/flags; nonsecret export omits secrets and restore verification checks presence.

Strict policy enforcement source eligibility requires the same deployed source/behavior to have three real clean UTC buckets with representative route evidence; source parsing rejects unknown/duplicate/empty/padded entries. Task source requires all others and remains last; arbitrary other-source parser order is not an extra hidden rule. The narrowly approved 8 October exception applies only to public GET /api/config: exact-source public-response/source-ordering plus reviewed disposable strict-selection/health/rollback proof may substitute for its unavailable pre-guard tally. It changes no defaults, parser, permission or deployment exposure and cannot promote any other source. See [safety/runtime](safety-and-runtime.md), [operations](operations-and-distribution.md), [import/cutover](import-and-cutover.md) for maintained detailed contracts.

## Aggregation and imports

Metric snapshots carry indexed real project/organisation columns, not JSON dimensions used in place of tenant predicates. Read closed periods from snapshots and compute only current partial hour live; disclose that distinction. Hourly aggregation and daily cycle snapshots follow the job registry.

Imports run from UI as queued → running → paused/completed/failed, chunked and resumable. Each chunk commits source→target import_record_link mappings atomically, so retry does not duplicate. Use the bulk write path: no per-row outbox/activity/broadcast flood, one import.chunk_completed instance-topic message per chunk and run-level audit. Yield batches, renew long-running lease and recommend large runs outside busy hours. Full mapping, placeholder-person and reconciliation semantics remain in [import/cutover](import-and-cutover.md).

## Conflicts and limits

- The 14 October creator/project-lead and owner/admin sees_all decisions supersede the older RBAC paragraph saying project creation grants no reach. The exception is narrow and origin-bound, not automatic reach for arbitrary workspace members.
- The complete grant-provenance target remains explicitly proposed where its source says pending approval. Table registration is not evidence the complete migration/projection is accepted or implemented.
- The concrete-state/template split supersedes both older single-workspace-state and unshared project-only designs. Pinned policy-version SLA semantics in the maintained newer SLA contract govern historical evaluation; the older scan coalesce describes candidate binding, not permission to rewrite an item's pinned history.
- Configuration's two-process migration rule supersedes the older data-model sentence about serving container startup with owner credentials. The configuration source's “fifth value” was a counting typo; the registry lists four process roles.
- Historical “not implemented”, review outcomes, current scheduler/factor/metrics claims and CI-era waiting/process instructions are not transferred as live acceptance or workflow policy. Verify actual behavior using [testing](../testing.md); one consolidated phase review follows current AGENTS.
- The snapshot's PostgreSQL 18 introduction and its explicit “Postgres 16 stays supported” activity addendum disagree if read as a version restriction. Preserve compatibility with the actual supported shipping database/upgrade matrix; neither phrase authorizes new PostgreSQL-18-only SQL or silently dropping 16. Record any support change explicitly.
- Links formerly pointing into feature, architecture, operations or decision trees now point to the maintained feature groups/registries above. Unmigrated ADR-specific approval evidence is a recorded provenance/owner-decision gap, never permission to infer approval from code. Archive files are not needed to enforce any reader listed here.
