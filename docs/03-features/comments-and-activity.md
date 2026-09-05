# Comments and activity

- **Phase:** P1
- **Status:** ⬜
- **Feature flag:** always on
- **Depends on:** work items, RBAC

## Purpose

One stream showing everything that has happened to a work item — what people said and what
changed — in order.

Separating "comments" from "history" into two tabs is a mistake: the reason a field changed
is usually in a comment three lines above the change, and splitting them destroys that.

## The visibility rule

**Every comment is either `public` or `internal`.** This is the single most
security-sensitive field in the product.

| | Public | Internal |
| --- | --- | --- |
| Staff see | Yes | Yes |
| Customers see | Yes | **Never** |
| Notifies customer | Yes | No |
| Stops first-response SLA | Yes | No |

- `CA-1` Visibility is chosen explicitly at composition, with the current choice always
  visible. There is no ambiguity about who is about to read what.
- `CA-2` The default is configurable per project. For customer-facing service desks it
  should default to **internal**, because an accidental internal note is embarrassing and
  an accidental public note can be catastrophic.
- `CA-3` Internal comments are filtered **server-side in the portal router**. Never in the
  client, never by a CSS class, never by a conditional render.
- `CA-4` Visibility cannot be changed after posting. A comment sent to a customer has been
  sent. Delete and repost, which leaves a visible tombstone.
- `CA-5` The composer's appearance differs unmistakably between modes — an internal
  composer has a distinct background and a persistent label. This is a place where visual
  redundancy is worth the noise.

## Activity

- `CA-6` Every field change writes an `activity` row with the field, old value and new
  value. This is the journal, and it is what makes point-in-time reconstruction possible.
- `CA-7` Activity rows have visibility too, decided by this table and nothing else. **An
  unmapped verb or field is `internal`** — adding a field later fails closed.

  | Verb / field | Visibility |
  | --- | --- |
  | `created`, `transitioned` (state change), `priority`, `due_date`, `title`, `description`, `attachment.added` (customer-visible attachment), `reopened`, `resolved`, `escalated` | `public` |
  | `assignee`, `watcher`, `label`, `custom_field` (unless the field is `customer_visible`), `estimate`, `cycle`, `module`, `relation`, `parent`, `time_entry`, `sla_pause`, `attachment.added` (internal attachment), everything else | `internal` |

  Customers therefore never see staff names as assignees; they do see the named author of a
  public comment or approval decision ([RBAC](../01-architecture/rbac.md), customer rules).
- `CA-8` Consecutive changes by the same actor within five minutes are grouped in the UI
  into one entry — "Jane changed priority, due date and 2 labels" — expandable.
- `CA-9` System actions are attributed to the automation or job that made them, never to a
  person.
- `CA-10` Activity is never edited or deleted, including when a work item is archived.

## Composition

- `CA-11` Rich text via Tiptap: bold, italic, lists, links, code, code blocks, tables,
  images, task lists.
- `CA-12` `@mention` a person to notify them and add them as a watcher. Mentioning someone
  without reach on the work item warns and does not notify.
- `CA-13` A customer cannot be mentioned in an internal comment. The picker excludes them.
- `CA-14` `#SUP-123` links a work item inline, rendering key, title and state.
- `CA-15` Pasting or dropping an image uploads it as an attachment and inserts a
  reference. Never base64 into the document.
- `CA-16` Drafts persist per work item per user, surviving a closed tab.
- `CA-17` Editing is allowed for 15 minutes by the author, after which the comment shows
  "edited" with a hover-revealed history.
- `CA-18` Deleting leaves a tombstone — "Comment deleted by Jane, 2 March" — never a
  silent gap. Like every deletion it is a pending action approved by the requester — a
  click-level confirmation showing the comment and its work item
  ([pending-actions.md](../01-architecture/pending-actions.md)).

## Canned responses

- `CA-19` A workspace may define reusable snippets with placeholders for requester name,
  work item key and due date.
- `CA-20` Inserted from the composer, then editable before sending. Never sent
  automatically.

## Permissions

| Action | Capability |
| --- | --- |
| Read public comments | `work_item:read` |
| Read internal comments | `work_item:read` + staff side |
| Post public | `comment:create` |
| Post internal | `comment:create_internal` |
| Edit own within window | `comment:create` |
| Edit anyone's | `comment:update_any` |
| Delete anyone's | `comment:delete_any` |

## Screens

The activity stream on the work item detail, newest last, with the composer pinned at the
bottom. A filter toggles between "everything", "comments only" and "public only" — the
last being how a staff member checks what the customer has actually seen.

## API

```
GET    /api/work-items/{key}/activity          work_item:read
POST   /api/work-items/{key}/comments          comment:create | comment:create_internal
PATCH  /api/comments/{id}                      author within window, or comment:update_any
DELETE /api/comments/{id}                      author, or comment:delete_any
GET    /api/portal/requests/{ref}/activity     (portal router — public only)
```

The portal endpoint is a separate handler, not the same handler with a filter, so it is
impossible to leak internal content through a forgotten branch.

## Edge cases

| Case | Behaviour |
| --- | --- |
| Customer mentioned in a public comment | Notified normally |
| Mentioned person later loses reach | Existing mention remains; no further notifications |
| Comment on a deleted work item | Deleted with it |
| Very long comment | Collapsed above 400 words with "show more" |
| Image in a comment, attachment later deleted | Renders a "image unavailable" placeholder |
| Two people editing one comment | Only the author may edit; no conflict possible |
| Activity for a field the viewer cannot see | Suppressed entirely, not shown as redacted |

## Testing

Integration — the important ones:

- `portal-never-returns-internal.test.ts` — internal comments absent from every portal
  response, including activity, search and export.
- Visibility cannot be changed after creation.
- A customer cannot be mentioned in an internal comment.

Unit: activity grouping window; mention parsing; work item reference parsing.

E2E: post internal and public comments, sign in as the customer, confirm only the public
one is present in the DOM.

## Related

- [Work items](work-items.md) · [Customer portal](customer-portal.md)
- [Notifications](notifications.md) · [Audit trail](audit-trail.md)
