# Security model

> v1 shipped **eleven** authorization holes past a green test suite. The response is not
> "try harder". It is to make the omissions mechanically detectable.

## The five structural controls

### 1. Every route declares its policy — or the build fails

```ts
export const workItemPolicies = {
  'POST /api/work-items':      { capability: 'work_item:create', scope: 'project' },
  'GET  /api/public/branding': { public: true, reason: 'rendered on the login page' },
} satisfies PolicyMap;
```

`tests/permissions/route-coverage.test.ts` enumerates every route in the OpenAPI document
and fails if any lacks a policy entry. `public: true` requires a `reason` string, so
making something public is a visible, reviewable decision rather than a forgotten line.

**This single test would have caught most of v1's holes.**

### 2. Permission matrix test

`tests/permissions/matrix.test.ts` runs every built-in role against every route and
asserts allow or deny against a checked-in fixture. Changing who can do what changes the
fixture, which appears in the pull request diff.

```
                          owner admin manager lead member viewer customer
POST /api/projects          ✓     ✓      ✓      ✗     ✗      ✗       ✗
POST /api/work-items        ✓     ✓      ✓      ✓     ✓      ✗       ✗
POST /api/work-items/:k/assign ✓  ✓      ✓      ✓     own    ✗       ✗
GET  /api/instance/plugins  ✗*    ✗      ✗      ✗     ✗      ✗       ✗
                                                    (* instance:admin only)
```

### 3. Negative E2E suites

Playwright projects that attempt forbidden things and assert failure:

- A customer requesting an agent-origin URL.
- A customer requesting another organisation's work item by key → expects **404**.
- A customer approving their own request → expects 403.
- A customer de-escalating priority → expects 403.
- A viewer attempting every write route.
- An expired session, a revoked session, a revoked API key.

### 4. Deny by default in the middleware chain

The policy middleware runs before every handler. A route reaching a handler without
having passed a policy check is impossible: the route factory refuses to construct a
route that has no policy, at module load.

### 5. Secrets never serialise

Response schemas are explicit. There is no `select *` path to the wire. Plugin secrets
are additionally encrypted at rest and return `"••••••••"` on read.

---

## Reach, authority, and the 404 rule

Covered fully in [RBAC](rbac.md). The security-relevant summary:

- **Reach** and **authority** are separate arguments to the evaluator; neither is derived
  from the other.
- Identity is resolved **from the database on every request**, keyed by user id. Token
  claims never carry authority. Revocation is immediate.
- Out of reach ⇒ **404**, not 403, so tenant boundaries leak nothing.

## Portal boundary

Two origins, two cookies, two route trees. Enforced:

1. **At login callback** — a customer completing a login on the agent origin gets no
   session and an audit row.
2. **Per request** — session portal must match request host.
3. **At build** — a check asserts no `routes/agent/*` or `components/god-mode/*` module
   appears in the portal bundle graph.

The bundle split reduces information disclosure. It is **not** the security boundary.
The server is. Anyone who writes "it's fine, that screen isn't in the customer bundle" in
a review comment has misunderstood, and should be pointed here.

## Input handling

| Vector | Control |
| --- | --- |
| Injection | Drizzle parameterises everything. No string-built SQL, no exceptions. Filter grammar whitelists fields and compiles to parameters |
| XSS | React escapes by default. Tiptap content is sanitised server-side on write with an allowlist; `dangerouslySetInnerHTML` is banned by lint |
| Uploads | Extension and MIME allowlist, magic-byte sniff, size cap, served from a separate origin with `Content-Disposition: attachment` and a restrictive CSP |
| SSRF | Webhook and OIDC discovery URLs resolved and checked against private ranges before connecting, then re-checked at connect time to defeat DNS rebinding. Redirects not followed to new hosts |
| Path traversal | Object keys are generated, never derived from user filenames |
| Mass assignment | Zod schemas are strict; unknown keys rejected, not stripped |
| ReDoS | User-supplied patterns never compiled to regex |
| Prototype pollution | No deep merge of user input; `Object.create(null)` for dynamic maps |

## Transport and headers

Traefik terminates TLS 1.2+ and sets:

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: <storage-origin>; connect-src 'self' <api-origin> <ws-origin>;
  frame-ancestors 'none'; base-uri 'self'; form-action 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), camera=(), microphone=()
Cross-Origin-Opener-Policy: same-origin
```

CSP is reported to an endpoint and reviewed. `unsafe-inline` for styles is a Tailwind
requirement and is tracked as debt.

## Secrets

| Secret | Storage |
| --- | --- |
| Plugin configuration secrets | AES-256-GCM in `instance_plugin_config.secrets`, key from `TASKDESK_ENCRYPTION_KEY` |
| Webhook signing secrets | Same |
| Session signing key | `TASKDESK_AUTH_SECRET`, env only |
| API keys | Hashed (Argon2id); only a prefix stored in clear |
| Invitation tokens | SHA-256 hash only |
| Passwords | better-auth default (scrypt) |

Key rotation is a documented God Mode operation that re-encrypts all plugin secrets under
a new key, in a transaction, with the old key retained until it completes.

## Audit

Every mutation writes an `audit_log` row: actor, IP, action, entity, before, after,
timestamp. Additionally always audited regardless of outcome:

- Sign-in success and failure
- Impersonation start and end
- Role and capability changes
- Plugin configuration changes (keys changed, never values)
- Permission denials
- Data exports
- Bulk operations

Audit rows are append-only. No API can update or delete one; retention purge is itself
audited.

## Elevated actions

Require re-authentication within the last five minutes, regardless of capability:

- Changing an identity provider
- Granting `instance:admin`
- Deleting a workspace or project
- Starting impersonation
- Rotating the encryption key
- Exporting all data

## Impersonation

An instance admin may impersonate a user for support. When active:

- A persistent, unmissable banner shows who is impersonating whom, with an exit button.
- Every request is tagged with both identities in the audit log.
- Writes are permitted but doubly audited.
- The session is capped at 30 minutes.
- Impersonating another instance admin is forbidden.

## Dependencies

- `pnpm audit` in CI; high or critical fails the build.
- Renovate weekly for patch and minor.
- Lockfile committed; `--frozen-lockfile` in CI.
- SBOM (CycloneDX) generated per release.
- Container image scanned with Trivy; high or critical fails the release.

## Testing security

| Test | Where | Frequency |
| --- | --- | --- |
| Route policy coverage | `tests/permissions/` | Every PR |
| Permission matrix | `tests/permissions/` | Every PR |
| Negative E2E | `tests/e2e/security/` | Every PR |
| Tenant isolation fuzz | `tests/api-integration/` | Every PR |
| Dependency audit | CI | Every PR |
| Container scan | CI | Every release |
| Penetration test | External | Before first external customer, then annually |

## Incident response

1. **Contain** — revoke sessions, disable the affected plugin or account.
2. **Assess** — the audit log is the source of truth for what was touched.
3. **Notify** — affected organisations, per contractual obligation.
4. **Remediate** — fix, add a regression test, deploy.
5. **Record** — write it up in `docs/07-planning/decision-log.md` and add the lesson to
   this document.

Full procedure: [runbook](../05-operations/runbook.md).

## Related

- [RBAC](rbac.md) · [Auth and identity](auth-and-identity.md) · [Multi-tenancy](multi-tenancy.md)
- [Testing strategy](../04-engineering/testing-strategy.md)
