# PR #13 Security Review — Lens C: Storage, Uploads and Attachments

Reviewer: independent post-merge review (adversarial). Repo: `/home/ubuntu/ticketing.v2`, branch `main`, merged state.
Scope read: `apps/api/src/storage/*`, `apps/api/src/utils/authorize-asset-access.ts`,
`apps/api/src/utils/authenticate-api-request.ts`, `apps/api/src/utils/validate-workspace-access.ts`,
`apps/api/src/utils/workspace-access-middleware.ts`, `apps/api/src/utils/require-workspace-permission.ts`,
`apps/api/src/index.ts` (asset + avatar routes), `apps/api/src/task/index.ts` (upload routes),
`apps/api/src/task/schema.ts`, `apps/api/src/task/controllers/move-task.ts`,
`apps/api/src/user/avatar.ts`, `apps/web/src/lib/upload-task-image.ts`.

---

## 0. How the pipeline actually works (traced)

1. `PUT /api/task/image-upload/{id}` (`apps/api/src/task/index.ts:454-482`, handler `:749-800`)
   — middleware `workspaceAccess.fromTask()` + `requireWorkspacePermission({task:["update"]})` + `requireEntitlement`.
   Body: `{filename, contentType, size, surface}` — all `z.string()`/`z.number()` with **no constraints**
   (`apps/api/src/task/schema.ts:106-111`).
   Handler re-reads the task → workspace/project ids **from the DB**, calls `createTaskImageUploadUrl`.
2. `createTaskImageUploadUrl` (`apps/api/src/storage/s3.ts:289-313`) builds the key server-side
   (`buildObjectKey`, `:245`) and returns a **presigned S3 PUT URL** to the browser.
3. Browser PUTs raw bytes straight to the object store (`apps/web/src/lib/upload-task-image.ts:57-62`).
4. `POST /api/task/image-upload/{id}/finalize` (`apps/api/src/task/index.ts:485-514`, handler `:801-909`)
   writes the `asset` row and returns `<apiBase>/api/asset/<id>`.
5. `GET /api/asset/{id}` (`apps/api/src/index.ts:265-343`) — registered **before** the global auth
   middleware (`apps/api/src/index.ts:543`), so Hono never runs `authenticateApiRequest` for it.
   The route's *only* gate is `authorizeAssetAccess` (`apps/api/src/index.ts:309`).

The server never re-reads the object after upload: no `HeadObject`, no size check, no
content-type verification, no magic-byte check. Every fact stored in the `asset` row
(`filename`, `mimeType`, `size`, `kind`) is **client-asserted**.

Positive findings (state up front, so the negatives are calibrated):

- The object key is derived **entirely from DB values**, not from request input, for the
  workspace/project/task segments (`s3.ts:228-243`). The caller cannot pick a prefix.
- `assertTaskImageKeyMatchesContext` (`s3.ts:320-336`) re-derives the prefix at finalize and
  rejects any suffix containing `/` or a leading `.`. I could not construct a traversal.
- `GET /api/asset/{id}` sets `X-Content-Type-Options: nosniff` and forces
  `application/octet-stream` + `attachment` for anything outside a 9-entry image allowlist
  (`apps/api/src/index.ts:104-114`, `:314-334`). `image/svg+xml` is correctly **not** on it.
- Avatars (`apps/api/src/user/avatar.ts`) are the well-built half: MIME allowlist, 512 KB cap,
  base64 shape check, and **magic-byte verification** (`avatar.ts:18-41`). None of that rigour
  was applied to attachments.
- `deleteOrphanedAssets` scopes deletion with `eq(assetTable.taskId, scope.taskId)`
  (`storage/cleanup-assets.ts:100-104`) — no cross-task/cross-tenant delete primitive.

---

## FINDINGS

### C-01 — HIGH — Presigned PUT enforces no size limit: `S3_MAX_IMAGE_UPLOAD_BYTES` is advisory only

**File:** `apps/api/src/storage/s3.ts:268-287` (`validateTaskAssetUploadInput`), `:289-313` (`createTaskImageUploadUrl`); `apps/api/src/task/index.ts:752-762`, `:806-816`

`validateTaskAssetUploadInput` checks the **client-supplied `size` number**, then throws it away:

```ts
export function validateTaskAssetUploadInput(contentType: string, size: number) {
  const maxImageUploadBytes = getMaxImageUploadBytes();
  if (!contentType.trim()) throw new Error("A valid content type is required.");
  if (size <= 0) throw new Error("Upload size must be greater than zero.");
  if (size > maxImageUploadBytes) throw new Error(`Upload exceeds ...`);
}
```

The presign that follows carries only `Bucket`, `Key`, `ContentType` (`s3.ts:296-301`). A
SigV4 presigned **PUT** cannot express a size bound (only a POST policy's
`content-length-range` can). So the limit is enforced nowhere:

**Attack path.** Any workspace member with `task:update` (the lowest role that can attach a
file) calls the presign endpoint with `{"size": 1}`, receives `uploadUrl`, and then
`curl -T 50GB.bin "<uploadUrl>"`. The object lands in the tenant's bucket. Repeat in a loop
across tasks. Nothing in the API ever observes the real byte count; `asset.size` in the DB
stays `1`, so quota/reporting built on that column is also wrong. On a self-hosted MinIO/
SeaweedFS volume this is a disk-exhaustion DoS against the whole instance; on real S3 it is
an unbounded bill.

