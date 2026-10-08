# Comments and activity

- **Stage:** P1
- **Status:** ⬜
- **Feature flag:** always on
- **Depends on:** work items, RBAC

## Purpose

One stream showing everything that has happened to a work item — what people said and what
changed — in order.

Separating "comments" from "history" into two tabs is a mistake: the reason a field changed
is usually in a comment three lines above the change, and splitting them destroys that.

## Data

[`data-model.md`](../01-architecture/data-model.md) §4 is authoritative for every column.

- `comment` — `work_item_id`, `author_id`, `actor_type`, `body jsonb`, `visibility`
  (`public`\|`internal`), `activity_id` null, `edited_at`, `deleted_at`/`deleted_by` (the
  `CA-18` tombstone).
- `comment_version` — `comment_id`, `number`, `body jsonb`, `edited_by` (the editor's
  `person.id`, nullable when no linked person exists), `created_at` — the edit history
  `CA-17` renders. Historical rows may still contain the user id written by older builds;
  readers resolve either stored id without rewriting the row.
- `activity` — `work_item_id`, `actor_id`, `actor_type`, `verb`, `field`, `old_value`,
  `new_value`, `payload jsonb`, `visibility`, `workflow_version_id` null, `created_at`.
- `canned_response` — `workspace_id`, `name`, `body jsonb`, `visibility_default`,
  `created_by`.
- `project.default_comment_visibility` (`public`\|`internal`, default `internal`) — `CA-2`'s
  per-project default.
- Attachment linkage: `attachment.comment_id` (`CHECK` exactly one of `work_item_id` \|
  `comment_id` \| `submission_id`) is how an image pasted into a comment (`CA-15`) attaches
  to that comment rather than to the work item directly.

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
- `CA-2` The default is configurable per project — `project.default_comment_visibility`
  ([data-model.md](../01-architecture/data-model.md) §3), `public`\|`internal`, seeded
  `internal`. For customer-facing service desks it should default to **internal**, because
  an accidental internal note is embarrassing and an accidental public note can be
  catastrophic.
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
  A plain field edit is recorded as verb `updated` with `field` set to the field name —
  matching [`events.md`](../01-architecture/events.md)'s own resolution of the
  automation-picker label `work_item.field_changed` to the real event key
  `work_item.updated` — and its visibility resolves by that field name, per `CA-7`'s table
  below.
- `CA-7` Activity rows have visibility too, decided by this table and nothing else. **An
  unmapped verb or field is `internal`** — adding a field later fails closed.

  | Verb / field | Visibility |
  | --- | --- |
  | `created`, `transitioned` (state change), `priority`, `due_date`, `title`, `description`, `attachment.added` (customer-visible attachment), `reopened`, `resolved`, `escalated` | `public` |
  | `assignee`, `watcher`, `label`, `custom_field` (unless the field is `customer_visible`), `estimate`, `cycle`, `module`, `relation`, `parent`, `time_entry`, `sla_pause`, `approval.decided` (approval decision; the decision note is not copied into activity), `attachment.added` (internal attachment), everything else | `internal` |

  Customers therefore never see staff names as assignees; they do see the named author of a
  public comment or approval decision ([RBAC](../01-architecture/rbac.md), customer rules).
- `CA-8` Consecutive changes by the same actor within five minutes are grouped in the UI
  into one entry — "Jane changed priority, due date and 2 labels" — expandable.
- `CA-9` System actions are attributed to the automation or job that made them, never to a
  person.
- `CA-10` Activity is never edited or deleted, including when a work item is archived —
  except when the parent work item is purged at the end of the soft-delete window, or its
  workspace is hard-deleted (the tenant deletion cascade — decision log 2026-09-23,
  "Activity addendum").

## Composition

- `CA-11` Rich text via Tiptap: bold, italic, lists, links, code, code blocks, tables,
  images, task lists. The serialized `body jsonb` document is capped at **256 KiB** and
  **10,000 nodes**; a comment over either limit is rejected with the standard 422
  validation contract ([api-design.md](../01-architecture/api-design.md) "Errors" —
  `errors[]` gives field-level detail, `path: "body"`).
- `CA-12` `@mention` a person to notify them and add them as a watcher. The mention picker
  and its preflight are scoped to the current work item's workspace and require the caller's
  current `work_item:read` access to that work item. Before save, the composer submits the
  selected person ids to the preflight and displays a warning for each selected person who
  currently cannot reach the work item. The warning does not block the comment: the saved
  body retains the mention, but the person is not added as a watcher and receives no
  notification. The preflight is advisory; the comment write repeats recipient identity,
  workspace, and current work-item reach checks inside the same transaction as the comment,
  watcher and event writes. A person whose reach changed after preflight is treated as
  unreachable at save time.

  Each newly mentioned, reachable person is inserted as an explicit watcher only when no
  watcher row already exists. An existing watcher row is preserved exactly, including its
  `source` and `muted` value: mentioning someone never unmutes them. On comment creation,
  the author is not notified about their own mention. Each distinct reachable mentioned
  person gets one
  `work_item.mentioned` event carrying `mentionedPersonId` and, for a comment mention,
  `commentId`; that event, the comment and watcher changes commit atomically. The registered
  event recipient is only the named person, and normal notification preference and delivery
  checks still apply. Mention parsing reads `taskdeskMention` nodes from the stored Tiptap
  document; text, labels, Markdown lookalikes and arbitrary JSON fields do not identify a
  recipient.
