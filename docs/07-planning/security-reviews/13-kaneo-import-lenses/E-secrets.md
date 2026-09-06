# PR #13 Security Review — Lens E: Secrets, Credentials, Logging + Inherited Attack Surface

Reviewer: independent post-merge review. Repo: /home/ubuntu/ticketing.v2 (main, merged).
Scope restriction honoured: only /home/ubuntu/ticketing.v2 was read.

STATUS: IN PROGRESS

---

## HALF 1 — SECRETS, CREDENTIALS AND LOGGING

### E-1. CRITICAL — Empty-string auth secret default lets better-auth fall back to its publicly-known constant `better-auth-secret-12345678901234567890`

**File:** `/home/ubuntu/ticketing.v2/apps/api/src/auth.ts:202`, guard at `:100-107`
**Owning issue:** NEW ISSUE (blocker) — hardening, not a #6 removal.

```ts
// apps/api/src/auth.ts:100-107
if (
  process.env.TASKDESK_AUTH_SECRET &&
  process.env.TASKDESK_AUTH_SECRET.length < 32
) {
  console.error("TASKDESK_AUTH_SECRET is less than 32 characters, please generate a new one.");
  process.exit(1);
}
...
// apps/api/src/auth.ts:202
  secret: process.env.TASKDESK_AUTH_SECRET || "",
```

The length guard is gated on the variable **being set**. If `TASKDESK_AUTH_SECRET` is *absent* the guard is a no-op and `""` is handed to better-auth. Tracing the vendored better-auth 1.6.25:

```js
// better-auth/dist/context/create-context.mjs:70-79
const legacySecret = options.secret || env.BETTER_AUTH_SECRET || env.AUTH_SECRET || "";
...
  secret = legacySecret || "better-auth-secret-12345678901234567890";
  validateSecret(secret, logger);

// create-context.mjs:38-44
function validateSecret(secret, logger) {
  const isDefaultSecret = secret === DEFAULT_SECRET;
  if (isTest()) return;
  if (isDefaultSecret && isProduction) throw new BetterAuthError(...);
  if (!secret) throw new BetterAuthError(...);
  if (secret.length < 32) logger.warn(...);   // WARN ONLY
```

and `isProduction` is a **module-load-time constant**:

```js
// @better-auth/core/dist/env/env-impl.mjs:30-32
const nodeENV = env.NODE_ENV ?? "";
const isProduction = nodeENV === "production";
```

**Impact.** On any deployment where `NODE_ENV` is not *literally* `production` — running `node apps/api/dist/index.js` outside the shipped image, a compose/Helm override, a bare-metal systemd unit, anyone who runs the API from source — the instance boots happily and signs **every session cookie, every email-OTP / magic-link token and every better-auth-encrypted value** with a constant published in better-auth's own source. An attacker who knows the product (i.e. anyone reading this repo) can mint a valid session cookie for any `userId`, including the instance admin, with zero interaction. This is complete authentication bypass. TaskDesk ships one image to every customer, so the blast radius is "every self-hosted instance whose operator did not set NODE_ENV".

Secondary defects in the same code:
- The app's own `>= 32` guard never fires for `BETTER_AUTH_SECRET` / `AUTH_SECRET`, which better-auth *also* honours (`create-context.mjs:70`). A 4-character `AUTH_SECRET` is accepted with a log warning.
- `secret.length < 32` inside better-auth is only a `logger.warn`, never fatal.

**Fix.** Fail closed at boot, unconditionally, before `betterAuth()` is constructed:
```ts
const authSecret = process.env.TASKDESK_AUTH_SECRET ?? "";
if (authSecret.length < 32) {
  console.error("TASKDESK_AUTH_SECRET must be set to >= 32 random characters (openssl rand -base64 32).");
  process.exit(1);
}
```
and pass `secret: authSecret` (never `|| ""`). Do not rely on `NODE_ENV`. Add a startup assertion that `secret !== "better-auth-secret-12345678901234567890"`. Add a boot test asserting the process exits when the variable is unset.

### E-2. NO REAL COMMITTED CREDENTIALS FOUND (verified)

A targeted scan with anchored patterns:

```
grep -rnE "(\bsk_(live|test)_|\bpk_(live|test)_|\bAKIA[0-9A-Z]{16}|\bghp_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bxox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY)" .
```
returns exactly **one** hit, and it is **NOT a credential**:

- `/home/ubuntu/ticketing.v2/tests/api/plugins/github/utils/resolve-private-key.test.ts:5-9`
  ```ts
  const PEM = [
    "-----BEGIN RSA PRIVATE KEY-----",
    "MIIEpAIBAAKCAQEA",
    "abc",
    "-----END RSA PRIVATE KEY-----",
  ].join("\n");
  ```
  The body is the 16 literal characters `MIIEpAIBAAKCAQEA` plus `abc` — the standard DER prefix and filler. **Not a key. Do not rotate anything.**

The only `.env*` file in the tree is `/home/ubuntu/ticketing.v2/apps/api/.env.test.example` (an example). `charts/taskdesk/values.yaml` was checked separately (see E-8).

**Verdict: no rotation is required from this review.** Any claim to the contrary should be checked against the exact grep above.

---

### E-3. MEDIUM — Integration-secret encryption key is an unsalted single-round SHA-256 of an arbitrary operator string

**File:** `/home/ubuntu/ticketing.v2/apps/api/src/notification-preferences/secrets.ts:13-20`
**Owning issue:** NEW ISSUE (crypto hardening) — or #11 deployment for the key-format requirement.

```ts
function getSecretEncryptionKey() {
  const rawKey = process.env.TASKDESK_ENCRYPTION_KEY?.trim();
  if (!rawKey) return null;
  return createHash("sha256").update(rawKey).digest();
}
```