Secondary: `finalize` never calls `HeadObject`, so an attacker can also register asset rows
for objects that were never uploaded, or lie about `size` to defeat any future quota.

**Fix.** Either (a) switch to `createPresignedPost` with `Conditions: [["content-length-range", 1, max]]`,
or (b) keep the PUT but `HeadObject` in `finalize`, reject and `DeleteObject` when
`ContentLength > max` or `ContentType` disagrees, and only then write the `asset` row — and
persist the *observed* size, not the claimed one. (b) alone still leaves a transient window
where oversized bytes exist; (a) is the correct primitive.

**Owning issue:** NEW ISSUE (blocks the storage-plugin work in #10 — a plugin config exposing
"max file size" that is not enforced is worse than none).

---

### C-02 — HIGH — The "image upload" endpoint accepts *any* content type; no server-side type or extension allowlist

**File:** `apps/api/src/storage/s3.ts:18-31`, `:268-287`; `apps/api/src/task/index.ts:868`, `:886`

`isImageContentType` / `allowedImageMimeTypes` exist (`s3.ts:18-31`) but are **never used as a
gate**. The only two call sites use them to pick a label:

```ts
kind: isImageContentType(contentType) ? "image" : "attachment",
```
(`apps/api/src/task/index.ts:868` and `:886`)

`validateTaskAssetUploadInput` only requires `contentType.trim()` to be non-empty. The web
client is equally permissive — `upload-task-image.ts:42-46` has an inverted-looking guard that
resolves to "allow any non-empty file". So `contentType` can be `text/html`,
`application/x-msdownload`, `image/svg+xml`, anything; it is signed into the presigned URL
(`s3.ts:300`) and therefore becomes the object's **stored** `Content-Type` in the bucket.

**Why this matters even though the app route is careful.** `GET /api/asset/{id}` currently
neutralises it (`apps/api/src/index.ts:314-334`: allowlist → `inline`, otherwise
`application/octet-stream; attachment; nosniff`). But:

1. `StorageConfig.publicBaseUrl` / `S3_PUBLIC_BASE_URL` is read at `s3.ts:42` and `:148` and
   **never used anywhere** — dead config that documents an intent to serve objects directly
   from the bucket. The deployment docs describe exactly that: a `files.<domain>` host in
   front of an operator-owned S3 endpoint (`docs/05-operations/traefik-and-domains.md:17`,
   `docs/05-operations/kubernetes.md:17`). The moment anything serves the bucket directly —
   or an operator makes the bucket/prefix public-read, or a signed GET is handed to a browser —
   the attacker-chosen `text/html` is served verbatim and becomes **stored XSS on the files
   origin**, with the victim's session for that origin.
2. `docs/05-operations/configuration-reference.md:116-118` lists **"allowed extensions"** as
   planned storage config. There is no such enforcement in the merged code at all.

**Attack path (today, no misconfiguration needed).** Member uploads `payload.html` with
`contentType: "text/html"`. Object stored with `Content-Type: text/html`. It is inert through
`/api/asset/{id}` — but it is a live HTML page the instant any direct-bucket or presigned-GET
path is introduced, which the storage-plugin work in #10 explicitly plans.

**Fix.** Enforce `isImageContentType(contentType)` (or an explicit attachment allowlist) in
`validateTaskAssetUploadInput`; add `ContentDisposition: "attachment"` and
`ContentType: <normalised>` to the `PutObjectCommand` so the stored object is inert
regardless of who serves it; verify magic bytes at finalize the way `user/avatar.ts:18-41`
already does. Never trust `contentType` for the `kind` column either — derive it from the
verified bytes.

**Owning issue:** #7 (upload hardening) + #10 (must be settled before any direct-serve /
presigned-GET storage plugin ships).

---

### C-03 — HIGH — `/api/asset/{id}` ignores API-key permission scopes entirely

**File:** `apps/api/src/utils/authorize-asset-access.ts:20-29`; `apps/api/src/utils/validate-workspace-access.ts:5-58`; contrast `apps/api/src/utils/require-workspace-permission.ts:83-95`

`authorizeAssetAccess` calls `validateWorkspaceAccess(userId, asset.workspaceId, apiKeyId)`.
`validateWorkspaceAccess` checks only that the API key **exists, belongs to the user, and is
enabled** (`validate-workspace-access.ts:10-30`). It never looks at `apikey.permissions`.

Every other authenticated route goes through `requireWorkspacePermission`, which *does*
consult the key's scopes:

```ts
const apiKey = c.get("apiKey") as { permissions?: Record<string, string[]> | null } | undefined;
if (apiKey?.permissions && !satisfies(apiKey.permissions, permissions)) return false;
```
(`require-workspace-permission.ts:88-95`)

**Attack path.** A user mints a deliberately narrow API key — say `{"task":["read"]}` for a
CI bot, or a key intended for a single integration — and hands it to a third party
(that is the entire point of scoped keys). That key can then `GET /api/asset/<id>` for
**every attachment in every workspace the key's owner belongs to**, across all projects, with
no scope check. There is no `asset:read` permission concept at all. This is a scope-
confinement bypass: the key holder gets strictly more than the grant.