- `CA-13` A customer cannot be mentioned in an internal comment. The picker excludes them.
- `CA-14` `#SUP-123` links a work item inline, rendering key, title and state.
- `CA-15` Pasting or dropping an image uploads it as an attachment and inserts a
  reference. Never base64 into the document.
- `CA-16` Drafts persist per work item per user, surviving a closed tab — stored in
  `localStorage`, and therefore per device: a draft started on one device is not visible
  on another.
- `CA-17` Editing is allowed for 15 minutes by the author. After that window, editing is
  **refused** — a 403 — unless the actor holds `comment:update_any`. The PATCH request
  supplies the complete `body` value; omitting the property is rejected before any write.
  The existing opaque JSON/legacy-string body contract is unchanged. Each edit writes a new
  `comment_version (comment_id, number, body, edited_by, created_at)` row, where new
  `edited_by` values are the linked editor `person.id` (null when no person is linked)
  ([data-model.md](../01-architecture/data-model.md) §4). Older rows may contain the
  user id stored by earlier builds; they remain unchanged and readers resolve both forms.
  The comment shows "edited" with an expandable history built from those versions. History
  is fetched only when opened, in bounded cursor pages, so one activity page never expands
  every prior body. See the read contract below. History inherits the parent comment's
  immutable visibility and the existing work-item reach/read policy; it never gives a caller
  access to a comment they could not already read.
- `CA-18` Deleting sets `comment.deleted_at` / `deleted_by` and clears the body; the row and
  its activity stay, and the tombstone renders from those two columns — "Comment deleted by
  Jane, 2 March" — never a
  silent gap. Like every deletion it is a pending action approved by the requester — a
  click-level confirmation showing the comment and its work item
  ([pending-actions.md](../01-architecture/pending-actions.md)).
- `CA-11a` Inherited from kaneo and kept inside the Tiptap document: Markdown paste/import
  and export (`turndown`, `react-markdown`), Mermaid diagrams and code highlighting
  (`mermaid`, `shiki`) — sanitised on render, Mermaid rendered client-side only
  ([inherited-features.md](../01-architecture/inherited-features.md)).

## Canned responses

- `CA-19` A workspace may define reusable snippets with placeholders for requester name,
  work item key and due date — the `canned_response` table
  ([data-model.md](../01-architecture/data-model.md) §4). Creating, editing and deleting a
  canned response requires `workspace:manage_settings`
  ([rbac.md](../01-architecture/rbac.md)); reading the list to insert one only requires
  `work_item:read` on the work item being commented on.
- `CA-20` Inserted from the composer, then editable before sending. Never sent
  automatically.

## Permissions

