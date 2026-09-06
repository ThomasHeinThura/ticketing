# Attachments

- **Phase:** P1
- **Status:** ⬜
- **Feature flag:** always on
- **Depends on:** storage plugin, work items

## Purpose

Attach files to work items, comments and submissions. Screenshots, logs, quotes, signed
documents.

Architecture and security: [Storage and attachments](../01-architecture/storage-and-attachments.md).
This document covers behaviour and interface.

## Behaviour

- `AT-1` Files attach to a work item, to a specific comment, or to a submission.
- `AT-2` Upload is direct to object storage via a presigned POST. The API never proxies
  bytes.
- `AT-3` Every attachment carries `customer_visible`. Staff uploads default to **not**
  visible; customer uploads default to visible.
- `AT-4` An attachment on an internal comment is always internal, whatever its own flag
  says.
- `AT-5` Download URLs are presigned with a five-minute lifetime and are issued only after
  a policy check. The bucket is never public, and there is **no anonymous read path**:
  kaneo's `is_public` branch in `authorize-asset-access.ts` is deleted at fork
  ([decision log](../07-planning/decision-log.md)).
- `AT-6` Every download writes an audit row.
- `AT-7` Deleting is soft; the object is removed the following night by `attachment-gc`,
  so an accidental deletion is recoverable for a day. Like every deletion it is a pending
  action approved by the requester — a click-level confirmation showing the file and its
  parent ([pending-actions.md](../01-architecture/pending-actions.md)); the nightly
  `attachment-gc` and `attachment-pending-cleanup` runs need no second approval (`PA-12`).
- `AT-8` Images render inline as thumbnails with a lightbox. Everything else shows an icon,
  filename, size and uploader.
- `AT-9` PDFs preview in a sandboxed viewer. Office documents do not preview — they
  download.

## Upload experience

- `AT-10` Drag and drop anywhere on the work item detail.
- `AT-11` Paste from clipboard, which is how screenshots actually arrive.
- `AT-12` Multiple files at once, each with its own progress bar and its own failure state.
  One failure does not abandon the batch.
- `AT-13` Uploads continue if the user navigates within the app; leaving the app cancels
  them with a warning.
- `AT-14` A rejected file says exactly why — "Executable files aren't allowed",
  "This file is 41 MB; the limit is 25 MB" — never "Upload failed".

## Limits

Defaults, all configurable in God Mode.

| Limit | Default |
| --- | --- |
| Per file | 25 MB |
| Files per work item | 100 |
| Total per organisation | Unlimited |

Allowed: images, documents, text, archives. Blocked: executables and scripts. SVG is
blocked by default because it is a script vector; it can be enabled with sanitisation.

## Permissions

| Action | Capability |
| --- | --- |
| See an attachment | `work_item:read` + visibility |
| Upload (agent) | `attachment:create` on the work item |
| Upload (portal) | `{ portal: 'customer', predicate: 'own_request' }` — [RBAC](../01-architecture/rbac.md) policy kind 3 |
| Change visibility | `work_item:update` (staff only) |
| Delete own | `work_item:update` |
| Delete own | `attachment:delete_own` |
| Delete anyone's | `attachment:delete_any` — an attachment capability, not a comment one |

## API

```
POST   /api/attachments/presign                work_item:update
POST   /api/attachments/{id}/complete          work_item:update
GET    /api/attachments/{id}                   work_item:read → 302 to presigned URL
PATCH  /api/attachments/{id}                   work_item:update   (visibility, filename)
DELETE /api/attachments/{id}                   work_item:update
GET    /api/work-items/{key}/attachments       work_item:read
POST   /api/portal/requests/{ref}/attachments/presign   { portal: 'customer', predicate: 'own_request' }
```

## Edge cases

| Case | Behaviour |
| --- | --- |
| Upload starts, browser closes | Row stays `pending`; cleaned up after an hour |
| Storage unreachable | Presign fails with a clear message; nothing is created |
| Filename with path separators or nulls | Sanitised for display; the object key is generated regardless |
| Two files with the same name | Both kept. Display disambiguates with the upload time |
| Declared MIME does not match magic bytes | Rejected at `complete`; the object is deleted |
| Attachment on a work item moved to another project | Moves with it |
| Customer uploads to a resolved request | Allowed within the reopen window (`instance_setting.reopen_window_days`); reopens the request through the workflow's `is_reopen` (`workflow_transition.is_reopen`) transition as a system actor — `WF-21`, one mechanism shared with `CP-8` |
| Presigned POST conditions | Always pin the exact object key, `content-length-range` up to the limit, and the declared content type — the credential cannot write another key or an unbounded object. The download path serves only `state = 'ready'` rows, never by raw key |
| Malware | **No scanner — a stated, accepted residual risk** (decided 2026-09-05: not built or installed in the current scope; revisit before unknown external users can upload). Mitigated by the allowlist, magic-byte check, separate files origin and `Content-Disposition: attachment`. A *future* `storage.antivirus` plugin (ClamAV or a hosted scanner) would gate `pending → ready`; the plugin id is reserved, nothing else ([roadmap.md](../07-planning/roadmap.md)). Archives (`zip`, `7z`, …) are an instance-configurable allowlist entry because they bypass the extension allowlist for the recipient |

## Testing

Integration: presign refuses without permission; a `.png` containing an executable header
is rejected; a non-visible attachment is absent from every portal response; a traversal
filename produces a safe generated key.

E2E: drag and drop, paste a screenshot, download, delete and restore within the window;
upload from the portal on a phone viewport.

## Related

- [Storage and attachments](../01-architecture/storage-and-attachments.md)
- [Comments and activity](comments-and-activity.md)