Note the asset route also sits **before** the global auth middleware
(`apps/api/src/index.ts:265` vs `:543`), so there is no second line of defence.

**Fix.** Give assets a permission (`{task:["read"]}` at minimum) and route the check through
`hasWorkspacePermission`, or add the `satisfies(apiKey.permissions, ...)` check inside
`validateWorkspaceAccess`. The latter is safer — `validateWorkspaceAccess` is used from
`workspace-access-middleware.ts:122` too, and any caller that relies on it *alone* has the
same hole.

**Owning issue:** #8 (authz model) — NEW sub-item.

---

### C-04 — MEDIUM/HIGH — Workspace-level authorization only: no project-scoped check on asset reads

**File:** `apps/api/src/utils/authorize-asset-access.ts:26-28`; `apps/api/src/utils/validate-workspace-access.ts:41-57`; `apps/api/src/index.ts:288-309`

The asset query selects `workspaceId` from the asset row and `isPublic` from the joined
project (`apps/api/src/index.ts:288-303`), but authorization uses **only** `workspaceId`.
Any member of the workspace — including the lowest `viewer` role — can read every attachment
in every project of that workspace, including projects they never open, by asset id alone.

For a single-tenant self-hosted install this may be acceptable. For the multi-tenant posture
TaskDesk is targeting (organisations, portal access, per-project confidentiality — see
`docs/05-operations/configuration-reference.md:110-118`), "workspace member ⇒ sees every
attachment in the workspace" is the wrong default and will be a surprise the first time an HR
or security project shares a workspace with a general one.

Also in the same path: `validate-workspace-access.ts:32-40` short-circuits for
`user.role === "admin"` (instance admin) **before** any membership check, so a global admin
reads every tenant's attachment bytes. Defensible for self-hosted, but on the cloud/multi-
tenant side it is an unlogged cross-tenant read with no audit trail — nothing in the asset
route writes an access log.

**Fix.** Authorize on `asset.projectId` against project membership/visibility once that model
exists; short term, at least log admin-path asset reads.

**Owning issue:** #8.

---

### C-05 — MEDIUM — Anonymous branch in `authorize-asset-access.ts` (confirmed) — and it is broader than "public project"

**File:** `apps/api/src/utils/authorize-asset-access.ts:23-25`

```ts
export async function authorizeAssetAccess(c: Context, asset: AssetAccessTarget): Promise<void> {
  if (asset.isPublic) {
    return;                       // <-- line 23-25: no credential check at all
  }
  const { userId, apiKeyId } = await resolveAssetBearerOrCookie(c);
  await validateWorkspaceAccess(userId, asset.workspaceId, apiKeyId);
}
```

**Confirmed.** The route is anonymous-reachable (registered at `apps/api/src/index.ts:265`,
i.e. before the `api.use("*", ...)` auth middleware at `:543`; the `security: []` field is only
OpenAPI metadata). The docstring's justification is sound as far as it goes —
`resolveAssetBearerOrCookie` throws 401 for anonymous callers
(`authenticate-api-request.ts:169-172`), so the check genuinely has to come first.

The defect is what "public" is attached to. `isPublic` is a **project** flag
(`database/schema.ts:328`), toggled by anyone with `project:update`
(`apps/api/src/project/index.ts:249-263`). Two concrete consequences the current code makes
worse than a reader would expect:

1. **Retroactive publication.** Flipping a project public instantly exposes *every historical
   attachment* of every task in it — including files uploaded years earlier under a private
   project — to unauthenticated internet callers, served with `Cache-Control: public, max-age=300`
   (`apps/api/src/index.ts:322`), so a CDN/proxy may retain them after the flag is flipped back.
   There is no per-asset visibility, no confirmation, and no way to publish a project without
   publishing its files.
2. **Publication by task move.** `move-task.ts:165-168` re-points the assets:
   ```ts
   await tx.update(assetTable).set({ projectId: destinationProjectId }).where(eq(assetTable.taskId, taskId));
   ```
   Moving a task from a private project into a public one in the same workspace makes all of
   that task's attachments anonymous-readable, as a side effect of a move. (The workspace
   guard at `move-task.ts:124-128` does correctly prevent cross-workspace moves, so
   `asset.workspaceId` — which is *not* updated here — stays consistent. Good.)

**Attack path.** A `member`-role user in a shared workspace moves a task carrying a
confidential attachment into any project they can also write to that happens to be public
(or creates/flips one), then fetches `https://host/api/asset/<id>` with no credentials from
anywhere. Only `task:update` + `project:update` are needed — neither implies "may publish
files to the internet".

**Other defects in the same file** (the task asked me to look beyond the known branch):

- **C-05a — the `AssetAccessTarget` type invites the bug.** `{workspaceId, isPublic}`
  deliberately omits `projectId`, so the function *cannot* do a project-level check
  (see C-04). The type is the enforcement boundary and it is under-specified.
- **C-05b — `isPublic: boolean | null` is used as a truthy test.** Harmless today, but any
  future non-boolean value (a string `"false"` from a migration, an enum like `"link"`) fails
  open. Compare `get-public-project.ts:20`/`:34`, which tests `!project.isPublic` explicitly.
- **C-05c — no rate limit and no logging.** The anonymous branch is an unauthenticated,
  unmetered binary-streaming endpoint. Combined with C-01 (arbitrarily large objects), an
  anonymous caller can pull a 50 GB object out of a public project repeatedly and saturate
  egress. Nothing here logs who read what.