Ownership is `row.person_id === identity.personId` (the comment's `author_id`), matching
[rbac.md](../01-architecture/rbac.md)'s worked `PATCH /api/comments/{id}` example: an
`orOwner` branch grants the `_own` capability only within the 15-minute window, with the
`_any` capability as the unconditional override.

| Action | Capability |
| --- | --- |
| Read public comments | `work_item:read` |
| Read internal comments | `work_item:read` + staff side |
| Post public | `comment:create` |
| Post internal | `comment:create_internal` |
| Edit own within window | `comment:update_own` (owner predicate, `withinMinutes: 15`) |
| Edit anyone's | `comment:update_any` |
| Delete own | `comment:delete_own` (owner predicate) |
| Delete anyone's | `comment:delete_any` |

## Screens

The activity stream on the work item detail, newest last, with the composer pinned at the
bottom. A filter toggles between "everything", "comments only" and "public only" — the
last being how a staff member checks what the customer has actually seen.

## API

```
GET    /api/work-items/{key}/activity          work_item:read
POST   /api/work-items/{key}/comments          comment:create | comment:create_internal
GET    /api/work-items/{key}/comments/mention-candidates
                                                work_item:read, current work-item reach
POST   /api/work-items/{key}/comments/mention-preflight
                                                work_item:read, current work-item reach
PATCH  /api/comments/{id}                      comment:update_any, or comment:update_own
                                                (owner, within 15 minutes)
DELETE /api/comments/{id}                      comment:delete_any, or comment:delete_own
                                                (owner)
GET    /api/portal/requests/{ref}/activity     (portal router — public only)
GET    /api/canned-responses                   work_item:read
POST   /api/canned-responses                   workspace:manage_settings
PATCH  /api/canned-responses/{id}              workspace:manage_settings
DELETE /api/canned-responses/{id}              workspace:manage_settings
```

The activity response keeps its existing `{ data, page }` envelope and flat row shape. It
does not embed comment versions. An edited live comment exposes its history through the
agent-side `GET /api/work-items/{key}/comments/{id}/versions` read below; no portal history
route exists. The route uses the existing `work_item:read` capability and the same
project/work-item reach check as activity. It confirms that the live comment belongs to the
path work item before reading versions; missing, mismatched, deleted, archived, or
out-of-reach parents return the same `404`. A tombstone never exposes versions. Each returned
row contains only the persisted version number, body document, editor person id (nullable),
and creation timestamp. The immutable parent visibility is unchanged. The separate portal
activity projection continues to return public comments only and does not call this agent
history route.

### CA-12 mention preflight

`GET /api/work-items/{key}/comments/mention-candidates?visibility=public|internal` returns
the permissioned picker list for the addressed work item. It includes current workspace
staff (including those who lack this particular project's reach, so a deliberate mention
can be warned) and only customer people whose current organisation/project reach permits
them to see this work item. Customer people are excluded in internal mode. The response
contains person id, display name, image, side and current `reachable` status; it never reads
or exposes another workspace or customer organisation's directory.

`POST /api/work-items/{key}/comments/mention-preflight` accepts a bounded, deduplicated list
of person ids and returns only the ids that are current workspace people, split into
`reachablePersonIds` and `unreachablePersonIds`. Unknown, inactive, non-member, and
cross-workspace ids are returned as unavailable without distinguishing those cases. The
route requires current `work_item:read` and work-item reach; it does not grant workspace
membership or reveal people from another workspace. For an internal comment, customer-side
people are unavailable in accordance with `CA-13`. The composition UI uses this result to
warn before save. It is not an authorization token: comment creation re-resolves each
mentioned person and reach under the work-item lock in the comment transaction.

### CA-17 comment-version read pagination

`GET /api/work-items/{key}/comments/{id}/versions` returns `{ data, page: { nextCursor,
hasMore } }`; it returns no total count. `limit` defaults to 5 and must be 1–10. This
per-comment bound is intentionally below the general collection ceiling because each
version body may be 256 KiB under CA-11; even a maximum page is therefore bounded to ten
version bodies. The UI requests the first page when the user expands history and follows
`nextCursor` only when the user asks to load earlier versions. It keeps every fetched page
and renders all fetched rows in ascending `(number, id)` order; no history is silently
truncated or replaced by a summary.

The cursor is opaque, versioned, and keyset-based. It binds the work-item key, comment id,
and last `(number, id)` tuple. A malformed cursor or one bound to a different path parent
returns `400`; it never widens the query. The next page uses strict lexicographic
continuation and the same ascending `(number, id)` order, so concurrent edits do not shift
already-read rows. The database's existing unique `(comment_id, number)` constraint is
preserved; `id` remains the deterministic tie-break. Parent lookup, workspace/project
reach, `work_item:read`, and live-comment checks occur before reading version rows. The
route is not mounted in the customer-portal router; the portal's public-only projection is
unchanged.

The portal endpoint is a separate handler, not the same handler with a filter, so it is
impossible to leak internal content through a forgotten branch.

## Edge cases

| Case | Behaviour |
| --- | --- |
| Customer mentioned in a public comment | Notified normally |
| Mentioned person later loses reach | Existing mention remains; no further notifications |
| Comment on a soft-deleted work item | Hidden along with the work item, not deleted; both reappear together if the work item is restored within its 30-day soft-delete window. Removed only at purge, at the end of that window ([work-items.md](work-items.md) `WI-21`) |
| Very long comment | Collapsed above 400 words with "show more" |
| Image in a comment, attachment later deleted | Renders a "image unavailable" placeholder |
| Two people editing one comment | Only the author may edit; no conflict possible |
| Activity for a field the viewer cannot see | Suppressed entirely, not shown as redacted |

## Out of scope

- Threaded replies within one comment stream — the stream is flat, ordered by time, per
  `CA-8`'s grouping only.
- Reactions/emoji on comments.
- Rich analytics on canned-response usage — `CA-19`/`CA-20` are the composer affordance
  only.
- Per-organisation or per-customer default comment visibility — `CA-2`'s default is
  per-project only; a finer-grained default is [settings-hierarchy.md](settings-hierarchy.md)'s
  concern (P4), not this spec's.

## Testing

Integration — the important ones:

- `portal-never-returns-internal.test.ts` — internal comments absent from every portal
  response, including activity, search and export.
- Visibility cannot be changed after creation.
- A customer cannot be mentioned in an internal comment.

Unit: activity grouping window; mention parsing; work item reference parsing.

E2E: post internal and public comments, sign in as the customer, confirm only the public
one is present in the DOM.

## Open questions

- When an edit adds a new mention to a live comment, should it emit `work_item.mentioned`?
  The API/event contract for comment-edit mentions remains pending the human decision; the
  create-comment behavior above is defined.

## Related

- [Work items](work-items.md) · [Customer portal](customer-portal.md)
- [Notifications](notifications.md) · [Audit trail](audit-trail.md)
