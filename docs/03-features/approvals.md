# Approvals and CAB

- **Phase:** P2
- **Status:** ⬜
- **Feature flag:** `feature.approvals`
- **Depends on:** workflows, notifications

## Purpose

Record a decision by a named person, with an expiry, and optionally block a workflow
transition until it is made.

Two kinds, deliberately distinguished:

| Kind | Who decides | Typical use |
| --- | --- | --- |
| **Customer approval** | A customer contact | "Do you accept this quote / this resolution?" |
| **CAB approval** | Internal change advisory board members | "May this change be deployed?" |

They differ in who may request, who may decide, and where they surface. Conflating them
was one of v1's bugs — a customer account could request an internal CAB approval.

## Concepts

| Concept | Meaning |
| --- | --- |
| **Approval** | A request for a decision, on a work item, from a person, with an expiry |
| **Requester** | Who asked |
| **Approver** | Who must decide |
| **State** | `pending` · `approved` · `rejected` · `expired` · `withdrawn` — the `approval.state` enumeration in [data-model.md §7](../01-architecture/data-model.md) |
| **Gate** | A workflow transition that requires an approval before it may be made |

## Data

`approval` — the authoritative column list is [data-model.md §7](../01-architecture/data-model.md)
(`state`, `transition_id`, the reminder timestamps and the rest); this document does not
repeat it.

## Behaviour

**Requesting**

- `AP-1` A customer approval may be requested by staff with `approval:request`, on a work
  item within their reach.
- `AP-2` A CAB approval may be requested **only by staff**. A customer-side account
  attempting it is refused. *(This was a real v1 defect.)*
- `AP-3` The approver must be a person with reach on the work item. Approvers outside
  reach are not offered and are refused if submitted.
- `AP-4` Expiry defaults to 7 days, configurable per request, capped at 90 days.
- `AP-5` Multiple approvals may be pending on one work item. The gate is satisfied by the
  policy set on the transition: **any** approver, or **all** approvers.
- `AP-6` The requester may withdraw a pending approval. It becomes `withdrawn` (emitting `approval.withdrawn`), not
  deleted.

**Deciding**

- `AP-7` Only the named approver may decide. Not their manager, not an admin.
  An instance admin may *withdraw* on their behalf, which is audited.
- `AP-8` **Nobody may approve a request they raised.** Enforced in the domain layer,
  independent of capabilities.
- `AP-9` A decision requires a note when rejecting. Approving may be noteless.
- `AP-10` A decision is final. Changing your mind means a new approval request.
- `AP-11` Deciding writes an activity entry, notifies the requester and watchers, and
  emits `approval.decided`.

**Expiry**

- `AP-12` `reminder-scan` expires approvals past `expires_at`, setting status `expired`.
- `AP-13` A reminder is sent to the approver at 50% and 90% of the window.
- `AP-14` An expired approval does not satisfy a gate. A new one must be requested.

**Gating**

- `AP-15` A workflow transition with `requires_approval` is blocked until a matching
  approval is `approved`.
- `AP-16` `requires_cab` behaves identically but only accepts `kind = cab`.
- `AP-17` The blocked transition reports why: "Waiting on approval from Jane Smith,
  requested 2 days ago, expires in 5 days."
- `AP-18` A rejection does not close the work item. It unblocks nothing and the team
  decides what to do. Automations may act on `approval.decided` if a project wants
  rejection to move the item.

**Surfacing**

- `AP-19` "Waiting on my approval" is a lens on My Work for staff, and the Approvals
  screen in the portal for customers.
- `AP-20` The work item detail shows an approvals section whenever any approval exists or
  may be requested.
- `AP-21` Pending approvals appear in the notification inbox and, per preference, by email.

## The v1 defects being prevented

Recorded explicitly, because they are easy to reintroduce.

| v1 defect | Prevention here |
| --- | --- |
| A customer-side account could request an internal CAB approval | `AP-2`, enforced in the domain and covered by a named negative test |
| The approver's email address was returned to unauthenticated callers | Response schemas expose an approver's display name and avatar only. Email is never serialised on an approval |
| A requester could approve their own request | `AP-8`, in the domain layer, with a test |

## Permissions

| Action | Capability | Extra |
| --- | --- | --- |
| Request a customer approval | `approval:request` | Staff only |
| Request a CAB approval | `approval:request` | Staff only, change-type items only |
| Decide | `approval:decide` | Must be the named approver, and not the requester |
| Decide a CAB approval | `approval:decide_cab` | Must be a CAB member |
| Withdraw | `approval:request` | Requester, or instance admin (audited) |
| See approvals on an item | `work_item:read` | Customers see only approvals addressed to them or that they raised |

## Screens

Approvals section on the work item; request dialog; decision dialog; "Waiting on my
approval" lens; portal approvals list; portal decision screen.

The portal decision screen is deliberately minimal: what is being asked, by whom, the
relevant context, when it expires, and two buttons. A customer deciding an approval should
not have to learn the product first.

## API

```
GET    /api/work-items/{key}/approvals        work_item:read
POST   /api/work-items/{key}/approvals        approval:request
POST   /api/approvals/{id}/decide             approval:decide
POST   /api/approvals/{id}/withdraw           approval:request
GET    /api/me/approvals                      (self)
GET    /api/portal/approvals                  (self, portal router)
POST   /api/portal/approvals/{id}/decide      approval:decide
```

## Edge cases

| Case | Behaviour |
| --- | --- |
| Approver leaves the organisation | The approval stays pending and is flagged. It must be withdrawn and re-requested |
| Approver loses reach on the work item | Same as above — flagged, not silently voided |
| Work item deleted with a pending approval | The approval is deleted with it. Audited |
| Two approvals, "all" policy, one rejected | The gate stays blocked. The rejection is visible |
| Approval requested on an already-completed item | Allowed. Some processes approve after the fact |
| Expiry set in the past | Rejected at 422 |
| Approver is also the requester | Rejected at 422 with a clear message |

## Out of scope

- CAB membership definition → [service-management.md](service-management.md)
- Which transitions require approval → [workflows.md](workflows.md)

## Testing

Unit: self-approval rejected; expiry arithmetic; any-versus-all gate satisfaction.

Integration: a customer session requesting a CAB approval is refused; approval responses
never contain an email address; only the named approver may decide.

E2E, named security tests: `customer-cannot-request-cab.spec.ts`,
`requester-cannot-self-approve.spec.ts`, `approver-email-not-leaked.spec.ts`.

## Open questions

None.

## Related

- [Workflows](workflows.md) · [Customer portal](customer-portal.md) · [Notifications](notifications.md)
