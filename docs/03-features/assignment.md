# Assignment

- **Phase:** P1
- **Status:** ⬜
- **Feature flag:** always on
- **Depends on:** work items, RBAC, projects

## Purpose

Decide who is doing a piece of work, without letting anyone quietly hand their work to
someone else.

The rules come from v1, which thought about this carefully and got it right.

## The model

One assignee at a time. Not a list.

Multiple assignees sound helpful and are corrosive: nobody is accountable, notifications
fan out to people who ignore them, and "who is doing this?" stops having an answer.
Collaboration is expressed by watchers, sub-tasks and comments.

## Behaviour

**Who may assign whom**

- `AS-1` `work_item:assign` permits assigning to anyone on the project roster. (Held by
  the built-in `lead` and above — see the role matrix in [RBAC](../01-architecture/rbac.md).)
- `AS-2` Without `work_item:assign`, `work_item:update` permits assigning or unassigning
  **oneself only** — an ownership predicate on the new assignee, not a role-name check.
  Assigning another person is refused with 403.
- `AS-3` A member picking up work already held by someone else is asked to confirm, and
  the previous holder is notified. *(v1 shipped a reassign button with no confirmation and
  had to fix it.)*
- `AS-4` A customer may never assign. The control does not exist in the portal and the API
  refuses it.
- `AS-5` The assignable list is the **project roster**, not the whole directory.
  Assigning someone who is not on the project is refused with a suggestion to add them.

**Identity, not display name**

- `AS-6` Assignment stores a person id. Comparisons are by id.

  v1 compared display names, so two people called "J. Smith" could collide. This is called
  out because it is an easy and invisible mistake.

- `AS-7` The assignee is rendered from the directory at read time, so a rename propagates.

**Departed and inactive people**

- `AS-8` If an assignee becomes inactive or leaves the project, the assignment is
  **retained** and displayed as "Jane Smith (inactive)".
- `AS-9` Work is never silently unassigned. Silent unassignment loses accountability
  exactly when it matters most.
- `AS-10` A report lists work assigned to inactive people, so it can be cleaned up
  deliberately.

**Defaults and automation**

- `AS-11` A project may set a default assignee, applied to work items created with none.
- `AS-12` A request type may set a default assignee, overriding the project's.
- `AS-13` A workflow transition may set or clear the assignee via the `set_assignee` /
  `clear_assignee` **effects** defined in [workflows.md](workflows.md) `WF-19` — for
  example, moving to "Waiting on customer" may unassign. This spec defines no effects of
  its own.
- `AS-14` Automations may assign, subject to the same roster constraint.
- `AS-15` Round-robin and load-balanced assignment are **out of scope for v2**. They
  reward gaming and produce worse outcomes than a person looking at a queue.

**Notifications**

- `AS-16` Being assigned notifies the new assignee, per their preferences.
- `AS-17` Being unassigned notifies the previous assignee.
- `AS-18` Assigning yourself does not notify you.

## Permissions

| Action | Capability | Extra |
| --- | --- | --- |
| Assign to another person | `work_item:assign` | Target must be on the project roster |
| Assign to self | `work_item:update` | Confirmation if taking from someone else |
| Unassign self | `work_item:update` | |
| Unassign another person | `work_item:assign` | |
| Set project default assignee | `project:manage_settings` | |

## Screens

The assignee control appears in the work item header, in list and table rows, in the bulk
action bar, and in the create dialog.

It uses the `person-picker` primitive: avatar, name, role on this project, and current
open work count — because the person assigning usually wants to know who is already
loaded.

Where the actor may only assign themselves, the picker shows a single "Assign to me"
action rather than a disabled list of colleagues. Showing people you cannot choose is
worse than not showing them.

## API

```
POST   /api/work-items/{key}/assign     work_item:assign | work_item:update (self)
DELETE /api/work-items/{key}/assign     work_item:assign | work_item:update (self)
GET    /api/projects/{id}/assignable    work_item:read
POST   /api/work-items/bulk/assign      per-item capability
```

`GET /assignable` returns the roster with current load, filtered to people the actor may
actually assign to. The client never filters this itself.

## Edge cases

| Case | Behaviour |
| --- | --- |
| Assignee removed from the project | Assignment retained, shown as "(no longer on this project)" |
| Assignee's account deleted | Assignment tombstoned to "Former member". History preserved |
| Bulk assign where some items are outside authority | Per-item: allowed ones succeed, others reported |
| Assigning a work item already assigned to you | No-op, no activity entry, no notification |
| Two people self-assign simultaneously | Optimistic concurrency; the second is told who won |
| Default assignee is inactive when a work item is created | Left unassigned, and the project is flagged in settings |
| Assigning across projects during a move | Assignment cleared if the assignee is not on the destination roster; the user is warned first |

## Out of scope

- Team capacity and workload planning → [time-and-cost.md](time-and-cost.md)
- Automated routing rules → [automations.md](automations.md)
- On-call rotas — not in v2

## Testing

Unit: the `AS-1` to `AS-5` matrix — every role against every assignment target.

Integration: a member cannot assign to a colleague; a customer session cannot assign at
all; assignment to someone off the roster is refused; identity comparison is by id, proven
with two people sharing a display name.

E2E: self-assign; take work from a colleague and see the confirmation; observe an inactive
assignee rendered as inactive rather than blank.

## Open questions

None.

## Related

- [Work items](work-items.md) · [RBAC](../01-architecture/rbac.md)
- [Projects and engagements](projects-and-engagements.md)