**What is done right** (state this plainly so it is not re-litigated): the scheme *is* authenticated encryption — `aes-256-gcm`, a **fresh 12-byte `randomBytes` IV per encryption** (`:66`), and the GCM auth tag is stored and verified (`:76`, `:103`). Format `enc:v1:<iv>.<tag>.<ct>` in base64url. IV reuse is not a defect here.

**The defects:**

1. **No KDF.** `sha256(passphrase)` is one round, unsalted. A self-hosted operator will type a memorable string (that is what a plain `TASKDESK_ENCRYPTION_KEY=` prompt invites). Anyone who exfiltrates the database can brute-force that passphrase offline at GPU speed and decrypt every ntfy token, Gotify token and outbound webhook secret. There is **no minimum length or entropy check** anywhere — `TASKDESK_ENCRYPTION_KEY=x` is accepted.
2. **No AAD binding.** `createCipheriv` is called without `setAAD`. Ciphertexts are freely portable between rows, columns and users: anyone with DB write access can move user A's `webhookSecret` blob into user B's row, or into the `ntfyToken` column, and it decrypts cleanly. Bind `userId` + column name as AAD.
3. **Not validated at boot.** The key is only required at write time (`requireSecretEncryptionKey` throws `HTTPException(500)`), so a misconfigured instance fails as a runtime 500 on a user action instead of refusing to start.
4. **Rotation is silently destructive.** `encryptSecret:62` calls `isValidEncryptedSecret` → `decryptSecret`. After a key change the old ciphertext fails to decrypt, `isValidEncryptedSecret` returns `false`, and the function then **encrypts the old ciphertext string as if it were the plaintext secret**, permanently double-wrapping an unrecoverable value. The `v1` in the prefix is never used to select a key.
5. **Legacy plaintext is never migrated.** `decryptSecret:84` returns any non-`enc:v1:`-prefixed value verbatim. Rows written by the kaneo-era code (plaintext) stay plaintext in the database forever; nothing re-encrypts them.

**Fix.** Require a 32-byte key supplied as base64/hex and reject anything else at boot (`TASKDESK_ENCRYPTION_KEY` → `Buffer.from(v,"base64")`, assert `length === 32`); or, if a passphrase must be supported, derive with `scrypt`/`argon2id` and a per-install salt. Add `cipher.setAAD(Buffer.from(\`${userId}:${column}\`))`. Validate at startup, not at first write. Make `encryptSecret` refuse to re-encrypt an `enc:` string it cannot decrypt (throw, do not wrap). Add a one-shot migration that encrypts legacy plaintext rows.

### E-4. LOW — Masked secret preview leaks the first and last 4 characters of the plaintext

**File:** `/home/ubuntu/ticketing.v2/apps/api/src/notification-preferences/service.ts:103-106`
```ts
function maskValue(value: string | undefined | null): string | null {
  if (!value) return null;
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "••••";
}
```
Returned as `maskedNtfyToken` / `maskedGotifyToken` / `maskedWebhookSecret`. Scope is the caller's own preferences, so this is minor, but for structured tokens (`tk_`-style ntfy tokens) the prefix is exactly the part that identifies the token, and 8 known characters materially shortens a brute force. The rest of `response.ts` is well designed — it returns `*Configured` booleans and never the secret itself. Prefer a fixed-width `••••` or last-4-only. **Owning issue:** NEW ISSUE (low, batch with E-3).

---

### E-5. GOOD (no finding) — the database-config logging path deliberately splits the password out

`/home/ubuntu/ticketing.v2/apps/api/src/database/resolve-database-url.ts:38-50` builds a separate `logConfig` containing only `{source, host, port, database, username}`, and `/home/ubuntu/ticketing.v2/apps/api/src/database/prepare-database-startup.ts:31,36,47` logs **only** `config.logConfig`, never `config.connectionString`. The thrown messages at `:39` and `:50` interpolate host/port/database only. This is correct and should not be "fixed".

### E-6. MEDIUM — a malformed `TASKDESK_DATABASE_URL` prints the full DSN, password included, to stdout

