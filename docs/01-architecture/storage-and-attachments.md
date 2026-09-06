# Storage and attachments

Attachment **bytes** live in object storage. Attachment **metadata** lives in Postgres.
The backend is a plugin, so a deployment chooses SeaweedFS, S3, Azure Blob or the local
filesystem without a code change.

## Backends

| Plugin id | Use |
| --- | --- |
| `storage.s3` | The production recommendation — any S3-compatible endpoint: AWS S3, Garage, Wasabi, B2, or SeaweedFS shipped as an **opt-in Compose profile**; a plain S3-API client; not MinIO, see [tech stack](tech-stack.md). **A fresh install runs `storage.filesystem`** until an administrator chooses otherwise (decision log, 2026-09-05) |
| `storage.azure-blob` | Azure-native deployments |
| `storage.filesystem` | Single-node, no object store. Volume-mounted |

Contract in `packages/plugins-contracts`:

```ts
interface StorageBackend {
  put(key: string, body: Readable, meta: ObjectMeta): Promise<void>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  stat(key: string): Promise<ObjectStat | null>;
  presignUpload(key: string, meta: ObjectMeta, ttl: number): Promise<PresignedPost>;
  presignDownload(key: string, filename: string, ttl: number): Promise<string>;
}
```

Configured in God Mode with a **Test** button that writes, reads and deletes a probe
object. Nobody should discover their storage is misconfigured when a user loses a file.

## Object keys

Generated, never derived from the user's filename:

```
{workspaceId}/{yyyy}/{mm}/{attachmentId}{ext}     ← workspaceId = attachment.workspace_id, denormalised at insert (a submission attachment has one too)
```

- No user-controlled path segment ⇒ no traversal.
- The original filename is stored in the database and returned in
  `Content-Disposition` on download.
- The date prefix keeps prefixes shallow and makes lifecycle rules easy.

## Upload flow

Uploads go **direct to storage** via a presigned POST. The API never proxies file bytes.

```
1. POST /api/attachments/presign
     { workItemId, filename, mimeType, size }
   → policy check, quota check, allowlist check
   → creates attachment row (state = pending)
   → returns { attachmentId, url, fields, expiresIn: 300 }

2. Browser POSTs the file directly to storage.

3. POST /api/attachments/{id}/complete
   → server stats the object: exists? size matches? 
   → sniffs magic bytes against the declared MIME type
   → state = ready, emits activity + websocket event
```

A `pending` attachment older than one hour is cleaned up by `attachment-gc`, along with
any orphaned object.

## Validation

| Check | Rule |
| --- | --- |
| Size | 25 MB default per file; configurable per instance in God Mode |
| Extension | Allowlist, not denylist |
| MIME | Must match the extension **and** the sniffed magic bytes |
| Executables | `.exe .dll .so .bat .cmd .sh .ps1 .jar .msi` rejected outright |
| SVG | Rejected by default — SVG is a script vector. Optional to enable, with sanitisation |
| Archives | Allowed, never expanded server-side |
| Total per work item | 100 files default |

Default allowlist: images (png, jpg, webp, gif), documents (pdf, docx, xlsx, pptx, odt,
ods), text (txt, md, csv, log, json, xml, yaml), archives (zip, 7z, tar, gz).

## Download and serving

- Downloads are **presigned URLs with a 5-minute TTL**, issued only after a policy check.
- The storage plugin's configured **public endpoint must equal the browser-facing origin**:
  an S3 SigV4 signature covers the `Host` header, so a URL presigned for `seaweedfs:8333`
  fails at `https://files.<domain>`. The bucket's CORS allows exactly the agent and portal
  origins. `files.<domain>` and its Traefik router exist **only** when an operator-owned S3
  endpoint is served behind this Traefik ([deployment.md](../05-operations/deployment.md));
  on `storage.filesystem` the API serves bytes itself and no third hostname exists.
  The object store is never public.
- `Content-Disposition: attachment` for everything except images that are being displayed
  inline in the UI.
- Where the storage backend permits, downloads are served from a **separate origin** so
  that even a successfully uploaded hostile file cannot execute against the application
  origin. When it cannot, a restrictive `Content-Security-Policy: sandbox` header is set.
- Every download writes an audit row: who, what, when.

## Visibility

Each attachment carries `customer_visible`. Staff-uploaded files default to **not**
visible; customer-uploaded files default to visible. The portal API filters on this
server-side — never in the client.

An attachment on an internal comment is always internal, regardless of its own flag.

## Images in rich text

Tiptap images are ordinary attachments. Pasting or dropping an image into a description
or comment runs the same presign → upload → complete flow, and the editor stores an
attachment reference rather than a base64 blob. This matters: base64 in a JSONB column is
how document tables become gigabytes.

## Quotas

Optional, per organisation, configured in God Mode. Exceeding returns `429` naming the
quota. Usage is visible in workspace settings so it is not a surprise.

## Deletion and lifecycle

- Deleting an attachment marks the row deleted; `attachment-gc` removes the object the
  following night. This makes accidental deletion recoverable for a day.
- Deleting a work item cascades to its attachments through the same path.
- Deleting an organisation purges its objects during hard delete.
- Optional lifecycle rules on the bucket (transition to infrequent access after 90 days)
  are an operator concern, documented but not managed by the application.

## Backup

Object storage is backed up **separately from the database**, and the two must be
restored to a consistent point. A database restored to yesterday alongside today's bucket
will show attachments that the database does not know about — harmless — while the
reverse shows rows whose objects are missing, which is not.

Restore order is therefore: database first, then object storage forward-only.
See [Backup and restore](../05-operations/backup-and-restore.md).

## Testing

| Test | Asserts |
| --- | --- |
| `presign-policy.test.ts` | Presign refuses without `work_item:update` on the target |
| `mime-sniff.test.ts` | A `.png` containing a PE header is rejected at complete |
| `visibility.test.ts` | Portal API never returns a non-visible attachment |
| `traversal.test.ts` | A filename of `../../etc/passwd` produces a safe generated key |
| `gc.test.ts` | Orphaned objects and stale pending rows are removed |
| E2E `attachments.spec.ts` | Upload, view, download, delete, in both portals |

## Related

- [Plugin architecture](plugin-architecture.md) · [Security model](security-model.md)
- [Attachments feature](../03-features/attachments.md)
