# Pending actions — server-enforced approval for deletion and destructive agent calls

- **Status:** decided 2026-09-05 (Thomas — confirmed decision document, sections H, I, J)
- **Stage:** the mechanism lands in **P1** with work-item deletion, for **browser-session
  deletions only**. API-key issuance and MCP are **P4**; until then any `DELETE` — or any
  destructive MCP call — arriving with an API-key credential returns `403 not_implemented`,
  and MCP delete tools do not exist. The `web`, `api` and `mcp` origins below are the design;
  only `web` is reachable before P4
- **Feature flag:** always on — it is a security control, not a feature

> A confirm dialog in the browser is not a control. The server must hold a durable,
> single-use record that a named human approved *this exact* destructive action, and must
> refuse to perform the action without it — whichever client asked.

## Purpose

Every **user-initiated deletion** in TaskDesk, from any client, goes through one
mechanism: the request creates a `pending_action`; nothing is deleted; the human who owns
the request approves it in the TaskDesk browser UI; the server re-checks authorization and
executes exactly what was approved. The same mechanism carries the MCP server's
destructive tools ([mcp-server.md](../03-features/mcp-server.md) `MC-7`), because a model
must never be the thing that says "yes".

This closes three failure modes at once: a model prompt-injected into deleting through an
MCP key; an API client scripted to bulk-delete with a stolen key; and the ordinary
mis-click, which the browser dialog already caught in v1 but which the API never did.

## Concepts

| Term | Meaning |
| --- | --- |
| **Pending action** | A durable record of a requested destructive operation, awaiting a human decision |
| **Requester** | The human identity the request was made *as* — the session's person, or the `person_id` of the personal API key |
| **Origin** | Which client asked: `web`, `api`, `mcp`. (Automations have no delete action before P4 — `AM-13`) |
| **Approver** | Always the requester, in a **browser session**. Never an API key, never a model, never an impersonation session, never an automation |
| **Confirmation kind** | What the approver must do: click, type the target's name/key, type the affected count, and/or pass step-up authentication — [levels](#confirmation-levels) |

## Data

`pending_action` — [data-model.md](data-model.md) §11. Every approval is **bound** to:
requester `person_id`; credential (`session` or `api_key` + id); origin; `action`
(`delete`, `bulk_delete`, `purge`, `mcp_destructive`); `route_key`; `target_type` and the
exact `target_ids[]`; `target_versions` where the target is versioned; the stored `payload`
and its `payload_hash`; the `scope` (workspace/project/organisation); `created_at`;
`expires_at`; `state`; `invalidation_reason`; the confirmation kind required and the one
supplied; `decided_by`, `decision_session_id`, `decided_at`; `executed_at`; `error`.

Three of those columns exist so that the guarantees below have a mechanism rather than a
convention, and each has one job:

- **`payload jsonb`** — the request is *kept*, not only digested, so `PA-6` can re-hash it.
  `payload_hash` is SHA-256 over a **canonical payload** with exactly these members, in this
  order: `{ action, route_key, target_type, target_ids (sorted ascending), workspace_id,
  project_id, organisation_id, confirmation_required }`, serialised as RFC 8785 canonical JSON
  and written lowercase hex. Nothing outside that set enters the hash — not `created_at`, not
  the rendered summary — so the digest is reproducible at approval time from the stored row.
- **`route_key text` not null** — the exact `policy.ts` key (`'DELETE /api/work-items/{key}'`),
  type-constrained to `keyof PolicyMap`. `PA-6` re-runs `policyMap[route_key]` and nothing
  else. Without it the server cannot know *which* policy to re-run — `mcp_destructive` alone
  covers `decide_approval` and any bulk operation above 50 items — and an implementer would
  build a second `target_type → capability` map outside the registry, which is exactly the
  second authorization surface this design exists to prevent.
- **`invalidation_reason text` null** — an enum over the `PA-9` causes, so "why did this
  approval die?" is answerable from the row during the incident review the audit story depends
  on.

`payload_summary jsonb` stays what it always was: what the dialog renders. It is never the
thing that is hashed or executed.

## Behaviour