**File:** `/home/ubuntu/ticketing.v2/apps/api/src/database/prepare-database-startup.ts:22-24`, via `resolve-database-url.ts:36`
**Owning issue:** NEW ISSUE (or fold into #11 deployment).

```ts
// prepare-database-startup.ts:21-29
try {
  config = resolveConfig();
} catch (error) {
  logError("❌ Database configuration failed", error);   // <-- raw error
```
`resolveConfig` → `toResolvedConfig` → `new URL(connectionString)` (`resolve-database-url.ts:36`). Node's `ERR_INVALID_URL` **carries the offending string on `error.input`**, and `console.error` renders an Error's own enumerable properties. Verified in this environment:

```
$ bun -e "try{new URL('postgresql://user:sup3rs3cr3t@ho st:5432/db')}catch(e){console.error('input prop =', e.input)}"
input prop = postgresql://user:sup3rs3cr3t@ho st:5432/db
```

**Impact.** One typo in `TASKDESK_DATABASE_URL` (a space, an unescaped `@`, a stray character in a generated password) writes the complete database password into container stdout — which on a self-hosted box goes to the Docker json log, journald, and any shipped log aggregator, and is exactly the artefact users paste into a support issue. `getDerivationSignal()`'s `POSTGRES_HOST` path is equally exposed (host is not encoded, `:75`).

**Fix.** Catch and redact:
```ts
} catch (error) {
  logError("❌ Database configuration failed", error instanceof Error ? error.message : "invalid configuration");
```
and in `toResolvedConfig`, wrap `new URL()` so the rethrown error never carries the input:
```ts
let url: URL;
try { url = new URL(connectionString); }
catch { throw new Error(`Invalid ${source}: could not be parsed as a PostgreSQL URL`); }
```

---

### E-7. HIGH — Helm chart ships a known default PostgreSQL password, in plaintext, as a pod env var

**Files:** `/home/ubuntu/ticketing.v2/charts/taskdesk/values.yaml:38`, `/home/ubuntu/ticketing.v2/charts/taskdesk/templates/postgresql-deployment.yaml:36-43`, `/home/ubuntu/ticketing.v2/charts/taskdesk/templates/deployment.yaml:56-63, 86`
**Owning issue:** #11 deployment.

```yaml
# values.yaml:35-38
  auth:
    database: taskdesk
    username: taskdesk_user
    password: taskdesk_password     # <-- shipped default
```
Used directly:
```yaml
# postgresql-deployment.yaml:36-43
            - name: POSTGRES_PASSWORD
              ...
              value: {{ .Values.postgresql.auth.password }}
```
and inlined into the app's DSN at `deployment.yaml:86`.

**This is a default credential, not a leaked one** — nothing needs rotating in Anthropic/TaskDesk infrastructure. But it is worse than a leaked secret operationally: **every `helm install` that does not override it produces a database whose password is `taskdesk_password`**, and TaskDesk ships one chart to every customer. Any pod in the namespace/cluster, any `kubectl get pod -o yaml`, and any misconfigured NetworkPolicy reaches a database whose password is in this repository.

Three separate problems in the same template:
1. The default value exists at all. `authSecret` is correctly forced empty and validated (`templates/validations.yaml:2-3` `fail`s if it is absent or < 32 chars); `postgresql.auth.password` gets no such treatment.
2. Both the Postgres password and, when `existingSecret.enabled: false`, **`TASKDESK_AUTH_SECRET` itself** (`deployment.yaml:63`) are emitted as literal `value:` env vars in the Deployment spec rather than as a `Secret` + `secretKeyRef`. Plaintext in `kubectl describe deployment`, in the Helm release object, and in any GitOps repo the rendered manifest is committed to.
3. `deployment.yaml:80` and `:86` interpolate the DB password into a full DSN as a plain `value:`, so the whole connection string is readable from the pod spec.

**Fix.** Set `postgresql.auth.password: ""` and extend `templates/validations.yaml` to `fail` when `postgresql.enabled` and neither `auth.password` nor `auth.existingSecret` is set. Generate a `Secret` in the chart for `TASKDESK_AUTH_SECRET`, `POSTGRES_PASSWORD` and `TASKDESK_DATABASE_URL` and reference it via `secretKeyRef` in every branch.

### E-8. MEDIUM — `TASKDESK_ENCRYPTION_KEY` does not exist anywhere in the Helm chart

**Files:** `/home/ubuntu/ticketing.v2/charts/taskdesk/values.yaml`, `templates/deployment.yaml` (absent)
**Owning issue:** #11 deployment.

`grep -rn "ENCRYPTION" charts/taskdesk/` returns nothing. Every Helm-deployed instance therefore has `TASKDESK_ENCRYPTION_KEY` unset, and `requireSecretEncryptionKey()` (`apps/api/src/notification-preferences/secrets.ts:22-32`) throws `HTTPException(500)` the first time a user saves an ntfy/Gotify token or a webhook secret. The failure mode is a 500 on a user action with no operator-visible cause. Add it to `values.yaml` (empty default), to the generated Secret, and to `validations.yaml` alongside `authSecret`.

### E-9. HIGH (build/CI) — `Dockerfile.kaneo` COPYs three files PR #13 never imported; the image cannot be built

**File:** `/home/ubuntu/ticketing.v2/Dockerfile.kaneo:104-107`
**Owning issue:** #10 CI (with a #11 deployment follow-up).

```dockerfile
COPY --chown=appuser:appuser apps/web/nginx.kaneo.conf /etc/nginx/conf.d/default.conf
COPY --chown=appuser:appuser apps/web/env.sh /docker-entrypoint.d/env.sh
COPY --chown=appuser:appuser deploy/kaneo-entrypoint.sh /usr/local/bin/kaneo-entrypoint.sh
```
None of the three exists:
```
$ ls apps/web/env.sh deploy/kaneo-entrypoint.sh apps/web/nginx.kaneo.conf
ls: cannot access 'apps/web/env.sh': No such file or directory
ls: cannot access 'deploy/kaneo-entrypoint.sh': No such file or directory
ls: cannot access 'apps/web/nginx.kaneo.conf': No such file or directory
$ git log --all -- apps/web/env.sh deploy/kaneo-entrypoint.sh     # empty: never committed
```

**Why this is a security finding, not just a build break.** `Dockerfile.kaneo:110` (`ENV NODE_ENV=production`) is the *only* thing in the repository that sets `NODE_ENV`, and it is the sole mitigation standing between E-1 (default auth secret) and E-10 (wildcard CORS with credentials) and a live instance. Because the image cannot be built, **that mitigation is currently unreachable** — every operator today is running the API some other way, with `NODE_ENV` unset, i.e. in exactly the state where both defects are active. Do not treat E-1/E-10 as "mitigated by the Dockerfile".

It also means the front-end runtime-env substitution mechanism referenced by `apps/web/src/instrument.ts:5` ("skip init if env.sh never replaced the `KANEO_SENTRY_DSN` placeholder") no longer exists, and the guard on the next line checks a **different** prefix (`dsn.startsWith("TASKDESK_")`) than the placeholder the comment names (`KANEO_SENTRY_DSN`) — a stale, non-functional guard.

**Fix.** Either import the three missing files, or (preferred, since #6 deletes the Sentry/Turnstile substitution anyway) rewrite the runtime stage without `env.sh` and add a `docker build` job to CI so this can never merge again.

### E-10. HIGH — CORS reflects **any** origin with `credentials: true` whenever `NODE_ENV` is not literally `"production"`

**File:** `/home/ubuntu/ticketing.v2/apps/api/src/index.ts:165, 173-189`
**Owning issue:** NEW ISSUE (blocker), sibling of E-1.

```ts
const reflectUnconfiguredOrigins = process.env.NODE_ENV !== "production";
...
  cors({
    credentials: true,
    origin: (origin) => {
      // Reflecting an arbitrary origin alongside credentials lets any site
      // read authenticated responses, so it stays a development convenience.
      if (!corsOrigins) {
        return reflectUnconfiguredOrigins ? origin || "*" : null;
      }
```

The comment states the risk correctly and then ships it anyway behind a **negative** `NODE_ENV` test. `NODE_ENV` unset → `undefined !== "production"` → true → any origin is reflected back with `Access-Control-Allow-Credentials: true`. Any web page the victim visits can then issue credentialed cross-origin requests and **read** the responses: every task, comment, attachment URL, workspace member list, and the user's own API keys.

The trigger is not exotic: `NODE_ENV` is set in exactly one place in this repo (`Dockerfile.kaneo:110`) and that Dockerfile does not build (E-9). Note also the fallback only applies when `CORS_ORIGINS` **and** `TASKDESK_AGENT_URL` are both unset — which is the documented same-origin bundled-image configuration, so it is the *default* posture, not an edge case.

**Fix.** Invert the default: refuse unconfigured origins always, and make the reflecting behaviour require an explicit, loudly-named opt-in (`TASKDESK_DEV_ALLOW_ANY_ORIGIN=true`) that is never set by any shipped artefact. Never key security behaviour off `NODE_ENV !== "production"`; if `NODE_ENV` must be consulted, test `=== "development"` so an unset value fails closed.

### E-11. MEDIUM — raw driver/validation error messages returned to clients

**Files:**
- `/home/ubuntu/ticketing.v2/apps/api/src/task/controllers/import-tasks.ts:135` — `error: error instanceof Error ? error.message : "Unknown error"` returned per-row inside a **200** body
- `/home/ubuntu/ticketing.v2/apps/api/src/github-integration/controllers/import-issues.ts:147,183`
- `/home/ubuntu/ticketing.v2/apps/api/src/gitea-integration/controllers/import-gitea-issues.ts:81,139,179`
- `/home/ubuntu/ticketing.v2/apps/api/src/gitea-integration/controllers/create-gitea-integration.ts:79` — `message: error.message` from a remote Gitea API error
- `/home/ubuntu/ticketing.v2/apps/api/src/github-integration/controllers/verify-github-installation.ts:80,116` — `` `Failed to verify GitHub installation: ${(error as Error).message}` ``

**Owning issue:** #6 removals covers the github/gitea files (those routers are being deleted). `import-tasks.ts` is **NOT** covered — that is core task import and stays. Raise it as a NEW ISSUE.

The bulk-import loop catches anything that is not an `HTTPException` and echoes `error.message` verbatim. A `pg`/Drizzle failure therefore surfaces to any authenticated user as e.g. `duplicate key value violates unique constraint "task_pkey"` or `invalid input syntax for type timestamp with time zone: "..."` — leaking table names, constraint names and column types. `import-tasks` accepts user-controlled field values, so an attacker can deliberately provoke type errors to map the schema.

**Note the global handler is correct** and should not be changed: `apps/api/src/index.ts:142-153` returns `{ message: "Internal Server Error" }` for every non-`HTTPException`. The leak is in the handlers that swallow the error before it reaches `onError`.

**Fix.** In each catch, log the real error server-side and return a fixed string (`"Failed to import task"`) plus a correlation id.

---

## HALF 2 — INHERITED ATTACK SURFACE **NOT** ON ISSUE #6's LIST

### E-12. HIGH — `openAPI()` mounts two unauthenticated diagnostic routes, one of which pulls an unpinned third-party script into the API origin

**File:** `/home/ubuntu/ticketing.v2/apps/api/src/auth.ts:553` (`openAPI(),` in the plugin array)
**Owning issue:** NEW ISSUE — **add to #6's removal list**, it is not there today.

`openAPI()` is called with no options. From the vendored plugin (`better-auth/dist/plugins/open-api/index.mjs:43-59`):

```js
const path = options?.path ?? "/reference";
  generateOpenAPISchema: createAuthEndpoint("/open-api/generate-schema", { method: "GET" }, ...)
  openAPIReference: createAuthEndpoint(path, { method: "GET", metadata: HIDE_METADATA }, async (ctx) => {
    if (options?.disableDefaultReference) throw new APIError("NOT_FOUND");
```

Neither endpoint carries a session requirement. On every TaskDesk instance this exposes:

1. **`GET /api/auth/open-api/generate-schema`** — unauthenticated. Returns the complete generated OpenAPI document for the auth surface, which enumerates every enabled plugin and endpoint: anonymous/guest sign-in, `magic-link`, `email-otp`, `device`, `api-key`, `organization`, `admin`. Free reconnaissance telling an attacker exactly which of the still-present kaneo auth paths this instance will accept, before they try anything.
2. **`GET /api/auth/reference`** — unauthenticated HTML that ends with
   ```html
   <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
   ```
   **Unversioned, third-party, and loaded into the API's own origin** — the origin that holds the session cookie. A jsDelivr compromise or a malicious `@scalar/api-reference` release executes attacker JS same-origin with the authenticated API for anyone who opens that URL. It also breaks silently on an air-gapped or egress-filtered install, and it is an outbound third-party request from a product that promises no phone-home.

**Fix.** Delete `openAPI()` from the plugin array. If an auth API reference is wanted for developers, generate it at build time into the docs site, or at minimum pass `{ disableDefaultReference: true }` and put the schema endpoint behind an instance-admin check. Add `/api/auth/reference` and `/api/auth/open-api/generate-schema` to whatever route-inventory test #10 CI grows.

### E-13. HIGH — Unauthenticated first-run instance takeover, advertised by a public status oracle

**Files:** `/home/ubuntu/ticketing.v2/apps/api/src/auth.ts:596-602, 630-668, 715-716, 723-733, 757-758`; `/home/ubuntu/ticketing.v2/apps/api/src/index.ts:204-222`; `/home/ubuntu/ticketing.v2/apps/api/src/instance/controllers/get-instance-status.ts`
**Owning issue:** NEW ISSUE (not on #6's list — #6 removes *anonymous* sign-in, which is a different mechanism).

Every registration control in `auth.ts` is bypassed while the user table is empty:

```ts
// auth.ts:596-602 (databaseHooks.user.create.before)
const [userCountRow] = await db.select({ value: count() }).from(schema.userTable);
const existingUserCount = userCountRow?.value ?? 0;
if (existingUserCount === 0) {
  return;                                   // checkRegistrationAllowed skipped entirely
}

// auth.ts:715-716 (hooks.before, /sign-up/email)
if (isPasswordRegistrationDisabled && !isInstanceAdminSetup) { ... }   // skipped

// auth.ts:757-758
if (!isRegistrationDisabled || isInstanceAdminSetup) { return; }        // skipped
```
and `databaseHooks.user.create.after` (`:648-663`) then promotes that user to `role: "admin"`.

**There is no out-of-band bootstrap secret.** A freshly started instance with the *most locked-down* configuration the product offers — `DISABLE_REGISTRATION=true` **and** `DISABLE_PASSWORD_REGISTRATION=true` — will still hand instance-admin to whoever POSTs `/api/auth/sign-up/email` first. On a self-hosted box the operator typically starts the stack, then goes to set up DNS/TLS/reverse proxy; the window is minutes to hours and internet-reachable the whole time.

**And the window is publicly advertised.** `index.ts:204-222` registers `GET /api/instance/status` with `security: []` and the description *"Public instance setup status. When hasUsers is false the next signup becomes the instance admin."*:
```ts
return { hasUsers: (totalRow?.value ?? 0) > 0, hasAdmin: (adminRow?.value ?? 0) > 0 };
```
An attacker scanning for TaskDesk instances gets a boolean that says "this one is claimable right now" — no auth, no rate limit (rate limiting is off self-hosted, `auth.ts:569`). This is the same class that made Grafana and Jenkins require a filesystem-side setup token.

**Related, same code path — a permanent lockout (MEDIUM):** the guest/`anonymous()` plugin is **on by default** (`auth.ts:279`, `process.env.DISABLE_GUEST_ACCESS !== "true"` — another negative env check that fails open). Anonymous sign-in inserts a real `user` row. If any guest signs in before the operator registers, `totalUserCount === 1` is consumed by the guest, the guest is explicitly skipped from promotion (`:625-628`), and the operator's later signup sees `totalUserCount === 2` — so **the instance can never get an admin**, and there is no recovery path short of SQL.

**Fix.** Print a one-time random bootstrap token to the container log at first start and require it on the admin-bootstrap signup (`x-taskdesk-setup-token`), or require `TASKDESK_INITIAL_ADMIN_EMAIL` and only allow the bootstrap for that address. Stop exposing `hasUsers`/`hasAdmin` unauthenticated — the login page only needs "is setup complete", and even that is a scanning aid. Exclude anonymous rows from the count that gates the bootstrap.

### E-14. HIGH (removal hazard) — deleting `plugins/generic-webhook` for #6 silently removes the only SSRF guard on core notification delivery

**Files:** `/home/ubuntu/ticketing.v2/apps/api/src/notification-preferences/delivery.ts:14,286,315,359` and `/home/ubuntu/ticketing.v2/apps/api/src/notification-preferences/service.ts:11,332,350,368`
**Owning issue:** #6 removals — **this is a precondition on the generic-webhook deletion, add it to the issue.**

```ts
// notification-preferences/delivery.ts:14
import { assertPublicWebhookDestination } from "../plugins/generic-webhook/config";
```

`notification-preferences` is **core, retained** functionality: a user sets an ntfy server URL, a Gotify server URL and an arbitrary outbound webhook URL, and the API fetches them server-side. The only thing stopping that from being a full SSRF primitive into the operator's internal network (cloud metadata at `169.254.169.254`, the Postgres/Valkey pods, the admin interfaces on the same LAN) is `assertPublicWebhookDestination` — which lives inside `apps/api/src/plugins/generic-webhook/`, one of the six integration routers issue #6 is going to delete.

Delete that directory without moving the helper and every ntfy/Gotify/webhook URL becomes unvalidated. The failure is silent at review time (TypeScript will catch the import, someone will "fix" it by deleting the call).

**Fix.** Move `assertPublicWebhookDestination` to `apps/api/src/utils/` (next to the existing `assert-public-destination.ts`, which it wraps) **before** the plugin directory is removed, and add a test that asserts an ntfy URL of `http://169.254.169.254/` is rejected.

Two residual weaknesses in the guard itself (`apps/api/src/utils/assert-public-destination.ts:88-113`), worth a LOW follow-up:
- **TOCTOU / DNS rebinding.** `await lookup(url.hostname, {all:true})` validates the addresses, then `fetch()` resolves the name again. A hostname with a 1-second TTL that answers public-then-private defeats it. Pin the validated IP and connect to it with a `Host:` header, or use a socket-level `lookup` hook.
- `KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS` (`:82-84`) is an all-or-nothing kill switch for the whole SSRF guard, and it still carries the un-rebranded `KANEO_` prefix. Self-hosted operators legitimately need internal ntfy servers, so replace the boolean with an explicit CIDR/host allowlist.

### E-15. MEDIUM — `DEMO_MODE`: a hardcoded vendor hostname compiled into every customer's web bundle, plus a dead parallel API flag

**Files:** `/home/ubuntu/ticketing.v2/apps/web/src/constants/urls.ts:1`, `/home/ubuntu/ticketing.v2/apps/web/src/components/common/layout.tsx:70`, `/home/ubuntu/ticketing.v2/apps/web/src/components/demo-alert.tsx`, `/home/ubuntu/ticketing.v2/apps/api/src/utils/get-settings.ts:15`, `/home/ubuntu/ticketing.v2/apps/api/src/config/response.ts:9`
**Owning issue:** NEW ISSUE — **`DEMO_MODE` / demo-alert is not on the #6 list I was given.**

```ts
// apps/web/src/constants/urls.ts — the entire file
export const isDemoMode = window.location.hostname === "demo.taskdesk.app";
```

Every self-hosted customer ships a bundle that branches on **the vendor's own hostname**. Two problems:
1. **Two mechanisms, one dead.** The API exposes `isDemoMode: process.env.DEMO_MODE === "true"` through the *public* config endpoint (`get-settings.ts:15`, surfaced in `config/response.ts:9`), but the web app never reads it — it uses the hostname instead. So `DEMO_MODE` is an env var that publicly advertises a mode which does nothing, and the mode that *does* something cannot be turned on or off by any operator.
2. **De-branding / provenance leak.** A hostname literal for a vendor property has no business in a self-hosted artefact, and it is the sort of thing that quietly re-enables demo behaviour if TaskDesk ever hosts a demo under that name.

**Fix.** Delete `apps/web/src/constants/urls.ts`, `demo-alert.tsx`, its use at `layout.tsx:70`, and `isDemoMode` from `get-settings.ts` + `config/response.ts`. Add a CI grep that fails on `taskdesk.app` / `kaneo.app` literals in `apps/web/src` and `apps/api/src`.

### E-16. MEDIUM — `/api/openapi` is unauthenticated and defaults its advertised server URL to the vendor's cloud

**File:** `/home/ubuntu/ticketing.v2/apps/api/src/index.ts:402-419`
**Owning issue:** NEW ISSUE.

```ts
  api.get("/openapi", (c) => {
    const document = api.getOpenAPI31Document({
      ...
      servers: [{ url: normalizeApiServerUrl(process.env.KANEO_API_URL || "https://cloud.taskdesk.app"), description: "TaskDesk API Server" }],
```

Two defects:

1. **Unauthenticated.** The route is registered at line 402; the app-wide auth middleware is registered at line 543 (`api.use("*", ...)`). Hono composes matched handlers **in registration order**, and this handler returns without calling `next()`, so the middleware registered later never runs. The complete ~120-route API description — every path, parameter and schema — is world-readable on every instance. (Same holds for `/api/health`, `/api/instance/status`, `/api/public-project/:id`, `/api/invitation/public/:id`, `/api/config`, `/api/asset/{id}`, `/api/user/avatar/{id}` and the two webhook receivers. Most of those are deliberate and declare `security: []`; `/api/openapi` declares nothing, which suggests the exposure is accidental rather than chosen.)
2. **Vendor-cloud fallback.** When `KANEO_API_URL` is unset — which, given E-9, is the state of any instance not built from the broken Dockerfile — a **self-hosted** instance publishes a spec whose `servers[0].url` is `https://cloud.taskdesk.app`. Any SDK, Postman import, MCP client or code generator fed that spec will send requests, **including the user's API key**, to the vendor's domain instead of the operator's own. For a product that promises no phone-home, this is credential misdirection by default. `apps/api/src/scheduler/trial-reminders.ts:51` has the same `?? "https://cloud.taskdesk.app"` fallback.

**Fix.** Derive the server URL from the incoming request origin, or refuse to serve the document when the public URL is unconfigured — never fall back to a vendor host. Put `/api/openapi` behind the auth middleware (register it after line 543) or give it an explicit, reviewed `security: []`.

### E-17. MEDIUM — guest accounts are minted with `@taskdesk.app` email addresses on self-hosted instances

**File:** `/home/ubuntu/ticketing.v2/apps/api/src/auth.ts:279-286`
**Owning issue:** #6 removals (rider on the anonymous-sign-in removal) — the *email domain* aspect is not called out there.

```ts
...(process.env.DISABLE_GUEST_ACCESS !== "true"
  ? [ anonymous({ generateName: async () => generateDemoName(), emailDomainName: "taskdesk.app" }) ]
  : []),
```
better-auth's anonymous plugin builds the address as `` `temp-${id}@${options.emailDomainName}` `` (`better-auth/dist/plugins/anonymous/index.mjs:20`). So every guest on a customer's instance gets an identity at **a domain the vendor controls and the operator does not**.

The delivery path does not filter these out: `apps/api/src/notification-preferences/delivery.ts:509-511` sends
```ts
sendNotificationEmail(user.email, content.title, { title, message: content.body, actionUrl: context.taskUrl, ... })
```
with `user.email` read straight from `userTable.email` (`:411`) and no `isAnonymous` check. A guest who enables email notifications (they hold a session, so they can call the preferences endpoint) causes **task titles, comment bodies and task URLs from the operator's instance to be SMTP-delivered to `temp-…@taskdesk.app`** — off the operator's premises, to the vendor's MX. It also means guest identities are indistinguishable from vendor staff in the member list.

**Fix.** Since #6 removes guest access, delete the plugin outright. If any guest mode survives, set `emailDomainName` to a reserved non-routable domain (`guest.invalid`, per RFC 2606) and add an `isAnonymous` short-circuit in `deliverNotification` before any outbound channel.

### E-18. LOW — a debug route ships in the production SPA and hardcodes an upstream developer's personal domain

**Files:** `/home/ubuntu/ticketing.v2/apps/web/src/routes/test-error.tsx`, `/home/ubuntu/ticketing.v2/apps/web/src/components/ui/error-test.tsx:4-6`
**Owning issue:** NEW ISSUE (trivial cleanup) — not on #6's list.

`createFileRoute("/test-error")` registers a top-level route (outside `_layout`, so no auth guard) that renders a canned error card whose text is:
```ts
"Failed to connect to API server at https://api.andrej.com. This might be due to CORS configuration issues or the server not running. ..."
```
`api.andrej.com` is a personal domain inherited verbatim from the kaneo snapshot. Impact is low (static text, no data), but a `/test-error` route in a shipped product is a smell that fails any customer security questionnaire, and the domain is a provenance leak the de-branding pass missed. Delete both files.

### E-19. LOW — Sentry check-ins fire from the scheduler outside the `SENTRY_DSN` guard

**File:** `/home/ubuntu/ticketing.v2/apps/api/src/scheduler/index.ts:21-41`
**Owning issue:** #6 removals (Sentry) — flagged because it is a **separate call site** from `instrument.ts` and `index.ts` and is easy to miss.

```ts
const checkInId = Sentry.captureCheckIn({ monitorSlug: name, status: "in_progress" });
```
`initializeScheduler` registers four crons, two of which run every **5 minutes**, and each tick emits two `captureCheckIn` calls plus, on failure, a `captureException`. There is no `if (process.env.SENTRY_DSN)` around any of it — the only guard is `Sentry.init` never having run (`instrument.ts:27`), which makes the SDK a no-op. That is a *library* behaviour the product is relying on, not a decision the product makes. The moment a DSN is present, a self-hosted instance emits a cron heartbeat to a third-party ingest endpoint every 5 minutes. Remove all four `Sentry.*` calls along with the rest of Sentry.

### E-20. LOW — bcrypt cost 10 with no maximum password length

**File:** `/home/ubuntu/ticketing.v2/apps/api/src/auth.ts:253-261`
```ts
hash: async (password) => await bcrypt.hash(password, 10),
verify: async ({ hash, password }) => await bcrypt.compare(password, hash),
```
Cost 10 is at the bottom of the current OWASP band (≥ 10, 12 recommended); note the defender pays the `bcryptjs` pure-JS penalty while an attacker cracking a stolen hash uses native/GPU bcrypt, so the effective margin is *worse* than the number suggests. `bcrypt` also silently truncates at 72 bytes, and no maximum length is enforced anywhere, so a 100-character passphrase provides the security of its first 72 bytes with no warning. Raise the cost to 12 and reject passwords over 72 bytes (or SHA-256 pre-hash before bcrypt). **Owning issue:** NEW ISSUE (low).

### E-21. LOW — `/api/config` returns the full instance feature/configuration matrix unauthenticated

**Files:** `/home/ubuntu/ticketing.v2/apps/api/src/index.ts:393` (registered before the auth middleware at `:543`), `/home/ubuntu/ticketing.v2/apps/api/src/utils/get-settings.ts:8-33`

Returns `disableRegistration`, `disablePasswordRegistration`, `disableEmailOtpSignIn`, `disableWorkspaceCreation`, `isDemoMode`, `hasSmtp`, `hasGithubSignIn`, `hasGoogleSignIn`, `hasDiscordSignIn`, `hasCustomOAuth`, `hasGuestAccess`, `disableLoginForm`, `customOAuthAutoLogin`, `customOAuthLogoutUrl`, `billingEnabled`. Most of this the login page genuinely needs, so this is a design trade-off rather than a bug — but `customOAuthLogoutUrl` discloses the operator's internal IdP URL, and `hasSmtp`/`hasGuestAccess`/`billingEnabled` give an unauthenticated scanner a precise fingerprint of which attack paths are live. Trim to the fields the pre-auth UI actually renders. **Owning issue:** NEW ISSUE (low).

### Checked and clean — do not re-raise

- **Webhook signature verification is constant-time.** `apps/api/src/plugins/gitea/utils/verify-signature.ts:19-25` uses `timingSafeEqual` after an explicit length check. The `catch` fallback to `provided === expected` (`:27`) is unreachable (`Buffer.from(x,"hex")` does not throw) — cosmetic, worth deleting, not a timing bug.
- **API keys are not compared in JS.** `apps/api/src/utils/verify-api-key.ts:39-55` hashes the presented key with SHA-256 and looks the digest up with a SQL equality; no user-supplied secret is string-compared in application code, so no constant-time compare is needed here.
- **Notification secrets are never echoed.** `apps/api/src/notification-preferences/response.ts` returns `*Configured` booleans and masked previews only (see E-4 for the masking nit).
- **The global error handler does not leak.** `apps/api/src/index.ts:142-153` returns a fixed `{ message: "Internal Server Error" }` for any non-`HTTPException`.
- **Account linking is guarded.** `apps/api/src/auth.ts:238-249` sets `requireLocalEmailVerified: true`, which closes the pre-registration takeover this pattern usually carries. (#6 removes it anyway.)
- **better-auth's own telemetry is off.** `@better-auth/telemetry/dist/index.mjs:360` defaults `enabled` to `false` and only turns on via `BETTER_AUTH_TELEMETRY`. Nothing in this repo sets it. Consider passing an explicit `telemetry: { enabled: false }` in `betterAuth()` so a future default change or a stray env var cannot silently enable it.
- **No analytics/tracking SDKs.** A grep for posthog / plausible / umami / mixpanel / segment / google-analytics / gtag / amplitude across `apps`, `packages`, `charts`, `scripts` returns **zero** hits. The only outbound third-party surfaces are Sentry (opt-in, on #6's list), Cloudflare Turnstile (on #6's list), and the jsDelivr script in E-12.

### E-22. MEDIUM — Sentry **Session Replay** is bundled into the web app and samples 10% of all sessions

**File:** `/home/ubuntu/ticketing.v2/apps/web/src/instrument.ts:33-39`
**Owning issue:** #6 removals (Sentry) — flagged separately because "remove Sentry" reads as error reporting, and **replay is a screen recorder**, a materially different privacy commitment.

```ts
    integrations: [ Sentry.browserTracingIntegration(), Sentry.replayIntegration() ],
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
```

`replaysOnErrorSampleRate: 1.0` means **100% of sessions in which any error occurs** are recorded and uploaded, plus a flat 10% of all sessions regardless. `sendDefaultPii: false` (`:11`) does not govern replay content. The SDK's `maskAllText` default masks rendered text, but it does not mask URLs, route parameters, project/task identifiers, or the shape and timing of everything the user did — and one `maskAllText: false` in a future "we can't debug this" commit turns it into a live feed of customers' ticket contents, which for a service desk means end-customer PII.

For a self-hosted-first product this integration should not be in the bundle at all: shipping the recorder and relying on the DSN being unset is the same "library default protects us" pattern as E-19. Remove `replayIntegration()` with the rest of Sentry, and make the removal explicit in the #6 acceptance criteria so it is not left behind as "just error reporting".

---

## SUMMARY

**No real committed credentials.** The only regex hit in the tree is a synthetic PEM in `tests/api/plugins/github/utils/resolve-private-key.test.ts:5-9` whose body is the literal `MIIEpAIBAAKCAQEA` / `abc`. **Nothing needs rotating** (E-2). The Helm chart's `taskdesk_password` (E-7) is a shipped *default*, not a leaked secret — it needs deleting, not rotating.

| # | Sev | Title | Owner |
|---|-----|-------|-------|
| E-1 | **CRITICAL** | `secret: process.env.TASKDESK_AUTH_SECRET \|\| ""` → better-auth's public default secret when `NODE_ENV != "production"` | NEW (blocker) |
| E-10 | HIGH | CORS reflects any origin with credentials when `NODE_ENV` is unset | NEW (blocker) |
| E-13 | HIGH | Unauthenticated first-run instance takeover + public `hasUsers` oracle | NEW |
| E-14 | HIGH | #6's generic-webhook deletion removes the only SSRF guard on core notification delivery | #6 |
| E-12 | HIGH | `openAPI()` → unauthenticated `/api/auth/reference` loading unpinned jsDelivr script into the API origin | #6 (add) |
| E-7 | HIGH | Helm ships `postgresql.auth.password: taskdesk_password`, plaintext env var | #11 |
| E-9 | HIGH | `Dockerfile.kaneo` COPYs 3 files that were never imported — image cannot build, so the only `NODE_ENV=production` is unreachable | #10 CI |
| E-3 | MED | Integration-secret key = unsalted `sha256(passphrase)`; no AAD; destructive rotation; legacy plaintext never migrated | NEW |
| E-6 | MED | Malformed `TASKDESK_DATABASE_URL` prints the full DSN + password to stdout | NEW / #11 |
| E-8 | MED | `TASKDESK_ENCRYPTION_KEY` absent from the Helm chart → runtime 500s | #11 |
| E-11 | MED | Raw driver error messages returned to clients (`import-tasks.ts:135` is core and not covered by #6) | NEW + #6 |
| E-15 | MED | `DEMO_MODE`: `window.location.hostname === "demo.taskdesk.app"` hardcoded in every bundle; dead parallel API flag | NEW |
| E-16 | MED | `/api/openapi` unauthenticated, `servers[0].url` defaults to `https://cloud.taskdesk.app` | NEW |
| E-17 | MED | Guest accounts minted as `temp-…@taskdesk.app`; delivery path emails them | #6 (rider) |
| E-22 | MED | Sentry **Session Replay** bundled; 10% of sessions, 100% of error sessions | #6 (call out) |
| E-4 | LOW | Masked secret preview leaks first+last 4 chars | NEW |
| E-18 | LOW | `/test-error` debug route in the SPA, hardcodes `api.andrej.com` | NEW |
| E-19 | LOW | `Sentry.captureCheckIn` in the scheduler, outside the DSN guard | #6 |
| E-20 | LOW | bcrypt cost 10, no max password length (silent 72-byte truncation) | NEW |
| E-21 | LOW | `/api/config` returns the full feature matrix unauthenticated | NEW |

**The single most important observation:** three separate defects (E-1, E-10, and the `isProduction` default of better-auth's own rate limiter) all fail open when `NODE_ENV` is merely *unset* rather than explicitly non-production, and the only place in the entire repository that sets `NODE_ENV=production` is `Dockerfile.kaneo:110` — a Dockerfile that **cannot build** (E-9). Fix E-9 first, then remove every security decision that keys off `NODE_ENV`.

**Additions recommended for issue #6's removal list** (currently absent from it): `openAPI()` (E-12), `DEMO_MODE` / `demo-alert` / `constants/urls.ts` (E-15), the `/test-error` route (E-18), the guest `emailDomainName` (E-17), the scheduler's Sentry check-ins (E-19), Sentry Session Replay called out explicitly (E-22), and — as a **precondition** on the generic-webhook deletion — relocating `assertPublicWebhookDestination` (E-14).

STATUS: COMPLETE