- **C-05d — the function returns `void` on success and is easy to call wrongly.** It is a
  bare `await` with no return value at `apps/api/src/index.ts:309`; a future refactor that
  drops the `await` silently disables authorization. Returning a `{allowed, reason}` (or a
  branded token the response builder requires) would make the omission a type error.

**Fix.** Take `projectId` into the target type; make publication explicit per asset (or at
minimum require an `asset:public` capability and audit the flip); do not re-point `projectId`
into a public project on move without re-confirming; add rate limiting and access logging on
the anonymous branch; make the "authorized" result unforgeable.

**Owning issue:** #8 (known item — confirm and extend with C-05a…d).

---

### C-06 — MEDIUM — `Content-Disposition` quote injection via Unicode NFKD (`＂` U+FF02)

**File:** `apps/api/src/index.ts:115-137` (`buildContentDisposition`), used at `:324-327`

```ts
const normalized = filename.normalize("NFC").replace(/[\r\n"]/g, "").trim();   // strips " ...
const asciiFallback =
  safeFilename.normalize("NFKD")                                               // ... then NFKD RE-CREATES it
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\\/]/g, "-")
    .replace(/[^\x20-\x7E]+/g, "_")   // U+0022 is inside \x20-\x7E, so it survives
    ...
return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`;
```

The `"` strip happens **before** the NFKD pass. `U+FF02 FULLWIDTH QUOTATION MARK` survives the
strip and NFKD-decomposes to `U+0022`, which then lands unescaped inside the quoted
`filename=""` parameter. Verified by executing the exact function:

```
NFKD of U+FF02 -> "\""
filename = '＂; filename=evil.html＂'
  -> attachment; filename=""; filename=evil.html""; filename*=UTF-8''%EF%BC%82%3B%20filename%3Devil.html%EF%BC%82
```

`filename` is fully attacker-controlled: it is a bare `z.string()`
(`apps/api/src/task/schema.ts:117`) written straight into `assetTable.filename` at finalize
(`apps/api/src/task/index.ts:867`, `:883`) and read back into the header at
`apps/api/src/index.ts:325`.

**Impact.** Header *parameter* injection, not full header injection — I could not reach `\r`
or `\n` (no NFKD mapping produces them, and they are stripped first), and the disposition
type token is already emitted, so `attachment` cannot be turned into `inline`. What an
attacker *can* do is emit multiple `filename=` parameters and a malformed quoted-string,
producing divergent parsing across browsers, proxies, AV scanners and download managers —
the classic "the scanner sees `a.txt`, the browser saves `evil.exe`" split. Modern browsers
prefer `filename*`, which is correctly percent-encoded, so this is a hardening defect rather
than a direct RCE — but it is a real injection into a security-relevant header from
unvalidated user input, and it is on the anonymous path (C-05).