- `PA-1` **Any request to delete** — `DELETE` route, MCP tool, bulk action — first passes
  the route's normal policy (reach, capability, feature flag). If the caller may not even
  *request* deletion, the response is the ordinary 404/403 and no pending action exists.
- `PA-2` If the caller may request it, the server creates a `pending_action` in state
  `pending`, writes `pending_action.requested` to the audit log, and responds **`202
  Accepted`** with `{ pendingActionId, action, summary, confirmation, expiresAt,
  approveUrl }`. **Nothing is deleted at this point**, whatever the client.
- God Mode user deactivation uses this same state machine with `action = 'delete'`,
  `target_type = 'user'`, and exactly one target user id. The request route is
  `POST /api/instance/users/{id}/deactivate`; it creates the pending action and does not
  change the account. The server fixes the confirmation to the exact current target email
  plus step-up (`typed_name_step_up`). Approval revalidates that the target id and current
  email still match the stored request, the person remains active, and the route's current
  `instance:admin` policy still permits execution. A mismatch invalidates the action. The
  executor uses IP-15 with the server-selected `end_memberships` lifecycle policy and the
  shared person-deactivation transaction. SCIM deactivation keeps its connection-selected
  lifecycle policy.
- `PA-3` A **web-UI** request opens the approval dialog immediately in the same browser
  session, rendered from the server's `summary` (never from client state). To the person it
  is a confirm dialog; underneath it is `PA-6`.
