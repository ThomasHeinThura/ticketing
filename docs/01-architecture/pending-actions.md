# Pending actions — server-enforced approval for deletion and destructive agent calls

- **Status:** decided 2026-09-05 (Thomas — confirmed decision document, sections H, I, J)
- **Phase:** the mechanism lands in **P1** with work-item deletion; MCP and API-key
  origins use it from **P4**
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
(`delete`, `bulk_delete`, `purge`, `mcp_destructive`); `target_type` and the exact
`target_ids[]`; `target_versions` where the target is versioned; a `payload_hash` of the
full request; the `scope` (workspace/project/organisation); `created_at`; `expires_at`;
`state`; the confirmation kind required and the one supplied; `decided_by`,
`decision_session_id`, `decided_at`; `executed_at`; `error`.

## Behaviour

- `PA-1` **Any request to delete** — `DELETE` route, MCP tool, bulk action — first passes
  the route's normal policy (reach, capability, feature flag). If the caller may not even
  *request* deletion, the response is the ordinary 404/403 and no pending action exists.
- `PA-2` If the caller may request it, the server creates a `pending_action` in state
  `pending`, writes `pending_action.requested` to the audit log, and responds **`202
  Accepted`** with `{ pendingActionId, action, summary, confirmation, expiresAt,
  approveUrl }`. **Nothing is deleted at this point**, whatever the client.
- `PA-3` A **web-UI** request opens the approval dialog immediately in the same browser
  session, rendered from the server's `summary` (never from client state). To the person it
  is a confirm dialog; underneath it is `PA-6`.
- `PA-4` An **API-key or MCP** request returns the same `202`. The requester is notified
  ("An agent using your key *ci-bot* asked to delete SUP-1234") and approves from
  **Profile → Pending actions** or the notification. The client learns the outcome by
  polling `GET /api/me/pending-actions/{id}` — retrying the original request while the
  action is pending returns `409 pending_approval` with the id, and creates nothing new.
- `PA-5` A request made with a **workspace service key** (no `person_id`) has no approver
  and is refused `403 no_approver`. Service keys cannot delete.
- `PA-6` **Approval** is `POST /api/me/pending-actions/{id}/approve` with the required
  confirmation — policy kind 2 (`authenticated + self`: the requester only) **and
  session-only**: an API key, an `is_mcp` key or an impersonation session is refused `403`
  ([rbac.md](rbac.md#elevated-and-audited-actions--the-single-list)). The server then:
  1. re-checks the action is `pending` and unexpired;
  2. re-resolves the approver's identity and **re-runs the route policy** against the
     current reach and capability — an approver who lost access since requesting gets 404
     and the action becomes `invalidated`;
  3. re-hashes the stored payload against the stored `payload_hash` and, for versioned
     targets, checks `target_versions` still match (a work item edited since the request
     is `409 target_changed`, and the action is `invalidated`);
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
  required capability is removed, the requester cancels it, or a target's version changes.
  Denial by the approver is `denied`. None of these can later be approved.
- `PA-10` **Nobody approves their own automation.** A model-supplied field (the old
  `confirm: true`), a header, an MCP argument or an automation cannot satisfy `PA-6`.
  There is no server setting that disables this mechanism.
- `PA-11` **Fully audited**: `requested`, `viewed` (the dialog or the pending-actions page
  rendered the summary), `approved`, `denied`, `expired`, `cancelled`, `invalidated`,
  `executed`, `failed` — each an `audit_log` row; all but `viewed` also emit one of the
  three `pending_action.*` events in [events.md](events.md) (`requested`; `decided` with
  its `outcome`; `executed` with `executed|failed`). `viewed` is audit-only — it is not a
  state change.
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

## Confirmation levels

The server decides the required confirmation from `target_type` and `action`; the client
cannot lower it. The dialog always shows the **exact target** and the **action**.

| Target | The dialog shows | Confirmation required |
| --- | --- | --- |
| Comment, attachment, personal saved view | Exact target, parent work item | Explicit click |
| Work item | Key, title, project, requester and portal-visibility impact, the soft-delete recovery period | Explicit click |
| **Bulk deletion** (any type, > 1 item) | Total count, the exact filter/query, workspace/project scope, representative targets | **Typed count** *or* the exact matching phrase. Never a model-supplied value |
| Project | Affected work items, members, attachments, integrations; recovery and purge behaviour | **Typed project key or exact name + step-up** |
| Workspace, organisation | Full operational and security impact | **Typed exact name + step-up** |
| API key, webhook, identity connection / provider | Who and what depends on it; what stops working | **Typed exact name + step-up** |
| Hard purge (`PA-13`) | What will be irrecoverably removed; legal-hold and retention check result | **Typed exact name + step-up**, `instance:admin` |
| MCP destructive that is not a deletion (`PA-14`: `decide_approval`, bulk > 50 items) | The decision or the batch, and the work items it touches | Explicit click |
| **Any other single deletable record** — role (with its holders reassigned, `RL-8`), custom field (`CF-8`), team, service calendar, automation rule, time entry, shared or team saved view, label, relation | Exact target and its dependants | Explicit click |

Step-up is the action-bound confirmation token in
[security-model.md](security-model.md#sessions-csrf-and-step-up); the token names the
pending action id, so one step-up cannot approve two things.

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
GET     /api/workspaces/{id}/pending-actions              workspace:manage_settings (read-only)
POST    /api/instance/purge                               instance:admin  E  (PA-13)
```

`202` is added to the status table in [api-design.md](api-design.md#errors); the response
body carries the `summary` the UI renders.

## Edge cases

| Case | Behaviour |
| --- | --- |
| Approver's session expires mid-dialog | The action stays `pending` until `expires_at`; re-sign-in and approve from Profile → Pending actions |
| Two identical delete requests | Two pending actions; approving one executes it; the second is `invalidated` on approval attempt because the target is gone (404) |
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