**Fix.** Do the ASCII fold **first**, then strip; or simply reject/replace `"` and `\` in
`asciiFallback` after the NFKD pass (`.replace(/["\\]/g, "_")`). Better: validate `filename`
at finalize (length cap, no control chars) instead of accepting an unbounded `z.string()`.

**Owning issue:** NEW ISSUE.

---

### C-07 — MEDIUM — Stored asset URL is built from the `Host` header when `KANEO_API_URL` is unset

**File:** `apps/api/src/task/index.ts:899-908`

```ts
const apiBaseUrl = normalizeApiServerUrl(
  process.env.KANEO_API_URL || new URL(c.req.url).origin,
);
return c.json({ id: asset.id, url: `${apiBaseUrl}/asset/${asset.id}` }, 200);
```

`new URL(c.req.url).origin` on Hono/Node derives from the request's `Host` header. When
`KANEO_API_URL` is not set — which the docs actively encourage for the zero-config install
(`docs/05-operations/one-line-install.md:50`) — an attacker sends `Host: evil.example` to the
finalize route and receives `https://evil.example/api/asset/<id>`. The web client inserts that
URL verbatim into the task description or comment
(`apps/web/src/lib/upload-task-image.ts:75-81`), so it is **persisted into shared content**.

**Attack path.** Every teammate who later opens that task makes an outbound request to
`evil.example` — reliable per-viewer tracking (IP, UA, timing, referrer leaking the internal
task URL), and a swap-the-image / phishing primitive on an internal page. The orphan-cleanup
regex `\/api\/asset\/([a-z0-9]+)` (`storage/cleanup-assets.ts:11`) still matches the poisoned
URL, so cleanup does not flag it either.

**Fix.** Never derive a persisted absolute URL from the request. Store and emit a
**relative** `/api/asset/<id>` (the avatar code already does exactly this —
`apps/api/src/user/avatar.ts:83-85` returns `/api/user/avatar/${id}`), or require
`KANEO_API_URL` and fail closed. Add a trusted-host allowlist at the edge regardless.

**Owning issue:** #11 (deployment) for the host allowlist; NEW ISSUE for the relative-URL fix.

---

### C-08 — MEDIUM — Presigned URL is an unauthenticated, transferable write capability with an operator-unbounded TTL

**File:** `apps/api/src/storage/s3.ts:289-313`, TTL resolution `:88-92` and `:155-158`

The presign covers `bucket + key + content-type + expiry` and nothing else. It is returned to
the browser (`imageUploadSchema`, `apps/api/src/task/response.ts:186-199`) and is a **bearer
capability**: anyone who obtains it (a browser extension, a shared HAR, a proxy log, a
screenshot of devtools) can write to that key from anywhere, with no TaskDesk identity, for
the whole TTL.

- Default TTL is 300 s (`s3.ts:16`) — reasonable.
- `S3_PRESIGN_TTL_SECONDS` goes through `parsePositiveInt` (`s3.ts:88-92`), which has **no
  upper bound**. An operator can set `604800` (SigV4's 7-day max) and the code accepts it
  silently, turning every issued URL into a week-long anonymous write grant.
- Because there is no size bound (C-01) and no content-type restriction beyond the signed
  header (C-02), that grant is "write an object of any size to this tenant's bucket".

**Replay / manipulation analysis (asked explicitly).** The key *is* covered by the SigV4
signature, so a presigned URL for object A **cannot** be edited to reach object B — changing
the path invalidates the signature. Within the TTL the same URL can be replayed to
**overwrite** its own key any number of times; combined with the finalize-side update branch
(`apps/api/src/task/index.ts:858-873`, which updates an existing row matched by `objectKey`),
a user can silently swap the bytes behind an already-embedded, already-reviewed attachment.
That is a content-integrity issue, not a cross-tenant one.

**Presigned URLs bypassing app authorization (asked explicitly).** Today, no: there is no
presigned **GET** anywhere — reads always go through `getPrivateObject` (`s3.ts:338-361`) and
therefore through `authorizeAssetAccess`. That is the right design and should be stated as an
invariant, because `publicBaseUrl` (C-02) shows the temptation to break it. If #10 introduces
presigned GETs, every one of them is by construction an authorization bypass with a TTL.

**Fix.** Clamp `presignTtlSeconds` (e.g. `Math.min(parsed, 900)`); bound the write with a POST
policy (C-01); keep the no-presigned-GET invariant explicit in the storage plugin contract.

**Owning issue:** #10 (storage plugin contract) + #11 (config validation).

---

### C-09 — MEDIUM — Configuration/credential errors are reflected to the caller in the 503 body

**File:** `apps/api/src/task/index.ts:793-800`; error strings at `apps/api/src/storage/s3.ts:113-116`, `:132-136`

```ts
} catch (error) {
  throw new HTTPException(503, {
    message: error instanceof Error ? error.message : "Image uploads are not configured",
  });
}
```

The `try` block wraps `createTaskImageUploadUrl`, which calls `getStorageConfig()`,
`getClient()` (constructing the `S3Client` and resolving credentials) and `getSignedUrl()`.
Any error from that chain is returned **verbatim** to an authenticated caller. That includes:

- the deliberate config messages (harmless: they name env vars, not values);
- **AWS SDK credential-chain errors** — the C-13 fallback path. `@aws-sdk/credential-providers`
  errors routinely embed the metadata endpoint, the ECS/EKS relative URI, the profile name,
  the role ARN being assumed, or `~/.aws/config` paths. Example shapes:
  `"Could not load credentials from any providers"`, `"ECS credential provider: ... 169.254.170.2/v2/credentials/<uuid>"`,
  `"User: arn:aws:sts::123456789012:assumed-role/taskdesk-prod/i-0abc is not authorized to perform: s3:PutObject on resource: arn:aws:s3:::bucket/prefix/..."`.

**Attack path.** Any low-privileged workspace member repeatedly triggers the upload endpoint
against a broken/misconfigured instance and reads back the account id, role name, bucket ARN,
internal endpoint host and key prefix from the 503 body — a free internal-infrastructure map,
handed to whoever is probing next.

Related, lower severity: `apps/api/src/index.ts:339` (`console.error("Failed to stream asset:", error)`)
and `storage/cleanup-assets.ts:164-170` (logs every failing **object key** with the raw SDK
`reason`) put endpoints, key prefixes and error detail into logs, which on this stack go to
Sentry via the `onError` handler (`apps/api/src/index.ts:142-155`).

**Fix.** Return a fixed string (`"Image uploads are not configured on this instance"`) and log
the detail server-side only. This becomes more important, not less, once credentials live in
encrypted secret storage (#10) — a leaky error path defeats the encryption.

**Owning issue:** #10 (secret handling) + NEW ISSUE for the error-shape fix.

---

### C-10 — MEDIUM — `storage.filesystem` — the documented default — does not exist in the merged code

**File:** `apps/api/src/storage/` (only `s3.ts` and `cleanup-assets.ts`); `apps/api/src/storage/s3.ts:127-140`

The decision record is explicit: *"on a new instance the active storage plugin is
`storage.filesystem` … no storage configuration, no third hostname, no bucket"*
(`docs/07-planning/decision-log.md:509-518`), echoed at
`docs/05-operations/configuration-reference.md:118-122` and `docs/05-operations/deployment.md:18`.

The merged code has **no filesystem backend at all**. `getStorageConfig()` hard-throws unless
`S3_ENDPOINT` and `S3_BUCKET` are both set (`s3.ts:132-137`), and there is no driver
abstraction — `createTaskImageUploadUrl`, `getPrivateObject`, `deleteS3Object` and
`assertTaskImageKeyMatchesContext` each call `getStorageConfig()` directly.

**Consequence.** A fresh install per the documented default returns **503 on every
attachment upload**. The gap between docs and code is itself a security problem: an operator
following the docs believes attachments are on a local volume, discovers they are broken, and
the fast fix is to point `S3_*` at whatever bucket is nearest — typically with static keys in
plaintext env, which is exactly what #10 is trying to eliminate.

I am recording this under the storage lens because the reviewer was asked whether the current
code makes the storage decision *impossible*: for `storage.filesystem`, it is currently not
implemented, so yes.

**Fix.** Implement the filesystem driver behind a `StorageDriver` interface before claiming it
as the default, or correct the docs to say S3 is required today.

**Owning issue:** #10 (storage plugin) + #11 (deployment docs).

---

### C-11 — MEDIUM — Config is read from `process.env` at every call site: runtime plugin configuration is not reachable without refactoring, and credential rotation is silently ignored

**File:** `apps/api/src/storage/s3.ts:79-81` (`env()`), `:126-161` (`getStorageConfig`), `:172-207` (`getClient`)

The local helper is:

```ts
function env(name: string) {
  return process.env[name]?.trim() || "";
}
```
(`s3.ts:79-81`)

and `getStorageConfig()` (`s3.ts:126`) rebuilds the whole config from `process.env` on **every**
call — presign, finalize-key-check, read, delete. There is no injection point, no config
object passed in, no async resolution. Two consequences for the #10 decision (S3 values move
to runtime plugin config with credentials in encrypted secret storage):

1. **Not reachable as written.** Every consumer is a module-level function that reads globals
   synchronously. Encrypted secret storage is inherently async (decrypt, possibly fetch).
   Delivering #10 requires turning these into an injected, async-resolved `StorageDriver` —
   a real refactor of `s3.ts`, `cleanup-assets.ts`, `task/index.ts` and `index.ts`, not a
   config swap. Worth sizing now.
2. **Rotation bug, present today.** The client cache key is:
   ```ts
   const cacheKey = JSON.stringify({ endpoint, region, accessKeyId, bucket, forcePathStyle });
   ```
   (`s3.ts:173-180`) — it deliberately includes `accessKeyId` but **not** `secretAccessKey`.
   Rotating the secret while keeping the same access key id (the normal rotation pattern for
   MinIO/Garage/SeaweedFS, and for any re-issued static key) leaves the cached `S3Client`
   holding the **old secret** for the lifetime of the process. Uploads and reads keep failing
   (or keep succeeding on a credential the operator believes they revoked) until a restart.
   Under runtime plugin configuration this becomes the *primary* failure mode: an operator
   rotates a compromised credential in God Mode and the running process ignores it.

Also here: `clientCache` is a single global entry (`s3.ts:72-77`). If #10 ever allows
per-organisation storage config, this cache is a **cross-tenant client mix-up** waiting to
happen — one tenant's config evicting another's is fine, but the single-slot design means the
key must be complete, and it currently is not.

**Fix.** Hash the full credential material into the cache key (or key on a config version/
generation counter and expose an explicit `invalidateStorageClient()`); introduce the
`StorageDriver` interface with injected config before #10 lands; make the cache a keyed map
if config becomes per-tenant.

**Owning issue:** #10.

---

### C-12 — LOW — Object key construction: reviewed, no traversal found; two residual sharp edges

**File:** `apps/api/src/storage/s3.ts:209-266`, `:320-336`

I attacked this directly and could not break it. Recording the analysis so it is not re-done:

- `buildObjectKeyPrefix` (`s3.ts:228-243`) uses `sanitizePathSegment` on `workspaceId`,
  `projectId`, `taskId` — all **DB-sourced cuid2** values, not request input. The caller
  cannot choose a prefix.
- `sanitizePathSegment` (`s3.ts:209-217`) keeps `.` and does **not** collapse dots, so
  `sanitizePathSegment("..") === ".."`. That is only safe because `buildObjectKey`
  (`s3.ts:245-260`) unconditionally appends `-${timestamp}-${randomId}`, so the final segment
  can never be exactly `.` or `..`. Verified: `"../../evil.png"` → base `"..-..-evil"`, ext
  `"png"` → `..-..-evil-1757...-<cuid>.png`. No `/`, no traversal. **This is load-bearing and
  undocumented** — a future refactor that drops the suffix reintroduces traversal.
- Null bytes and full-width homoglyphs are folded by the `[^a-z0-9._-]+` replace (verified:
  `"\u0000x.png"` → `"x"`, `"ａｂ.png"` → `"file"`).
- `assertTaskImageKeyMatchesContext` (`s3.ts:320-336`) re-derives the prefix server-side and
  additionally requires the suffix to match `/^[A-Za-z0-9._-]+$/` and not start with `.` —
  correctly blocking `/`, `%2f`, and dot-files even if a gateway normalised the path. The
  comment at `:333-334` shows this was thought about. Good.
- `applyKeyPrefix` (`s3.ts:262-266`) concatenates the **operator-controlled** `S3_KEY_PREFIX`
  with a single `replace(/\/+$/, "")`. `S3_KEY_PREFIX=".."` or `"a/../b"` is accepted and
  would relocate the whole tree; not attacker-reachable, but it should be validated at
  startup (`^[A-Za-z0-9._\-/]*$`, no `..` segment) once it becomes runtime plugin config
  editable from God Mode by an org admin — at which point it *is* attacker-reachable by a
  privileged-but-not-root actor.

**Fix.** Add a unit test pinning "the generated key never contains `..` as a full segment",
and validate `keyPrefix` in `getStorageConfig`.

**Owning issue:** #10 (prefix validation); NEW ISSUE (regression test).

---

### C-13 — LOW/INFORMATIONAL — AWS default credential-provider-chain fallback: safe here, with one caveat

**File:** `apps/api/src/storage/s3.ts:94-124` (`resolveS3Credentials`), `:192-203`

The documented fallback works as described: explicit credentials only when **both** keys are
set; a hard error when exactly one is set (`s3.ts:111-117`); `undefined` when neither, letting
the SDK use instance profile / ECS task role / IRSA / env / shared config. The asymmetric-
config error is a genuinely good touch — it turns the classic "silently signs with the wrong
identity" failure into a loud one.

**Assessment: safe as a mechanism, with one deployment caveat.** On a container platform the
fallback resolves to whatever ambient identity the pod/instance carries. If that identity is
broad (a node role with `s3:*`, common on hand-rolled EKS), TaskDesk silently inherits it —
and because the key/prefix logic is entirely application-side (C-12), the *only* thing
confining TaskDesk to its own prefix is application correctness. A static key scoped to
`arn:aws:s3:::bucket/<prefix>/*` fails closed; an inherited node role does not.

Note also that `getStorageConfig()` validates credentials **eagerly** at `s3.ts:140` by calling
`resolveS3Credentials(...)` and discarding the result — so a half-configured instance throws
on the first upload, and that throw is reflected to the caller (see C-09).

**Fix.** No code change required. Document that when relying on the provider chain, the
instance/task role must be scoped to the bucket **and key prefix**, and prefer IRSA/task role
over node role. Fold this into the #11 deployment guidance.

**Owning issue:** #11 (deployment).

---

### C-14 — LOW — No image processing library anywhere (positive), and no `bodyLimit` anywhere (negative)

`grep` for `sharp|jimp|imagemagick|resize` across `apps/api/src` and `apps/api/package.json`
returns nothing. **No untrusted bytes are fed to an image codec** — the classic
ImageTragick/libwebp CVE surface is absent by construction. Worth preserving as an explicit
non-goal: if thumbnailing is ever added, it must not run in-process on unverified bytes
(see C-02 — there is no magic-byte check on attachments).

Conversely, there is **no `bodyLimit` middleware registered anywhere** in
`apps/api/src/index.ts`. The avatar route accepts a base64 blob inside a JSON body and only
checks size *after* `Buffer.from(payload, "base64")`
(`apps/api/src/user/avatar.ts:66-76`) — so a multi-hundred-MB JSON body is fully read and
decoded into heap before the 512 KB limit rejects it. Memory-amplification DoS on an
authenticated route. `app.use(compress())` (`apps/api/src/index.ts:196`) is response-side, so
it does not help.

**Fix.** `app.use(bodyLimit({ maxSize: ... }))` globally, with a tighter cap on the avatar
route; check `input.data.length` before decoding.

**Owning issue:** NEW ISSUE.

---

### C-15 — LOW — Dead storage surface: `assertStorageConfigured` and `publicBaseUrl`

**File:** `apps/api/src/storage/s3.ts:316-318`, `:42` + `:148`

- `assertStorageConfigured()` (`s3.ts:316-318`) is exported and called from **nowhere** in
  `apps/api/src`.
- `StorageConfig.publicBaseUrl` (`s3.ts:42`) is populated from `S3_PUBLIC_BASE_URL`
  (`s3.ts:148`) and read by **nothing**.

Both are kaneo carry-over. `publicBaseUrl` in particular is a loaded gun (see C-02): it is the
hook for direct-bucket serving, and its presence will read to the next engineer as
"direct serving is supported here".

**Fix.** Delete both, or wire `publicBaseUrl` with an explicit decision recorded about
content-type inertness first.

**Owning issue:** #6 (removals).

---

### C-16 — LOW — Finalize trusts and can silently re-point an existing asset row

**File:** `apps/api/src/task/index.ts:852-893`

`finalize` looks up an existing row by `objectKey` (unique — `database/schema.ts:612`) and, if
found, **updates** `workspaceId`, `projectId`, `taskId`, `filename`, `mimeType`, `size`,
`kind`, `surface` and `createdBy`. Because `assertTaskImageKeyMatchesContext` already pins the
key to the current task's prefix, I could not turn this into a cross-tenant re-point — the
prefix encodes workspace/project/task and all three are cuid2 (no sanitisation collision).

What it *does* allow, for any user with `task:update` on the same task: rewriting another
user's attachment metadata — including reassigning `createdBy` to themselves, changing the
displayed `filename`, and (with C-08's replay) swapping the bytes. There is no audit record of
the change. Attribution on attachments is therefore not trustworthy.

**Fix.** Reject finalize when a row already exists for the key and `createdBy` differs (or
when it exists at all — the presign always mints a fresh key with a cuid2 suffix, so a
pre-existing row is already anomalous). Never overwrite `createdBy`.

**Owning issue:** NEW ISSUE.

---

## Answers to the ten posed questions

1. **Upload authorization** — Sound. `workspaceAccess.fromTask()` +
   `requireWorkspacePermission({task:["update"]})` (`task/index.ts:463-467`), and the
   middleware breaks on the first resolved source (`workspace-access-middleware.ts:109-110`),
   so the `?workspaceId=` fallback cannot override the task lookup. The project/workspace used
   for the key comes from the DB (`task/index.ts:764-780`), not the request. Checked
   **before** the presign is issued. No finding.
2. **Object key construction** — Not user-influenceable for the prefix; filename contributes
   only a sanitised, suffix-appended leaf. See **C-12** for the two residual sharp edges
   (undocumented load-bearing suffix; unvalidated `S3_KEY_PREFIX`).
3. **Path traversal** — None found on the S3 path (verified by executing the sanitiser against
   `../`, `%2f`, `\0`, full-width homoglyphs and `..`). No filesystem storage path exists to
   test — see **C-10**.
4. **Signed URLs** — Presign covers bucket+key+content-type+expiry; a URL for object A cannot
   be manipulated to reach object B. TTL default 300 s but operator-unbounded. Presigned URLs
   do **not** currently bypass app authorization because there are no presigned GETs — reads
   go through `getPrivateObject` → `authorizeAssetAccess`. See **C-08**.
5. **Cross-tenant object access** — Query at `apps/api/src/index.ts:288-303`, authorization at
   `:309` → `authorize-asset-access.ts:20-29` → `validate-workspace-access.ts:5-58`. A user of
   tenant A **cannot** fetch tenant B's asset by id (workspace membership is checked) or by key
   (there is no key-addressed read route). But: instance `admin` reads everything unlogged
   (**C-04**), any scoped API key reads everything in the owner's workspaces (**C-03**), any
   workspace member reads every project in the workspace (**C-04**), and anyone at all reads
   assets whose project is public (**C-05**).
6. **MIME and content handling** — Content-type is entirely client-supplied and unvalidated
   server-side (**C-02**). Stored XSS from the app's own origin is currently **prevented** by
   the allowlist + `nosniff` + forced `attachment` at `apps/api/src/index.ts:314-334` — that
   code is correct and should be protected by a test. `Content-Disposition` itself is
   injectable (**C-06**).
7. **Size limits and DoS** — `S3_MAX_IMAGE_UPLOAD_BYTES` is enforced against a client-claimed
   number only and is unenforceable on a presigned PUT (**C-01**). No global `bodyLimit`;
   avatar base64 is decoded before its size check (**C-14**). No rate limiting on the
   anonymous asset read (**C-05c**).
8. **Image processing** — None. No `sharp`/`jimp`/native codec anywhere (**C-14**, positive).
9. **S3 configuration and secrets** — Credential fallback is correctly implemented and safe as
   a mechanism, with an IAM-scoping caveat (**C-13**); config is `process.env`-bound at every
   call site, which blocks #10 and breaks secret rotation (**C-11**); credential/endpoint
   detail leaks to callers in 503 bodies and to Sentry in logs (**C-09**).
10. **Anonymous branch** — **Confirmed** at `authorize-asset-access.ts:23-25`; the docstring's
    reasoning is correct but the flag is project-scoped and retroactive, and reachable by task
    move. Four additional defects in the same file: **C-05a** (type omits `projectId`, making
    project-level authz impossible), **C-05b** (truthy test on a nullable field, fails open),
    **C-05c** (no rate limit, no access log on an unauthenticated binary endpoint),
    **C-05d** (`Promise<void>` contract — a dropped `await` silently disables authorization).

## Verdict on the storage decision (#10)

- **S3 values → runtime plugin config:** currently **not reachable without refactoring**.
  `getStorageConfig()` reads `process.env` synchronously on every call from four modules
  (**C-11**); encrypted secret storage is async. Budget a `StorageDriver` interface, not a
  config swap. Also fix the cache key before rotation is exposed in God Mode — today rotating
  a secret while keeping the access key id is a no-op until restart.
- **Credentials in encrypted secret storage:** undermined today by **C-09** — credential-chain
  and authorization errors are reflected verbatim to any authenticated caller. Encrypting the
  store while the error path narrates the role ARN and endpoint is not a net win.
- **Fresh installs default to `storage.filesystem`:** **impossible as merged** — the driver
  does not exist (**C-10**). Attachments 503 on the documented default install.
- **If direct-bucket / `files.<domain>` serving ships** (the `publicBaseUrl` hook, **C-15**),
  **C-02** becomes stored XSS on the files origin on day one. Fix the content-type allowlist
  and set `ContentDisposition: attachment` on the stored object *before* that lands.

## Suggested triage order

1. **C-01** (unbounded write to the bucket) — HIGH, exploitable by the lowest role today.
2. **C-03** (API-key scopes ignored on asset reads) — HIGH, silent scope-confinement bypass.
3. **C-02** (arbitrary content-type stored) — HIGH, latent XSS gated only on a future feature.
4. **C-05 / C-04** (anonymous + workspace-wide asset exposure) — the authz model, issue #8.
5. **C-10 / C-11** (filesystem driver, runtime config) — blocks #10.
6. **C-06, C-07, C-09, C-14, C-16** — MEDIUM/LOW hardening.
7. **C-15** — #6 removals.