- `PA-4` An **API-key or MCP** request to delete an **ordinary** record — work item, comment,
  attachment, custom field, saved view, time entry, label, relation and the rest — returns the
  same `202`. The requester is notified ("An agent using your key *ci-bot* asked to delete
  SUP-1234") and approves from **Profile → Pending actions** or the notification. The client
  learns the outcome by polling `GET /api/me/pending-actions/{id}`.
  - **The retry rule, stated once.** Idempotency middleware runs **first**: a repeat carrying
    the same `Idempotency-Key` replays the stored `202` and reaches nothing further
    ([api-design.md](api-design.md)). Behind it, a partial unique index on
    `(requested_by_person_id, action, target_ids, state) WHERE state = 'pending'` makes a
    second *pending* action for the same targets impossible. So a retry of the same request
    while one is pending returns **`409 pending_approval` with the id and creates nothing
    new** — with or without an idempotency key. There is no path that produces two pending
    actions for the same targets, and `target_ids` (not the rendered summary) is what
    establishes identity.
- `PA-5` **Two credential classes, two answers.** Deleting a **workspace, organisation,
  project, API key, webhook, identity connection or `auth.*` plugin** is on the elevated list
  and carries `sessionOnly: true` ([rbac.md](rbac.md#session-only-routes)). The credential
  check runs in the auth middleware **before** the route policy, so those requests are refused
  **`403 session_required`** when they arrive on an API key, an MCP key or an impersonation
  session: no pending action is created and there is no 202 to poll. The elevated rows in the
  confirmation table below are therefore **web-origin only**. Everything else keeps `PA-4`.
- `PA-5a` A request made with a **workspace service key** (no `person_id`) has no approver
  and is refused `403 no_approver`. Service keys cannot delete.
- `PA-6` **Approval** is `POST /api/me/pending-actions/{id}/approve` with the required
  confirmation — policy kind 2 (`authenticated + self`: the requester only) **and
  session-only**: an API key, an `is_mcp` key or an impersonation session is refused `403`
  ([rbac.md](rbac.md#elevated-and-audited-actions--the-single-list)). The server then:
  1. re-checks the action is `pending` and unexpired;
  2. re-resolves the approver's identity and **re-runs `policyMap[route_key]`** — the stored
     route's own policy, no other — against the current reach and capability; an approver who
     lost access since requesting gets 404 and the action becomes `invalidated`;
  3. re-hashes the stored `payload` over the canonical members above and compares it to the
     stored `payload_hash`, and for versioned targets checks `target_versions` still match
     (a work item edited since the request is `409 target_changed`, and the action is
     `invalidated`);
  3a. re-reads each target's **current** `workspace_id`, `project_id` and `organisation_id`
     and compares them to the stored scope — any difference is `409 target_changed` and the
     action is `invalidated`, even where the approver happens to hold the capability in the
     new scope. Without this step a target moved between the request and the approval is
     deleted in a scope the approver never saw in the summary, which is the target-substitution
     attack `PA-7` exists to prevent, achieved without touching the pending action;
  4. validates the confirmation — typed text equals the exact key/name, typed count equals
     the affected count, step-up token present and bound to this action where required;
  5. marks the action `approved`, executes **exactly the stored targets**, marks it
     `executed` (or `failed` with the error), and writes the audit rows.
- `PA-7` **Single-use and exact.** An approved action cannot be replayed, cannot be applied
  to another resource, and cannot be applied when the payload, targets or scope differ from
  what was approved — the hash comparison in `PA-6` is the mechanism, not a convention.
- `PA-8` **Expiry:** 15 minutes from creation. `pending-action-expire`
  ([background-jobs.md](background-jobs.md)) marks stale rows `expired`.
- `PA-9` **Invalidation:** an action becomes `invalidated` when the requesting credential
  is revoked, the requester is deactivated, the requester loses reach to any target, the
  required capability is removed, the requester cancels it, a target's version changes, or
  **a target has moved to another scope** since the request (`PA-6` step 3a — a cross-project
  or cross-workspace move). Whichever cause fired is written to `invalidation_reason` and
  carried on the `pending_action.decided` event, so the row explains itself afterwards.
  Denial by the approver is `denied`. None of these can later be approved.
- `PA-10` **Nobody approves their own automation.** A model-supplied field (the old
  `confirm: true`), a header, an MCP argument or an automation cannot satisfy `PA-6`.
  There is no server setting that disables this mechanism.
- `PA-11` **Fully audited**: `requested`, `viewed` (the dialog or the pending-actions page
  rendered the summary), `approved`, `denied`, `expired`, `cancelled`, `invalidated`,
  `executed`, `failed` — each an `audit_log` row; all but `viewed` also emit one of the
  three `pending_action.*` events in [events.md](events.md) (`requested`; `decided` with
  its `outcome`; `executed` with `executed|failed`). `viewed` is audit-only — it is not a
  state change. Decision transitions are mutations and follow `AU-14` in
  [audit-trail.md](../03-features/audit-trail.md): if the decision audit insert fails, the
  state transition and decided event still commit while the audit failure is reported under
  AU-14. This is the documented audit-failure exception to the normal state/event/audit
  pairing; it does not apply to rendering a summary, whose read fails if its `viewed` audit
  cannot be written.
- `PA-12` **What does *not* need a second approval:** the retention purge that completes an
  already-approved soft deletion — `session-cleanup`'s soft-delete purge and
  `attachment-gc` ([background-jobs.md](background-jobs.md)), completing `WI-21`'s 30-day
  window and its equivalents; the configured and audited `audit-purge`; removal of
  `pending` upload objects that were never made available as records
  (`attachment-pending-cleanup`); system cascades that are part of an approved deletion (a
  project's work items when the project deletion was approved). A legal hold suspends the
  first two for its scope ([security-model.md](security-model.md#threat-model)).
- `PA-13` **Hard purge** is never a general-purpose tool. There is no MCP purge tool and no
  automation purge action. Hard purge is either retention/system lifecycle processing, or
  an exceptional `instance:admin` operation (`POST /api/instance/purge`) that is elevated,
  requires typed confirmation, **checks legal hold and retention policy first**
  ([data-protection.md](../05-operations/data-protection.md)), and writes a complete audit
  record of what was purged.
- `PA-14` The same mechanism carries the MCP server's other destructive tools —
  `decide_approval`, and any bulk operation above 50 items — with `action =
  'mcp_destructive'` ([mcp-server.md](../03-features/mcp-server.md) `MC-7`, `MC-17`).
- `PA-15` **Step-up is single-use and bound to one pending action or one explicitly
  registered operation.** `step_up_confirmation` in [data-model.md](data-model.md) owns a
  session/person-bound challenge and confirmation. `POST /api/me/step-up/challenges`
  (`authenticated + self`, session-only) creates a five-minute challenge for either the
  current requester's pending action or an explicitly registered operation. The operation
  allowlist is `metrics_token_rotate`, `oidc_group_mapping_create`,
  `oidc_group_mapping_update`, `mfa_reset`, and `instance_admin_grant`. Pending-action binding uses its existing `pending_action.id`
  and `payload_hash`; operation binding uses the exact fixed route key, operation key,
  expected resource version and server-computed canonical request-binding hash. The client
  cannot choose a route or submit a hash. The response contains an opaque challenge id and a
  one-time 32-byte random nonce encoded as 43-character unpadded base64url; only its SHA-256
  digest is stored.

  `POST /api/me/step-up` takes the same discriminated binding plus challenge id, nonce and a
  method-specific proof. It verifies the live session/person, exact binding, nonce,
  five-minute expiry and actual fresh re-authentication before issuing a new random
  32-byte confirmation token. Only its SHA-256 digest is stored. The 43-character token is
  returned once with no-store headers and expires five minutes after issuance. There is no
  session-wide grace window, token readback, or client assertion that re-authentication
  succeeded. A fresh challenge is required after expiry or failed proof. New challenges and
  tokens invalidate older unused material for the same session and binding; consumed rows
  are retained for at most 24 hours for replay diagnosis.

  Custom operation proof verification is bounded independently of Better Auth's HTTP
  limiter: a person/session/operation may create at most five challenges in a rolling
  15-minute window. Each challenge authorizes one verifier attempt; a failed password,
  factor, or nonce expires that challenge. Missing or unrelated challenge identifiers do not
  burn another challenge. The database advisory lock serializes challenge issuance and
  attempt accounting across API replicas. A rejected attempt never issues a proof or mutates
  the bound operation.

  Challenge requests are a strict discriminated union:

  ```json
  { "kind": "pending_action", "pendingActionId": "..." }
  { "kind": "operation", "operation": "metrics_token_rotate", "version": 7 }
  { "kind": "operation", "operation": "mfa_reset", "userId": "...",
    "verificationNote": "..." }
  { "kind": "operation", "operation": "oidc_group_mapping_create",
    "connectionId": "...", "request": { "configVersion": 7, "externalGroupId": "...", "roleId": "...", "scope": "workspace", "scopeId": "..." } }
  { "kind": "operation", "operation": "oidc_group_mapping_update",
    "connectionId": "...", "mappingId": "...",
    "request": { "configVersion": 7, "enabled": false } }
  ```

  For `metrics_token_rotate`, the server requires current `instance:admin` and a matching
  current `observability_config_version`, then hashes the canonical body bytes defined in
  [api-design.md](api-design.md#observability-administration-and-step-up). For either OIDC
  mapping operation, it requires current `instance:admin`, session-only authentication, the
  exact allowlisted route and a connection/mapping pair that resolves to that route; it
  checks the current `identity_connection.config_version` against `request.configVersion`
  (stored as `expected_version`) and validates the strict request against the persisted
  connection and mapping before issuing a challenge. The canonical request-binding hash
  covers the fixed route key, the
  path `connectionId` and (for update) `mappingId`, and the server-canonical serialization
  of the complete validated request body. The client supplies neither a route key nor a
  hash. For a pending action, it verifies current requester ownership and pending state and
  takes the existing payload hash itself. The no-store response is `{challengeId, challengeNonce, expiresAt,
  reauthenticationMethods}`; the nonce is 32 random bytes as unpadded 43-character
  base64url. The step-up request repeats the binding to prevent completing a different
  challenge target:

  ```json
  { "kind": "operation", "operation": "metrics_token_rotate", "version": 7,
    "challengeId": "...", "challengeNonce": "...",
    "proof": { "method": "password", "value": "..." } }
  { "kind": "operation", "operation": "oidc_group_mapping_update",
    "connectionId": "...", "mappingId": "...",
    "request": { "configVersion": 7, "enabled": false },
    "challengeId": "...", "challengeNonce": "...",
    "proof": { "method": "password", "value": "..." } }
  ```

  Supported proofs are the current password only for a local-password account with no
  enrolled or required second factor, or a currently enrolled TOTP / unused backup code
  verified by Better Auth against the live challenge. A required but unsupported upstream
  SSO proof fails closed; an SSO callback stores a server-verifiable receipt and accepts no
  client claim of success. The mint
  response is the no-store `{stepUpToken, expiresAt}`; no proof is logged or persisted.

  The operation bindings are only these exact routes and request contracts:

  | Operation key | Route | Version source |
  | --- | --- | --- |
  | `metrics_token_rotate` | `POST /api/instance/observability/metrics-token/rotate` | `observability_config_version` |
  | `mfa_reset` | `POST /api/instance/users/{id}/reset-mfa` | fixed operation version `1` |
  | `instance_admin_grant` | `POST /api/instance/users/{id}/grant-admin` | fixed operation version `1` |
  | `oidc_group_mapping_create` | `POST /api/instance/identity-connections/{id}/oidc-group-mappings` | `identity_connection.config_version` |
  | `oidc_group_mapping_update` | `PATCH /api/instance/identity-connections/{id}/oidc-group-mappings/{mappingId}` | `identity_connection.config_version` |

  OIDC mapping challenge and completion requests carry the exact connection id, mapping id
  where applicable, and strict operation body; the service re-resolves them and checks that
  the mapping belongs to the named connection. The step-up request repeats the binding.
  Each protected route uses `X-TaskDesk-Step-Up-Token` and recomputes the request-binding
  hash from the loaded path parameters and server-validated canonical body. In one database
  transaction, re-read the current active person and session, re-evaluate the exact
  `instance:admin` route policy, lock the confirmation row found by token digest, compare its
  fixed-length hash and exact route/body/version/session/person binding, mark it consumed
  conditionally, compare-and-set the resource version and perform the protected mutation.
  A stale version or failed validation rolls back token consumption and the mutation; the
  retry needs a new challenge bound to the current version and request. The mutation's
  existing audit-failure exception still follows AU-14.

  For metrics rotation, the route/body canonicalization remains as specified in
  [api-design.md](api-design.md#observability-administration-and-step-up). For OIDC mapping
  writes, the canonical request envelope and field ordering are specified in
  [api-design.md](api-design.md#oidc-group-mapping-administration). No operation may reuse
  another operation's proof, and no session-wide freshness window is introduced.

  For `mfa_reset`, both challenge and proof repeat the target user id and exact validated
  `verificationNote`. The canonical body hash covers the fixed route, operation, fixed
  version, target user id, and trimmed note. The reset route recomputes that binding and
  consumes the one-use token in the same transaction that locks the target, clears the
  factor, revokes sessions and keys, and inserts the target's private security notification.
  A stale, missing, replayed, wrong-target or wrong-note proof makes no reset change.

  For `instance_admin_grant`, both challenge and proof bind the target user id from the
  route and the strict empty JSON body `{}`. The canonical request hash covers the fixed
  route, operation key, fixed version, target user id, and empty body. The route recomputes
  the binding and consumes the proof in the same transaction that locks and revalidates the
  target user/person and shared instance-admin promotion lock before changing
  `user.role`. A stale, missing, replayed, wrong-target or wrong-session proof makes no
  authority change.

  The metrics operation uses `X-TaskDesk-Step-Up-Token` and recomputes the canonical
  request hash server-side.
  In one database transaction, re-read the current active person and session, re-evaluate
  the exact `instance:admin` route policy, lock the confirmation row found by token digest,
  compare its fixed-length hash and exact route/body/version/session/person binding, mark it
  consumed conditionally, compare-and-set the singleton version, rotate the token hash, and
  append the safe audit row in a nested savepoint. Those writes commit together. A stale
  version returns `409
  version_conflict` and rolls back token consumption; the retry needs a new challenge bound
  to the new version. A wrong, expired, replayed, or mismatched token returns the same
  generic `403 step_up_expired`; missing token is `403 step_up_required`. These denials do
  not rotate the credential. Pending-action approval retains its existing pending-id
  binding, five-minute token lifetime, re-mintability while pending, and `pending` state on
  denial.

  For SSO step-up, the callback must validate the exact configured issuer and audience,
  single-use `state` and `nonce` bound to challenge/session/subject/connection, and the
  requested `prompt=login`. It must include signed `auth_time` satisfying
  `challenge.created_at - 60s <= auth_time <= callback_received_at + 60s` and
  `callback_received_at - auth_time <= 5min`; the callback must arrive before challenge
  expiry. Missing or untrustworthy `auth_time`, changed subject/connection/session, or
  unavailable auth context fails closed (`403 step_up_unavailable` or authentication
  failure). Where policy requires MFA, fresh `amr`/`acr` evidence must satisfy the configured
  connection mapping or a real local factor; a static upstream-MFA flag alone is not proof.
  No password/email-OTP fallback is allowed for an SSO-only account.

  Re-authentication must be actually verified. The initial supported account class is a
  current local-password session with no enrolled or required second factor, where the
  server rechecks the current credential/identity and verifies the password. The current
  source does not enable better-auth `twoFactor` and does not implement a fresh Entra
  `prompt=login` callback or other verified factor adapter. A method that the account
  requires but the server cannot verify fails closed with `403 step_up_unavailable`; sign-in
  email OTP or a client success flag must not substitute for a missing required factor. The
  protected operation cannot be called usable for unsupported account classes until their
  applicable re-authentication adapters exist and are tested. Detailed binding and
  transaction rules are in
  [security-model.md](security-model.md#sessions-csrf-and-step-up) and
  [api-design.md](api-design.md#observability-administration-and-step-up).

  Challenge creation and proof attempts are rate-limited by session/person/IP. Missing or
  revoked session is `401`; API, MCP, or impersonation credentials are `403
  session_required`; a missing required proof is `403 step_up_required`; expired, consumed,
  malformed, or mismatched proof material shares generic `403 step_up_expired`; unavailable
  required verification is `403 step_up_unavailable`; stale operation version is `409
  version_conflict`; exhausted attempt limits return `429`. Errors expose no factor,
  credential, challenge/token id, hash, nonce, or request body. Audit `auth.step_up_issued`,
  `auth.step_up_consumed`, and `auth.step_up_denied` with actor, session/person, binding,
  outcome and trace id only; `auth.step_up_denied` records failed proof/verification or
  replay. Never record proof, nonce, token/hash, or arbitrary body.
  `pending_action.step_up_token_id` records the consumed confirmation row id, not its secret.

## Confirmation levels

The server decides the required confirmation from `target_type` and `action`; the client
cannot lower it. The dialog always shows the **exact target** and the **action**.

| Target | The dialog shows | Confirmation required |
| --- | --- | --- |
| Comment, attachment, personal saved view | Exact target, parent work item | Explicit click |
| Work item | Key, title, project, requester and portal-visibility impact, the soft-delete recovery period | Explicit click |
| **Bulk deletion** of **50 items or fewer** | Total count, the exact filter/query, workspace/project scope, representative targets | **Typed count**. Never a model-supplied value |
| **Bulk deletion above 50 items** | As above, plus the full blast radius of the filter | **Typed count + step-up** (`typed_count_step_up`) |
| Project | Affected work items, members, attachments, integrations; recovery and purge behaviour | **Typed project key or exact name + step-up** |
| Workspace, organisation | Full operational and security impact | **Typed exact name + step-up** |
| API key, webhook, identity connection / provider | Who and what depends on it; what stops working | **Typed exact name + step-up** |
| God Mode user deactivation | Current target account email; that sessions and personal API/MCP keys are revoked, direct and external grants are retired, memberships end, and history is preserved | **Typed exact email + step-up** (`typed_name_step_up`), `instance:admin` |
| Hard purge (`PA-13`) | What will be irrecoverably removed; legal-hold and retention check result | **Typed exact name + step-up**, `instance:admin` |
| MCP destructive that is not a deletion (`PA-14`: `decide_approval`, bulk > 50 items) | The decision or the batch, and the work items it touches | Explicit click |
| **Any other single deletable record** — role (with its holders reassigned, `RL-8`), custom field (`CF-8`), team, service calendar, automation rule, time entry, shared or team saved view, label, relation | Exact target and its dependants | Explicit click |

Each row states **one** required confirmation, never a choice between two: the column is the
`confirmation_required` enum value, and "A or B" is not something the enum can hold or a test
can assert. The enum is `click | typed_name | typed_count | typed_count_step_up |
typed_name_step_up`.

The ladder rises with blast radius, and `typed_count_step_up` exists because it did not. Bulk
deletion by filter is the largest blast radius in the product — every work item in a workspace,
in one request — and it previously stopped at a typed count with no second factor, while
deleting a single webhook required one. A stolen browser session (the "compromised staff
session" adversary in [security-model.md](security-model.md#threat-model)) could therefore
destroy a workspace's entire work-item corpus without a second factor. Above 50 items — the
same threshold the corpus already uses for MCP bulk — it now needs one.

Step-up is the action-bound confirmation token minted by `PA-15`; the token names the pending
action id, so one step-up cannot approve two things.

## Permissions

| Action | Who |
| --- | --- |
| Request a deletion | Whoever the route's own policy allows — `work_item:delete`, `project:delete`, … |
| View or cancel a pending action | The requester only (`authenticated + self`), from **any** credential — so an API or MCP client can poll `PA-4` |
| Approve or deny a pending action | The requester only (`authenticated + self`), **in a browser session** — never an API key, MCP key or impersonation session |
| See all pending actions in a workspace (read-only, for support) | `workspace:manage_settings`, reach-filtered |
| Hard purge | `instance:admin`, elevated |

## Screens

- **Pending action approval** — a dialog over whatever screen requested it (P1).
- **Profile → Pending actions** — `/agent/settings/profile/pending-actions`: the list of
  actions awaiting my approval, with origin (web/api/mcp), requesting key, target, expiry
  (P4).
- **No portal dialog.** Customers cannot delete anything ([customer-portal.md](../03-features/customer-portal.md),
  "May not: delete anything"); the portal has no `DELETE` route, so nothing there needs
  approval. Withdrawal of a submission (`CP-15`) is a state change, not a deletion.
- Rows are in the [screen inventory](../02-design/screen-inventory.md).

## API

```
DELETE  <any deletable resource>                          route's own policy → 202 + pending action
GET     /api/me/pending-actions                           authenticated + self
GET     /api/me/pending-actions/{id}                      authenticated + self
POST    /api/me/pending-actions/{id}/approve              authenticated + self, session-only
POST    /api/me/pending-actions/{id}/deny                 authenticated + self, session-only
POST    /api/me/pending-actions/{id}/cancel               authenticated + self
POST    /api/me/step-up/challenges                       authenticated + self, session-only  (PA-15)
POST    /api/me/step-up                                   authenticated + self, session-only  (PA-15)
GET     /api/workspaces/{id}/pending-actions              workspace:manage_settings (read-only)
POST    /api/instance/purge                               instance:admin  E  (PA-13)
```

The self list returns only the caller's `pending` actions, ordered by
`created_at DESC, id DESC`. It uses the standard opaque cursor and `limit` contract
from [api-design.md](api-design.md#collections): default 50, maximum 200, and returns
`{ data, page: { nextCursor, hasMore }, meta: { total } }`, where `meta.total` is the
count of all pending actions owned by the caller. `GET /api/me/pending-actions/{id}`
returns that caller's action in any state so API and MCP clients can poll its outcome;
another requester's id is indistinguishable from a missing id and returns 404.

Both reads resolve the caller's current database identity before querying actions, for
session and API-key credentials alike. No current valid identity (including an inactive
person, banned user, or an inapplicable customer organisation/key) returns 401 on both
routes, consistently with [RBAC](rbac.md#404-versus-403-versus-409). A surviving credential
does not preserve a deactivated owner's access. This refusal happens before action lookup
and writes no `pending_action.viewed` audit. A valid identity still gets 404 for a missing
or foreign action. The authenticated-self policy does not require a workspace capability.

Both routes return the same explicit allowlisted DTO, in camel case:
`id`, `action`, `origin`, `targetType`, `targetIds`, `summary`, `confirmation`, `state`,
`createdAt`, `expiresAt`, `invalidationReason`, `decidedAt`, `executedAt`, and
`requestingKeyName`. `summary` is the stored `payload_summary` and must be a JSON object.
`confirmation` is `confirmation_required`. `requestingKeyName` is the name of the
requesting person's API key when the credential is an API key and that key still exists;
it is otherwise null. Reads never return the stored payload, payload hash, route key,
credential id, step-up token id, trace id, or internal error.

Rendering a list row or detail summary is a `pending_action.viewed` audit action (PA-11).
The read fails if the audit write fails; it must not return an unaudited summary.

The first line covers ordinary records. A `DELETE` on an **elevated** target (workspace,
organisation, project, API key, webhook, identity connection, `auth.*` plugin) carries
`sessionOnly: true` and returns `403 session_required` on any non-session credential rather
than a 202 — `PA-5`.

`202` is added to the status table in [api-design.md](api-design.md#errors); the response
body carries the `summary` the UI renders.

## Edge cases

| Case | Behaviour |
| --- | --- |
| Approver's session expires mid-dialog | The action stays `pending` until `expires_at`; re-sign-in and approve from Profile → Pending actions |
| Two identical delete requests | **One** pending action. The idempotency layer replays the stored `202` for a keyed retry; an unkeyed repeat hits the partial unique index and returns `409 pending_approval` with the existing id (`PA-4`) |
| Elevated `DELETE` presented on an API key or MCP key | `403 session_required` before the policy runs — no pending action, nothing to poll (`PA-5`) |
| Target moved to another project or workspace between request and approval | `PA-6` step 3a → `409 target_changed`, action `invalidated` with `invalidation_reason = 'target_scope_changed'`, even if the approver holds the capability in the new scope |
| Step-up token expires while the approver reads the summary | `403 step_up_expired`; the action stays `pending` and a fresh token is minted from `POST /api/me/step-up` (`PA-15`) |
| Target already soft-deleted by someone else | `PA-6` step 2 → 404, action `invalidated` |
| Requester is impersonated | Impersonation sessions cannot request or approve deletions (`GM-9`) |
| Work item edited between request and approval | `409 target_changed`; the requester asks again and sees the new summary |
| Client sends `confirm: true` or any approval field | Ignored; `PA-2` response unchanged |
| Legal hold on the organisation | Soft delete is allowed and stays recoverable; purge (`PA-12`/`PA-13`) is refused while the hold stands |

## Out of scope

- Approval by *someone else* (four-eyes deletion). Not in this design; a future
  specification if a customer requires it.
- Automation-initiated deletion (`AM-13` — none before P4; any later capability needs its
  own spec, blast-radius control, dry run, human approval, audit and security review).
- Undo of an executed hard purge — by definition impossible; that is what the confirmation
  levels are for.

## Testing

`tests/api-integration/pending-actions/` and `tests/e2e/security/`:

```
delete-returns-202-and-deletes-nothing.test.ts
api-key-delete-requires-ui-approval.test.ts
service-key-cannot-delete.test.ts
approval-rejected-from-api-key-and-mcp-key.test.ts
approval-rejected-from-impersonation-session.test.ts
impersonation-cannot-request-deletion.test.ts
approval-replay-and-target-substitution-refused.test.ts
approval-invalidated-on-revocation-deactivation-lost-reach.test.ts
approval-invalidated-on-target-version-change.test.ts
bulk-delete-requires-typed-count.test.ts
bulk-delete-above-50-requires-step-up.test.ts
elevated-delete-from-api-key-is-403-session-required.test.ts
retry-while-pending-returns-409-and-creates-nothing.test.ts
approval-invalidated-when-target-moves-scope.test.ts
step-up-token-is-bound-to-one-pending-action-and-re-mintable.test.ts
project-delete-requires-typed-key-and-step-up.test.ts
model-supplied-confirm-field-ignored.test.ts
retention-purge-needs-no-second-approval.test.ts
no-mcp-purge-tool.test.ts
legal-hold-blocks-purge.test.ts
pending-action-expires-after-15-minutes.test.ts
every-transition-audited.test.ts
```

## Related

- [RBAC](rbac.md) · [Security model](security-model.md) · [Data model](data-model.md)
- [MCP server](../03-features/mcp-server.md) · [Automations](../03-features/automations.md)
- [Work items](../03-features/work-items.md) `WI-21`–`WI-23` · [Data protection](../05-operations/data-protection.md)
