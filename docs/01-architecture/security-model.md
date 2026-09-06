# Security model

> v1 shipped **eleven** authorization holes past a green test suite. The response is not
> "try harder". It is to make the omissions mechanically detectable.

Rewritten 2026-09-05 after the [planning review](../07-planning/review-2026-09-05.md)'s
dedicated security pass: the controls were strong, the threat model was missing, and a
dozen boundaries (WebSocket origin and re-authorization, CSRF, egress, provisioning,
account linking, step-up, scope-object resolution) were asserted rather than specified.
Security review is a **mandatory Opus checkpoint** on every merge and every phase gate —
[agent-workflow.md](../04-engineering/agent-workflow.md#model-tiers-within-claude-code).

## Threat model

Trust boundaries: browser ↔ Traefik ↔ application ↔ {Postgres, Valkey, object storage} ↔
{identity providers, SMTP, webhook targets, AI providers, marketplace APIs}. Assets: every
organisation's work items, comments and attachments; the directory; plugin secrets; the
audit trail; session and API-key material; the image and release artefacts.

| Adversary | Goal | What stops them |
| --- | --- | --- |
| **Hostile customer organisation** (a portal user) | Read or affect another organisation's data; escalate to staff | Reach = own organisation, enforced in the evaluator, not by role; 404-not-403; separate portal router with policy kind 3 on every route; behavioural customer rules in `packages/domain`; per-request `customer_visibility` |
| **Malicious workspace admin** (staff, high rank) | Grant themselves capability they lack; reach another customer's projects; read another workspace's audit | Rank guardrails (strict `>`, resulting-set check); `instance:admin` ungrantable from workspaces; re-parenting authorised on both projects and never across organisations; `audit_log.workspace_id` scoping |
| **Compromised staff session** | Act as the user; persist access | Short idle timeout; step-up (second factor) for elevated actions bound to the specific action; session rotation on privilege change; every durable-authority creation (API keys, webhooks, invitations) audited and listed in profile |
| **Compromised plugin credential** (SMTP, S3, OIDC client secret) | Read mail/objects; mint logins | Secrets encrypted per row with `key_id`, IV and AAD; never serialised; rotation via `secrets-rekey`; OIDC claims never grant authority directly; a compromised IdP cannot cross a domain bound to another provider |
| **Insider with database access** | Read everything; rewrite history | Application-level secrets encryption (DB access ≠ secret access); append-only audit via DB grants and hash-chaining; the documented residual: plaintext business data is readable by DB admins — a deployment that needs more uses volume encryption and Postgres access controls, stated in the runbook |
| **Compromised upstream** (kaneo before the fork; a dependency) | Ship malicious code in our image | kaneo snapshot audited and SHA-pinned at fork **and human-reviewed router by router during the P0 policy retrofit** — a scanner finds known CVEs, not a planted change; lockfile frozen; `pnpm audit` + Trivy + secret-scanning gates; signed images and archives with provenance; better-auth upgrades reviewed as security changes |
| **Compromised CI identity** (a malicious PR job, a leaked repository secret) | Produce a *validly signed* malicious image every deployment accepts | Release workflow runs only from `main`/`release/*` on manual dispatch, behind branch protection with no bypass; `id-token: write` granted to that one job only; `permissions:` read-only by default on every workflow; the cosign verification in `deploy.sh` pins the **workflow identity** (`repo`, `workflow`, `ref`), not just the issuer; third-party actions pinned by SHA ([ci-cd.md](../04-engineering/ci-cd.md)) |
| **Malicious MCP client / runaway agent / typosquatted `@taskdesk/mcp`** | Exfiltrate via a key; amplify writes; harvest `TASKDESK_API_KEY` | Key capability subset ∩ owner authority; `is_mcp` keys read-only by default; `is_mcp` ceiling; burst auto-disable; idempotency; no MCP-only data path; `@taskdesk` scope reserved, provenance + 2FA on publish, internal packages `private` |
| **Hostile content read by a model** (prompt injection through ticket text) | Make a staff agent or an AI feature act with staff authority | Tool output marked untrusted (`MC-15`); destructive/bulk tools need out-of-band human approval (`MC-7`); AI retrieval scoped to the triggering identity; model output sanitised as user input — [AI and MCP surfaces](#ai-and-mcp-surfaces) |
| **Rogue automation / job** | Act beyond the rule author's authority | Automations run as their `effective_role_id` (clamped, `AM-3`); placeholder expansion checked against the destination's visibility (`AM-11`); jobs carry `actor_type = 'system'` and still write through scoped repositories; manual job triggers are `instance:manage_jobs`, audited, rate-limited; per-organisation job workload caps |
| **Account-recovery social engineering** ("please reset my MFA") | Get an administrator to remove a second factor | `reset-mfa` is elevated, requires a recorded verification note, emails every address on file, revokes all sessions and keys ([auth-and-identity.md](auth-and-identity.md#multi-factor-authentication)) |
| **Compromised SCIM token, or a hostile customer's own IdP** | Create staff, reach another organisation, grant authority, enumerate users | Organisation and portal are fixed by the connection the token belongs to, never by the request (`IP-4`); a customer connection can create only customer-side people in its own organisation with the customer role (`IP-2`); no connection can grant `instance:admin` or `sees_all`; token hashed, rotatable with immediate invalidation, rate-limited; every denial is a provisioning event — [SCIM](#scim--an-inbound-privileged-management-api) |
| **A deletion nobody meant** (mis-click, scripted key, injected agent) | Destroy data faster than anyone can stop it | Every user-initiated deletion is a `pending_action` approved by the requesting human in a browser session; bound to exact targets and payload; single-use; 15-minute expiry; re-authorised at execution; no model, key or automation can approve — [Deletion approval](#deletion-approval) |
| **Anonymous internet** | Enumerate users/providers; bomb mail; DoS; distinguish "not found" from "not yours" | Anonymous rate-limit class; constant-time auth responses; **constant-shape 404** (same body, same lookup path, same bucket); minimal `/api/public/*`; `health/deep` authenticated; quotas with real defaults; event-loop lag alerting |
| **Legal hold / e-discovery** (not an adversary — an obligation) | Delete what must be retained; fail to produce what must be produced | A per-organisation or per-person **legal hold** flag suspends `audit-purge`, the soft-delete purge in `session-cleanup`, `attachment-gc` and hard delete for that scope ([background-jobs.md](background-jobs.md)); the per-tenant export already required for subject rights ([data-protection.md](../05-operations/data-protection.md)) is the discovery export |

Residual risks accepted, and where they are recorded: no malware scanning by default
([attachments.md](../03-features/attachments.md)); metering integrity is contractual
([risks.md](../07-planning/risks.md) R18); DB admins can read business data (above);
`unsafe-inline` styles for Tailwind (below); **no encryption at rest below the
application** — business data, attachments and backups are plaintext to whoever holds the
volume, so a deployment that needs more enables volume encryption and encrypts the backup
target with a key held separately from `TASKDESK_ENCRYPTION_KEY`
([backup-and-restore.md](../05-operations/backup-and-restore.md)). What leaves the
instance, to whom, under which configuration, is the sub-processor register in
[data-protection.md](../05-operations/data-protection.md).

## The inherited kaneo surface — the P0 seam

Every control below is specified for code that does not yet exist, while the first act of
P0 is importing kaneo's *existing* routers. That seam is the largest single security task
in the project and is treated as one: `public-project` (anonymous boards) is **deleted at
fork**, not flagged off; every remaining inherited router is retrofitted into the five
policy kinds by a human-reviewed pass, router by router; the route-coverage test must go
green on the inherited surface, not on an empty application; and the retrofit gets its own
Opus security review before P0 closes ([phases.md](../07-planning/phases.md#p0--foundation),
[inherited-features.md](inherited-features.md)).

## The structural controls

### 1. Every route declares its policy — or the build fails

Five policy kinds, defined once in [RBAC](rbac.md): capability (optionally `orOwner`),
`authenticated + self`, `portal + predicate`, `public + reason`, `delegated + reason`.
`tests/permissions/route-coverage.test.ts` enumerates **Hono's router** — not the OpenAPI
document — and fails on any route without a policy of a known shape. `/auth/*`, `/ws` and
`/metrics` are **explicitly allowlisted, with the surface behind them unenumerated**, not
"covered": `/auth/*` is one mounted handler whose endpoint set is defined by the better-auth
**plugin list**, which is rebuilt at runtime from database configuration. The control there is
a different assertion — the constructed plugin list must equal the approved list (no
`anonymous`, no `deviceAuthorization`, no `bearer`) — re-run on every runtime rebuild, logging
and alerting on a diff. Policies also carry `elevated` and `sessionOnly`, so elevation is a
build failure to omit rather than a prose table someone forgot ([RBAC](rbac.md)).

### 2. The scope object is resolved by the framework, not the handler

A policy's `scope` names *which* object the capability is checked against; the policy
middleware **loads that object from the route's declared scope source, checks reach, checks
authority, and hands the already-authorized row to the handler**. The scope source is the
path parameter for most routes and, for workspace-scoped collection routes with no workspace
in the path (`/api/custom-fields`, `/api/capabilities`, `/api/webhooks`, `/api/views`,
`/api/notifications`), the required `X-Workspace-Id` header or `?workspace=` query parameter,
validated the same way; `POST /api/work-items/search` takes it from the filter body. Handlers
never re-load by id from user input. This closes the classic IDOR (a valid capability in
project A, an id from project B): `tests/permissions/idor-fuzz.test.ts` takes every scoped
route and substitutes ids from the other seeded tenant **at every scope source — path segment,
header and search body alike** — asserting 404.

### 3. Permission matrix, twice — plus generated roles

`matrix.test.ts` runs every built-in role against every route for **capability** and again
for **reach**. `custom-role.property.test.ts` generates random capability sets and random
(actor rank, target rank) pairs and asserts the evaluator's decision equals the
set-membership prediction and that every rank guardrail holds — the escalation bugs live in
the configurations the fixture never enumerates.

### 4. Negative E2E suites

Playwright projects that attempt forbidden things and assert failure — cross-tenant 404,
self-approval 403, de-escalation 403, viewer writes, expired/revoked session, revoked key,
forged `X-Forwarded-For`, cross-origin WebSocket, CSRF on an elevated route.

### 5. Secrets never serialise; queries are never unscoped

Response schemas are explicit; there is no `select *` to the wire. Every table read goes
through a feature's `repository.ts` whose exports take an identity and return a
phantom-typed `ScopedQuery` that **cannot execute without one** — a type error, not a lint
warning; `check:queries` additionally fails the build on any `db.select()` outside a
repository. RLS remains rejected as the *primary* control ([multi-tenancy.md](multi-tenancy.md));
it may be added as a backstop on `work_item`, `comment` and `attachment` if a customer's
compliance requires it, recorded in the decision log.

---

## Reach, authority, and the 404 rule

Covered fully in [RBAC](rbac.md). The security-relevant summary:

- **Reach** and **authority** are separate arguments to the evaluator; neither is derived
  from the other.
- Identity is resolved **from the database on every request**, keyed by user id, with a
  30-second Valkey cache invalidated on any membership or role change. Token claims never
  carry authority.
- Out of reach ⇒ **404**, not 403, so tenant boundaries leak nothing — on HTTP **and on the
  WebSocket**.
- The two reach-affecting project fields — `parent_id` and `owner_team_id` — are
  `project:manage_members`, not `project:update`, on their own route. Re-parenting is
  authorised against **both** the child and the new parent, refused across organisation
  boundaries, and audited on both; an owner-team change is audited with the team's member
  list. `sees_all` is never self-grantable and is an elevated, audited reach change.
- The 404 is **constant-shape**: same body, same lookup path, same rate-limit bucket for
  "does not exist" and "not yours".

## Identity provisioning and account linking

The one place an IdP claim influences authority is just-in-time provisioning, so it is
constrained hard:

- **Protocol floor first:** every `auth.oidc` plugin uses PKCE (`S256`), a single-use
  `state` bound to the session and portal, and a validated `nonce`; the ID token's
  signature, `iss`, `aud` and `exp` are checked before any claim is read
  ([auth-and-identity.md](auth-and-identity.md#what-every-authoidc-plugin-must-do--the-protocol-floor)).
  Nothing below applies to an unvalidated token.
- **The durable identity key is `(connection, issuer, subject)` plus the SCIM `externalId`**
  — never the email address, which is a changeable attribute. Organisation and portal are
  properties of the connection, resolved server-side.
- A domain mapping is honoured only when the token carries `email_verified = true`.
- **Each email domain is bound to exactly one provider.** A token asserting `@contoso.com`
  from any other enabled provider is refused, so no second provider can be used to walk into
  Contoso's tenant.
- Provisioning `side = staff`, or a group→role rule that grants above `member`, is an
  elevated configuration change.
- Group→role mapping is applied **at provisioning only**. It is never re-evaluated at login
  — so de-provisioning is a directory action, symmetric and audited, not an IdP side effect.
- **No automatic account linking on email.** A sign-in through provider B for an email that
  exists via provider A is refused with an explanation; linking requires an authenticated
  session on A plus an explicit confirmation. better-auth's auto-link defaults are off.
- "MFA satisfied upstream" prefers the token's `amr`/`acr` claim (challenge when absent);
  the static per-provider flag remains for providers that emit neither, and setting it is
  elevated and shown in a security-posture panel.

## SCIM — an inbound privileged management API

Decided 2026-09-05: Microsoft Entra SCIM is core P3 delivery
([identity-provisioning.md](../03-features/identity-provisioning.md)). It is the one API
through which an external system creates and deactivates people, so it is treated as a
privileged surface, not an integration:

- **Scope comes from the credential, never the request.** The bearer token identifies one
  `scim_connection`, therefore one identity connection, one portal scope, at most one
  organisation, the allowed resource types and the allowed mappings. A body carrying
  `organisation_id`, `workspace_id`, a role, a capability or a portal scope is refused
  `400 forbidden_attribute` and logged (`IP-4`).
- **A customer connection cannot cross the customer boundary**: customer-side people, own
  organisation, customer role only; never staff, never instance authority, never `sees_all`,
  never another organisation, never keys/webhooks/automations (`IP-2`).
- **Nothing provisions `instance:admin`**, from any claim, attribute, group or connection
  (`IP-3`, `IP-21`).
- HTTPS only; `application/scim+json`; strict schema validation; body-size cap;
  per-connection rate limit; failed authentication counted in the anonymous class; token
  stored as a hash, shown once, rotation **invalidates the old token immediately**; raw
  token values never appear in logs, responses, exports or audit detail (`IP-12`, `IP-14`).
- **De-provisioning is immediate and complete**: `active=false` deactivates the person,
  revokes every session and every personal API/MCP key, ends memberships per policy, keeps
  history, and writes a provisioning event (`IP-15`). It is never a hard delete.
- `/scim/v2/*` is `delegated: scim` in the policy registry and is inside the IDOR-fuzz and
  tenant-isolation suites like any other scoped surface.

## Deletion approval

Every user-initiated deletion — web UI, REST API, personal API key, MCP — is a
`pending_action` that the requesting human approves in a browser session; the server
re-runs the route policy at approval, verifies the payload hash and target versions, and
executes exactly the approved targets. Confirmation levels rise with blast radius (click →
typed name → typed count → typed count + step-up → typed name + step-up), one required level
per target type, never a choice between two. No model-supplied field, API key,
impersonation session or automation can approve; automations have no delete action before
P4; there is no MCP purge tool; hard purge is retention lifecycle or an elevated
`instance:admin` operation that checks legal hold first. The whole mechanism, table, routes
and tests: [pending-actions.md](pending-actions.md).

## Portal boundary

Two origins, two cookies, two route trees. Enforced:

1. **At login callback** — a customer completing a login on the agent origin gets no
   session and an audit row.
2. **Per request** — `session.portal` must match the request host.
3. **At build** — a check asserts no `routes/agent/*` or `components/god-mode/*` module
   appears in the portal bundle graph.

The bundle split reduces information disclosure. It is **not** the security boundary.
The server is.

## Sessions, CSRF and step-up

| Control | Rule |
| --- | --- |
| Cookies | HTTP-only, `Secure`, host-only (no `Domain`), `__Host-` prefix, `SameSite=Lax`; `SameSite=Strict` for the elevated-action routes |
| CSRF | **No state-changing GET, ever** (a lint rule). The CSRF controls apply **only to cookie-authenticated requests**, because the cookie is the only ambient-authority credential: an unsafe method presented with a session cookie requires `Origin` (or `Referer`) to equal the request host's own origin **and** a matching double-submit token; either failing is a 403. `SameSite` alone is not the control — the agent and portal are sibling subdomains. Requests authenticated by a **bearer token, a personal or service API key, or a SCIM token** are exempt from both checks: they are not sent automatically by a browser, so there is nothing for a cross-site page to forge, and non-browser clients (curl, CI, Microsoft Entra's SCIM client, the MCP server) send no `Origin` at all. This is the single statement of the rule; [api-design.md](api-design.md) cites it |
| Session rotation | The session id is regenerated on authentication, on impersonation start/end, and on MFA enrolment (fixation) |
| Defaults | Idle 12 h, absolute 30 days, concurrent 5 — configurable in God Mode within maxima of 7 days idle / 90 days absolute |
| Step-up for elevated actions | Re-authentication means the **second factor** when the account has one — never "password *or* MFA". SSO-only accounts re-authenticate at the IdP with `prompt=login`. The re-auth is minted by `POST /api/me/step-up` (session-only) and returns a **single-use confirmation token bound to the pending action's id**, valid five minutes; the pending action must already exist, so the token can never be broader than one approval, and a token that expires while the approver reads the summary is re-minted from the same endpoint for as long as the action is `pending`. A session-wide window is not enough. Statuses and re-minting: [pending-actions.md](pending-actions.md) `PA-15` |
| Elevated list | The single list in [RBAC](rbac.md) |

## Impersonation

Rules `GM-7`–`GM-11` in [god-mode.md](../03-features/god-mode.md): 30-minute cap, doubly
audited (`impersonator_id` on every row), never another instance admin, and **forbidden
during impersonation**: approvals, elevated actions, further impersonation, credential or
MFA changes, and anything that creates durable authority — API keys, webhooks, invitations,
role edits. The impersonated person is **notified** (in-app and email) that a support
session happened.

## Input handling

| Vector | Control |
| --- | --- |
| Injection | Drizzle parameterises everything. No string-built SQL, no exceptions. Filter grammar whitelists fields and compiles to parameters |
| Filter as an oracle | Filterable fields carry their own read capability; the filter is evaluated **after** identity scoping; `meta.total` counts only rows in reach |
| XSS | React escapes by default. Rich text is a Tiptap **JSON document, never raw HTML**; sanitised against an allowlist on write **and** normalised on render; importers write through the same domain-layer sanitiser as the API. `dangerouslySetInnerHTML` is banned by lint |
| Uploads | Extension and MIME allowlist, magic-byte sniff at `complete`, size cap; presigned POST pins key, `content-length-range` and content type; served from a separate origin with `Content-Disposition: attachment`; only `state = 'ready'` rows are served. No malware scanner — accepted residual risk; a future `storage.antivirus` plugin is reserved, not built ([roadmap.md](../07-planning/roadmap.md)) |
| SSRF / egress | **One HTTP client for every outbound call** — webhooks, OIDC discovery, SMTP, S3/Azure endpoints, AI providers, OTLP, Sentry, marketplace APIs, and plugin `test()` — resolves and checks the target against private, link-local and metadata ranges (`169.254.169.254`, `fd00:ec2::254`) before connecting and again at connect time; never follows redirects to a new host. The **egress allowlist** is stated once, here, and cited from `WH-12`: in production it is a God Mode-configurable, **default-empty**, per-host list whose every edit is an elevated, audited change, and it may be used **only** by `ai.*` plugins reaching a self-hosted model on a private address; `notify.*`, `webhook` and `import.*` may never target private, link-local or metadata ranges in production, and no God Mode entry can make them. A separate development allowlist relaxes the HTTPS requirement and exists **only** when `NODE_ENV=development`. Plugin `test()` is rate-limited and **audited even when nothing is saved** |
| Path traversal | Object keys are generated, never derived from user filenames |
| Mass assignment | Zod schemas are strict; unknown keys rejected, not stripped |
| ReDoS | User-supplied patterns never compiled to regex |
| Prototype pollution | No deep merge of user input; `Object.create(null)` for dynamic maps |
| Client IP | Read from `X-Forwarded-For` only at the trusted-proxy hop count set by `TASKDESK_TRUST_PROXY`; a forged header moves no rate-limit bucket and satisfies no API-key IP allowlist (tested) |

## WebSocket

- The upgrade is accepted only when `Origin` is exactly the configured origin for the
  request host, and the session's `portal` matches — cookie-authenticated upgrades are not
  protected by the same-origin policy, so this check is the control.
- Subscriptions are **re-authorized**, not only authorised at subscribe: the socket
  subscribes to the identity-cache invalidation channel and drops affected topics the moment
  a membership or role changes; as a floor, every subscription is re-checked every 60 s.
- Inbound frames are Zod-validated; topics are parsed into a discriminated union, `user:`
  topics are asserted against the session identity, `instance` requires `instance:admin`.
- Subscribe messages are rate-limited per socket, and a refused subscribe never
  distinguishes "does not exist" from "not in reach".

Detail: [realtime.md](realtime.md).

## AI and MCP surfaces

Both consume text written by customers while holding staff authority — the MCP server
through a staff member's key, the `ai.*` features through the identity that triggered
them. Prompt injection is therefore the primary threat on both, and "off by default" is
not a control. The rules, owned by the two specs and summarised here so a reviewer has one
list:

| Rule | Where |
| --- | --- |
| **MCP is an alternate client, not a second authorization system.** Effective authority = owner's current RBAC ∩ key subset ∩ current reach ∩ route policy ∩ feature availability; no `mcp:*` capabilities exist; a personal MCP key is owned by a named human; service keys are never MCP keys (schema `CHECK`) | [rbac.md](rbac.md#mcp--the-same-rbac-not-a-second-one), [mcp-server.md](../03-features/mcp-server.md) |
| Tool output and retrieved content are **untrusted, attacker-controlled data**, marked as such in the response envelope and in tool descriptions | `MC-15`, [mcp-server.md](../03-features/mcp-server.md) |
| Destructive and bulk operations need an **out-of-band human approval** (`pending_action_id` approved in the UI) — never a model-supplied `confirm: true` | `MC-7`, `MC-17` |
| `is_mcp` keys are **read-only by default**; write capabilities are an explicit, warned opt-in | `MC-16`, `AK-9` |
| AI retrieval context is assembled through the **same scoped repositories** as any read, for the triggering identity — no workspace-wide corpus, no cross-organisation duplicate detection | [plugin-architecture.md](plugin-architecture.md#ai--optional-ai-assistance) |
| Model output is sanitised on the same path as user rich text; never executed, never an instruction to another component | same |
| Per-feature declaration of what leaves the instance; `ai.sent_externally` audit row per work item; prompts and completions **not logged** by default; per-organisation spend cap and opt-out | same |
| All AI and MCP-related outbound calls go through the central egress client; `ai.ollama` private addresses are allowlisted per host by the administrator | [Input handling](#input-handling) |
| `tests/mcp/injection.test.ts` and the AI plugin's scoped-retrieval test are CI gates | `MC-18`, [testing-strategy.md](../04-engineering/testing-strategy.md) |

## Transport and headers

Traefik terminates TLS 1.2+ (1.3 preferred) and sets:

```
Strict-Transport-Security: max-age=63072000            (includeSubDomains/preload: operator opt-in)
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=()
Cross-Origin-Opener-Policy: same-origin
X-Frame-Options: DENY
```

**Content-Security-Policy is set by the application**, per origin, because it embeds
runtime configuration (the storage origin, the OTLP and Sentry endpoints):

```
default-src 'none';
script-src 'self' 'nonce-<per-response>';
style-src 'self' 'unsafe-inline';                      -- Tailwind v4 requirement; tracked as debt
img-src 'self' <files-origin>;                         -- no data:/blob: — attachments are references, never base64
font-src 'self';
connect-src 'self' wss://<this-host> <sentry> <otlp>;
frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';
report-to csp-endpoint
```

Rolled out `Content-Security-Policy-Report-Only` first for one release, then enforced.
Reports land at `POST /api/public/csp-report` (rate-limited, `public` with reason).

## Secrets

| Secret | Storage and rotation |
| --- | --- |
| Plugin configuration secrets | AES-256-GCM per row: envelope `key_id ‖ iv ‖ ciphertext ‖ tag`, a fresh random 96-bit IV per write, and the row id as **AAD** so a ciphertext cannot be moved between rows. Rotation is `secrets-rekey`, resumable, staged by the operator ([runbook](../05-operations/runbook.md)) |
| Webhook signing secrets | Same envelope; per-webhook rotation with a 24 h dual-signing window (`WH-13`); **rotate all** is a God Mode incident action |
| `TASKDESK_AUTH_SECRET` | Env only. Rotation signs everyone out — a documented incident action with a warning banner, not an accident; dual-secret verification during a window where better-auth supports it |
| API keys | Hashed (Argon2id); only a prefix stored in clear; **revoke all** is a God Mode incident action |
| Invitation tokens | ≥ 128 bits CSPRNG, SHA-256 hash only, bound to the invited email, 7-day default expiry, revoked when the inviter loses `member:invite` |
| Setup token | 32 bytes, printed once to the container log, one hour or one use |
| Passwords | better-auth default (scrypt) |
| The "unchanged" write | Omitting a secret field means unchanged; there is **no in-band sentinel string**, and an omitted field is honoured only for the same plugin row |

## Audit

Every security-relevant mutation writes an `audit_log` row: actor (with `actor_type`,
`api_key_id`, `impersonator_id`), IP, user agent, `trace_id`, workspace, organisation,
action, entity, before, after. **`audit_log` is for security-relevant events; `activity`
is the user-visible journal** — not every mutation writes both. Always audited, regardless
of outcome:

- Sign-in success and failure; MFA enrolment and reset; session revocation
- Impersonation start and end, and every action during it
- Role, membership and rank changes; invitations sent and redeemed
- Plugin configuration changes and **tests** (keys changed, never values); secret rotation
- Permission denials (403/404 on a scoped route)
- Data exports and attachment downloads; config export
- Bulk operations; imports (run level); job triggers
- API key and webhook lifecycle; automation enable/disable

Append-only is **enforced in the database**: the application role has no `UPDATE`/`DELETE`
on `audit_log` ([migrations.md](../04-engineering/migrations.md)); rows are hash-chained
(`prev_hash`) so tampering by a database-level actor is detectable; retention purge runs as
a separate maintenance role and is itself audited.

**The chain is defined precisely, because a vague chain fails towards a false alarm during an
incident.** Three things are specified and none of them is left to the implementer:

- **Hash input.** `row_hash` is SHA-256 over the concatenation, in this fixed order, of
  `prev_hash`, `id`, `occurred_at`, `actor_person_id`, `impersonator_id`, `action`,
  `entity_type`, `entity_id`, `workspace_id`, `project_id`, `before`, `after`, `context` —
  each field length-prefixed, `null` distinguished from empty. `jsonb` columns are serialised
  as **RFC 8785 canonical JSON**; timestamps as microsecond-precision UTC ISO-8601; the digest
  is written lowercase hex. `organisation_id` and every other column that may be backfilled or
  corrected after the fact are **excluded from the input** — a post-hoc mutable column inside
  the hash would break the chain on a legitimate backfill.
- **Serialisation point.** Every audit insert takes `pg_advisory_xact_lock(<the audit-chain
  constant>)` before reading the current tip and inserts inside the same transaction, so the
  chain is a strictly serial critical section. It is **one chain per instance**, not per
  workspace: a single tip is what `audit-verify` can walk end to end, and the throughput cost
  is one short lock per audited write, which this product's write rate can afford. Without
  this, two replicas read the same tip, insert with the same `prev_hash`, and `audit-verify`
  reports tampering on a healthy instance — at exactly the moment it is trusted most.
- **Purge anchor.** `audit-purge` does not silently leave a hole. After deleting an expired
  range it appends an **anchor row** — an ordinary audited row naming the purged range and the
  `row_hash` of the last surviving row before it — and `audit-verify` starts from the newest
  anchor and walks forward, so a purge reads as a purge and never as a break. `audit-verify`
  reports three distinct outcomes: `intact`, `purged-at <anchor>` (expected), and `broken at
  <id>` (a genuine mismatch). An `AU-14` write gap leaves no row and therefore no chain
  discontinuity; it is visible as an alert and a metric, not as a verification failure. Reading the audit log is scoped: a
workspace administrator sees rows with their `workspace_id` **and** whose entity is in
their reach — a manager with two projects does not read a third project's `before`/`after`
payloads through the workspace audit screen; instance-wide reads need `instance:read_audit`.
An **audit write failure alerts** (a metric and a notification to every instance
administrator), because the deliberate trade in `AU-14` — the mutation still succeeds — is
only acceptable if someone finds out. Rows contain PII deliberately; the erasure position
is in [data-protection.md](../05-operations/data-protection.md).

## Public and operational endpoints

- `/api/public/auth-providers` returns **only** what the login page needs — a button label
  and provider id — never discovery URLs, tenant ids or domain restrictions.
- `/api/public/health/live` and `/ready` are anonymous. The dependency-enumerating deep check
  is **not** on the public router at all: it is `GET /api/instance/health/deep`, policy kind 1
  with `instance:admin`. The one endpoint that lists every dependency is the reconnaissance
  surface this threat model names, so it does not live behind a per-route exception under a
  router whose blanket kind is `public`.
- `/metrics` is bearer-guarded with a constant-time comparison and, where the operator can,
  bound to a separate listener not exposed by Traefik; its labels are cross-tenant
  inventory and are treated as sensitive. The metrics bearer token is policy kind 5
  (`delegated: 'metrics'`) and grants **`/metrics` and nothing else** — it is not an
  alternative credential for `/api/instance/health/deep` or any other route.
- An **anonymous rate-limit class**, keyed by IP and — for anything that sends mail — by
  target email, covers `/api/public/*`, the non-login `/auth/*` endpoints (magic link, OTP,
  reset) and the WebSocket upgrade. Those endpoints respond identically and in constant time
  whether or not the account exists.
- Multi-replica deployments **require Valkey** for rate limiting; without it the limiter is
  per replica and the app logs a prominent warning and sets a metric.

## Dependencies and supply chain

- `pnpm audit` in CI; high or critical fails the build.
- Renovate weekly for patch and minor — **except better-auth**, whose upgrades are reviewed
  as security changes, with a named subscription to its advisories.
- Lockfile committed; `--frozen-lockfile` in CI.
- SBOM (CycloneDX) generated per release.
- Container image scanned with Trivy; high or critical fails the release.
- Image **and release archive** signed (cosign, keyless via the CI OIDC identity) with a
  build-provenance attestation; `scripts/deploy.sh` and the installer verify before starting
  a new digest (explicit opt-out for air-gapped mirrors).
- The kaneo snapshot taken at P0 is itself a supply-chain input: lockfile audited and tree
  scanned **before** the fork commit, SHA recorded in `THIRD-PARTY-NOTICES.md`.
- **Plugins are fully trusted code.** A plugin runs in-process with the database handle and
  the encryption key; installing one is a supply-chain decision equivalent to a core commit.
  No mechanism for untrusted third-party plugins exists, and none will without a separate
  ADR ([roadmap.md](../07-planning/roadmap.md) candidate).

## Data lifecycle

Organisation hard delete purges: work items, comments, attachments and objects, time and
cost entries, notifications, sessions, API keys, webhooks, invitations, outbox rows,
idempotency responses, `metric_snapshot` rows carrying its `organisation_id`, search
vectors, and cached identity entries. Audit rows keep an organisation tombstone. Deleted
data persists in backups for the retention period stated in
[backup-and-restore.md](../05-operations/backup-and-restore.md) — the answer a DPA asks for.
Quotas ship with **real defaults** (storage 20 GB, portal users 500, webhooks 10, API
600/min per organisation), not "unlimited", and the installer applies them.

## Vulnerability disclosure and advisories

- `SECURITY.md` at the repo root and `/.well-known/security.txt` on both origins name a
  security contact and a 90-day coordinated-disclosure window.
- Advisories are published as GitHub Security Advisories with a CVE where warranted, and
  every advisory ships with a patch release the same day per
  [release-plan.md](../07-planning/release-plan.md).
- Self-hosted operators learn they must upgrade through God Mode → Health's version check
  (which compares against `stable.txt`) and the advisory feed — a stated obligation of
  distributing a container image, and a marketplace listing requirement.

## Testing security

| Test | Where | Frequency |
| --- | --- | --- |
| Route policy coverage (Hono router, five kinds) | `tests/permissions/` | Every PR |
| Permission matrix — capability and reach; custom-role property tests | `tests/permissions/` | Every PR |
| IDOR fuzz — other-tenant ids on every scoped route | `tests/permissions/` | Every PR |
| Tenant isolation | `tests/api-integration/` | Every PR |
| Negative E2E (incl. CSRF, forged `X-Forwarded-For`, cross-origin WS, re-auth on revoke) | `tests/e2e/security/` | Every PR |
| Auth reconfiguration suite | `tests/api-integration/auth/` | Every PR |
| Dependency audit | CI | Every PR |
| Container scan, SBOM, signing | CI | Every release |
| Service-key clamp, owner-team reach, webhook delivery reach, OIDC PKCE/`state`/`nonce`, MCP injection | `tests/permissions/`, `tests/api-integration/auth/`, `tests/mcp/` | Every PR |
| SCIM/Entra acceptance tests 01–17 ([identity-provisioning.md](../03-features/identity-provisioning.md#testing)) — against a **real Entra test tenant** before the P3 identity gate | `tests/api-integration/identity/` | Every PR (mock IdP); P3 gate (real tenant) |
| Pending-action suite ([pending-actions.md](pending-actions.md#testing)) — 202-not-performed, no self-approval from API/MCP/impersonation, target/payload binding, single use, expiry, re-authorisation, step-up | `tests/api-integration/pending-actions/`, `tests/e2e/security/` | Every PR |
| Session-only routes refuse API and MCP keys | `tests/permissions/session-only.test.ts` | Every PR |

### The evidence chain

A control in this document is an *intention* until its test runs green. The P0 and P3
exit criteria cite this table, not the prose above:

| Planned control | Evidence |
| --- | --- |
| Every route has a policy | `route-coverage.test.ts` green on the inherited kaneo surface |
| No cross-tenant reads | `idor-fuzz.test.ts`, tenant-isolation suite green |
| No forged proxy IP | `forged-x-forwarded-for-moves-no-bucket.spec.ts` green |
| MCP cannot approve a deletion | `approval-rejected-from-api-key-and-mcp-key.test.ts` green |
| Customer session cannot reach agent routes | `portal-session-rejected-on-agent-origin.spec.ts` green |
| WebSocket drops revoked access | `ws-revoked-membership-stops-events.spec.ts` green |
| Service key cannot exceed creator | `service-key-cannot-exceed-creator.spec.ts` green |
| Entra SCIM is tenant-bound | `04-scim-token-cannot-touch-other-organisation.test.ts`, `06-customer-connection-cannot-create-staff-or-authority.test.ts` green against a real Entra tenant |
| OIDC is safe | `15-oidc-protocol-failures-block-sign-in.test.ts` green |
| Deletion is never immediate | `delete-returns-202-and-deletes-nothing.test.ts` green |
| Opus security review | PR template, phase gate | Every PR touching security surfaces; every phase; **the P0 router retrofit explicitly** |
| Independent red-team pass — authorization surface, portal boundary, inherited kaneo routes | Internal (a fresh Opus context with the hostile seed, not the authoring session) | **At the go-live gate**, before real customer data — the calendar does not move this |
| Penetration test | External | Before first external customer, then annually ([risks.md](../07-planning/risks.md) R19) |

## Incident response

| | |
| --- | --- |
| **Contact** | `security@<domain>` (in `SECURITY.md`); Thomas is the owner until a rota exists |
| **Triage** | S1 active breach or credential exposure — respond within 1 h; S2 exploitable vulnerability — 24 h; S3 hardening — next release |
| **Contain** | Revoke sessions (rotate `TASKDESK_AUTH_SECRET`), revoke all API keys, rotate webhook secrets, disable the affected plugin or account — all God Mode incident actions |
| **Assess** | The audit log is the source of truth for what was touched; the hash chain proves it is intact |
| **Notify** | Affected organisations within 72 h, per contractual obligation; downstream operators via advisory |
| **Remediate** | Fix, regression test, patch release the same day |
| **Record** | Decision log entry and a lesson added here |

Full procedure: [runbook](../05-operations/runbook.md).

## Related

- [RBAC](rbac.md) · [Auth and identity](auth-and-identity.md) · [Auth runtime reconfiguration](auth-runtime-reconfiguration.md)
- [Pending actions](pending-actions.md) · [Identity provisioning — SCIM/Entra](../03-features/identity-provisioning.md)
- [Multi-tenancy](multi-tenancy.md) · [Realtime](realtime.md) · [Plugin architecture](plugin-architecture.md)
- [Testing strategy](../04-engineering/testing-strategy.md) · [Data protection](../05-operations/data-protection.md)
