# Approvals and CAB decisions

TaskDesk approvals record a decision from one named approver. An approval can also gate a
workflow transition until that decision is made. Customer approvals are requested by staff
from customer contacts; CAB approvals are internal decisions for change work items.

## Current availability

The approvals API is available when `feature.approvals` is enabled for the item's project,
workspace, or instance. The built-in default is off. When the flag is off, creating a new
approval returns `404`; existing approvals remain available under their normal permissions,
and approval-required workflow transitions remain blocked until their gate is satisfied.

The approvals screens are held for the later S9 web work. This page describes the API
behavior currently available; it does not imply that an approvals screen is available in the
web application.

## Requesting an approval

An authorized staff member requests an approval on a work item with
`POST /api/work-items/{key}/approvals`. The request identifies the approval kind, the named
approver, and the workflow transition it concerns. Customer approval requests use
`kind: "customer"` and require `approval:request`. CAB requests use `kind: "cab"` and require
`approval:request_cab`; CAB requests are limited to work items whose type is marked as a
change. Customer-side accounts cannot request CAB approvals.

The approver must have reach to the work item. An approver cannot be the requester. Expiry
defaults to seven days from the instance setting `approval_default_expiry_days`; a request may
specify its own expiry up to 90 days. The setting is instance-wide, not workspace-specific.

For example, an authorized client can submit:

```http
POST /api/work-items/CHANGE-42/approvals
Content-Type: application/json

{
  "kind": "cab",
  "approverId": "person-id",
  "transitionId": "transition-id"
}
```

The caller must use its authenticated TaskDesk session and include the session's CSRF token
for state-changing requests. Exact request fields are defined by the API schema.

## Deciding and gating a transition

Only the named approver can decide. CAB approvers must also hold `approval:decide_cab` and be
a member of a team marked as the CAB. A decision is final. Rejection requires a note; approval
may omit one. A requester cannot approve their own request, even if their role includes the
decision capability.

An approver decides with `POST /api/approvals/{id}/decide`. Approval responses expose the
approver's display name and avatar, not their email address. The requester may withdraw a
pending approval with `POST /api/approvals/{id}/withdraw`. An instance administrator may
withdraw it through the audited, session-only route `POST /api/admin/approvals/{id}/withdraw`.

Workflow transitions marked `requires_approval` remain blocked until a matching approval is
approved. A `requires_cab` transition accepts only a CAB approval. The approval's
`transitionId` must match the transition being run. Approvals are single-use: after the
transition runs, that approval cannot authorize another run. Other pending approvals for the
same transition are closed by the run. A new run therefore needs a new approval. Rejection,
withdrawal, expiry, or a missing approval does not move the work item through the gate.

The inbox endpoints are `GET /api/me/approvals` for staff and `GET /api/portal/approvals`
for customer approvers. `GET /api/work-items/{key}/approvals` lists approvals visible to the
caller on that work item. Customers see only approvals addressed to them or raised by them.

## Related API routes

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/work-items/{key}/approvals` | List approvals visible on a work item |
| `POST` | `/api/work-items/{key}/approvals` | Request an approval |
| `POST` | `/api/approvals/{id}/decide` | Decide as the named approver |
| `POST` | `/api/approvals/{id}/withdraw` | Withdraw as the requester |
| `POST` | `/api/admin/approvals/{id}/withdraw` | Audited administrator withdrawal |
| `GET` | `/api/me/approvals` | List approvals addressed to the signed-in staff member |
| `GET` | `/api/portal/approvals` | List approvals addressed to the signed-in customer |
| `POST` | `/api/portal/approvals/{id}/decide` | Decide as the named customer approver |

See the [approvals feature specification](../../../docs/03-features/approvals.md) for the
complete behavior and permission rules.
