# Service calendars, SLAs, search, and saved views

This guide covers the API operations currently available for service calendars, SLA policy
authoring, structured work-item search, and saved views. These operations are API-only in
this slice; dedicated calendar, SLA policy, search, and saved-view screens are not available
in the web application yet.

Use an authenticated agent session and the workspace identifier returned when the workspace
is created. Reach and capability checks apply on every request. State-changing requests made
with a browser session require the session's CSRF token. Responses contain API schemas rather
than database rows.

## Service calendars

Calendars define the timezone, weekly coverage windows, and holidays used by SLA evaluation.
Window boundaries are integer minutes from midnight; for example, 09:00 is `540` and 17:00
is `1020`. A window ending at `1440` ends at midnight. Use an IANA timezone such as `Europe/London`.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/service-calendars?workspaceId={id}` | List calendars in a reachable workspace |
| `POST` | `/api/service-calendars` | Create a calendar |
| `GET` | `/api/service-calendars/{id}` | Read one reachable calendar |
| `PATCH` | `/api/service-calendars/{id}` | Update calendar settings; an optional quoted `If-Match` version prevents overwriting a newer edit |
| `GET` | `/api/service-calendars/{id}/preview?year={year}` | Preview annual and weekly covered minutes |
| `POST` | `/api/service-calendars/{id}/holidays/import` | Import a bounded all-day iCalendar file |
| `GET` | `/api/service-calendars/{id}/usage` | Read aggregate reference counts |
| `DELETE` | `/api/service-calendars/{id}` | Request deletion of an unused calendar; returns a pending action |

Calendar reads require `sla_policy:read`; calendar changes require `sla_policy:manage` in the
calendar's workspace. Holiday import accepts the documented bounded iCalendar subset and is
atomic: an invalid event rejects the import rather than saving a partial list. A calendar
with live references cannot be deleted. Deletion is a request followed by approval; the
calendar remains available until approval rechecks its version and references.

Manual SLA pause and resume routes are unavailable. Workflow pause and resume effects follow
the existing workflow contract for automatic `waiting_customer` pauses; manual and
completion/reopen pause continuity remain held for a later release. For a reopened item, the
reported resolution metric is not guaranteed to preserve the elapsed amount from before
completion while that continuity remains held.

## SLA policy authoring and evaluation

Policies are workspace-scoped. Create a draft with
`POST /api/sla-policies?workspaceId={id}`, read it with `GET /api/sla-policies/{id}`, update
its draft with `PATCH /api/sla-policies/{id}`, and publish a complete draft with
`POST /api/sla-policies/{id}/publish`. Policy reads require `sla_policy:read`; authoring and
publishing require `sla_policy:manage` in the policy's workspace.

A published policy version contains a calendar reference, threshold, and goal matrix. The
matrix has one `first_response` and one `resolution` goal for each supported priority on
each work-item type included in that version. Drafts may be incomplete; publishing requires a
complete matrix. `If-Match`, when supplied on update or publish, must contain the quoted
version read by the client.

`GET /api/work-items/{key}/sla` returns the current evaluation of that work item's stored
policy-version reference. The API subset documented here does not expose a policy-binding
operation, so creating or publishing a policy does not by itself assign it to a project,
workspace, or existing work item. An item without a stored applicable version reports the
`none` state. The evaluation uses stored `waiting_customer` workflow pauses, and the first
public staff comment by someone other than the requester sets the first-response fact. Manual
pause/resume routes remain unavailable while their continuity decision is held.

## Structured work-item search

Use `POST /api/work-items/search` with a workspace ID and a bounded work-item query. For
example:

```json
{
  "workspaceId": "workspace-id",
  "query": {
    "entity": "work_item",
    "filter": { "field": "priority", "op": "eq", "value": "high" }
  },
  "limit": 50
}
```

Search requires `work_item:read` and applies the caller's current project reach before it
counts or returns results. The filter grammar accepts only documented fields and operators;
it cannot express arbitrary SQL. Unsupported fields or entities are rejected instead of
silently returning an unfiltered list. Results use cursor pagination. Search results can
differ between two people running the same query because their reach can differ.

## Saved views

A saved view stores a work-item query and a presentation choice. Create a private view by
default with `POST /api/views`; list reachable views with
`GET /api/views?workspaceId={id}`; and read or update a view with `GET` or `PATCH
/api/views/{id}`. Run a view with `POST /api/views/{id}/run`; read its live count with
`GET /api/views/{id}/count`; and pin it for the current user with
`POST /api/views/{id}/pin`.

Private views are visible to their owner. Team and workspace visibility have additional
membership or workspace-capability requirements. Running a view rechecks the current viewer's
work-item reach and field permissions. Pinning is per user. Team-lead editing and shared-view
ownership transfer are held for a later release; current owner and workspace-manager access
rules remain in force.

`DELETE /api/views/{id}` creates a pending action and returns `202`; it does not delete the
view immediately. The requesting agent session can inspect the action at
`GET /api/me/pending-actions/{pendingActionId}` and approve it at
`POST /api/me/pending-actions/{pendingActionId}/approve`. Approval rechecks the saved view and
current authority. A successful decision writes the deletion audit record and domain event;
the view is not removed before that transaction succeeds.

The API behavior and complete permission rules are described in the
[service calendar](../../../docs/03-features/service-calendars.md),
[SLA](../../../docs/03-features/sla.md), and
[search and saved views](../../../docs/03-features/search-and-saved-views.md) specifications.
