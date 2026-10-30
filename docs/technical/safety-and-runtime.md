# Safety and runtime contracts

This is the maintained P0 safety/runtime reference. It states required behavior, not source completeness, passed tests, deployment acceptance or a review report. Current Thomas instructions and applicable recorded owner decisions take precedence. Preserve the original Kaneo interface and interactions while applying these server controls.

The sixteen PA definitions retain their full original wording, including embedded historical implementation commentary. Those sentences are provenance, not current status; unsupported required proof still fails closed. Only link destinations and editorial heading/indentation are normalized. The requirements index retains original source text and provenance separately. Required-case sections name behavior to verify and do not assert that a named test exists or passes.

Shared registries remain in [permissions](permissions.md), [data model](data-model.md), [features/plugins](features.md), [events](events.md), [background jobs](background-jobs.md), [configuration](configuration.md), and [workspace boundaries](workspace-boundaries.md). Do not add parallel authority, identifiers or customer-specific source configuration. The [integration contracts](../contracts.md) record applicable current behavior decisions.

## Contents

- [Api design](#api-design)
- [Auth and identity](#auth-and-identity)
- [Auth runtime reconfiguration](#auth-runtime-reconfiguration)
- [Multi tenancy](#multi-tenancy)
- [Observability](#observability)
- [Pending actions](#pending-actions)
- [Realtime](#realtime)
- [Security model](#security-model)
- [Storage and attachments](#storage-and-attachments)

<a id="api-design"></a>
## API design
<a id="api-design-scim-group-mapping-selector-options"></a>
### SCIM group-mapping selector options

`GET /api/instance/identity-connections/{id}/scim/mapping-options` is a safe,
session-only instance-administrator read used by the SCIM group-mapping editor. A missing
identity connection or SCIM child returns the same `404`. It returns only target and role
IDs, display names, and role ranks; it never returns membership, grants, capabilities,
provider data, or credentials. This selector read grants no authority.

The result is connection-bound and uses the same eligibility predicate as
`validateScimMappingRole` for mapping writes. For a customer connection it returns only the
connection's active, portal-enabled, non-internal organisation and its existing `customer`
role. For an agent connection, a request without `workspaceId` returns eligible active
workspaces in the active internal organisation; a request with `workspaceId` returns only
existing roles valid for that workspace, its connection's `maxRoleRank`, and the mapping
capability exclusions. An agent workspace role must be workspace-scoped or global as the
existing validator allows, match the selected workspace if scoped, have a valid capability
set, be at or below the configured rank ceiling, and contain no `instance:*` capability.
Customer mappings remain fixed to their connection organisation and `customer` role.
Target/role reads must share the write validator rather than maintaining a second eligibility
interpretation.

Both agent result sets are paged in stable ID order. `limit` defaults to 50 and is bounded
to 100; `cursor` is an opaque continuation for the same connection, result kind, and
workspace selection. The response includes `nextCursor: string | null`; callers must follow
it to enumerate all options and may not treat one page as the complete set. Invalid query
combinations or cursors return `400`; they never widen the selection. The route is
`instance:admin`, `scope: instance`, `sessionOnly: true`, read-only/elevation-exempt because
it returns only selector metadata and performs no mutation.

<a id="api-design-identity-connection-provisioning-event-history"></a>
### Identity connection provisioning-event history

`GET /api/instance/identity-connections/{id}/events` returns a connection-scoped page of
the persisted provisioning ledger to an instance administrator. The parent connection is
looked up first; a missing connection returns the same `404` as an unavailable connection.
The optional `limit` defaults to 25 and is bounded to 1–100. The optional opaque version-1
cursor is bound to the path connection id and the last `(created_at,id)` pair, preserving
PostgreSQL timestamp precision in its continuation. Pages sort descending by both fields,
so equal timestamps remain deterministic. A malformed cursor or one made for another
connection returns `400`.

The response is `{data: EventSummary[], page: {nextCursor, hasMore}}`; each summary contains
exactly `kind`, `outcome`, `actorType`, and ISO `createdAt`. It deliberately omits database
event ids, trace ids, structured `detail`, and a total count. Event detail is internal
write-side evidence and is not rendered by this endpoint. The endpoint is read-only,
instance-admin-only, and elevation-exempt; the browser follows `nextCursor` in the existing
identity-editor URL query state.

REST over HTTP, described by an OpenAPI document generated from Zod schemas via
`@hono/zod-openapi`. **The OpenAPI document is the published contract for third parties**
(MCP clients, importers, customers' integrations, the Scalar reference); **the in-repo
client is a Hono RPC client typed structurally from the route definitions**, not generated
from the spec — see [Typed client](#api-design-typed-client).

**OpenAPI version.** Publish the actual version emitted and validated by the toolchain. The retained contract uses OpenAPI 3.1; adopt a later compatible version only when emitter and validators support it, without claiming unsupported output.

<a id="api-design-principles"></a>
### Principles

1. **Schema first.** Request and response shapes are Zod schemas. The OpenAPI document
   derives from them and the Hono RPC types derive from the same route definitions. There
   is no hand-written spec to drift.
2. **Explicit response schemas.** Handlers never return a Drizzle row. They map to a
   response schema. This is how secrets and internal columns stay off the wire.
3. **Every route declares a policy** — one of the five kinds in [RBAC](permissions.md). No
   policy ⇒ build fails.
4. **Boring REST.** Nouns, plural, kebab-case. Verbs live in HTTP methods, except for
   genuine actions which get an explicit sub-resource.
5. **Errors are machine-readable.** RFC 9457 problem details, always.
6. **CSRF is a cookie-only concern.** The `Origin`/`Referer` check and the double-submit
   token apply **only to cookie-authenticated unsafe requests**, because the cookie is the
   only credential a browser attaches ambiently; requests bearing an API key, a bearer token
   or a SCIM token are exempt from both, and non-browser clients that send no `Origin` are
   not refused. Stated once in
   [security-model.md](#security-model-sessions-csrf-and-step-up) — this is a citation,
   not a second rule.

   `GET /api/me/csrf-token` issues the current live agent session's same-origin token to the
   browser with `Cache-Control: no-store`; custom unsafe cookie-session requests must echo it
   in `X-TaskDesk-CSRF`. Better Auth bootstrap/login endpoints keep their own trusted-origin
   checks. The detailed token, cookie, fallback and error contract is in the security model.

<a id="api-design-base-paths"></a>
### Base paths

| Prefix | Purpose | Policy kind |
| --- | --- | --- |
| `/api/*` | The application API | capability |
| `/api/me/*` | The caller's own records: settings, preferences, API keys, approvals | `authenticated + self` |
| `/api/public/*` | Unauthenticated: branding, `health/live` and `health/ready`, the login page's provider **buttons only** (label + id — never discovery URLs, tenant ids or domain restrictions), terminology, CSP reports, and the two origin-specific `POST /api/public/{agent|portal}/notification-preference-handoffs` routes (one-purpose signed email token; short-lived selector handoff only) | `public` with reason — **no exceptions**, so the router's blanket kind is true of every route under it |
| `/api/instance/*` | God Mode. `instance:*` capabilities. Includes the dependency-enumerating deep health check, `GET /api/instance/health/deep` — capability `instance:admin`, scope `instance`; it is **not** on the public router, and the `/metrics` bearer token is not an alternative credential for it | capability |
| `/api/portal/*` | Customer portal — a deliberately narrow, separate router | `portal` with predicate |
| `/auth/*` | better-auth handler | `delegated: better-auth` |
| `/ws` | WebSocket upgrade | `delegated: websocket` (Origin-checked — [realtime.md](#realtime)) |
| `/metrics` | Exact `GET /metrics` Prometheus scrape on its own Node listener, bearer-guarded | `delegated: metrics` |
| `/scim/v2/*` | Inbound SCIM 2.0 provisioning — Microsoft Entra first. `application/scim+json`. Authenticated by a per-connection bearer token that fixes the organisation, portal scope and allowed resources server-side ([identity-provisioning.md](feature-contracts-p3.md#identity-provisioning)) | `delegated: scim` |
| `/openapi.json` · `/docs` | Spec and Scalar reference UI | `public` |

<a id="api-design-metrics-listener-and-permission-coverage"></a>
#### Metrics listener and permission coverage

The `/metrics` route is served by a separate Node listener on fixed internal port 9464; it
is not mounted on the Hono API application and has no Traefik route. The module that starts
that listener exports its declarative listener manifest: listener port, exact method and
path, and delegated policy key `GET /metrics`. `tests/permissions/route-coverage.test.ts`
enumerates this manifest as well as `app.routes`. Coverage fails if the listener is present
without the delegated policy, if the policy is orphaned, or if the constructed listener
does not match its manifest. A handwritten test-only route list is insufficient evidence.

The listener accepts only `GET /metrics` without a query string. `HEAD`, `OPTIONS`, or any
other method on that path returns `405`; every other path returns `404`.

<a id="api-design-observability-administration-and-step-up"></a>
#### Observability administration and step-up

The instance administrator API contract is:

```
GET   /api/instance/observability                       instance:admin, instance scope
PATCH /api/instance/observability                       instance:admin, instance scope
POST  /api/instance/observability/metrics-token/rotate  instance:admin, instance scope, elevated, session-only
POST  /api/me/step-up/challenges                       authenticated + self, session-only
POST  /api/me/step-up                                   authenticated + self, session-only
```

GET returns exactly `{version, logLevels, metricsTokenConfigured,
metricsTokenRotatedAt}` with `Cache-Control: no-store`; neither digest nor token is included.
PATCH accepts only `{version, logLevels}`, uses compare-and-set on the singleton version,
audits changed keys only, and never accepts a token. A stale version returns `409
version_conflict` with the current safe version. Rotation accepts only `{version}`, returns
exactly `{version, token, metricsTokenRotatedAt}` once with `Cache-Control: no-store`, and
requires a single-use `X-TaskDesk-Step-Up-Token` bound to this exact operation, version and
canonical request body. For the operation binding, the parsed body is exactly one property,
`version`, whose value is a positive safe integer; request validation rejects unknown
properties. Syntactically valid JSON may contain insignificant whitespace or equivalent
JSON numeric spelling. The server serializes the validated value as UTF-8
`{"version":<base-10 integer>}` with no whitespace and hashes those canonical bytes for both
challenge and execution. It never hashes raw wire bytes or trusts a client hash. Equivalent
wire JSON therefore binds to the same semantic operation; a different parsed version or
extra property fails. Duplicate-key rejection is not implied by ordinary JSON/Zod parsing;
the parsed semantic value is the binding contract. Challenge and step-up mint responses are also
`Cache-Control: no-store`; the challenge nonce and step-up token each appear once.

Each successful configuration mutation appends the audit-only key
`instance.observability_changed`, with actor, trace id and changed keys (`logLevels` or
`metricsToken`) only; values, bearer token, hash and arbitrary before/after objects never
enter audit. An audit append failure follows AU-14: roll back the nested audit savepoint,
report the failure through the defined operational signal, and preserve the committed
configuration mutation.

The rotation binding is not implementable merely by marking the policy elevated. It depends
on a challenge/token verifier that actually validates the required fresh authentication
method and atomically consumes the token with the rotation CAS. Where the account's required
method cannot be verified, return `403 step_up_unavailable` and do not rotate. See
[security-model.md](#security-model-sessions-csrf-and-step-up) and
[pending-actions.md](#pending-actions) `PA-15`.

<a id="api-design-identity-connection-create-and-configuration-compare-and-set--pa-15"></a>
#### Identity-connection create and configuration compare-and-set — PA-15

`POST /api/instance/identity-connections` and
`PATCH /api/instance/identity-connections/{id}` require distinct session-only PA-15
operations, `identity_connection_create` and `identity_connection_configure`. Both require
current `instance:admin`; API keys are refused. Create is bound to fixed expected version
`1`, the exact collection route and the server-canonical complete validated request body.
PATCH is bound to the path connection id, current positive `configVersion`, exact route and
complete validated request body. Challenge and proof routes derive these bindings from the
same strict request; clients cannot provide a hash, route key or version outside the body.
Missing, expired, replayed, cross-route, cross-connection, stale-version or wrong-body proof
fails without mutation. The existing single-use transaction consumes proof in the same
transaction as the configuration CAS.

The create body is strict: `{portalScope, organisationId, defaultWorkspaceId, displayName,
tenantId, clientId, clientSecret, scopes, claimMapping, domainBindings, jitPolicy,
maxRoleRank}`. `providerType` is fixed to `entra`; the server derives `issuer` from the
tenant-specific Entra discovery document and derives `redirectUri` from the configured
portal origin and generated connection id. The server creates the id, starts at
`configVersion: 1`, and starts disabled. Customer scope requires its exact existing
organisation and null workspace/rank; agent scope has null organisation and validates any
configured JIT workspace/role using IP-3/IP-22. The required Entra app role is validated
even when JIT is disabled. The secret is encrypted with the existing per-row AES-256-GCM
helper before persistence and is never returned. The mutation response uses the existing
safe connection DTO.

PATCH accepts only `{configVersion, displayName?, clientId?, clientSecret?, scopes?,
claimMapping?, domainBindings?, defaultWorkspaceId?, jitPolicy?, maxRoleRank?, enabled?}`.
Omitted fields retain their current values; nullable `defaultWorkspaceId` and
`jitPolicy.default_role_id` explicitly clear those values where allowed. Unknown fields,
null secrets and empty replacement secrets are rejected. Connection id, provider, portal,
customer organisation, tenant, issuer and derived redirect URI are immutable; changing
tenant or ownership requires a separate connection and the existing typed-name deletion
workflow. Each successful create/configure/disable mutation advances the connection version
exactly once. A stale version returns `409 version_conflict` with only the current safe
version. Under the `IP-22` total lock order, changing JIT policy or lowering an enabled
agent connection's `max_role_rank` applies source-scoped grant retirement, projection,
audit/provisioning and existing event/outbox changes in the same transaction. Disabling
also revokes only sessions tagged with this connection id and retires only its external
grant sources; direct and other-connection sessions/grants remain. Re-enabling does not
restore retired grants; fresh validated identity evidence is required. Network discovery
occurs before locks, then the selected immutable connection facts and references are
revalidated under the complete IP-22 closure before commit.

Identity-connection creation and configuration require the distinct PA-15 operation bindings above; an ordinary configuration PATCH is not exempt. Connection deletion remains its separately
specified typed-name pending action. The `mfaUpstreamMode` column remains read-only and
defaults to `off`; this batch does not claim enforcement of the planned upstream-MFA modes.

The strict connection DTO may replace `claimMapping` only with the closed first-release
profile map `{ "version": 1, "displayName": "name" }`. Missing or null persisted data
means that exact default; malformed non-null persisted data fails OIDC login closed and is
repairable by saving the valid map with the current `configVersion`. No arbitrary claim
selector is accepted. The fixed `oid`/`tid` subject and
`email` → `preferred_username` → `upn` metadata precedence are not configurable. An absent
or invalid optional name is omitted; it is never synthesized from email or username. The
map changes profile metadata only and cannot select identity, tenant, portal, organisation,
role, capability or reach.

The connection DTO serializes `jitPolicy` as exactly `{ enabled, default_role_id,
required_entra_app_role }`. `enabled` is boolean, `default_role_id` is a canonical role id or
null, and `required_entra_app_role` is the exact nonempty Entra app-role value, preserved
byte-for-byte. Unknown persisted keys are never returned. A customer connection has only
the Customer role as its default. An enabled agent JIT default must remain within its
configured ceiling. Agent connections also return `defaultWorkspaceId`, the explicitly configured active internal workspace used for the JIT grant; customer connections return null. The server does not choose a workspace. If a later ceiling reduction makes the role ineligible, it is retained as
dormant policy and grants nothing. Enabling, saving or logging in with malformed admission
configuration fails closed.

The separate SCIM administration route uses the same parent version; its complete bounded
write and proof contract follows. Neither route maintains a child SCIM version. A successful
SCIM administration write makes a stale OIDC mapping or connection-config writer fail CAS,
and the reverse holds. Authenticated SCIM provisioning requests do not edit configuration
or advance this version; they still serialize grant changes under `IP-22`.

<a id="api-design-scim-administration-patch--issue-561-owner-contract"></a>
#### SCIM administration PATCH — issue #561 owner contract

`PATCH /api/instance/identity-connections/{id}/scim` is a God Mode operation with
`instance:admin`, `scope: instance`, `scopeSource: instance`, `elevated: true`, and
`sessionOnly: true` for **every** body variant. An API key, MCP key, SCIM bearer or
impersonation session receives `403 session_required` before proof issuance or mutation.
Unknown connections, absent SCIM child rows and foreign mapping ids receive the same `404`.
The route uses RFC 9457 errors and `Cache-Control: no-store`; it is distinct from
`/scim/v2/*` and never accepts a provisioning payload. No runtime route is authorized by
this documentation change alone.

The request is one of the following strict, closed objects. Each carries a positive safe
integer `configVersion`; unknown keys, extra nested keys, explicit `null` outside the one
nullable display snapshot, and multiple actions are rejected. A request makes exactly one
settings edit, one group-mapping edit or one attribute-map replacement, never a bulk
replacement across those categories.

```json
{ "configVersion": 7, "kind": "settings", "enabled": false }
{ "configVersion": 7, "kind": "settings", "allowedResources": ["users", "groups"], "lifecyclePolicy": "end_memberships" }
{ "configVersion": 7, "kind": "settings", "matchAttributes": ["externalId", "userName", "displayName"] }
{ "configVersion": 7, "kind": "mapping_create", "externalGroupId": "provider-group-id", "externalGroupNameSnapshot": null, "roleId": "...", "scope": "workspace", "scopeId": "...", "enabled": true }
{ "configVersion": 7, "kind": "mapping_update", "mappingId": "...", "externalGroupNameSnapshot": null, "roleId": "...", "scopeId": "...", "enabled": false }
{ "configVersion": 7, "kind": "attribute_mapping", "attributeMapping": { "version": 1, "name": "displayName", "email": "emails.primary.value", "jobTitle": "title", "locale": "preferredLanguage" } }
```

`settings` requires at least one of `enabled`, `allowedResources`, `lifecyclePolicy`,
`matchAttributes`.
`enabled` is boolean. `allowedResources` is a canonical set in the fixed order `users`,
`groups`: `users` is required; `groups` is optional; duplicates and other values fail
validation. `lifecyclePolicy` is `end_memberships` or `keep_memberships` and governs future
SCIM person deactivation only. Omitting a settings property preserves its stored value;
explicit null never clears it. A settings request that changes no persisted value is
rejected `422`, so a successful write always advances the version once.

`matchAttributes` is a nonempty, duplicate-free, case-sensitive array containing only
`externalId`, `userName`, `displayName`, `name.formatted`, `title`, and
`preferredLanguage`. It must contain both `externalId` and `userName`. Storage and response
order is canonical: those required names first, followed by optional names in the order
listed above. Omission preserves the persisted array; the default is
`["externalId", "userName"]`. This list permits optional names in the SCIM `/Users` `eq`
filter only; it does not add profile fields or identity lookups. Supported sources and the
explicitly unsupported `emails.value` and `locale` paths are specified in
[`identity-provisioning.md`](feature-contracts-p3.md#identity-provisioning-scim-endpoint).
Invalid or duplicate names, missing required names, and an unchanged effective setting
return `422`; successful writes use the same parent `configVersion` CAS and audit semantics
as other settings edits.

`mapping_create` requires `externalGroupId`, `roleId` and `scope`; `enabled` defaults true
and `externalGroupNameSnapshot` defaults null. `mapping_update` requires a mapping id
belonging to this SCIM connection and at least one mutable property among
`externalGroupNameSnapshot`, `roleId`, `scopeId`, `enabled`. The external group id, mapping
scope, parent connection and customer organisation are immutable. Omission preserves a
stored property; an explicit null clears only the display snapshot. A create may set that
snapshot to null; it is display-only and never authority evidence. Mapping updates that
change no persisted property return `422`. There is no mapping DELETE, bulk edit or
omission-as-removal: `enabled: false` retains history.

`externalGroupId` is a nonempty provider-opaque identifier of at most 255 UTF-8 bytes,
without control characters; it is compared byte-for-byte within the SCIM connection, not
converted from a display name, lowercased or inferred from an OIDC group id. The display
snapshot is null or a nonempty string of at most 255 UTF-8 bytes without control
characters. The persisted unique `(scim_connection_id, external_group_id)` prevents
duplicates; a duplicate create returns `409`. Ids and role references use the existing
repository id validators. Caller-supplied organisation, portal, person, external identity,
grant, capability, `seesAll`, token, token hash, `attributeMapping`, sync/health metadata,
creator and audit fields are rejected as unknown in the existing variants. The dedicated
`attribute_mapping` variant below is the sole exception; it cannot edit settings or group
mappings in the same request. Token create/rotate/revoke retain their separate
routes and proof rules.

`attribute_mapping` requires exactly the version plus four destination fields in the
`attributeMapping` object shown above
and changes only `scim_connection.attribute_mapping`. Its grammar is a closed map from
safe SCIM profile inputs to existing TaskDesk profile fields, not an expression language:
`version` is exactly integer `1`; `name` is `displayName` or `name.formatted`; `email` is
`emails.primary.value` or `userName`; `jobTitle` is `title` or `unmapped`; `locale` is
`preferredLanguage`, `locale`, or `unmapped`. The default stored mapping is the JSON
object shown above. A legacy null mapping is read as that default and is normalized only
by an explicit successful write. The four fields are always supplied together; unknown
paths, mixed-case aliases, wildcards, filters, transformations, nested objects, arrays,
empty values, and extra keys are rejected. A value of `unmapped` leaves that optional
profile field unchanged; it is forbidden for name or email. An identical effective
mapping is a `422` no-op without proof consumption or version advance.

The map's name destination is `person.display_name`, independent of account-wide
`user.name`; a placeholder can therefore have a profile before it has a login. The email
destination is the connection-scoped `external_identity.email_snapshot`, never a verified
login address or an automatic account-link key. Fixed `userName` is retained separately in
`external_identity.user_name_snapshot`. Job title and locale use the existing `person`
fields. Reads emit stored `displayName` and `name.formatted` values only; they do not derive
given/family components or substitute `userName` or email for a missing profile name. Existing
people without a stored display name remain without one; migration must not synthesize it
from account-wide names or identity snapshots. Profile data and identity snapshots remain
available after deactivation/reactivation.

The fixed identity keys (`id`, `externalId`, `userName` for lookup), `active`, group/member
links, portal, organisation, side, person/user ids, roles, grants, reach and capabilities
are outside this map and never configurable through it. `userName` as an email profile
value remains contact metadata only; it never links an account, verifies an address,
selects an organisation or admits a login. For `emails.primary.value`, choose the unique
`primary=true` item; with no marked primary, choose only if exactly one email item exists.
Zero or multiple candidates make a supplied email source invalid and reject that SCIM user
write without profile or authority mutation. A selected value must pass existing profile
validation. `POST` and replacement `PUT` require valid mapped name and email values;
their absence or invalidity fails the write atomically. A partial `PATCH` changes a mapped
profile field only when its source attribute is supplied; absent sources leave existing
values unchanged, while a supplied but invalid required source rejects the entire PATCH.
Missing optional title/locale leaves the current value unchanged. Never fall back to another
attribute implicitly. Changing a map affects **future** authenticated SCIM user writes
only; it does not reinterpret old payloads, retroactively rewrite profiles, create grants,
or alter live sessions. Raw incoming attributes remain untrusted and are never stored in
the mapping or audit detail.

For a customer connection, mapping `scope` must be `organisation`, `scopeId` is omitted
on create/update and resolved only from the persisted connection, and `roleId` must name
the existing customer role. For an agent connection, mapping `scope` must be `workspace`,
`scopeId` is required on create and, when changing a target, on update. The target must be
an existing non-deleted workspace owned by the unique active, non-deleted internal
organisation, with a current approved staff role in that workspace at or below the
connection's current `max_role_rank`. The persisted portal/organisation, SCIM child
ownership, role side/scope/rank/capabilities, target lifecycle and administrator authority
guardrails are rechecked under `IP-22` locks for **all** mapping writes, including a
disabled row or a display-only edit. `groups` must be allowed and the SCIM child must be
enabled to create or enable a mapping. A disabled mapping may be edited while the child is
disabled but remains ineligible. Removing `groups` remains permitted and retires its active
grants. No mapping can
grant `instance:admin`, `sees_all` or a role with forbidden external capabilities. The
provider never chooses a scope, role or organisation. Invalid persisted state fails closed.

`200` returns exactly `{data: ScimAdminDto, configVersion}` where `ScimAdminDto` contains
`enabled`, `allowedResources`, `lifecyclePolicy`, `attributeMapping` and `mappings`. The
attribute mapping is the effective validated versioned safe profile map above; it contains
no provider payload or secret. Each group mapping contains
exactly `id`, `externalGroupId`, `externalGroupNameSnapshot`, `roleId`, `scope`, `scopeId`,
`enabled`; mappings are ordered by external group id then id. `scopeId` is the resolved
persisted organisation id for customer mappings. The response version is the incremented
parent version. No raw bearer, prefix, token hash, client secret, raw claim, member list,
sync error detail or unlisted column is returned. The existing God Mode
connection read must use this same safe SCIM projection when it displays these fields.

The handler compares body `configVersion` to the locked
`identity_connection.config_version` and increments that parent version exactly once per
committed request. A stale version returns `409 version_conflict` containing only the
current safe version and makes no settings, mapping, grant, history, event or proof change.
Invalid shape or foreign resource fails before mutation; invalid role/scope/authority
returns `422` without a secret-bearing field echo. The PA-15 proof is mandatory for all
variants. Challenge and proof completion bind the dedicated `scim_admin_update` operation,
this fixed PATCH route, path connection id, expected persisted parent version and the
server-canonical validated body. Canonical JSON is the closed envelope
`{routeKey, connectionId, request}`. The server serializes fields in the order shown in
the variants above, omits absent optional properties, preserves explicit display-snapshot
null, applies create defaults, canonicalizes allowed-resource order, and serializes the
complete attribute-map object in `version`, `name`, `email`, `jobTitle`, `locale` order
before hashing UTF-8 bytes. The client supplies neither route key nor hash. Execution recomputes it and
consumes the one-use proof with CAS and mutation in one transaction; stale CAS or failed
validation rolls back consumption. An unavailable fresh supported verifier returns
`403 step_up_unavailable`; no OIDC, MFA-reset or metrics proof is accepted.

<a id="api-design-scim-token-rotation-and-revocation--pa-15-operations"></a>
#### SCIM token rotation and revocation — PA-15 operations

The separate token lifecycle routes are session-only God Mode operations:

```
POST /api/instance/identity-connections/{id}/scim/rotate-token
POST /api/instance/identity-connections/{id}/scim/revoke-token
```

Both accept exactly `{ "version": <positive safe integer> }`, use
`identity_connection.config_version` as the compare-and-set value, require
`instance:admin`, and require their distinct `scim_token_rotate` or
`scim_token_revoke` PA-15 binding. Challenge, proof mint and execution bind the exact route,
connection id and canonical UTF-8 `{"version":<base-10 integer>}`; no other operation's
proof is accepted. A stale version returns `409 version_conflict` without consuming proof or
changing the token. Each committed operation increments the parent version exactly once,
sets the SCIM child disabled and invalidates the old bearer immediately. Rotation returns
`{configVersion, token, tokenRotatedAt}` once with `Cache-Control: no-store`; the token is a
fresh 32-byte random value encoded as unpadded base64url. Revoke returns only
`{configVersion, revoked: true}`. Revoking an already absent token is a `422` no-op and
does not consume proof. Re-enabling SCIM requires a later settings PATCH after the upstream
bearer has been updated.

Both operations record only the changed key and new version in `identity_connection.changed`
audit detail, and a `token.rotated` or `token.revoked` provisioning event with connection
id and version. Raw tokens, token prefixes, hashes and bearer header values never enter
audit, event details, logs or read DTOs. Audit append failure follows AU-14; the mutation
commits with the durable operational alert. The response and step-up credentials are
no-store.

`IP-22` governs pre-discovery, total parent-first lock order, closure re-read/retry and
atomic source-validity projection. Disabling this SCIM child or removing `groups` retires
only its active `scim_group` grants (`connection_disabled` for child disable;
`mapping_changed` for removed group eligibility), repairs linked `scim_group_member`
history/pointers and recomputes each affected effective membership. Attribute-map edits
change profile interpretation for future SCIM user writes and retire no grant. Disabling,
retargeting
or changing a mapping retires only that mapping's active grants (`mapping_disabled` or
`mapping_changed`); display-only edits and lifecycle-policy edits retire none. Re-enabling
the child or mapping, or restoring `groups`, creates no grant: later authenticated
same-connection SCIM evidence is required. Parent connection disable retains its broader
session-revocation rule. This child-only edit does not revoke OIDC sessions. Existing
`IP-24` provisioning/audit rows commit with the mutation and existing outbox/authority
cache invalidation follows commit; details contain ids/changed keys/reasons only. An audit
append failure follows `AU-14`, not a fabricated rollback claim. No new event key is
introduced.

<a id="api-design-oidc-group-mapping-administration"></a>
#### OIDC group-mapping administration

The existing agent connection editor and organisation Identity tab use this single route
family. The organisation screen is server-filtered through the connection's persisted
`organisation_id`; it does not supply or select an organisation in a mapping request.

```
GET   /api/instance/identity-connections/{id}/oidc-group-mappings
      instance:admin, instance scope, elevated: false
POST  /api/instance/identity-connections/{id}/oidc-group-mappings
      instance:admin, instance scope, elevated, session-only
PATCH /api/instance/identity-connections/{id}/oidc-group-mappings/{mappingId}
      instance:admin, instance scope, elevated, session-only
```

The GET policy declares `scopeSource: instance` and an explicit elevation exemption reason:
read-only mapping configuration returns no credentials or provider claims. Each route
requires `instance:admin`, `scope: instance`, and `scopeSource: instance`; mapping writes
also require `elevated: true` and `sessionOnly: true`. API keys, MCP keys and impersonation
sessions receive `403 session_required` before a write or step-up operation. The collection
and item handlers load the connection from `{id}`; an item must belong to that connection.
Unknown connections and missing or foreign mapping ids share the same `404` response.

All request objects are strict and reject unknown properties. In particular, callers cannot
supply `organisationId`, `portalScope`, capabilities, `seesAll`, grant source, `createdBy`,
or external identity/person ids. These routes accept only God Mode session requests; neither
OIDC claims nor a SCIM bearer can invoke them. Errors use RFC 9457 problem details, never
SCIM error objects. Administrator configuration responses use `Cache-Control: no-store`.

`MappingDto` is an explicit projection of the persisted mapping and contains exactly:

```json
{
  "id": "...",
  "externalGroupId": "...",
  "externalGroupNameSnapshot": null,
  "roleId": "...",
  "scope": "organisation",
  "scopeId": "...",
  "enabled": true,
  "createdAt": "...",
  "updatedAt": "..."
}
```

`scopeId` is the persisted organisation id for customer mappings and workspace id for agent
mappings. No provider response, raw claim list, credential, secret or unlisted database
column is returned. GET returns `{data: MappingDto[], configVersion}` ordered by immutable
`externalGroupId`; `configVersion` is the current positive `identity_connection.config_version`.

POST accepts exactly `{configVersion, externalGroupId, externalGroupNameSnapshot?, roleId,
scope, scopeId?, enabled?}`. `configVersion` is a positive safe integer. The immutable
`externalGroupId` is a canonical lower-case, hyphenated Entra object-id UUID, validated by
the same canonicalizer used for the IP-28 token `groups` array before matching or
uniqueness validation. A malformed id is rejected. It is never a group name or email.
`externalGroupNameSnapshot` is display-only and defaults to null; `enabled` defaults to
true. Customer connections require `scope: "organisation"`, omit `scopeId`, resolve the
persisted scope id from the connection's organisation, and accept only the existing customer
role. Agent connections require `scope: "workspace"`, an existing workspace with
`deleted_at IS NULL` owned by the unique active, non-deleted internal organisation, and an
existing staff role scoped to that workspace. The instance administrator explicitly selects
the workspace. Create, target change, enable and login reconciliation revalidate this
predicate and the role's current rank/capabilities under `max_role_rank`; neither the agent
connection nor provider data chooses the workspace. Agent connections keep
`organisation_id = NULL`. See `IP-3` and `IP-20` in
[identity-provisioning.md](feature-contracts-p3.md#identity-provisioning).
`201` returns `{data: MappingDto, configVersion}` with the incremented version.

PATCH accepts exactly `{configVersion, externalGroupNameSnapshot?, roleId?, scopeId?,
enabled?}` and requires at least one mutable property. `externalGroupId`, `scope`, the
connection, organisation and portal scope cannot change through PATCH. A customer mapping
cannot change its resolved organisation target. An agent `scopeId` change is a target
change. `200` returns `{data: MappingDto, configVersion}` with the incremented version.
There is no mapping DELETE, bulk replacement, or omission-as-removal operation in the first
release; `enabled: false` is the administrative removal action and preserves mapping and
grant/audit history.

Every create, edit and enable revalidates the current Entra connection, portal and
organisation, target ownership, role existence and side/scope, current rank against
`max_role_rank`, administrator authority/rank guardrails and forbidden capabilities. All
mapping writes are unconditionally elevated even for customer, display-only or otherwise
non-authority changes; the SCIM mapping elevation thresholds do not apply to these OIDC
routes (IP-6). The
same validation runs for disabled rows. A mapping can never mint a role or capability,
`instance:admin`, `sees_all`, customer-to-staff access or cross-organisation/workspace reach.
Invalid persisted mappings fail closed at read and reconciliation boundaries. The write
compares body `configVersion` with `identity_connection.config_version` under the same
connection lock/transaction as the mapping mutation and advances it exactly once on success.
Stale versions return `409 version_conflict` with only the current safe version; duplicate
`(identity_connection_id, external_group_id)` returns `409`; validation failures return
`422` with field errors; unknown/foreign resources remain masked as `404`; missing
capability/elevation is `403`. A failed check makes no mapping, grant or version change.

Both writes always require a PA-15 operation-bound step-up confirmation, not only when a
handler decides the selected role is risky. PA-15 registers
`oidc_group_mapping_create` for the POST route and `oidc_group_mapping_update` for the PATCH
route. Challenge and proof-completion requests bind the operation key, exact route,
connection id, mapping id for update, expected `configVersion`, and the strict validated
request body. The server serializes the schema-parsed body in declared property order,
omitting absent optional fields while preserving explicit nulls and applying declared
defaults, then hashes UTF-8 JSON for the closed envelope `{routeKey, connectionId,
mappingId?, request}`. Neither client-selected route keys nor client-supplied hashes are
accepted. Execution recomputes the same envelope from the path and validated body and
consumes the five-minute single-use proof atomically with the version compare-and-set and
mutation. A stale version or failed validation rolls back token consumption; retry requires
a new challenge for the current version and exact request. An unavailable required factor
or SSO verifier returns `403 step_up_unavailable` without mutation. This proof is not the
metrics rotation operation and does not create a session-wide freshness window.

In one write transaction, use the shared `IP-22` total lock order and closure
rediscovery/retry; revalidate caller authority, mapping, role and rank under those locks.
Create makes no grant; a later validated OIDC login must observe the group claim. Disable,
role change or target change retires only active OIDC grants from that mapping, recomputes
each affected one-role effective membership, writes the existing
`provisioning_event` kind `group.mapping_changed` and safe `audit_log` evidence under
AU-14, and publishes authority-cache invalidation after commit. Re-enable never resurrects
retired grants before a later validated OIDC login through this connection with complete
matching groups and current admission. A SCIM update cannot restore an OIDC grant; SCIM
grants require fresh authenticated SCIM evidence. A write for connection A cannot change
connection B, SCIM, direct or another mapping's grants. No Graph lookup or new event key is
introduced. The existing identity-connection DELETE remains the PA-5/GM-6 pending-action
operation.

<a id="api-design-why-apiportal-is-separate"></a>
#### Why `/api/portal/*` is separate

The portal router is a small, hand-audited surface rather than the same handlers with a
role check. Fewer endpoints to reason about, no chance of a staff-only query parameter
being honoured for a customer, and the whole router can be reviewed in one sitting. Its
handlers reuse the domain layer but never share request shapes **or routes** with the
agent API — a single route serving "either session" is forbidden
([ADR 0004](design-and-decisions.md#0004-two-portals-two-origins)).

<a id="api-design-path-parameters--one-convention"></a>
### Path parameters — one convention

| Parameter | Form | Example |
| --- | --- | --- |
| Work items | `{key}` — the human key | `/api/work-items/SUP-1234` |
| Projects | `{projectId}` — CUID2 | `/api/projects/{projectId}` |
| Submissions | `{ref}` — `SUB-n` | `/api/submissions/SUB-88` |
| Everything else | `{id}` — CUID2 | `/api/webhooks/{id}` |

Work items are addressed by **key** because the key is what people copy out of chat
messages. Ids remain in payloads for machine use. Policy keys in `policy.ts` use exactly
these forms, and `PolicyMap<typeof routes>` makes a mismatch a type error.

<a id="api-design-workspace-context"></a>
### Workspace context

Many routes are workspace-scoped but carry no workspace in the path (`/api/custom-fields`,
`/api/capabilities`, `/api/webhooks`, `/api/views`). They read the
workspace from the **`X-Workspace-Id` header** (or `?workspace=` for GET), which the
policy middleware validates against the identity's memberships **before** the policy
check. Absent ⇒ `400`; not a member ⇒ `404`. The typed client sets the header from the
current workspace automatically; there is no other mechanism.

Notification inbox routes under `/api/notification` are authenticated-self routes: they
derive `person_id` from the session and do not require workspace context. Each returned or
mutated notification must also pass reach filtering for its referenced resource under that
resource's policy; inaccessible or deleted resources are omitted from collections and
cannot be read or mutated by id. Notification preference routes are self routes too, but
workspace- and project-scoped preference routes validate the selected scope against the
person's current reach.

<a id="api-design-url-shape"></a>
### URL shape

```
GET    /api/projects
POST   /api/projects
GET    /api/projects/{projectId}
PATCH  /api/projects/{projectId}
DELETE /api/projects/{projectId}

GET    /api/projects/{projectId}/states             ← active concrete states in project order, including empty ones
GET    /api/projects/{projectId}/work-items
POST   /api/projects/{projectId}/work-items

GET    /api/work-items/{key}
PATCH  /api/work-items/{key}
GET    /api/work-items/{key}/transitions      ← legal offers, each with toStateName
POST   /api/work-items/{key}/transition      ← action: state change with note
POST   /api/work-items/{key}/assign
POST   /api/work-items/{key}/watch
DELETE /api/work-items/{key}/watch
GET    /api/work-items/{key}/activity
POST   /api/work-items/{key}/comments
GET    /api/work-items/{key}/comments/mention-candidates
POST   /api/work-items/{key}/comments/mention-preflight
GET    /api/work-items/{key}/comments/{id}/versions
GET    /api/work-items/{key}/sla             ← computed fresh, never stored
```

<a id="api-design-collections"></a>
### Collections

Cursor pagination. Offset pagination is not offered — it is wrong under concurrent
writes and it is slow at depth. The one exception is `/scim/v2/*`, where SCIM 2.0 mandates
1-based `startIndex`/`count` and Microsoft Entra sends exactly that
([identity-provisioning.md](feature-contracts-p3.md#identity-provisioning) `IP-13`); it is the
only offset-paginated surface, and it is small.

```
GET /api/projects/{projectId}/work-items
    ?cursor=<opaque>
    &limit=50                       (default 50, max 200)
    &state=in_progress,blocked
    &assignee=me|<personId>|none
    &priority=high,urgent
    &label=<id>
    &due_before=2026-10-01
    &q=printer
    &sort=key|position|title|priority|dueDate   (list route only; position is the rank order)
    &dir=asc|desc
```

```json
{
  "data": [ … ],
  "page": { "nextCursor": "…", "hasMore": true },
  "meta": { "total": 1284 }
}
```

`meta.total` is an estimate for large sets and is documented as such.

**Lists and search are reach-filtered.** A collection or search that returns rows from more than
one project (the project list, workspace label list, `GET /api/search`, the saved-view list,
duplicate suggestions) returns only rows in projects the caller reaches, in the query itself, so
the rows, the page and every count are built from reachable rows only. An id outside reach
behaves as a missing one. See [rbac.md](permissions.md) § Reach.

<a id="api-design-query-grammar--filters-sort-grouping-aggregation"></a>
### Query grammar — filters, sort, grouping, aggregation

Complex queries — saved views, queues, tier 2 and tier 3 reports — use one structured
document, stored verbatim as `saved_view.query`. The request scope and pagination controls
are transport metadata around that document; they are not added to, or removed from, the
stored query:

```json
{
  "workspaceId": "ws_123",
  "query": {
    "entity": "work_item",
    "filter": {
      "op": "and",
      "clauses": [
        { "field": "state.group", "op": "in", "value": ["started"] },
        { "field": "assignee", "op": "eq", "value": "@me" }
      ]
    },
    "sort": [{ "field": "priority", "order": "desc" }],
    "columns": ["key", "title", "state", "assignee"]
  },
  "limit": 50,
  "cursor": null
}
```

<a id="api-design-work-item-search-v1-post-apiwork-itemssearch"></a>
#### Work-item search v1 (`POST /api/work-items/search`)

P1 implements only `entity: "work_item"`. The required `workspaceId` is resolved from the
JSON body by `workspaceAccess.fromBody("workspaceId")` before the route's
`work_item:read` check. It is never inferred from a `project` filter, a saved-view owner, or
the currently selected browser workspace. A missing or malformed id returns `400`; an
unreachable workspace is masked as `404`. The route returns only live work items in that
workspace and in the actor's project reach. Search predicates are applied after that scope,
and `meta.total` counts only those same reachable rows.
A customer principal receives `403` from this route.

The `query` object keeps the `{ entity, filter, sort, groupBy, columns, aggregate }`
envelope. Its `entity` must be `work_item`. P1 accepts `filter`, `sort`, and `columns`;
`groupBy` and `aggregate` are later-phase query features and receive `422` when supplied.
Other entities in the wider grammar (`submission`, `time_entry`, `sla_event`) also receive
`422` on this P1 route. Unknown keys and malformed shapes receive `400`; they are never
silently dropped. The text editor is a filter editor; switching modes preserves the other
query-document properties byte-for-byte at the JSON value level.

The P1 filter tree contains only `and` and `or` groups with nonempty `clauses`, or a leaf
`{ "field", "op", "value" }`. It is bounded to 64 leaves, depth 8, 32 clauses per group,
and a 32 KiB JSON request body. Values are typed by the field table below. Operators not
listed for a field, unknown fields, and values of the wrong type return `400`. A recognized
field that is unavailable in this implementation or whose field-level read requirement is
not met returns `422` naming that field.

| Structured field | P1 operators and values | Field read capability | SQL source / notes |
| --- | --- | --- | --- |
| `state.group` | `eq` string; `in` nonempty string array (1–20). Values: `backlog`, `unstarted`, `started`, `completed`, `cancelled` | `work_item:read` | `state.state_template_id → state_template.group` |
| `priority` | `eq`, `in` (1–4), `gt`, `gte`, `lt`, `lte`; values `low`, `medium`, `high`, `urgent` in that order | `work_item:read` | `work_item.priority`; comparison uses the declared order, not text collation |
| `assignee` | `eq` with the literal `@me` | `work_item:read` | Resolved at query time to the authenticated person's `person.id`; no caller-selected person id in v1 |
| `requester` | `eq` with the literal `@me` (VW-32 search-profile extension) | `work_item:read` | `work_item.requester_id`, resolved to the authenticated person's `person.id` at query time; workspace and project reach still apply |
| `watcher` | `contains` with the literal `@me` | `work_item:read` | `watcher` rows for the authenticated person with `muted = false` |
| `dueDate` | `lt`, `lte`, `gt`, `gte`; ISO calendar date or relative day value such as `7d` | `work_item:read` | `work_item.due_date`; `Nd` is a fixed duration of N×24 hours from the request's captured query time, with N from 1–3650; null dates do not match comparisons |
| `createdAt` | `lt`, `lte`, `gt`, `gte`; ISO calendar date | `work_item:read` | `work_item.created_at`; a date means midnight UTC at the start of that date; null is not applicable |
| `project` | `eq` slug string | `project:read` | `project.slug`, joined within the resolved workspace |
| `type` | `eq` key string | `workspace:read` | `work_item_type.key`, joined within the resolved workspace |

Recognized fields whose authoritative storage, visibility or loader contract is unavailable return `422` naming the field, never a false predicate. The retained first-search profile defers `sla.state`, `sla.due_at`, `cf.<key>` and `label`; enabling one requires its owning persistence/visibility contract and an explicit search-profile extension. This is not a current implementation-status claim.

`filter` may be omitted, which means every live, reachable work item in the required
workspace. `sort` is an array of zero or one item from `key`, `title`, `priority`, or
`dueDate`, with `order` `asc` or `desc`; omission defaults to `key asc`. `id asc` is always
the stable tie-break. `columns` is an optional, duplicate-free subset of `key`, `title`,
`state`, `assignee`, `priority`, and `dueDate`; omission means all six. It is presentation
metadata and does not weaken field-read checks or change the response row schema.

The request `limit` defaults to 50 and must be 1–200. `cursor` is either omitted/null or an
opaque continuation from this route. A continuation is bound to the authenticated actor,
workspace, normalized query document, and limit; a mismatch or malformed cursor returns
`400`. The cursor is keyset-based and preserves the declared sort plus the stable id
tie-break. Response shape is `{ data, page: { nextCursor, hasMore }, meta: { total } }`;
`meta.total` is an exact count of rows after workspace scope, project reach, live-row
exclusion, and filter predicates. The page rows use the explicit work-item list response
schema, never raw Drizzle rows.

The work-item list's P1 text syntax is a filter-only rendering of the same AST. Adjacent
terms are `and`; `AND` is explicit conjunction; `OR` is disjunction; parentheses preserve
infix-expression nesting. The canonical printer renders every AST group explicitly as
`AND(clause,...)` or `OR(clause,...)`, reusing the existing Boolean operators with the
grammar's comma and parenthesis delimiters so operator, arity (including one-child groups),
nested same-operator groups, and clause order round-trip exactly. The text parser also accepts
the infix forms below. Field
aliases in the existing examples are canonical (`state` → `state.group`, `due` → `dueDate`,
`created` → `createdAt`). Examples include `assignee:@me state:started`,
`priority:>=high`, `due:<7d`, `project:SUP`, `type:incident`,
`created:>2026-01-01`, and `watcher:contains(@me)`. `in` uses
`field:in(value1,value2)`. Whitespace or reserved punctuation in a string value is represented
with a JSON-quoted string. Comparisons use `<`, `<=`, `>`, `>=`; the parser has no escape
that can introduce a field, operator, or SQL fragment. Parsing and printing preserve the
filter tree, values, and clause order; sort and columns stay unchanged in the surrounding
query document when the user switches modes.

The P1 endpoint compiles only these validated nodes to parameterized Drizzle SQL. Field
expressions are fixed server-side mappings; values are always bound parameters. The scoped
workspace and actor's project reach are established before filter compilation and are
present in both the page and count read chains. A field-level read denial is `422` naming the
field; it is never converted into an empty result or a different `meta.total`.

The wider, future grammar continues to use the same envelope. It lists all product entities,
future fields and report clauses; it does not make those later-phase facilities available
through this P1 endpoint before their owning storage and authorization contracts exist.

The canonical query document, without transport metadata, is:

```json
{
  "entity": "work_item",
  "filter": {
    "op": "and",
    "clauses": [
      { "field": "state.group", "op": "in", "value": ["started"] },
      { "op": "or", "clauses": [
        { "field": "assignee", "op": "eq", "value": "@me" },
        { "field": "watcher",  "op": "contains", "value": "@me" }
      ]}
    ]
  },
  "sort":    [{ "field": "priority", "order": "desc" }],
  "columns": ["key", "title", "state", "assignee"]
}
```

- The wider product grammar names `work_item | submission | time_entry | sla_event`. P1's
  `/api/work-items/search` implementation accepts `work_item` only. A queue over
  submissions *and* work items is two saved views presented together, not one document.
- **Fields are whitelisted per entity**; `cf.<key>` addresses a custom field; `organisation`
  resolves through `project.organisation_id`; `state.group` is not a stored column — it
  resolves through the join `state.state_template_id → state_template.group`
  ([data-model.md](data-model.md) §3); `sla.state` and `sla.due_at` resolve against
  `work_item_sla_cache` and are **eventually consistent** (five-minute refresh) — the
  detail endpoint always recomputes, and where they disagree the computed value wins
  ([ADR 0009](design-and-decisions.md#0009-lazy-sla-evaluation)).
- `groupBy` and `aggregate` (`count | sum { field } | avg { field } | percentile { field, p }`)
  are what tier 3 reports add; a plain saved view omits them. They are not accepted by the
  P1 endpoint until their owning report implementation lands.
- The grammar compiles to parameterised SQL and can never express arbitrary SQL.
- **Authorization inside the filter.** Every filterable field carries its own read
  capability; the request is `422` naming any recognized field the caller cannot read. The
  filter is evaluated **after** the identity scope is applied, and `meta.total` counts only
  rows within reach — so search can never become an existence oracle for records the caller
  may not see. The concrete P1 field set and field-level responses are listed above.

A saved view is exactly a stored query document plus a `layout`; there is **one** route
family for saved views, `/api/views`, defined in
[search-and-saved-views.md](feature-contracts-p1.md#search-and-saved-views). Reports do not add a
second.

<a id="api-design-actions"></a>
### Actions

Where an operation is not CRUD, it is a `POST` to a named sub-resource with a body:

```
POST /api/work-items/{key}/transition        { toStateId, note?, noteVisibility? }
POST /api/work-items/{key}/approvals         { approverId, expiresAt }
POST /api/approvals/{id}/decide              { decision: 'approve'|'reject', note }
POST /api/submissions/{ref}/accept           { projectId, typeId }
POST /api/imports/{id}/dry-run               ← an import run is a resource with a lifecycle
POST /api/instance/plugins/{id}/test         { config }
```

Actions return the mutated resource in its normal response shape, so the client can
update its cache without a refetch. Actions that can race (self-assign, claim a
submission) accept an optional `If-Match` or use a conditional update and return `409`
naming the winner. `DELETE /work-items/{key}/assign` takes an optional `expectedAssigneeId`
query parameter (the holder the caller saw); any other current holder is `409` and nothing is
written (`AS-19`).

<a id="api-design-errors"></a>
### Errors

RFC 9457 `application/problem+json` — **every** error response, including validation.
The media type is declared on every error response schema so Scalar renders it correctly.
**One exception, because the protocol demands it:** `/scim/v2/*` answers with SCIM 2.0
error objects (`urn:ietf:params:scim:api:messages:2.0:Error`, `application/scim+json`) —
Microsoft Entra parses those, not problem documents
([identity-provisioning.md](feature-contracts-p3.md#identity-provisioning) `IP-14`).

```json
{
  "type": "https://docs.taskdesk.dev/errors/insufficient-capability",
  "title": "Insufficient capability",
  "status": 403,
  "detail": "This action requires work_item:assign in project SUP.",
  "instance": "/api/work-items/SUP-1234/assign",
  "capability": "work_item:assign",
  "traceId": "01J8…"
}
```

| Status | Used for |
| --- | --- |
| **202** | **Accepted, not performed.** A user-initiated `DELETE` of an ordinary record — work item, comment, attachment, custom field, saved view, time entry, label — and every destructive MCP call returns `202` with `{ pendingActionId, action, summary, confirmation, expiresAt, approveUrl }`; the requesting human approves in the UI and the server executes — [pending-actions.md](#pending-actions). A retry while pending is `409 pending_approval` with the same id, whether or not it carries an `Idempotency-Key`. **The elevated targets are the exception:** deleting a workspace, organisation, project, API key, webhook, identity connection or `auth.*` plugin carries `sessionOnly: true`, so on an API key, an MCP key or an impersonation session it is `403 session_required` **before the policy runs** — no 202, no pending action ([pending-actions.md](#pending-actions) `PA-5`) |
| 400 | Malformed request; missing workspace context; a SCIM or OIDC payload carrying a forbidden tenant/role/capability attribute (`forbidden_attribute`) |
| 401 | No or invalid session |
| 403 | In reach, missing capability. `capability` names what is missing. Customer principals also receive it on agent-API work-item routes. Also `session_required` (an API/MCP key or impersonation session on a session-only route) and `no_approver` (a service key requesting a deletion) |
| 404 | Not found **or out of reach** — deliberately indistinguishable |
| 409 | Conflict: version mismatch, duplicate key, illegal transition (`reason`), in-flight idempotent duplicate, `pending_approval` (a retry while a pending action is open), `target_changed` (a target's version moved between a pending action's request and its approval) |
| 422 | Validation failed. `errors[]` gives field-level detail |
| 429 | Rate limited. `Retry-After` set; `quota` names which limit |
| 500 | Unexpected. `traceId` correlates to logs. Never leaks internals |

Validation errors are a full problem document with `errors` as an extension member, so
React Hook Form can bind them directly:

```json
{
  "type": "https://docs.taskdesk.dev/errors/validation",
  "title": "Validation failed",
  "status": 422,
  "instance": "/api/projects/…/work-items",
  "traceId": "01J8…",
  "errors": [
    { "path": "title",            "code": "too_short", "message": "Title is required" },
    { "path": "customFields.abc", "code": "required",  "message": "Impact is required" }
  ]
}
```

<a id="api-design-concurrency"></a>
### Concurrency

Mutable resources carry a `version` integer — the tables marked **v** in the
[data model](data-model.md). `PATCH` may send `If-Match: "<version>"`; a mismatch returns
`409` with both versions so the client can show a merge affordance. **Rank changes
(`POST …/rank`) are exempt and last-write-wins** — dragging must never 409.

<a id="api-design-idempotency"></a>
### Idempotency

Unsafe requests may send `Idempotency-Key`. The key, request hash and response are stored
in `idempotency_key` for 24 hours; a repeat returns the original response; a duplicate that
arrives **while the first is still in flight** returns `409`. Required for importers,
mandatory for anything invoked by an AI agent, which may retry.

**Order matters for deletions.** The idempotency middleware runs **before** the pending-action
layer, so a keyed retry of a `DELETE` replays the stored `202` and creates nothing. An unkeyed
repeat reaches the pending-action layer and is stopped there by a uniqueness rule on the open
action, returning `409 pending_approval` with the existing id. Either way there is exactly one
pending action per set of targets — never two for a human to reason about
([pending-actions.md](#pending-actions) `PA-4`).

<a id="api-design-rate-limiting"></a>
### Rate limiting

Two nested buckets, both in Valkey, one `429` shape:

| Bucket | Limit | Names itself in `quota` as |
| --- | --- | --- |
| **Outer — organisation quota** | Default 600 requests / minute per organisation ([multi-tenancy.md](#multi-tenancy)) | `organisation` |
| **Inner — identity × route class** | Auth 10/min/IP · portal writes 60/min · agent writes 300/min · reads 1000/min · search 60/min · API keys: `min(key.rate_limit_per_minute, class limit)`; MCP-flagged keys additionally capped by `instance_setting.mcp_write_ceiling_per_minute` | `route_class` |
| **Anonymous class** | `/api/public/*` 60/min/IP · non-login `/auth/*` (magic link, OTP, reset) 5/min/IP **and** 3/hour per target email · WebSocket upgrades 10/min/IP. Responses on the mail-sending endpoints are constant-time and identical whether or not the account exists | `anonymous` |

Client IP is taken from `X-Forwarded-For` only at the trusted-proxy hop configured by
`TASKDESK_TRUST_PROXY`; a forged header moves no bucket. Every bucket, including the
organisation quota, produces the same `429` problem document with `quota` and
`Retry-After`.

Configurable in God Mode; the table above is the default. **Without Valkey the counters
are per replica and therefore approximate** — a multi-replica deployment must configure
Valkey ([scaling.md](operations-and-distribution.md#scaling)).

<a id="api-design-versioning"></a>
### Versioning

The API is unversioned until `2.0.0` ships ([release-plan.md](retained-constraints.md#release-plan)).
After that:

- Additive changes (new optional field, new endpoint, new event key) go out freely.
- Breaking changes get a new path segment, and the old one is supported for two minor
  releases with a `Deprecation` and `Sunset` header.
- The OpenAPI diff (`oasdiff`) runs in CI against `main`, and a breaking change without a
  version bump fails the build.

Before the first stable `2.0.0`, a deliberate breaking change requires an exact, newly authorized `scripts/ci/openapi-approved-breaks.json` entry naming operation, oasdiff rule and finding fingerprint, with its authorizing owner decision. It approves only the change introducing it; a merged entry cannot approve a later break and must be removed. Every unapproved finding and every unused/new stale entry fails. After the first published, non-draft, non-prerelease `v2.0.0`-or-later GitHub release, the allowlist is empty and breaks require the new path/version compatibility policy above. Stable tag syntax and `package.json` are not release authority. Read all release pages for the checkout's origin repository; lookup failure or malformed metadata fails closed. Current consolidated phase review and existing branch protections apply; this contract does not reintroduce a per-change review ceremony.

<a id="api-design-typed-client"></a>
### Typed client

`packages/libs` exports a **Hono RPC client** typed from the server's exported `AppType`.
It does not read the OpenAPI document; the types flow through the monorepo, so a server
change that the client does not reflect fails `pnpm typecheck` — there is no generation
step and nothing to regenerate.

```ts
// apps/api/src/index.ts
export type AppType = typeof app;

// packages/libs/src/client.ts
import { hc } from 'hono/client';
export const api = hc<AppType>(baseUrl, { headers: () => ({ 'X-Workspace-Id': currentWorkspaceId() }) });

// apps/web — path segments mirror the URL literally
const res = await api.api['work-items'][':key'].$get({ param: { key: 'SUP-1234' } });
//    ^ fully typed from the server route — a server change breaks the client build
```

Routes are declared with `createRoute({ path: '/api/work-items/{key}', … })`;
`@hono/zod-openapi` converts `{key}` for the document and `:key` for the router. The
frontend never constructs URLs by hand and never uses `fetch` directly.

<a id="api-design-documentation"></a>
### Documentation

`/docs` serves a Scalar reference generated from the live spec. The spec is exported in CI
to `apps/site/public/openapi.json` so the documentation website renders the same
reference, and it is what MCP tool schemas and third-party integrators consume.

<a id="api-design-work-capability-introspection-within-a-project"></a>
#### Work capability introspection within a project

`GET /api/capabilities?workspaceId={id}&projectId={id}` optionally narrows the caller's
work-item and comment flags to a reachable, live project in the requested workspace.
It retains the existing session-only, exact workspace-membership self-introspection
policy. Unknown, deleted, cross-workspace and unreachable projects all return the same
404. Work flags are the intersection of existing workspace flags, the write routes’ strict
workspace capability checks and the canonical project-role override for the current credential. Workspace/settings flags
keep their workspace meaning. This response grants no authority: write routes revalidate
current reach and capability. The client keys the map by both workspace and project and
fails closed while changing projects; an allowed map from one project is never reused
for another. Work-item editors and property controls use this scoped map.

<a id="api-design-canonical-work-item-labels"></a>
#### Canonical work-item labels

`GET /api/work-items/{key}/labels` requires `work_item:read` and item reach. It returns
workspace-catalogue labels as `{ id, name, color, assigned }` rows; legacy task-bound copies
are excluded. An absent, deleted, archived or unreachable item returns the normal opaque
404. Agent-only restrictions and API-key scope apply as on work-item detail.

`PATCH /api/work-items/{key}` accepts optional `labelIds` (at most 100 unique nonempty IDs).
Omission preserves assignments; `[]` clears them. Existing `If-Match`, project/workspace
`work_item:update` and API-key ceilings apply. Every ID must reference a workspace-catalogue
label in the item's own workspace; missing, foreign and legacy task-bound IDs all return
422 without partial writes. Replace assignments, advance version, record internal `label`
activity with sorted old/new IDs and enqueue `work_item.updated` in one transaction. Same
set in a different order does not publish change activity. No new event or permission.

Deleting a workspace catalogue label also removes canonical work-item assignments in the
same transaction, increments affected versions and records internal label activity/outbox
events before publishing realtime hints. Catalogue mutation and canonical label editing
acquire the shared workspace catalogue lock before item locks so deletion cannot silently
cascade a concurrent assignment without its version/activity change. Responses reveal no
keys or titles of affected items outside the manager's reach.

<a id="auth-and-identity"></a>
## Authentication and identity
> **Design goal:** works out of the box with zero configuration, and scales to any
> enterprise identity setup without a code change.

<a id="auth-and-identity-layers"></a>
### Layers

```
┌───────────────────────────────────────────────────────────────┐
│ 1. AUTHENTICATION — "who is this?"                            │
│    better-auth. Sessions, MFA, providers.                      │
│    Pluggable: password · magic link · OTP · TOTP ·   │
│    passkey (later scope) ·                                         │
│    any number of OIDC providers · social.                      │
└───────────────────────────────────────────────────────────────┘
                              ↓ userId
┌───────────────────────────────────────────────────────────────┐
│ 2. IDENTITY RESOLUTION — "who are they here?"                  │
│    userId → directory record.                                  │
│    side · organisation · memberships · reach · authority.      │
│    ALWAYS from the database. NEVER from a token claim.         │
└───────────────────────────────────────────────────────────────┘
                              ↓ ResolvedIdentity
┌───────────────────────────────────────────────────────────────┐
│ 3. AUTHORIZATION — "may they do this?"                         │
│    packages/permissions. See rbac.md.                          │
└───────────────────────────────────────────────────────────────┘
```

Keeping these separate is what makes the identity provider swappable. The authorization
layer never knows or cares how someone logged in.

<a id="auth-and-identity-why-better-auth-is-primary"></a>
### Why better-auth is primary

| Requirement | better-auth |
| --- | --- |
| Works with zero config | Required: email + password out of the box |
| Multi-organisation | **Not used.** better-auth's organisation plugin is removed at the fork — our own `organisation` / `membership` / `team` / `invitation` tables are the directory, because identity is always resolved from *our* database. better-auth does authentication only |
| MFA | Better Auth local TOTP/backup-code verification with TaskDesk policy, enrollment and session consequences; configuration alone is not proof of enforcement |
| Magic link | Required: inherited |
| Email OTP | Required: inherited |
| Passkeys | Later scope; no authentication acceptance without a specified verifier and integration |
| Arbitrary OIDC | Microsoft Entra uses the connection-bound protocol; other providers require their own specified protocol and admission profile before sign-in is enabled. |
| API keys | Required: apiKey plugin |
| Impersonation | Required: admin plugin — kept **only as a session primitive**; the authority check is ours (see the plugin table) |
| TypeScript-native, Drizzle adapter | Required: |
| Already in kaneo | Required: the library. **Not the plugin set** — see the plugin table below |

Keycloak is **not** a dependency. It is one OIDC provider among many, added through
God Mode if a deployment wants it. That is the difference between "we support Keycloak"
and "we require Keycloak".

**Runtime limitation of better-auth `genericOAuth`.** Generic OAuth by itself is not the Entra connection protocol. Its profile path decodes ID-token claims before mapping and does not provide the
connection-specific signature, immutable `oid`/`tid`, exact app-role/`acct` admission,
portal/organisation binding, profile-only mapping, or source-isolated grant reconciliation
required by IP-7/IP-27. Its generic profile/error handling can also surface upstream
response details through the auth error path. TaskDesk therefore uses a custom Better Auth
plugin endpoint for the Entra authorization-code flow, with tenant-pinned discovery, PKCE,
single-use state/nonce, bounded upstream responses, native RS256/JWKS validation and generic
browser failure redirects. Upstream response bodies, claims, codes, tokens, state, and client
secrets are never included in TaskDesk logs or public errors. Generic OAuth remains disabled
for connection sign-in until a separate provider contract and verifier are implemented.

<a id="auth-and-identity-the-better-auth-plugin-set--inherited-removed-added"></a>
#### The better-auth plugin set — inherited, removed, added

The supported plugin surface is explicit. Removing a library plugin also removes its mounted route family; dormant unauthorized authentication transports do not ship.

| Plugin | Verdict | Note |
| --- | --- | --- |
| `magicLink` | inherited — kept | `auth.magic-link` |
| `emailOTP` | inherited — kept | `auth.email-otp` |
| `genericOAuth` | connection sign-in disabled without a separately specified provider verifier | Entra uses the connection-bound native OIDC plugin, not generic decoded claims |
| `apiKey` | inherited — kept | the credential only; our `api_key` table owns everything else |
| `admin` | inherited — kept **as a session primitive only** | its HTTP routes are **refused**: a `hooks.before` in `createAuth` (`apps/api/src/auth.ts`) rejects every `/api/auth/admin/*` endpoint (`set-role`, `create-user`, `set-user-password`, `impersonate-user`, `remove-user`, `ban-user`, `unban-user`, `revoke-user-sessions`, `list-users`, ...) with 404 before it runs, even for an instance-admin session, guarded by `tests/api-integration/auth-admin-routes-refused.test.ts`. The application's identity resolver reads the stored `user.role = 'admin'` field as the current source for the instance-scope `instance_admin` grant; authority does not come from a plugin endpoint. `POST /api/instance/users/{id}/impersonate` ([rbac.md](permissions.md)) does the authority check and sets `impersonatedBy` |
| `openAPI` | removed | No unauthenticated auth reference loading an unpinned remote bundle into the cookie origin. TaskDesk publishes its own Zod/OpenAPI document. |
| `lastLoginMethod` | inherited — kept | |
| `anonymous` | **removed at fork** | guest sign-in, on by default in kaneo. An ephemeral-identity surface does not ship dormant |
| `deviceAuthorization` | **removed at fork** | a device-code grant no v2 spec asks for |
| `bearer` | **removed at fork** | a second token-bearing authentication surface |
| `organization` | **removed** | see below |
| `twoFactor` | P0 requirement | TOTP and backup codes use Better Auth verification; policy, enrollment and session consequences remain mandatory |
| `taskdesk-identity-oidc` | **added — P3 identity integration** | TaskDesk's native OIDC plugin enforces the documented issuer, signature, nonce, audience, and identity-connection contracts; it uses Better Auth's adapter/session infrastructure and does not grant roles or instance authority |
| `passkey` | later scope | No enabled sign-in transport without its specified verifier |

**The organization plugin is kaneo's workspace model, not a dormant feature.** In kaneo it
maps `organizationId → workspaceId` and owns `workspace`, `workspace_member`, `invitation`,
`workspace_role`, `team` and `teamMember` through the adapter schema, with hooks for create,
delete and seat sync. Removing it is therefore a retrofit, required by the fork boundary: our own
`organisation` / `workspace` / `membership` / `role` tables ([data-model.md](data-model.md)
§2) replace `workspace_role` and `team`, our own `invitation` table and the flow below
replace the plugin's, and the whole `/organization/*` route family — including the
`/organization/invite-member` route the invitation flow currently runs on — **disappears from
the router**, which the inherited route-coverage expectation in
[repository-bootstrap.md](retained-constraints.md#repository-bootstrap) accounts for.

Two inherited defaults are disabled rather than removed, and both are load-bearing here:
`account.accountLinking` (see [Placeholder people](#auth-and-identity-identity-resolution--the-important-rule)
and `IP-18`) and `session.cookieCache` (see [Sessions](#auth-and-identity-sessions)).

<a id="auth-and-identity-runtime-provider-configuration"></a>
### Runtime provider configuration

Providers are `auth.*` plugins (see [Plugin architecture](features.md)), edited
in God Mode, and **loaded into the better-auth instance at boot and on change**. They live
in two tables, and the difference matters to the reload mechanism:

- **Non-OIDC auth plugins** — `auth.password`, `auth.email-otp`, `auth.magic-link` — are
  `instance_plugin_config` rows.
- **OIDC connections** — every configured instance of `auth.oidc` and its presets
  `auth.entra`, `auth.keycloak`, … — are **`identity_connection` rows**, because the
  organisation FK and the SCIM link cannot live in a generic `config jsonb`
  ([identity-provisioning.md](feature-contracts-p3.md#identity-provisioning),
  [data-model.md](data-model.md) §2). The plugin *kinds* stay in the plugin registry and
  provide the protocol implementation.

Both tables carry `config_version`, and the reload mechanism watches **both**.

Implementation note: better-auth is configured once at construction. To support runtime
changes we build the auth instance from database configuration and rebuild it when
configuration changes, swapping the handler behind a stable reference. Config changes
apply within seconds without a restart. **The full mechanism — build-validate-swap
ordering, rollback when construction throws, what survives a swap, propagation to
replicas with and without Valkey, and the test list — is designed in
[auth-runtime-reconfiguration.md](#auth-runtime-reconfiguration).** ADR 0006 calls this
the most delicate code in the system; it is not left to a paragraph.

<a id="auth-and-identity-the-god-mode-flow"></a>
#### The God Mode flow

The form describes required configuration behavior, not available provider implementations. No setting, example or listed option supplies an admission or required-MFA verifier.

```
God Mode → Authentication → [ Add connection ]          (agent connections)
God Mode → Organisations → Contoso → Identity → [ Add connection ]   (customer — same form)

  Choose type:
    ┌──────────────────┬──────────────────┬──────────────────┐
    │ Microsoft Entra  │ Keycloak         │ Generic OIDC     │
    ├──────────────────┼──────────────────┼──────────────────┤
    │ Google           │ GitHub           │ GitLab           │
    ├──────────────────┼──────────────────┼──────────────────┤
    │ SAML 2.0 (later) │ LDAP (later)     │                  │
    └──────────────────┴──────────────────┴──────────────────┘

  Form is generated from the plugin's Zod schema:
    Display name          "Contoso Staff SSO"          ← what users see on the button
    Portal                (•) Agent  ( ) Customer      ← exactly one; never both (IP-1)
    Organisation          —  (required when Customer; fixed to one organisation)
    Discovery URL         https://login.microsoftonline.com/<tenant-guid>/v2.0/...
                          ← a specific tenant; /common and /organizations are refused (IP-26)
    Client ID             …
    Client secret         •••••••• (encrypted at rest)
    Scopes                openid profile email
    Claim mapping         identifier: oid + tid (fixed) · email: email → preferred_username
                          → upn · name → name · groups → groups          (IP-27)
    Auto-provision (JIT)  [x] create a person on first login (Entra admission role required)
      → admission role     [configured Entra app-role value; not a TaskDesk role]
      → default role       Viewer ▾   (≤ this connection's max role rank; customer
                                      connections have exactly one choice: Customer)
    Max role rank         50 (Lead) ▾                     ← agent connections only
    Group → role mapping  1f9a…-c3d2 "TaskDesk-Leads" → Lead   [+ add rule]
                          ← keyed on the group OBJECT ID; the name is a snapshot (IP-28)
    Domain bindings       contoso.com                     ← each domain bound to one connection
    MFA upstream          (requires verified per-login claims; static setting is not proof)
    SCIM provisioning     [ ] enable → token, resources, mappings (IP-11…IP-23)
    Enabled               [x]

  [ Test connection ]   ← performs a real discovery + token exchange dry-run
  [ Test SCIM ]
  [ Save ]
```

Two things the form deliberately **cannot** express, because `IP-4` forbids them: **side**
is never chosen — it follows the connection's portal (`agent` ⇒ staff, `customer` ⇒
customer); after authenticated admission, **organisation scope** comes only from the selected
connection's persisted `organisation_id` — never directly from a claim or typed email domain.
A customer connection is bound to one organisation at creation; an agent connection is
instance-scoped.
The same form serves both places it appears: God Mode → Authentication → *Add connection*
(agent) and God Mode → Organisations → *org* → Identity → *Add connection* (customer, with
the organisation pre-filled and locked).

The **Test connection** button is not optional polish. An administrator must be able to
verify a provider before making it live, or the first person to discover it is broken
will be a locked-out user. It is an outbound connection with admin-supplied credentials,
so it goes through the central egress client, is rate-limited, and is **audited even
though nothing is saved** ([security model](#security-model-input-handling)).

<a id="auth-and-identity-what-every-authoidc-plugin-must-do--the-protocol-floor"></a>
#### What every `auth.oidc` plugin must do — the protocol floor

These are properties of the `auth.*` plugin contract, not per-provider options, and the
auth reconfiguration suite asserts each of them against a mock IdP:

- **PKCE with `S256`** on every authorization-code flow, including confidential clients.
- A **`state`** value that is single-use, CSPRNG-generated, bound to the initiating
  session and portal, and expired after ten minutes. Its server-side context for customer
  home-realm routing records the selected identity-connection id and its persisted
  `organisation_id`; the callback consumes this context and cannot reselect these values
  (`IP-7`, `IP-9`).
- A **`nonce`** in the request, validated in the ID token; the ID token's `iss`, `aud`,
  `exp` and signature (via the discovered JWKS, cached, with key rotation honoured) are
  validated before any claim is read.
- Redirect URIs are exact-match, per portal, and never taken from the request.
- The issuer is the connection's **resolved, tenant-specific** issuer, and — for Entra —
  the token's `tid` must equal the connection's tenant as well as its `iss` (`IP-26`).
- Customer login initiation may use the visitor's typed email domain for connection
  routing. Callback-claim collision checks and account-linking rules apply only after the
  token is validated; the callback cannot change the connection or scope bound in state
  (`IP-9`).

<a id="auth-and-identity-what-microsoft-entra-actually-sends--the-claim-rules"></a>
#### What Microsoft Entra actually sends — the claim rules

Entra is the one provider in core delivery, and three of its behaviours break a naive OIDC
mapping. The rules are **stated normatively in
[identity-provisioning.md](feature-contracts-p3.md#identity-provisioning)**, which owns the `IP-n`
numbering; they are named here only so that an implementer reading the protocol floor knows
they exist.

- **The issuer must be a specific tenant** — `IP-26`. `/common` and `/organizations` are
  refused at save; the connection stores the resolved tenant-specific issuer; every ID token
  must match both `iss` and `tid`. `05-no-user-controlled-tenant-selection.test.ts`.
- **Entra subject admission is separate from JIT creation and profile metadata** — `IP-27`.
  Every Entra connection requires an exact configured app role and signed `acct=0` after
  exact token validation, for every login including existing invite/SCIM identities when
  JIT is disabled. JIT controls only creation/default-grant behavior. A valid negative
  admission retires only that identity's OIDC/JIT grants and denies a new session; an
  invalid/unverified token or invalid server configuration mutates no grants. The durable
  identifier is `oid` + `tid`; `email` → `preferred_username` →
  `upn` supplies contact/display metadata only. An absent usable address may fail a profile
  data requirement, never the admission decision by proving or disproving domain ownership.
- **The `groups` claim carries object ids, and can go missing** — `IP-28`. Mapping is keyed
  on the group object id with a name snapshot. On a valid login with absent, malformed, or
  overage groups, retire only this external identity's prior OIDC group grants; keep only a
  currently permitted JIT-default grant and independent direct, SCIM, or other-connection
  grants. Emit the existing `provisioning_event` and Health warning for overage. Do not
  query Graph in the first release. Invalid or unverified tokens do not mutate grants.

Home-realm routing, connection-bound callback scope and deny-only post-validation domain
collision checks follow the single boundary in `IP-9`; `identity_connection.organisation_id`
is persisted on the selected connection and is the only customer-organisation scope source
([multi-tenancy.md](#multi-tenancy)).

<a id="auth-and-identity-per-portal-binding"></a>
#### Per-portal binding

`portal_scope` on each provider row makes the common enterprise pattern trivial:

| Provider | Scope | Effect |
| --- | --- | --- |
| Entra ID (our tenant) — identity connection | `agent` | Staff sign in with corporate SSO; SCIM keeps the staff directory in step |
| Entra ID (Contoso's tenant) — identity connection bound to organisation Contoso | `customer` | Contoso's people sign in to the portal with their own SSO and land only in Contoso; Contoso's SCIM deactivates them when they leave |
| Email OTP | `customer` | Other customers get a code, no password to manage |
| Password | `both` | Break-glass and small deployments |

An OIDC identity connection is `agent` **or** `customer`, never both; only non-OIDC auth
plugins may be `both` ([ADR 0003](design-and-decisions.md#0003-better-auth-primary),
[plugin-architecture.md](features.md)).

**The agent login screen renders the providers scoped to `agent`** — there are few of them,
they belong to the instance, and naming them discloses nothing. **The portal login screen
renders no connection list at all.** Customer connections are per-organisation; the portal
may use the typed email domain to route login initiation to a configured connection, with an
unbound domain falling through to non-SSO methods. The limited, domain-specific disclosure
in the complete unauthenticated flow is defined in `IP-29`; no organisation/connection list
is published. The authoritative routing/admission and state-scope boundary is `IP-9`/`IP-29`
and `CP-18`.

New-person JIT admission follows the single authoritative rule in `IP-9` and `IP-27`
after OIDC validation; no provider-specific exception is inferred here. For customer sign-in,
state-bound connection and scope follow `IP-7`/`IP-9`. Callback email-like claims are
metadata only; any cross-connection domain collision can deny after validation, never admit
or switch scope. Upstream app-role deassignment alone does not promise immediate revocation
of an existing TaskDesk session. The first-release rule does not define a guest-login or
alternate account-linking path.

<a id="auth-and-identity-identity-architecture--the-authoritative-model"></a>
### Identity architecture — the authoritative model

This document owns the identity model; [identity-provisioning.md](feature-contracts-p3.md#identity-provisioning)
owns the numbered behavioural rules (`IP-n`) and the acceptance tests; the security model,
RBAC, God Mode and the portal spec link here rather than restating.

**TaskDesk stores and is authoritative for:** `user`, `person`, `organisation`, organisation
/ workspace / project memberships, roles and capabilities, `external_identity`,
`identity_connection`, `scim_connection`, `scim_group_mapping`, sessions, API/MCP key
ownership, audit history ([data-model.md](data-model.md) §2). **Microsoft Entra owns:**
authentication, user lifecycle, directory attributes, and group membership where enabled.
TaskDesk never stores an external user's password.

**Durable identity key:** `(identity_connection, issuer, subject)` and, for SCIM-created
records, `externalId`. Organisation binding and portal scope are properties of the
connection, resolved server-side. **Email is an attribute** — it may change and is never
the sole key or a linking key on its own.

One person belongs to exactly one organisation, and the same address may appear on a
staff-side and a customer-side `person` row without the two ever being linked — the key is
`(identity_connection_id, subject)`, so they collide on nothing (`IP-33`,
[multi-tenancy.md](#multi-tenancy-identity-across-tenants)).

**Two connection shapes, one implementation:**

| | Agent connection | Customer connection |
| --- | --- | --- |
| Portal | `agent` | `customer` |
| Bound to | the instance | exactly **one** customer organisation |
| May create | staff-side people; permitted workspace memberships; approved staff roles ≤ `max_role_rank` | customer-side people of that organisation; the customer role only |
| May never | grant `instance:admin`, `sees_all`, a role above the maximum; let a group *name* create capabilities | create staff, instance admins, workspace/manager/lead roles, `sees_all`, cross-organisation membership, keys, webhooks, automations; reach agent routes or God Mode |
| Configured by | instance administrators, God Mode → Authentication | instance administrators, God Mode → Organisations → *org* → Identity (customer self-service is a later, separately approved feature) |
| SCIM | staff joiner/mover/leaver | that organisation's joiner/mover/leaver |

**Lifecycle and revocation.** Deactivation — from SCIM `active=false`, from God Mode, or
from an administrator — sets `person.active = false`, revokes every session and every
personal API/MCP key, ends memberships per the connection's lifecycle policy, and preserves
authored history attributed to a former member. It is never a hard delete; erasure and
anonymisation are the separate elevated process in
[data-protection.md](operations-and-distribution.md#data-protection). Group→role mappings are
allowlisted, scoped to the connection's organisation and portal, symmetric on removal, and
can never reach `instance:admin` or `sees_all`.

**Where the UI lives.** Agent connections: God Mode → Authentication. Customer connections:
God Mode → Organisations → detail → Identity. Both are views over
`/api/instance/identity-connections/*` ([god-mode.md](feature-contracts-p4.md#god-mode)).

<a id="auth-and-identity-scim-provisioning--summary"></a>
### SCIM provisioning — summary

OIDC says who someone is at login; SCIM creates, updates and **deactivates** people when
the directory changes, so offboarding does not depend on anyone remembering. Core P3
delivery for Microsoft Entra; endpoint `/scim/v2/*` on the agent origin; bearer token per
connection with immediate-invalidation rotation; strict schemas; scope from the credential,
never the body; `/Bulk` not implemented unless Entra interoperability testing requires it;
tested against a real Entra tenant before the P3 identity gate. Full rules `IP-1`…`IP-32`
and the twenty-five acceptance tests: [identity-provisioning.md](feature-contracts-p3.md#identity-provisioning).
Security treatment: [security-model.md](#security-model-scim--an-inbound-privileged-management-api).

**Unlike every other row in the table above, SCIM is not a library capability.** The SCIM
2.0 server is **ours** — better-auth provides no SCIM plugin. Schemas, the filter parser,
`PATCH` path expressions, `ListResponse` and the SCIM error bodies are our own protocol
code; only the credential check reuses the platform. Budget it as such.

<a id="auth-and-identity-sessions"></a>
### Sessions

- HTTP-only, `Secure`, `__Host-`-prefixed, `SameSite=Lax` cookies (`Strict` on the
  elevated-action routes). **No tokens in browser storage, ever.** CSRF is *not* left to
  `SameSite`: the full rule — no state-changing GET, `Origin` check on every unsafe
  method, double-submit token — is in [security-model.md](#security-model-sessions-csrf-and-step-up).
- **Two better-auth instances, one per portal origin** (decided 2026-09-06, Claude Code —
  reversible). better-auth derives cookie names from *construction-time* configuration, not
  from the incoming request, so "one instance, a per-request prefix" is not a thing the
  library can do. The holder therefore constructs **two** instances on every reload, one per
  portal, each with its own `baseURL`, its own cookie names, its own `trustedOrigins` (that
  portal's origin only) and its own provider set (the connections scoped to that portal).
  **The request host selects the instance**; everything else about the reload is unchanged
  ([auth-runtime-reconfiguration.md](#auth-runtime-reconfiguration)).
- **The two cookie names, in full:** `__Host-tdk_agent_session` on `ticket.<domain>` and
  `__Host-tdk_portal_session` on `portal.<domain>`. `__Host-` is a browser-enforced *name*
  prefix, so the name literally begins with it: host-only, no `Domain` attribute, `Path=/`,
  `Secure`. kaneo's `COOKIE_DOMAIN` variable and its cross-subdomain
  `SameSite=None; Partitioned` branch are **removed at the fork** — both are incompatible
  with `__Host-` and with `SameSite=Lax`, and the API is served on each portal's own origin,
  which `/api/portal/*` already implies
  ([decision-log.md](retained-constraints.md#decision-log) — environment surface).
- New `session` rows carry `portal` (`agent` | `customer`), set by the host-selected
  Better Auth instance at issue time. The additive migration leaves existing rows unbound
  (`NULL`) rather than infer their origin from identity-side data; those sessions fail
  closed during authenticated request resolution and at the realtime boundary, requiring
  a fresh sign-in. The selected host's portal must match `session.portal` even if a cookie
  value is copied into the other portal's cookie name.
- Native OIDC-issued sessions also carry nullable `identity_connection_id` referencing
  `identity_connection.id` with `ON DELETE CASCADE`. Only a validated native OIDC callback
  may set it; local sign-in, impersonation and other-connection sessions remain null or keep
  their original connection provenance. The callback revalidates the enabled connection
  under the `IP-22` connection lock before issuing a session. Disabling a connection deletes
  only sessions whose provenance equals that connection id, in the same serialized
  configuration transaction that retires its grants. The forward migration does not infer
  provenance for pre-migration sessions. Because those older OIDC sessions cannot be
  distinguished from local sessions, rollout must occur before enabling this source-scoped
  revocation guarantee; any persistent runtime with such sessions requires an explicit
  operator reconciliation before the migration is applied. The FK cascade is only a
  source-specific final deletion guard; production deletion still uses its pending-action,
  audit and authority-invalidation lifecycle.
- **Server-side sessions in Postgres, and this is the honest revocation SLA.**
  better-auth's `session.cookieCache` is **disabled** at the fork — kaneo enables it for
  five minutes, which serves a session from a signed cookie with no database read. Every
  request that presents a session cookie is validated against the `session` table, so a
  revoked or deleted session fails **on the very next request**. The separate *authority*
  resolution (memberships, roles, `sees_all`) keeps its 30-second Valkey cache with explicit
  invalidation, below. So: a **revoked session** takes effect on the next request; a
  **changed authority** takes effect immediately in the normal case and within 30 s if the
  invalidation message is lost. `IP-15`, the SCIM de-provisioning tests and god-mode.md's
  "organisation suspended" row all cite this paragraph.
- Idle timeout and absolute lifetime configurable in God Mode.
- Session rows record IP, user agent, and `impersonatedBy` — written by our own
  `POST /api/instance/users/{id}/impersonate`, never by better-auth's admin routes.

<a id="auth-and-identity-portal-boundary"></a>
### Portal boundary

Enforced at two points:

1. **At the OIDC callback** — if a `side = customer` directory record completes a login
   on the agent origin, the callback fails with a clear message and writes an audit row.
   No session is issued.
2. **On every request** — middleware compares the session's portal to the request host.
   Mismatch ⇒ session invalidated, `401`.

This is inherited from v1 and it is correct.

<a id="auth-and-identity-identity-resolution--the-important-rule"></a>
### Identity resolution — the important rule

```ts
// Correct
const identity = await resolveIdentity(session.userId);
//  → { userId, side, organisationId, memberships, reach, authority }

// WRONG — never do this
const role = session.user.role;
const orgs = token.claims.groups;
```

Everything about *what a person is allowed to do* comes from the database, keyed by user
id, on every request. Consequences:

- Revoking access takes effect on the next request, not when a token expires.
- A validated OIDC groups claim is an input to a transactional, source-isolated grant
  reconciliation on every login. Stored `membership_grant` provenance and the single
  effective membership projection—not claims—authorize requests. Overage or absent/malformed
  groups retire that identity's stale OIDC group grants; invalid tokens do not mutate grants.
- RBAC changes are safe to deploy; there are no in-flight tokens carrying stale rules.

Resolution is cached in Valkey for **30 seconds** (the revocation-latency budget, stated
once here and in [scaling.md](operations-and-distribution.md#scaling)), keyed by user id, and
invalidated explicitly on every membership, role, deactivation and connection change — so in
practice an authority change is immediate and 30 s is only the worst case when the
invalidation message is lost. This is the *authority* cache; the *session* SLA is the one
stated under [Sessions](#auth-and-identity-sessions), and they are different budgets.

The provenance ledger and effective-membership projection are specified in
[data-model.md](data-model.md) §2 and [RBAC](permissions.md). They require
[ADR 0015](design-and-decisions.md#0015-membership-grant-provenance), which remains Proposed pending Thomas's
approval. In the target, each source adds/retires only its own grants; the projection chooses
one role without capability union. Every connection/mapping/JIT/role-policy write must also
preserve the shared IP-22 current-source validity and projection invariant, including
role-priority changes with no grant retirement; see
[identity-provisioning.md](feature-contracts-p3.md#identity-provisioning) `IP-22`. OIDC reevaluation
on connection A is not evidence about
an explicitly linked connection B, so upstream removal on B is observed only at B's next
validated login, SCIM update, or administrative disable/change. Global SCIM deactivation is
the defined exception: all external grants for that inactive person retire. The 30-second
authority-cache bound applies after committed grant/projection changes; no upstream
instantaneous-revocation guarantee is implied.

**Accounts are never linked automatically.** kaneo ships better-auth with
`account.accountLinking: { enabled: true, trustedProviders: ["github","google","discord",
"custom"] }`, and `"custom"` is precisely the `genericOAuth` provider id every `auth.oidc`
connection is built on — so, as inherited, an OIDC sign-in would silently adopt an existing
account with the same address. At the fork it is set **explicitly** to `enabled: false`. No
claim is made about the library's own defaults, in either direction: the retrofit sets the
value, and `16-same-email-second-idp-does-not-autolink.test.ts` asserts it by reading the
**constructed configuration**, not only the HTTP behaviour (`IP-18`).

**Placeholder people.** An import may create a `person` with `user_id = null` and
`is_placeholder = true` so history has an author. A placeholder can never be assigned work
or hold a membership. A later sign-up may **claim** that row (linked, not duplicated) —
but only on a path where **TaskDesk itself verified the address**: password sign-up with
email verification, email OTP, or magic link; or an explicit, administrator-confirmed
claim. **Never on the SSO path** — an ID token's address is the IdP's assertion, not our
verification, and for Entra there is no `email_verified` claim to lean on at all. Every
claim is audited. The rule in full is `IP-30` in
[identity-provisioning.md](feature-contracts-p3.md#identity-provisioning), tested by
`18-placeholder-claim-requires-local-verification.test.ts`. This is the only path by which a
login attaches to a pre-existing directory record, and it is not an exception to `IP-18`:
`IP-18` forbids linking to another *connection's* account, and this links to a row that has
no account.

<a id="auth-and-identity-multi-factor-authentication"></a>
### Multi-factor authentication

- **Local factors:** P0 supports TOTP and one-use backup codes through Better Auth's
  `twoFactor` plugin. The plugin owns encrypted factor material and verification; TaskDesk
  owns the policy gate, enrollment confirmation, session consequences and audit records.
  Passkeys remain planned for a later stage. An enabled plugin alone is not evidence that a
  required policy is enforced.
- **Runtime policy:** the singleton `instance_setting.local_factor_policy` is the sole
  authority, with the closed shape `{ mode, requiredRoleId }`. `mode` is `off`, `optional`,
  `required_staff`, `required_role`, or `required_everyone`. `requiredRoleId` is null except
  for `required_role`, when it is the id of an existing role row; role rows have no inactive state, and deletion is blocked while one is the configured target. That policy applies to a
  person with an active membership holding that role at any supported scope. Deleted or
  inactive roles make the persisted policy invalid and readiness fails closed. The policy
  is read at request/login authorization time, never cached beyond the documented runtime
  refresh interval, and is not customer- or environment-specific.
  Instance administrators read and update it through
  `GET/PATCH /api/instance/local-factor-policy`; writes validate the required role before
  committing and write an `instance.local_factor_policy_changed` audit action.
- **Enforcement:** `off` does not require enrollment and disables self-service enrollment; `optional` permits
  self-service enrollment and password-only login for unenrolled accounts. In either mode,
  an already-enrolled account must complete its factor challenge;
  each `required_*` mode requires a verified enrolled TOTP or valid backup code before an
  authenticated session may be used. An unenrolled required user receives only the
  enrollment/challenge surface, not a usable API session. Customer-portal authentication
  is enabled by P3; customers are exempt from the local-factor policy (every mode, including
  `required_everyone`, applies to staff only, and a customer SSO sign-in never reaches the
  agent-only `/auth/two-factor` challenge; a factor a customer enrolled voluntarily is still
  honoured on local sign-in). Unsupported upstream SSO MFA cannot satisfy a
  required local-factor policy; it fails closed. Sign-in email OTP, remembered-device state,
  and client assertions are never second-factor proof.
- **Enrollment and recovery:** enrollment starts from a real session, returns the setup
  secret only to that session once, and does not mark the factor enabled until a TOTP is
  verified. Backup codes are shown once and are server-generated by Better Auth. Successful
  enrollment invalidates other sessions and requires a fresh sign-in with the new factor.
  Failed or expired enrollment leaves the account unenrolled. A backup code is consumed
  once under concurrent requests. Factor disable requires a fresh factor proof and is not
  available to an unenrolled/required account as a bypass.
- **Target upstream contract:** a configured IdP's signed, verified `amr` / `acr` evidence
  may satisfy login MFA only when it meets that connection's mapping. A static "MFA satisfied
  upstream" setting is not proof that a particular login used MFA and never establishes
  fresh step-up proof. An unavailable SSO MFA verifier cannot satisfy upstream-MFA policy.
- **Second-factor reset** (`POST /api/instance/users/{id}/reset-mfa`) requires an elevated browser-session-only instance-admin route and a
  12–1000 character note describing how the administrator verified the person's identity,
  deletes the factor, invalidates all of that person's sessions and API keys, writes
  `auth.mfa_reset`, and inserts a private `security_alert` notification before attempting
  email delivery. The identity model has one canonical `user.email` address per user record; the
  email attempt targets that address. The response reports whether SMTP delivery succeeded;
  the in-app notice remains durable if SMTP fails after the reset. SMTP must be configured
  before the mutation starts. Required-factor policy still blocks protected use until the
  person enrolls and verifies a new factor. Multiple verified addresses are not implied on one user record. Audit write failure follows AU-14 and does not undo
  the reset. A factor reset must not be treated as a solution to bootstrap ownership or the zero-admin race.

<a id="auth-and-identity-api-keys-and-machine-access"></a>
### API keys and machine access

- better-auth `apiKey` plugin for the credential; our `api_key` extension table
  ([data model](data-model.md) §2) for everything else: capability subset, IP allowlist,
  per-key rate limit, expiry, last-used, `is_mcp`, and the workspace-owned **service key**
  with no person behind it. Keys are hashed; only a prefix is stored in the clear.
- A personal key can never exceed its owner's authority — it is clamped to the owner's
  *current* authority on every request. A **service key is bounded by its creator's
  authority at creation** (you cannot mint a key carrying a capability you do not hold —
  evaluated against the expanded closure, exactly like a role grant), is an **elevated
  action** ([RBAC](permissions.md)), and its exact
  capability set is written to the audit row. On use, a service key is evaluated against
  its own stored subset, so it survives its creator leaving (`AK-7`) without ever having
  been wider than that person was. `service-key-clamp.test.ts` mirrors the personal-key
  clamping test.
- Used by the MCP server, importers and outbound integrations. `feature.mcp` off ⇒ keys
  flagged `is_mcp` are refused with 404.

<a id="auth-and-identity-invitations"></a>
### Invitations

1. A staff member with `member:invite` invites an email into an organisation with a role.
2. A token (≥ 128 bits, CSPRNG) is generated; only its SHA-256 hash is stored. Default
   expiry **7 days**. Redemption is **bound to the invited email address** — the account
   completing sign-up must verify that address — so an intercepted link is not bearer
   access to a tenant. Pending invitations are revoked when the inviter loses
   `member:invite`.
3. The invitee follows the link and completes sign-up via **any enabled provider for that
   portal** — password, OTP or SSO.
4. On acceptance, the directory record is created with the invitation's side, organisation
   and role. The invitation is consumed.

Invitations never grant instance-admin. That is deliberate and hard-coded.

<a id="auth-and-identity-break-glass"></a>
### Break-glass

**Target first-run flow** needs no environment variable. On an empty database the application
serves a one-time **setup page** at the agent origin, unlocked by a 32-byte token printed
once in the container log (the pattern Jenkins and Portainer use). The target flow creates
the first instance administrator and requires verified MFA enrollment before recording
completion in `instance_setting.setup_completed_at`. The completion marker is durable, so the page can never be re-opened by deleting user rows. Bootstrap ownership and factor-completion atomicity remain required; a factor-reset route is not a substitute. The setup
token expires after one hour or one use, and **while `setup_completed_at` is null every
container start prints a fresh token and invalidates the previous one** — so an operator who
missed the log line restarts the container rather than hunting for it, and a token scrolled
past in a shared log is already dead ([runbook](operations-and-distribution.md#runbook)). `TASKDESK_BOOTSTRAP_ADMIN_EMAIL` remains as an
optional override for **headless** installs (automation that cannot read a log) and is
ignored once `setup_completed_at` is set.

If every administrator is locked out, recovery is the CLI (`grant-instance-admin`,
[runbook](operations-and-distribution.md#runbook)), which must be run **inside the container**, writes
an audit row with `actor_type = 'system'`, and emails every existing administrator that it
was used. Break-glass is loud by design.

<a id="auth-and-identity-p4-god-mode-users--selected-implementation-contracts"></a>
#### P4 God Mode Users — selected implementation contracts

The browser `grant-admin` route is authorized by the current administrator's person and
session (any future recovery CLI must reuse its target eligibility and serialization). It requires a real, non-anonymous, unbanned target user with exactly one active staff person;
it refuses unlinked, inactive, customer-side, or otherwise ineligible targets. It changes
only the existing `user.role = 'admin'` source and never creates or links an identity. It
takes the shared `pg_advisory_xact_lock(2026)`, locks the target user and eligible person,
then re-reads setup state, target eligibility, current administrator state, and target role
before mutation. An already-admin target is an audited idempotent result. Suspending or
deactivating an account (including approving a deactivation) is refused when the actor is
the target or when it would leave no active, unbanned instance administrator, under the same
`pg_advisory_xact_lock(2026)` (decision log 2026-10-10). Workspace-role rank guardrails remain the permissions contract; this section supplies no exemption.

The operation is `instance_admin_grant`, fixed version `1`, on
`POST /api/instance/users/{id}/grant-admin`. Its strict JSON body is `{}`. The one-use PA-15
proof binds the acting user, active person, session, target user id, fixed route, operation
key/version and canonical empty body. The route consumes that proof in the transaction that
locks/revalidates the target and writes the role change. The role change, `auth.instance_admin_granted`
audit append, and durable in-app security alerts commit atomically; audit or alert failure
means no role change. The alert goes to every current instance administrator and the target,
with a closed payload that contains no identity-provider data, credentials, or secrets.

God Mode suspension uses the existing Better Auth `user.banned`, `banReason`, and
`banExpires` fields, not `person.active`. Suspending blocks login and API-key authentication,
revokes all existing sessions and all personal keys in the current native Better Auth
`apikey` store, and preserves the person's identity and memberships. There is no separate
MCP credential store in this implementation. Unsuspending clears the ban fields only. It
never restores sessions or keys. Force sign-out deletes all current sessions, including any
impersonation session, and leaves account state and API keys unchanged. Deactivation is
the separate IP-15 identity-provisioning lifecycle and is not a suspension alias.

Suspending a target whose locked `user.role` is `admin` requires the operation
`instance_admin_suspend`, version `1`, on `POST /api/instance/users/{id}/suspend`. Its one-use
PA-15 proof binds the acting user, active staff person, current agent session, target user id,
route, and canonical suspension request (`reason` and `expiresAt`). The route rechecks the
actor's admin role, active staff person, and session while holding the shared instance-admin
serialization lock; it consumes the proof and applies suspension in the same transaction.
Ordinary-user suspension remains session-only.

<a id="auth-and-identity-threat-notes"></a>
### Threat notes

| Threat | Mitigation |
| --- | --- |
| Stolen session cookie | HTTP-only + Secure + SameSite; short idle timeout; sessions listed and revocable in profile settings |
| IdP compromise | Claims never grant authority directly; role comes from the directory |
| Customer reaching agent surface | Portal boundary at callback and per request; server-side policy on every route |
| Privilege escalation via invite | Invitations cannot grant instance-admin; role bounded by inviter's authority |
| Brute force | Rate limit on auth endpoints; optional CAPTCHA plugin; account lockout configurable |
| Open redirect at callback | Redirect targets restricted by each instance's `trustedOrigins`, which holds **that portal's origin only**; redirect URIs are exact-match and rebuilt from that instance's `baseURL` on every reload |
| Secret leakage in API responses | Secrets never serialised; responses use explicit response schemas |

<a id="auth-runtime-reconfiguration"></a>
## Auth runtime reconfiguration
Provider changes apply across replicas without restart, interrupted valid sessions, or a missing authentication holder.

<a id="auth-runtime-reconfiguration-the-problem"></a>
### The problem

better-auth is constructed once, from a configuration object, and exposes a request
handler. Providers, cookie settings, plugins and the database adapter are all construction
inputs. Runtime provider changes therefore mean **constructing a new instance** and routing
requests to it — while requests are in flight, while OAuth flows are mid-redirect, and on
every replica, some of which may have no Valkey.

<a id="auth-runtime-reconfiguration-the-holder"></a>
### The holder

```ts
// apps/api/src/auth/holder.ts
type Portal = 'agent' | 'customer';

interface AuthHolder {
  current(portal: Portal): BetterAuth;   // what /auth/* and the session middleware use
  configVersion(): number;               // greatest config_version it was built from — see below
  reload(reason: string): Promise<void>; // build → validate → swap, or keep the old pair
}
```

**Two instances, not one.** better-auth derives cookie names, `baseURL` and
`trustedOrigins` from *construction-time* configuration, so a single instance cannot issue
`__Host-tdk_agent_session` on one host and `__Host-tdk_portal_session` on another. Each
reload therefore constructs **a pair** — one instance per portal origin — and `current()`
takes the portal, resolved from the request host. Everything below happens to both members
of the pair, atomically: they are built together, validated together, and swapped together.
Cookie names and the origin boundary follow [authentication sessions](#auth-and-identity-sessions).

`/auth/*` is mounted **once**, as
`(c) => holder.current(portalOf(c.req)).handler(c.req.raw)`. The mount never changes; only
what `current()` returns does.

<a id="auth-runtime-reconfiguration-build--validate--swap"></a>
### Build → validate → swap

```
1. read every enabled auth.* row from instance_plugin_config
   AND every enabled identity_connection            ← the OIDC connections live here
   plus the instance session policy
2. split the connections by portal_scope, and derive per portal:
   baseURL (that portal's origin), trustedOrigins (that origin only),
   cookie names (__Host-tdk_agent_session / __Host-tdk_portal_session),
   exact-match redirect URIs (built from that baseURL)
3. construct a NEW better-auth instance PER PORTAL from them   ← may throw
4. validate: run each provider's discovery against its cached document;
   assert auth.password present; assert each connection's resolved issuer is
   tenant-specific (IP-26)
5. swap: both instances at once; holder.configVersion = greatest(
       max(instance_plugin_config.config_version) where plugin_id like 'auth.%',
       max(identity_connection.config_version))
6. log + metric: taskdesk_auth_reload_total{outcome}, taskdesk_auth_config_version
```

Step 1 reads **both** tables because an OIDC connection is an `identity_connection` row,
not an `instance_plugin_config` row ([identity-provisioning.md](feature-contracts-p3.md#identity-provisioning),
[data-model.md](data-model.md) §2). Reading only the latter would mean a God Mode change to
an Entra connection — the flagship P3 flow — never reached any replica without a restart.

- **Construction or validation throwing keeps the previous instance.** The failure is
  logged with the offending plugin id, surfaced in God Mode → Health, and the `test()` that
  the administrator ran before saving is what should have caught it. The system never
  ends up with *no* auth instance.
- **Swap is a pointer assignment** — atomic in JavaScript — and it assigns the *pair*, so a
  request can never land on a new agent instance and an old portal one. In-flight requests
  holding a reference to an old instance finish on it.
- **What survives a swap, by construction:** the session table (every instance reads the
  same rows through the same Drizzle adapter), `TASKDESK_AUTH_SECRET` (identical input),
  the **cookie names** and attributes, each instance's **`baseURL`** and **`trustedOrigins`**
  (all four derived from the two portal origins, which are deployment facts and not
  administrator-editable configuration), and the rate-limit store (shared Valkey /
  in-memory reference passed in, not re-created). A reload never signs anyone out.
  Redirect URIs are **recomputed** from `baseURL` on every reload, which is why they are
  listed here: they are identical across a swap unless the origins themselves changed.
- **What does not survive, deliberately:** an OAuth authorisation flow started against a
  provider that was *disabled* by the change fails at the callback with a clear message
  and an audit row. Flows against unchanged providers complete, because their
  configuration is identical in the new instance.
- `auth.password` cannot be disabled ([plugin-architecture.md](features.md)); the
  validate step refuses a configuration without it.

<a id="auth-runtime-reconfiguration-propagation-to-replicas"></a>
### Propagation to replicas

A God Mode save writes the `instance_plugin_config` row **or the `identity_connection` row**
(bumping that row's `config_version`) and then publishes `auth.reload` on the
`taskdesk:control` Valkey channel ([realtime.md](#realtime)). Every replica's subscriber
calls `holder.reload()`. Adding, editing, disabling or deleting an identity connection
publishes on the same channel — `identity_connection.changed` ([events.md](events.md)) is
the event; `auth.reload` is the control message.

**Pub/sub is an accelerator, not the source of truth.** Every replica also polls the stable
set of `(row id, config_version)` pairs from both auth tables every **10 seconds** and reloads
when that version vector changes. The row identity matters because each row owns an independent
counter: one row's increment can otherwise be hidden by another row with a larger counter.
A deployment with no Valkey converges within 10 s;
a deployment with Valkey converges within a second and the poll is a no-op. No replica can
silently run a stale configuration for longer than the poll interval — which is the
property the two-replica-no-Valkey case previously lacked.

The same `taskdesk:control` channel and the same poll-fallback pattern carry
`plugin.reload` and `flags.reload`.

<a id="auth-runtime-reconfiguration-elevated-action"></a>
### Elevated action

Changing an `auth.*` row is on the single elevated-actions list in [rbac.md](permissions.md):
re-authentication within five minutes, and an audit row recording which keys changed —
never values.

<a id="auth-runtime-reconfiguration-break-glass"></a>
### Break-glass

If a reload leaves administrators locked out despite the rules above (a provider that
passed `test()` but rejects real logins), `auth.password` is still enabled by construction,
and the CLI (`node dist/cli.js disable-auth-plugin <id>`, [runbook](operations-and-distribution.md#runbook))
flips a row and bumps `config_version`, which the poll picks up within 10 s.

<a id="auth-runtime-reconfiguration-required-reload-and-origin-cases"></a>
### Required reload and origin cases

| Test | Asserts |
| --- | --- |
| `auth-reload-swaps-atomically.test.ts` | A request started before the swap completes on the old instance; the next starts on the new |
| `auth-reload-keeps-sessions.test.ts` | A session issued before the reload is valid after it |
| `auth-reload-rollback-on-throw.test.ts` | A provider config that throws at construction leaves `current()` unchanged and Health degraded |
| `auth-reload-refuses-no-password.test.ts` | A configuration with `auth.password` disabled is rejected at validate |
| `auth-reload-poll-fallback.test.ts` | With no Valkey, a second replica converges within the poll interval |
| `auth-reload-disabled-provider-callback.test.ts` | A callback for a provider disabled mid-flow fails clearly and is audited |
| `auth-cookie-per-host.test.ts` | Agent and portal hosts issue `__Host-tdk_agent_session` and `__Host-tdk_portal_session` respectively, from the two constructed instances; `session.portal` is set and enforced |
| `auth-reload-on-identity-connection-change.test.ts` | A **newly added** `identity_connection` is usable without a restart, and a **disabled** customer connection stops issuing sessions on `portal.<domain>` — on a replica that learned of the change only from the poll |
| `auth-reload-recomputes-redirect-uris.test.ts` | After a swap, each instance's `trustedOrigins` holds only its own portal origin and its redirect URIs are rebuilt from its `baseURL`; a callback presented to the wrong instance is refused |

`03-portal-isolation-both-directions.test.ts`
([identity-provisioning.md](feature-contracts-p3.md#identity-provisioning)) covers the portal
boundary at the *session* level. It does not cover reload, and these do not cover the
boundary — neither suite may be assumed to cover the other.

<a id="multi-tenancy"></a>
## Multi-tenancy
<a id="multi-tenancy-the-model"></a>
### The model

TaskDesk is **multi-tenant within one instance**, and one instance may itself be sold to
a customer who then runs their own tenants.

```
Instance                      one deployment, one database
└── Organisation              a tenant boundary. Internal org + one per customer
    └── Workspace             container for projects, roles, members
        └── Project           an engagement (project or managed service)
            └── Work item
```

- **Organisation** is the tenant boundary. Every person belongs to exactly one.
  Exactly one organisation is marked `is_internal` — that is the operating company whose
  staff work across all the others.
- **Workspace** is an organisational container, not a security boundary. Roles and
  members are defined here.
- A **project** belongs to a workspace and references the **customer organisation** it
  serves.

<a id="multi-tenancy-isolation"></a>
### Isolation

Isolation is enforced **in the application**: scoped repositories, the route policy
registry, reach and authority. That is the primary control, and it stays primary — it is
the layer that is reviewed, tested and able to express reach versus authority, which SQL
cannot.

**Postgres row-level security is a P0 prototype, as a backstop underneath it** (decided
2026-09-06, promoted from the deferred list). Scope: `work_item`, `comment` and
`attachment` only — the three tables where a missed `WHERE` leaks another tenant's content
rather than a setting. The policy reads the organisation from a session GUC set by the
connection wrapper, and it is a **second** check that must agree with the application's,
never the only one.

The prototype exists to answer three questions with a measurement rather than an opinion:
does it survive PgBouncer-style pooling, what does it cost on the hot list queries, and does
it ever disagree with the application layer (a disagreement is a bug in one of them, and
finding it is the point). The backstop decision requires those measured answers and a recorded retain/drop decision; application scoping remains mandatory either way.

What does not change: omission stays detectable in the application — see
[Security model](#security-model).

<a id="multi-tenancy-query-scoping"></a>
#### Query scoping

Every query that can return cross-organisation data passes through a scoped repository
function that takes the resolved identity and applies the caller's reach in the statement
predicate. A workspace or project id may further narrow the query, but the repository must
check it against that identity; the id alone is not authoritative scope.

```ts
const items = await listWorkItemsInProject(identity, projectId, filter);
```

The accepted `workItems.forIdentity(identity).inProject(projectId)` shape illustrates this
resolved-identity scoping convention. It does not claim that a literal fluent API or a
universal phantom type is implemented or proven for every repository. The required behavior
is that the repository derives and applies the authorized scope from the resolved identity;
any additional tenant id is checked against that scope. See
[coding-standards.md](retained-constraints.md#coding-standards).

Repository ownership checks must forbid cross-organisation statements outside their assigned repositories. Query location does not prove tenant-predicate correctness; the resolved-identity predicate is still required.

<a id="multi-tenancy-the-404-rule"></a>
#### The 404 rule

A read outside reach returns **404**, never 403. Returning 403 would confirm the record
exists, which is a cross-tenant leak. `tests/api-integration/tenant-isolation.test.ts`
seeds two organisations and asserts that every read route returns 404 across the boundary.

<a id="multi-tenancy-customer-scoping"></a>
#### Customer scoping

For a customer identity, reach is `{ kind: 'organisation', ids: [theirOrg] }` and cannot
be widened by any role. Even a customer with an inflated role sees only their
organisation. This is enforced in the evaluator, not by role configuration, so it cannot
be misconfigured away.

<a id="multi-tenancy-cross-organisation-work"></a>
### Cross-organisation work

Staff in the internal organisation routinely work across customer organisations. That is
reach granted by project membership, or by an explicit `sees_all` flag on a workspace
membership for roles such as service-desk triage.

`sees_all` grants **reach only**. It never grants authority. This is the distinction v1
got right and is worth repeating: a triage agent who can see every ticket still cannot
change a project's SLA policy.

<a id="multi-tenancy-data-residency-and-separation"></a>
### Data residency and separation

Single database, shared schema, application-level scoping. Reasons:

- One migration path, one backup, one connection pool.
- Cross-organisation reporting for the internal organisation is a first-class requirement,
  and schema-per-tenant makes it painful.
- Our scale does not justify the operational cost of separation.

**If a customer requires physical separation**, the answer is a separate instance —
a separate container and database, same image. This is exactly why everything is
configured at runtime: a dedicated instance costs a `docker compose up` and a God Mode
session, not a build.

<a id="multi-tenancy-branding-per-tenant"></a>
### Branding per tenant

Instance branding is instance-wide. Where a customer-facing portal must carry the
customer's own branding, that is a separate instance.

Within one instance, per-organisation customisation is limited to: the request catalogue
they see, their service calendar, their SLA policies and their notification settings.

<a id="multi-tenancy-identity-across-tenants"></a>
### Identity across tenants

**One person, one organisation.** A `person` row belongs to exactly one organisation and
never moves between them. Everything below follows from that.

- **The agent portal serves the internal staff organisation only** — the one marked
  `is_internal`. Staff arrive through an identity connection scoped to that portal
  (Microsoft Entra in core delivery; other providers when they land), or by email
  invitation, and are then placed on teams and named as stakeholders.
- **The customer portal serves one organisation per customer company.** No customer person
  belongs to two organisations.
- **Email is not an identity key, and is not unique per instance.** The key is
  `(identity_connection_id, subject)` on `external_identity` — Entra's `oid` within its
  tenant. Better-auth's default unique index on `user.email` is therefore dropped at fork
  ([data-model.md](data-model.md) §2); an address is an attribute that can change, and two
  people at different customers may legitimately present the same one.
- **A human who genuinely needs both portals gets two `person` rows** — one staff-side, one
  customer-side — and **the same email address is allowed on both**, because the identity
  key is per connection and the two rows collide on nothing. They are never linked: linking
  them by address is exactly what `IP-18` forbids, and a single identity with two sides is
  the ambiguity that produces authorization bugs.
- **But the default is not a second account.** A staff member who needs to see what a
  customer sees uses **God Mode impersonation** — audited twice, capped at thirty minutes
  ([god-mode.md](feature-contracts-p4.md#god-mode) `GM-7`, `GM-8`). A second account is for
  someone who genuinely *is* a customer contact in their own right, not for support work.

**Known limitation, accepted deliberately (2026-09-06):** a consultant who is genuinely a
contact at two customer organisations needs two customer-side `person` rows and signs in to
each through that organisation's own connection. There is no single identity spanning
customer organisations, and the schema is **not** being redesigned for it now — the cost is
a rare person signing in twice; the alternative is a many-to-many identity model paying for
itself on every authorization check.
- Identity providers are bound per portal, and a customer connection is bound to exactly
  one organisation by `identity_connection.organisation_id`
  ([identity-provisioning.md](feature-contracts-p3.md#identity-provisioning) `IP-1`). After
  authenticated admission, **that persisted column is the only source of organisation
  scope**; login routing cannot set or alter it.
- A visitor's typed email domain may route unauthenticated customer-login initiation to a
  configured connection. The connection's persisted `organisation_id`, not the domain,
  supplies organisation scope; state-binding and post-validation collision rules follow
  [identity-provisioning.md](feature-contracts-p3.md#identity-provisioning) `IP-9`. A match never
  admits a subject. The limited domain-to-SSO/IdP-destination disclosure across the
  unauthenticated flow is defined by `IP-29`; it is not organisation scope or a published
  customer inventory. An unbound domain falls through to non-SSO methods.

<a id="multi-tenancy-provisioning-a-new-customer-organisation"></a>
### Provisioning a new customer organisation

```
God Mode → Organisations → New

  Name, key, email domains
  Service calendar          (choose or create)
  Default SLA policy
  Request catalogue         (which request types they see)
  Portal access             enabled / disabled      (organisation.portal_access)
  Initial contact           email → invitation
```

Identity is **not** a field on this form. There is nothing to inherit: an `agent` connection
has no organisation at all, so there is no instance default a customer organisation could
fall back to. An organisation's identity is a **read-through of its `identity_connection`
row** — created and edited afterwards, by an instance administrator, in God Mode →
Organisations → *org* → Identity ([god-mode.md](feature-contracts-p4.md#god-mode),
[identity-provisioning.md](feature-contracts-p3.md#identity-provisioning) `IP-5`).

No deploy. No restart. This is the operation that must be effortless, because it is the
one performed most often.

<a id="multi-tenancy-deleting-an-organisation"></a>
### Deleting an organisation

1. Soft-delete: portal access revoked, sessions invalidated, projects archived.
2. A 30-day window during which restore is one click.
3. Hard delete purges the **complete** list in [security-model.md § Data lifecycle](#security-model-data-lifecycle)
   — work items, comments, attachments and objects, time and cost entries, notifications,
   `notification_delivery` children, empty `notification_digest` groups, sessions, API keys,
   webhooks, invitations, outbox event envelopes and their
   `outbox_dedupe_reservation` leases (owned by delivery children), idempotency responses,
   `metric_snapshot` rows for the organisation, search vectors and cached identities.
   `audit_log` rows are retained with `organisation_id` set null as the tombstone, because
   deleting an audit trail on request defeats its purpose. Backups retain deleted data for
   their stated retention; [data-protection.md](operations-and-distribution.md#data-protection) states
   the position a customer's DPA will ask about.
4. The whole sequence is audited and requires re-authentication.

<a id="multi-tenancy-limits-and-quotas"></a>
### Limits and quotas

Configured per organisation in God Mode, with **real defaults** — an internet-facing portal
with unlimited storage and unlimited portal users is a denial-of-wallet path from a
low-privilege actor. The internal organisation may raise them freely.

The six limits are stored in **`organisation_quota`**
([data-model.md](data-model.md) §2), one row per organisation, `organisation_id` unique;
**no row means these defaults**. Current usage is never stored there — it is counted live
off the owning tables and the rate limiter's window — so a quota can be lowered below
present usage without a migration or a backfill.

| Quota | `organisation_quota` column | Default |
| --- | --- | --- |
| Projects | `max_projects` | 200 |
| Work items | `max_work_items` | 500,000 |
| Storage | `max_storage_bytes` | 20 GiB |
| Portal users | `max_portal_users` | 500 |
| API requests / minute | `max_api_requests_per_minute` | 600 |
| Webhook endpoints | `max_webhooks` | 10 |

Exceeding a quota returns `429` with a problem document naming the quota.

<a id="multi-tenancy-testing"></a>
### Required behavior cases

| Test | Asserts |
| --- | --- |
| `tenant-isolation.test.ts` | Two seeded orgs; every read route returns 404 across the boundary |
| `customer-reach.test.ts` | A customer role with inflated capabilities still cannot widen reach |
| `sees-all-authority.test.ts` | `sees_all` grants no capability |
| `org-delete.test.ts` | Hard delete removes all owned rows and leaves audit tombstones |
| E2E `cross-tenant.spec.ts` | Customer A cannot reach Customer B's ticket by URL |

<a id="observability"></a>
## Observability
<a id="observability-the-three-signals"></a>
### The three signals

| Signal | Tool | Purpose |
| --- | --- | --- |
| **Logs** | Pino → stdout, JSON | What happened |
| **Metrics** | Planned: Prometheus at `/metrics` | How much, how fast, how often |
| **Traces** | OpenTelemetry (optional exporter) | Where the time went, across a request |

Application request logs and trace spans share a server-generated `traceId`. Ordinary
Prometheus series do not: trace ids are unbounded and must never be metric labels. A future
tracing integration may use exemplars for metric-to-trace navigation; that is not part of
P0 acceptance.

<a id="observability-logging"></a>
### Logging

Structured JSON to stdout. The container runtime collects it; the application never
writes log files.

```json
{
  "level": "info",
  "time": "2026-09-05T10:14:22.113Z",
  "traceId": "01J8XQ…",
  "spanId": "a3f1…",
  "actorId": "usr_…",
  "organisationId": "org_…",
  "route": "PATCH /api/work-items/{key}",
  "status": 200,
  "durationMs": 42,
  "msg": "work item updated"
}
```

Levels: `error` (needs a human), `warn` (degraded but handled), `info` (state changes and
requests), `debug` (off in production).

Every record is constructed from an explicit typed field allowlist. Do not pass raw request,
response, header, body, error, cookie, or plugin-configuration objects to the logger. Route
labels use the registered route template, never a raw URL or query. Pino redaction is a
second layer of defence; a test that throws known secret patterns at the logger supplements
the allowlist and does not define it.

The existing `http.request` record may carry the narrow strict-terminal witness defined in
[RBAC](permissions.md): an opaque server-generated request
id, registered route and policy source, evaluator decision category, and finite scope
provenance validation result. It is emitted only when the strict evaluator completed. The
request id is returned in the `x-taskdesk-request-id` response header for receipt correlation;
an inbound id header is never trusted or reused. No row/tenant/actor identifiers or facts,
credentials, payloads, or arbitrary text are included. At the logger boundary, both the event
and nested witness are snapshotted from own enumerable data properties only; accessors,
symbols, non-enumerable fields, unknown keys, and custom prototypes are rejected without
reading accessor values. The logger validates the captured primitive types and route/source
pair, then serializes a fresh canonical projection of the approved fields rather than the
caller-supplied object. This prevents inherited or custom `toJSON` behavior and later mutation
from adding log data. This witness does not change request processing or shadow gates.

**Never logged:** passwords, tokens, API keys, plugin secrets, session cookies, request
bodies containing custom field values, attachment contents, or arbitrary exception text.

Log level is configurable at runtime in God Mode, per module, so debugging production
does not require a restart.

HTTP server lifecycle failures use the fixed `http.lifecycle_failure` message, module
`http`, level `error` and result `failed`. This covers startup, graceful HTTP close and
forced connection close failures. The lifecycle helper accepts no error or context argument;
it emits no request route, duration, identifier, configuration, payload or exception text.
It does not alter propagation, shutdown deadlines, forced-close decisions or completion.
Structural and injected-failure regressions must reject raw exception serialization in the
API server lifecycle; successful startup/shutdown messages may remain finite informational
text. Realtime failures continue to use `realtime.failure`.


<a id="observability-p0-metrics-contract"></a>
### P0 metrics contract

P0 starts with bounded HTTP request metrics and the audit-write-failure counter below. The
broader business, job, and infrastructure catalogue remains a target for later producer-by-
producer work; it is not a P0 completeness claim. Application metric names and finite label
values are registered here before implementation. Route labels use normalized registered
templates; method values use `GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|OTHER`; status values
are the five finite classes `1xx|2xx|3xx|4xx|5xx`. Never label by raw path, query,
project/organisation/person identifiers or names, token, exception, actor, or trace id.

Prometheus exposition is `GET /metrics`, guarded by a bearer token configured through the
administrator API in God Mode and compared in constant time. The metrics-only Node listener
binds on the container network interface at fixed internal port **9464** and is not
published to the host or exposed through Traefik. It has no API, health, OpenAPI,
static-file, or authentication mount. The
token grants `/metrics` alone and never reads `/api/instance/health/deep`, which is
`instance:admin` only (decision log 2026-09-06).

The listener accepts only exact `GET /metrics` with no query. `HEAD`, `OPTIONS`, and other
methods on that path return `405`; other paths return `404`. A valid scrape returns only
registered Prometheus metrics. The listener starts only in serving role after the safe
observability configuration has loaded and validated; a bind failure prevents readiness.
Shutdown closes it with the API server. Migration and job roles do not open the listener.

The token is exactly 32 random bytes from the Node cryptographic random generator, shown as
an unpadded 43-character base64url value once after successful rotation. Store only its
32-byte SHA-256 digest and rotation timestamp; there is no plaintext, prefix, previous-token
grace, or token export. The bearer must decode from exactly 43 unpadded base64url characters
to 32 bytes; compare fixed-length SHA-256 digests with `timingSafeEqual`. Malformed bearer
values follow the same denial path as a wrong value. A scrape reads the current digest from
PostgreSQL without a credential cache. A scrape whose credential read starts after a
rotation commits rejects the previous token; a scrape authorized before commit may finish.
Credential read failures return `503` without exposition. Missing, malformed, and wrong
credentials share a generic `401` response. These credentials do not authorize any API
operation.

The P0 administrator surface is `GET /api/instance/observability`,
`PATCH /api/instance/observability`, and
`POST /api/instance/observability/metrics-token/rotate`. GET returns only safe settings;
PATCH changes log levels with an optimistic version; rotation returns the token once and
requires fresh session-only operation-bound step-up. The route registry, OpenAPI schemas,
permission matrix, and implementation tests must agree. The `/god-mode/observability` surface uses the original settings composition for log levels, local-factor policy and metrics-token rotation; a listed screen is not acceptance evidence.

Per-module levels are a closed document with `default` and `modules` only. Initial module
keys are `http`, `auth`, `database`, `jobs`, `audit`, `plugins`, and `realtime`; each level is one of
`error`, `warn`, `info`, or `debug`. All modules start at `info`, which keeps production
debug logging off. Validate on write and when reading persisted settings; invalid persisted
shape prevents readiness. Serving replicas refresh the complete validated snapshot at most
every five seconds and apply it atomically. A transient refresh failure keeps the last known
non-secret levels, emits one bounded warning per failure interval, and retries. The metrics
credential is never cached.

A required factor or fresh SSO method that cannot be verified makes rotation unavailable (`403 step_up_unavailable`). A session-only check, sign-in email OTP or client success assertion cannot substitute for fresh proof. Metrics names and surfaces below are requirements, not evidence that an image serves them.

The finite structured log `msg` values are `http.request`, `http.lifecycle_failure`, `auth.failure`,
`database.failure`, `jobs.failure`, `audit.write_failure`, `plugins.failure`,
`realtime.failure`,
`observability.config_refresh_failure`, and `observability.listener_bind_failure`.
Callers cannot supply arbitrary message text. The `route` field uses an actual registered
method-and-template pair; a request that cannot be matched is recorded as the finite `unmatched`
bucket rather than its raw path.

**HTTP**
```
taskdesk_http_requests_total{route,method,status}
taskdesk_http_request_duration_seconds{route,method}   histogram
taskdesk_http_in_flight
taskdesk_audit_write_failures_total{operation}
```

`operation` is a closed label enum: `mutation`, `pending_action_decision`,
`pending_action_self_read`, or `audit_read`. Do not add route, id, actor, exception text, or
trace id labels. `audit_read` covers the best-effort AU-13 audit-row append after an audit-log
read; it is separate from pending-action self-read auditing.
The counter increment and its safe error-level log line happen outside any rolled-back audit
savepoint. They do not change AU-14's successful mutation behavior or the separately
fail-closed pending-action self-read contract. A positive five-minute increase is an urgent,
page-worthy alert for the affected instance. Background pending-action expiry groups the
administrator notification and safe log by degraded batch while counting every failed append.

Audit-write failure requires the counter and durable administrator notification; a positive five-minute increase is an urgent, page-worthy instance alert.

**Business** — instance-wide aggregate targets, never per-tenant or per-resource series
```
taskdesk_work_items_open{priority}                     priority: low|medium|high|urgent
taskdesk_sla_state{state}                              state: ok|at_risk|breached
taskdesk_intake_pending
taskdesk_approvals_pending
taskdesk_portal_sessions_active
taskdesk_auth_reload_total{outcome}                    ok|failed — auth configuration reloads per replica
taskdesk_auth_config_version                            the auth config_version each replica serves
```

`work_items_open` and `sla_state` are instance-wide aggregates. They contain no project or
organisation series. `priority` is the closed enum in [data-model.md](data-model.md); the
SLA state values are the finite values shown above. All names in this broader catalogue are
targets, not evidence of live producers.

**Withheld job metrics**

Do not implement the current target shapes `taskdesk_job_runs_total{job,outcome}`,
`taskdesk_job_duration_seconds{job}`, or
`taskdesk_job_last_success_timestamp{job}` until
[background-jobs.md](background-jobs.md) registers a finite,
configuration-independent job enum. `outcome` is limited to `ok|failed` where used. An
`other` bucket is permitted only if that owner document explicitly defines it. Scalar
outbox gauges have no job label:

```
taskdesk_outbox_pending
taskdesk_outbox_dead
```

**Infrastructure** — bounded scalar targets
```
taskdesk_db_pool_{active,idle,waiting}
taskdesk_ws_connections
taskdesk_nodejs_eventloop_lag_seconds
```

Do not implement the target shape `taskdesk_db_query_duration_seconds{operation}` until
the query owner enumerates a finite, configuration-independent operation set; an `other`
bucket is allowed only if that owner specifies it. Do not implement
`taskdesk_plugin_health{plugin_id}`: `plugin_id` can identify a customer-configured plugin
instance. A separate owner-reviewed metric contract must replace that shape with finite,
privacy-safe aggregation before instrumentation.

Every Prometheus label in the P0 core and later catalogue must come from a documented finite
enum or the finite registered HTTP route-template set. A label may never contain a tenant,
organisation, project, person, work-item, resource, credential, plugin-instance id/name/key,
user-controlled text, raw path/query, trace id, or exception. A producer whose useful
dimensions cannot meet this rule remains withheld until its owner specifies a safe finite
aggregation and a retention/cardinality test. The internal bearer is still required because
aggregate cross-tenant operating data is sensitive.

<a id="observability-tracing"></a>
### Tracing

OpenTelemetry is deferred beyond the P0 core. If implemented later, it is off unless an
exporter is configured in God Mode (OTLP endpoint, headers, sample rate). Auto-instrumentation
covers Hono, `pg` and `ioredis`; we add manual spans
for domain operations that matter:

```
PATCH /api/work-items/SUP-1234
├── auth.resolve-session                    2 ms
├── identity.resolve                        4 ms   (cache miss)
├── policy.evaluate                         1 ms
├── db.work_item.load                       6 ms
├── domain.workflow.validate-transition     0 ms   ← pure, always fast
├── domain.sla.compute                      1 ms
├── db.work_item.update                     9 ms
├── db.activity.insert                      3 ms
├── events.emit                             2 ms
│   ├── outbox.enqueue                      1 ms
│   └── ws.broadcast                        1 ms
└── response.serialize                      1 ms
                                    total  29 ms
```

Sampling: 100% of errors, 100% of requests slower than 1 s, 1% of the rest.

<a id="observability-health-endpoints"></a>
### Health endpoints

| Endpoint | Meaning | Used by |
| --- | --- | --- |
| `/api/public/health/live` | The process is running | Container liveness. Anonymous |
| `/api/public/health/ready` | Database reachable, migrations applied; after observability settings ship, safe settings loaded and validated | Load balancer readiness. Anonymous |
| `/api/instance/health/deep` | Dependency/plugin diagnostics; instance-admin policy; availability must be verified |

`live` never touches a dependency — a liveness probe that fails when Postgres blips will
restart a healthy container and make an outage worse.

<a id="observability-errors-deferred"></a>
### Errors (deferred)

The intended error reporting uses Sentry, configured in God Mode rather than only by
environment variable, with:

- Release tagged to the build's git SHA, so a regression points at a commit.
- `traceId` attached, linking to logs and traces.
- PII scrubbed before send.
- The user's organisation as a tag, so "is this one customer or everyone?" is one click.

Error reporting and source-map publication require their configured privacy and release contracts; this reference makes no implementation claim.

<a id="observability-frontend-performance-deferred"></a>
### Frontend performance (deferred)

P0 has no RUM client and no public ingestion endpoint. A future RUM contract must first
specify its route policy, bounded payload, PII handling, and retention before browser
reporting is implemented. The currently discussed target budgets are:

| Metric | Budget |
| --- | --- |
| LCP | < 2.5 s p75 |
| INP | < 200 ms p75 |
| CLS | < 0.1 p75 |
| Board render, 200 items | < 500 ms |
| Route transition | < 300 ms |

Budgets are preserved and must not be waived or raised to make a check pass. A RUM feature and local/CI performance evidence are distinct. See [UX quality gates](architecture-and-experience.md#ux-quality-gates).

<a id="observability-dashboards-deferred"></a>
### Dashboards (deferred)

The following Grafana panels require their instrumentation and finite-label contracts; a catalogue entry does not prove a dashboard artifact exists.

1. **Service health** — request rate, error rate, latency percentiles, saturation.
2. **Business** — instance-wide aggregate open work items by priority, SLA states, intake depth, pending approvals.
3. **Jobs** — only scalar outbox depth is currently dimension-safe; last-success and duration panels are blocked until the job owner registers a finite job enum.
4. **Database** — pool, slow queries, table sizes, index hit ratio; per-operation duration is blocked until the query owner registers finite operation labels.
5. **Frontend** — deferred Web Vitals by route; no P0 RUM ingestion exists.

<a id="observability-alerts"></a>
### Alerts

Audit failure requires a durable instance notification to currently authorized administrators. The remaining monitoring conditions retain their producer/label prerequisites. Every alert
must be actionable; anything that fires and is routinely ignored gets deleted rather than
muted.

| Alert | Condition | Severity |
| --- | --- | --- |
| Audit write failures | `increase(taskdesk_audit_write_failures_total[5m]) > 0` | Urgent / Page |
| API down | `/api/public/health/ready` failing 2 min | Page |
| Error rate | 5xx > 1% over 5 min | Page |
| Latency | p95 > 2 s over 10 min | Warn |
| Job stalled | Blocked until a finite, configuration-independent job label contract exists; then evaluate last-success against 3× cadence | Deferred |
| Outbox backing up | `outbox_pending` rising 15 min | Warn |
| Outbox dead letters | `outbox_dead` > 0 | Warn |
| DB pool exhausted | `db_pool_waiting` > 0 for 5 min | Page |
| Plugin unhealthy | Blocked until a finite, privacy-safe plugin-health aggregation contract exists | Deferred |
| Disk | > 85% | Warn |
| Certificate expiry | < 14 days | Warn |

<a id="observability-audit-versus-logging"></a>
### Audit versus logging

They are different and must not be conflated.

| | Audit log | Application log |
| --- | --- | --- |
| Lives in | Postgres `audit_log` | stdout |
| Purpose | Answer "who changed what" under scrutiny | Debug the system |
| Retention | 12 months, configurable | Whatever the collector keeps |
| Mutable | Never | N/A |
| Contains PII | Yes, deliberately | No, deliberately |

<a id="pending-actions"></a>
## Pending actions — server-enforced approval for deletion and destructive agent calls
Every user-initiated deletion uses durable, exact, single-use approval by the requesting human in a browser. This security control is always on.

<a id="pending-actions-purpose"></a>
### Purpose

Every **user-initiated deletion** in TaskDesk, from any client, goes through one
mechanism: the request creates a `pending_action`; nothing is deleted; the human who owns
the request approves it in the TaskDesk browser UI; the server re-checks authorization and
executes exactly what was approved. The same mechanism carries the MCP server's
destructive tools ([mcp-server.md](feature-contracts-p4.md#mcp-server) `MC-7`), because a model
must never be the thing that says "yes".

This closes three failure modes at once: a model prompt-injected into deleting through an
MCP key; an API client scripted to bulk-delete with a stolen key; and the ordinary
mis-click, which the browser dialog already caught in v1 but which the API never did.

<a id="pending-actions-concepts"></a>
### Concepts

| Term | Meaning |
| --- | --- |
| **Pending action** | A durable record of a requested destructive operation, awaiting a human decision |
| **Requester** | The human identity the request was made *as* — the session's person, or the `person_id` of the personal API key |
| **Origin** | Which client asked: `web`, `api`, `mcp`. (Automations have no delete action before P4 — `AM-13`) |
| **Approver** | Always the requester, in a **browser session**. Never an API key, never a model, never an impersonation session, never an automation |
| **Confirmation kind** | What the approver must do: click, type the target's name/key, type the affected count, and/or pass step-up authentication — [levels](#pending-actions-confirmation-levels) |

<a id="pending-actions-data"></a>
### Data

`pending_action` — [data-model.md](data-model.md) §11. Every approval is **bound** to:
requester `person_id`; credential (`session` or `api_key` + id); origin; `action`
(`delete`, `bulk_delete`, `purge`, `mcp_destructive`); `route_key`; `target_type` and the
exact `target_ids[]`; `target_versions` where the target is versioned; the stored `payload`
and its `payload_hash`; the `scope` (workspace/project/organisation); `created_at`;
`expires_at`; `state`; `invalidation_reason`; the confirmation kind required and the one
supplied; `decided_by`, `decision_session_id`, `decided_at`; `executed_at`; `error`.

Three of those columns exist so that the guarantees below have a mechanism rather than a
convention, and each has one job:

- **`payload jsonb`** — the request is *kept*, not only digested, so `PA-6` can re-hash it.
  `payload_hash` is SHA-256 over a **canonical payload** with exactly these members, in this
  order: `{ action, route_key, target_type, target_ids (sorted ascending), workspace_id,
  project_id, organisation_id, confirmation_required }`, serialised as RFC 8785 canonical JSON
  and written lowercase hex. Nothing outside that set enters the hash — not `created_at`, not
  the rendered summary — so the digest is reproducible at approval time from the stored row.
- **`route_key text` not null** — the exact `policy.ts` key (`'DELETE /api/work-items/{key}'`),
  type-constrained to `keyof PolicyMap`. `PA-6` re-runs `policyMap[route_key]` and nothing
  else. Without it the server cannot know *which* policy to re-run — `mcp_destructive` alone
  covers `decide_approval` and any bulk operation above 50 items — and an implementer would
  build a second `target_type → capability` map outside the registry, which is exactly the
  second authorization surface this design exists to prevent.
- **`invalidation_reason text` null** — an enum over the `PA-9` causes, so "why did this
  approval die?" is answerable from the row during the incident review the audit story depends
  on.

`payload_summary jsonb` stays what it always was: what the dialog renders. It is never the
thing that is hashed or executed.

<a id="pending-actions-behaviour"></a>
### Behaviour

- `PA-1` **Any request to delete** — `DELETE` route, MCP tool, bulk action — first passes
  the route's normal policy (reach, capability, feature flag). If the caller may not even
  *request* deletion, the response is the ordinary 404/403 and no pending action exists.
- `PA-1a` **Exemptions (accepted by Thomas, 23 Oct 2026).** Removals that are not "deletes of
  business data" may stay immediate, always behind the route's normal policy, and every one is
  listed with its reason in `tests/api-integration/delete-routes-never-immediate.test.ts`
  (adding a route there is a contract change recorded here). The categories are:
  (1) **unlinks** that remove only a relationship and never the linked records or history
  (label detach from a task, assignee clear, own watch, parent clear, **workspace membership
  removal** under its owner/last-owner guards, **team membership removal**, **direct project
  roster removal** (PR-4; inherited or identity-provider-managed rows are refused 409), and
  **removing a work item from a cycle or module** (CY-4, MO-2; both records survive, audited));
  (2) **a person's own settings and inbox**
  (own avatar, own notification clear-all and per-workspace overrides); (3) **configuration
  rows with no history** managed by a session-only administrator in the Kaneo editor
  (workflow-rule deletion, `sessionOnly`, never reachable with an API/MCP key; deleting an **empty** custom-field section, refused while any field still belongs to it); (4)
  **revocation under another authenticator** — a person revoking their own session or own
  API key through better-auth (`/api/auth/*`; killing your own credential is the safe
  direction and is not a data deletion) and **SCIM deprovision/group removal under the
  per-connection SCIM bearer token** (identity-connection guards apply; the directory
  deactivates an identity, the person's work survives); (5) **ending one's own impersonation
  session** (`DELETE /api/instance/impersonate`, GM-11: removes only that session row, audited
  as `impersonation.ended`). Creating or rotating API keys stays elevated (PA-5). Everything
  else that deletes business data follows PA-1…PA-4; every registered deletion target's real
  `DELETE` handler is proven at runtime to answer 202 and record a `pending` action
  (`tests/api-integration/delete-routes-runtime-pending.test.ts`).
- `PA-2` If the caller may request it, the server creates a `pending_action` in state
  `pending`, writes `pending_action.requested` to the audit log, and responds **`202
  Accepted`** with `{ pendingActionId, action, summary, confirmation, expiresAt,
  approveUrl }`. **Nothing is deleted at this point**, whatever the client.
- `PA-3` A **web-UI** request opens the approval dialog immediately in the same browser
  session, rendered from the server's `summary` (never from client state). To the person it
  is a confirm dialog; underneath it is `PA-6`.
- `PA-4` An **API-key or MCP** request to delete an **ordinary** record — work item, comment,
  attachment, custom field, saved view, time entry, label, relation and the rest — returns the
  same `202`. The requester is notified ("An agent using your key *ci-bot* asked to delete
  SUP-1234") and approves from **Profile → Pending actions** or the notification. The client
  learns the outcome by polling `GET /api/me/pending-actions/{id}`.
  - **The retry rule, stated once.** Idempotency middleware runs **first**: a repeat carrying
    the same `Idempotency-Key` replays the stored `202` and reaches nothing further
    ([api-design.md](#api-design)). Behind it, a partial unique index on
    `(requested_by_person_id, action, target_ids, state) WHERE state = 'pending'` makes a
    second *pending* action for the same targets impossible. So a retry of the same request
    while one is pending returns **`409 pending_approval` with the id and creates nothing
    new** — with or without an idempotency key. There is no path that produces two pending
    actions for the same targets, and `target_ids` (not the rendered summary) is what
    establishes identity.
- `PA-5` **Two credential classes, two answers.** Deleting a **workspace, organisation,
  project, API key, webhook, identity connection or `auth.*` plugin** is on the elevated list
  and carries `sessionOnly: true` ([rbac.md](permissions.md)). The credential
  check runs in the auth middleware **before** the route policy, so those requests are refused
  **`403 session_required`** when they arrive on an API key, an MCP key or an impersonation
  session: no pending action is created and there is no 202 to poll. The elevated rows in the
  confirmation table below are therefore **web-origin only**. Everything else keeps `PA-4`.
- `PA-5a` A request made with a **workspace service key** (no `person_id`) has no approver
  and is refused `403 no_approver`. Service keys cannot delete.
- `PA-6` **Approval** is `POST /api/me/pending-actions/{id}/approve` with the required
  confirmation — policy kind 2 (`authenticated + self`: the requester only) **and
  session-only**: an API key, an `is_mcp` key or an impersonation session is refused `403`
  ([rbac.md](permissions.md)). The server then:
  1. re-checks the action is `pending` and unexpired;
  2. re-resolves the approver's identity and **re-runs `policyMap[route_key]`** — the stored
     route's own policy, no other — against the current reach and capability; an approver who
     lost access since requesting gets 404 and the action becomes `invalidated`;
  3. re-hashes the stored `payload` over the canonical members above and compares it to the
     stored `payload_hash`, and for versioned targets checks `target_versions` still match
     (a work item edited since the request is `409 target_changed`, and the action is
     `invalidated`);
  3a. re-reads each target's **current** `workspace_id`, `project_id` and `organisation_id`
     and compares them to the stored scope — any difference is `409 target_changed` and the
     action is `invalidated`, even where the approver happens to hold the capability in the
     new scope. Without this step a target moved between the request and the approval is
     deleted in a scope the approver never saw in the summary, which is the target-substitution
     attack `PA-7` exists to prevent, achieved without touching the pending action;
  4. validates the confirmation — typed text equals the exact key/name, typed count equals
     the affected count, step-up token present and bound to this action where required;
  5. marks the action `approved`, executes **exactly the stored targets**, marks it
     `executed` (or `failed` with the error), and writes the audit rows.
- `PA-7` **Single-use and exact.** An approved action cannot be replayed, cannot be applied
  to another resource, and cannot be applied when the payload, targets or scope differ from
  what was approved — the hash comparison in `PA-6` is the mechanism, not a convention.
- `PA-8` **Expiry:** 15 minutes from creation. `pending-action-expire`
  ([background-jobs.md](background-jobs.md)) marks stale rows `expired`. Its registered
  candidate set is pending workspace-scoped actions, canonical instance user deactivation
  (`delete`/`user` on `POST /api/instance/users/{id}/deactivate`), and durable 0109
  `user_deactivation`/`person` rows on that same route with all scope columns null. Other
  nullable-scope rows remain untouched and make the worker report degraded operation. The
  worker takes one database-clock cutoff per candidate statement, then samples the database
  clock again after each row lock before committing the terminal state and its existing
  decision event/audit behavior.
- `PA-9` **Invalidation:** an action becomes `invalidated` when the requesting credential
  is explicitly revoked, the requester is deactivated, the requester loses reach to any
  target, the required capability is removed, the requester cancels it, a target's version changes, or
  **a target has moved to another scope** since the request (`PA-6` step 3a — a cross-project
  or cross-workspace move). Whichever cause fired is written to `invalidation_reason` and
  carried on the `pending_action.decided` event, so the row explains itself afterwards.
  An explicit sign-out or session revocation invalidates actions bound to that session;
  disabling or revoking an API key invalidates actions bound to that key. Restoring the same
  session, key, reach or capability never revives an invalidated action. Ordinary session
  expiry alone is not credential revocation: the action stays pending until `expires_at`, and
  the requester may sign in again to approve it. Natural API-key expiry is terminal for
  actions bound to that original key, even if its expiry is later extended; the expiry
  extension invalidates those actions with `credential_revoked` before the extension commits.
  A reach or capability change invalidates an
  action only when it removes access required by that action under its current registered
  route policy and target scope; unrelated membership, role, or profile changes do not.
  Successful deletion of the linked auth account also removes that person's ability to act on
  every remaining request: account teardown invalidates residual actions owned by the linked
  person with `capability_removed`, including actions whose original expired-session row was
  already removed by ordinary cleanup. Expiry cleanup alone remains nonterminal; a missing
  credential row by itself is not a selector for account teardown.
  Denial by the approver is `denied`. None of these terminal outcomes can later be approved.
- **Lifecycle lock order:** pending-action creation, approvals that lock the requester
  person, and person active-state transitions take one transaction-scoped lifecycle gate
  before their first row lock. Administrative deactivation takes the shared instance-admin
  lock first, then this gate. After the person closure is locked, deactivation locks that
  person's pending rows in id order, marks each still-pending row `invalidated` with
  `requester_deactivated`, and writes its decided event and audit row in the same transaction.
  This order prevents an approval holding an action row while deactivation holds the person.
- `PA-10` **Nobody approves their own automation.** A model-supplied field (the old
  `confirm: true`), a header, an MCP argument or an automation cannot satisfy `PA-6`.
  There is no server setting that disables this mechanism.
- `PA-11` **Fully audited**: `requested`, `viewed` (the dialog or the pending-actions page
  rendered the summary), `approved`, `denied`, `expired`, `cancelled`, `invalidated`,
  `executed`, `failed` — each an `audit_log` row; all but `viewed` also emit one of the
  three `pending_action.*` events in [events.md](events.md) (`requested`; `decided` with
  its `outcome`; `executed` with `executed|failed`). `viewed` is audit-only — it is not a
  state change. Decision transitions are mutations and follow `AU-14` in
  [audit-trail.md](feature-contracts-p2.md#audit-trail): if the decision audit insert fails, the
  state transition and decided event still commit while the audit failure is reported under
  AU-14. This is the documented audit-failure exception to the normal state/event/audit
  pairing; it does not apply to rendering a summary, whose read fails if its `viewed` audit
  cannot be written.
- `PA-12` **What does *not* need a second approval:** the retention purge that completes an
  already-approved soft deletion — `session-cleanup`'s soft-delete purge and
  `attachment-gc` ([background-jobs.md](background-jobs.md)), completing `WI-21`'s 30-day
  window and its equivalents; the configured and audited `audit-purge`; removal of
  `pending` upload objects that were never made available as records
  (`attachment-pending-cleanup`); system cascades that are part of an approved deletion (a
  project's work items when the project deletion was approved). A legal hold suspends the
  first two for its scope ([security-model.md](#security-model-threat-model)).
- `PA-13` **Hard purge** is never a general-purpose tool. There is no MCP purge tool and no
  automation purge action. Hard purge is either retention/system lifecycle processing, or
  an exceptional `instance:admin` operation (`POST /api/instance/purge`) that is elevated,
  requires typed confirmation, **checks legal hold and retention policy first**
  ([data-protection.md](operations-and-distribution.md#data-protection)), and writes a complete audit
  record of what was purged.
- `PA-14` The same mechanism carries the MCP server's other destructive tools —
  `decide_approval`, and any bulk operation above 50 items — with `action =
  'mcp_destructive'` ([mcp-server.md](feature-contracts-p4.md#mcp-server) `MC-7`, `MC-17`).
  For `decide_approval`, the registered target is `approval_decision` on
  `POST /api/approvals/{id}/decide`; its canonical payload binds
  `mcp_decision: { action: 'approve' | 'reject', note: string | null }`. The approval
  endpoint returns a pending-action id and never executes a decision for an API key.
  Existing pending-action payload hashes retain their prior shape; this field is included
  only for this registered target.
- `PA-15` **Step-up is single-use and bound to one pending action or one explicitly
  registered operation.** `step_up_confirmation` in [data-model.md](data-model.md) owns a
  session/person-bound challenge and confirmation. `POST /api/me/step-up/challenges`
  (`authenticated + self`, session-only) creates a five-minute challenge for either the
  current requester's pending action or an explicitly registered operation. The operation
  allowlist is `metrics_token_rotate`, `identity_connection_create`,
  `identity_connection_configure`, `oidc_group_mapping_create`,
  `oidc_group_mapping_update`, `scim_admin_update`, `scim_token_rotate`,
  `scim_token_revoke`, `mfa_reset`, `instance_admin_grant`,
  `instance_admin_suspend`, `impersonation_start`, `secrets_rotate`, `webhook_create`,
  `webhook_update_url` and `webhook_rotate_secret` (Thomas, 23 Oct, for the first two; the three
  webhook keys implement `WH-15` and are pending his sign-off). Pending-action binding
  uses its existing `pending_action.id`
  and `payload_hash`; operation binding uses the exact fixed route key, operation key,
  expected resource version and server-computed canonical request-binding hash. The client
  cannot choose a route or submit a hash. The response contains an opaque challenge id and a
  one-time 32-byte random nonce encoded as 43-character unpadded base64url; only its SHA-256
  digest is stored.

  `POST /api/me/step-up` takes the same discriminated binding plus challenge id, nonce and a
  method-specific proof. It verifies the live session/person, exact binding, nonce,
  five-minute expiry and actual fresh re-authentication before issuing a new random
  32-byte confirmation token. Only its SHA-256 digest is stored. The 43-character token is
  returned once with no-store headers and expires five minutes after issuance. There is no
  session-wide grace window, token readback, or client assertion that re-authentication
  succeeded. A fresh challenge is required after expiry or failed proof. New challenges and
  tokens invalidate older unused material for the same session and binding; consumed rows
  are retained for at most 24 hours for replay diagnosis.

  Custom operation proof verification is bounded independently of Better Auth's HTTP
  limiter: a person/session/operation may create at most five challenges in a rolling
  15-minute window. Each challenge authorizes one verifier attempt; a failed password,
  factor, or nonce expires that challenge. Missing or unrelated challenge identifiers do not
  burn another challenge. The database advisory lock serializes challenge issuance and
  attempt accounting across API replicas. A rejected attempt never issues a proof or mutates
  the bound operation.

  All four shared challenge-create and proof-issue entrypoints (pending action and registered
  operation) first enter the pending-action lifecycle gate, then use that admitted transaction
  through local password, TOTP or backup-code verification and final proof issuance. The
  supported local-factor-policy PATCH joins the same gate as its first transaction statement,
  before its existing required-role then singleton lock order. A policy update therefore
  cannot commit between admitted final factor revalidation and proof issuance; it does not
  retroactively invalidate proofs that were already issued.
  verifier receives the admitted executor; Better Auth adapter transactions are nested
  savepoints on that same backend. Provider effects, including native-authorization
  invalidation from Better Auth's session-delete hook, queue on the child and commit only
  with the outer transaction.
  The proof path rechecks the original live session and current identity, factor and
  authorization after verification, using a database wall-clock sample for the five-minute
  expiry. A successful verifier remains one-shot if final revalidation denies the proof or
  its later savepoint fails: the still-challenge row expires through the admitted outer
  executor. Successful provider-side effects remain committed on either outcome; no proof is
  issued. Failure of the outer transaction provides no persistence guarantee.

  Challenge requests are a strict discriminated union:

  ```json
  { "kind": "pending_action", "pendingActionId": "..." }
  { "kind": "operation", "operation": "metrics_token_rotate", "version": 7 }
  { "kind": "operation", "operation": "mfa_reset", "userId": "...",
    "verificationNote": "..." }
  { "kind": "operation", "operation": "identity_connection_create",
    "request": { "portalScope": "agent", "organisationId": null,
      "defaultWorkspaceId": null, "displayName": "Support sign-in",
      "tenantId": "00000000-0000-4000-8000-000000000001",
      "clientId": "00000000-0000-4000-8000-000000000002",
      "clientSecret": "<submitted once>", "scopes": [],
      "claimMapping": { "version": 1, "displayName": "name" },
      "domainBindings": [],
      "jitPolicy": { "enabled": false, "default_role_id": null,
        "required_entra_app_role": "TaskDesk.User" }, "maxRoleRank": 10 } }
  { "kind": "operation", "operation": "identity_connection_configure",
    "connectionId": "...", "request": { "configVersion": 7, "enabled": false } }
  { "kind": "operation", "operation": "oidc_group_mapping_create",
    "connectionId": "...", "request": { "configVersion": 7, "externalGroupId": "...", "roleId": "...", "scope": "workspace", "scopeId": "..." } }
  { "kind": "operation", "operation": "oidc_group_mapping_update",
    "connectionId": "...", "mappingId": "...",
    "request": { "configVersion": 7, "enabled": false } }
  { "kind": "operation", "operation": "scim_admin_update",
    "connectionId": "...",
    "request": { "configVersion": 7, "kind": "mapping_update",
      "mappingId": "...", "enabled": false } }
  { "kind": "operation", "operation": "scim_token_rotate",
    "connectionId": "...", "version": 7 }
  { "kind": "operation", "operation": "scim_token_revoke",
    "connectionId": "...", "version": 7 }
  ```

  The proof request repeats the exact same validated `request` object for its challenge; the
  create body above is not abbreviated or replaced with a client-computed digest.

  For `metrics_token_rotate`, the server requires current `instance:admin` and a matching
  current `observability_config_version`, then hashes the canonical body bytes defined in
  [api-design.md](#api-design-observability-administration-and-step-up). For identity
  connection create/configure, either OIDC mapping operation, or SCIM administration, it
  requires current
  `instance:admin`, session-only authentication, the exact allowlisted route and a
  connection with any variant-specific mapping that belongs to it. Connection create uses
  fixed initial version `1`; connection configure and the other connection operations check
  the current `identity_connection.config_version` against `request.configVersion` or
  `version` (stored as `expected_version`) and validate the strict request against the persisted
  connection and mapping, or SCIM child and selected mapping when the SCIM variant has one,
  before issuing a challenge. The canonical request-binding hash covers the fixed route key,
  path `connectionId`, OIDC path `mappingId` where applicable, and the server-canonical
  serialization of the complete validated request body. The SCIM mapping id is inside that
  strict body. The client supplies neither a route key nor a hash. For a pending action,
  it verifies current requester ownership and pending state and
  takes the existing payload hash itself. The no-store response is `{challengeId, challengeNonce, expiresAt,
  reauthenticationMethods}`; the nonce is 32 random bytes as unpadded 43-character
  base64url. The step-up request repeats the binding to prevent completing a different
  challenge target:

  ```json
  { "kind": "operation", "operation": "metrics_token_rotate", "version": 7,
    "challengeId": "...", "challengeNonce": "...",
    "proof": { "method": "password", "value": "..." } }
  { "kind": "operation", "operation": "oidc_group_mapping_update",
    "connectionId": "...", "mappingId": "...",
    "request": { "configVersion": 7, "enabled": false },
    "challengeId": "...", "challengeNonce": "...",
    "proof": { "method": "password", "value": "..." } }
  { "kind": "operation", "operation": "scim_admin_update",
    "connectionId": "...",
    "request": { "configVersion": 7, "kind": "settings", "enabled": false },
    "challengeId": "...", "challengeNonce": "...",
    "proof": { "method": "password", "value": "..." } }
  { "kind": "operation", "operation": "scim_token_rotate",
    "connectionId": "...", "version": 7,
    "challengeId": "...", "challengeNonce": "...",
    "proof": { "method": "password", "value": "..." } }
  ```

  Supported proofs are the current password only for a local-password account with no
  enrolled or required second factor, or a currently enrolled TOTP / unused backup code
  verified by Better Auth against the live challenge. A required but unsupported upstream
  SSO proof fails closed; an SSO callback stores a server-verifiable receipt and accepts no
  client claim of success. The mint
  response is the no-store `{stepUpToken, expiresAt}`; no proof is logged or persisted.

  The operation bindings are only these exact routes and request contracts:

  | Operation key | Route | Version source |
  | --- | --- | --- |
  | `metrics_token_rotate` | `POST /api/instance/observability/metrics-token/rotate` | `observability_config_version` |
  | `mfa_reset` | `POST /api/instance/users/{id}/reset-mfa` | fixed operation version `1` |
  | `instance_admin_suspend` | `POST /api/instance/users/{id}/suspend` | fixed operation version `1` |
  | `identity_connection_create` | `POST /api/instance/identity-connections` | fixed initial version `1` |
  | `identity_connection_configure` | `PATCH /api/instance/identity-connections/{id}` | `identity_connection.config_version` |
  | `oidc_group_mapping_create` | `POST /api/instance/identity-connections/{id}/oidc-group-mappings` | `identity_connection.config_version` |
  | `oidc_group_mapping_update` | `PATCH /api/instance/identity-connections/{id}/oidc-group-mappings/{mappingId}` | `identity_connection.config_version` |
  | `scim_admin_update` | `PATCH /api/instance/identity-connections/{id}/scim` | `identity_connection.config_version` |
  | `scim_token_rotate` | `POST /api/instance/identity-connections/{id}/scim/rotate-token` | `identity_connection.config_version` |
  | `scim_token_revoke` | `POST /api/instance/identity-connections/{id}/scim/revoke-token` | `identity_connection.config_version` |
  | `impersonation_start` | `POST /api/instance/users/{id}/impersonate` | fixed operation version `1`; body hash covers target user id and recorded reason |
  | `secrets_rotate` | `POST /api/instance/plugins/rotate-secrets` | fixed operation version `1`; empty body |
  | `webhook_create` | `POST /api/webhooks` | fixed operation version `1`; body hash covers workspace id, name, destination url and sorted event set (never the signing secret) |
  | `webhook_update_url` | `PATCH /api/webhooks/{id}` | fixed operation version `1`; body hash covers workspace id, webhook id and the new url; spent only when the PATCH changes `url` |
  | `webhook_rotate_secret` | `POST /api/webhooks/{id}/rotate-secret` | fixed operation version `1`; body hash covers workspace id and webhook id |

  The two instance operations require current `instance:admin`; the three webhook operations
  require `webhook:manage` in the bound workspace (re-checked at challenge, at proof issue and
  inside the proof transaction), because a workspace manager is not an instance administrator.

  OIDC mapping and SCIM administration challenge and completion requests carry the exact
  connection id and strict operation body; the OIDC mapping id is a separate path id, while
  the SCIM mapping id, when applicable, is inside its validated body. SCIM token operations
  carry only the connection id and positive expected `version`; their fixed route is part of
  the server-side binding. The service re-resolves
  both resources and checks that each mapping belongs to the named connection. The step-up
  request repeats the binding.
  For `instance_admin_suspend`, the binding hash includes the target user id and the
  canonical validated suspension request (`reason` and `expiresAt`). The suspension route
  requires this single-use proof only when the target is currently an instance administrator.
  For either SCIM token operation, the service requires current `instance:admin`, a current
  agent session, the exact operation route and connection id, and a strict body containing
  only the positive safe-integer `version`. It checks that the connection and SCIM child
  exist and that `identity_connection.config_version` still equals `version` before issuing
  a challenge. The binding hash covers the fixed route key, connection id and canonical
  UTF-8 `{"version":<base-10 integer>}`. Rotation and revocation advance the same parent
  version exactly once. Rotation disables SCIM until the administrator explicitly
  re-enables it after updating the upstream bearer; revocation also leaves it disabled. Both
  operations consume proof atomically with the parent CAS and secret-hash mutation. A stale
  version leaves the proof unused. Rotation returns the random bearer once with no-store;
  revoke returns only the new safe version. Neither raw tokens nor token prefixes/hashes
  enter audit, provisioning-event detail, logs or read DTOs.
  Each protected route uses `X-TaskDesk-Step-Up-Token` and recomputes the request-binding
  hash from the loaded path parameters and server-validated canonical body. In one database
  transaction, re-read the current active person and session, re-evaluate the exact
  `instance:admin` route policy, lock the confirmation row found by token digest, compare its
  fixed-length hash and exact route/body/version/session/person binding, mark it consumed
  conditionally, compare-and-set the resource version and perform the protected mutation.
  A stale version or failed validation rolls back token consumption and the mutation; the
  retry needs a new challenge bound to the current version and request. The mutation's
  existing audit-failure exception still follows AU-14.

  For metrics rotation, the route/body canonicalization remains as specified in
  [api-design.md](#api-design-observability-administration-and-step-up). For OIDC mapping
  and SCIM administration writes, the canonical request envelopes and field ordering are
  specified in [api-design.md](#api-design-oidc-group-mapping-administration) and
  [api-design.md](#api-design-scim-administration-patch--issue-561-owner-contract).
  No operation may reuse another operation's proof, and no session-wide freshness window
  is introduced.

  For `mfa_reset`, both challenge and proof repeat the target user id and exact validated
  `verificationNote`. The canonical body hash covers the fixed route, operation, fixed
  version, target user id, and trimmed note. The reset route recomputes that binding and
  consumes the one-use token in the same transaction that locks the target, clears the
  factor, revokes sessions and keys, and inserts the target's private security notification.
  A stale, missing, replayed, wrong-target or wrong-note proof makes no reset change.

  The metrics operation uses `X-TaskDesk-Step-Up-Token` and recomputes the canonical
  request hash server-side.
  In one database transaction, re-read the current active person and session, re-evaluate
  the exact `instance:admin` route policy, lock the confirmation row found by token digest,
  compare its fixed-length hash and exact route/body/version/session/person binding, mark it
  consumed conditionally, compare-and-set the singleton version, rotate the token hash, and
  append the safe audit row in a nested savepoint. Those writes commit together. A stale
  version returns `409
  version_conflict` and rolls back token consumption; the retry needs a new challenge bound
  to the new version. A wrong, expired, replayed, or mismatched token returns the same
  generic `403 step_up_expired` for expired, consumed, malformed or mismatched proof. These denials do
  not rotate the credential. Pending-action approval retains its existing pending-id
  binding, five-minute token lifetime, re-mintability while pending, and `pending` state on
  denial.

  For SSO step-up, the callback must validate the exact configured issuer and audience,
  single-use `state` and `nonce` bound to challenge/session/subject/connection, and the
  requested `prompt=login`. It must include signed `auth_time` satisfying
  `challenge.created_at - 60s <= auth_time <= callback_received_at + 60s` and
  `callback_received_at - auth_time <= 5min`; the callback must arrive before challenge
  expiry. Missing or untrustworthy `auth_time`, changed subject/connection/session, or
  unavailable auth context fails closed (`403 step_up_unavailable` or authentication
  failure). Where policy requires MFA, fresh `amr`/`acr` evidence must satisfy the configured
  connection mapping or a real local factor; a static upstream-MFA flag alone is not proof.
  No password/email-OTP fallback is allowed for an SSO-only account.

  Re-authentication must be actually verified. The initial supported account class is a
  current local-password session with no enrolled or required second factor, where the
  server rechecks the current credential/identity and verifies the password. The current
  source does not enable better-auth `twoFactor` and does not implement a fresh Entra
  `prompt=login` callback or other verified factor adapter. A method that the account
  requires but the server cannot verify fails closed with `403 step_up_unavailable`; sign-in
  email OTP or a client success flag must not substitute for a missing required factor. The
  protected operation cannot be called usable for unsupported account classes until their
  applicable re-authentication adapters exist and are tested. Detailed binding and
  transaction rules are in
  [security-model.md](#security-model-sessions-csrf-and-step-up) and
  [api-design.md](#api-design-observability-administration-and-step-up).

  Challenge creation and proof attempts are rate-limited by session/person/IP. Missing or
  revoked session is `401`; API, MCP, or impersonation credentials are `403
  session_required`; a missing required proof is `403 step_up_required`; expired, consumed,
  malformed, or mismatched proof material shares generic `403 step_up_expired`; unavailable
  required verification is `403 step_up_unavailable`; stale operation version is `409
  version_conflict`; exhausted attempt limits return `429`. Errors expose no factor,
  credential, challenge/token id, hash, nonce, or request body. Audit `auth.step_up_issued`,
  `auth.step_up_consumed`, and `auth.step_up_denied` with actor, session/person, binding,
  outcome and trace id only; `auth.step_up_denied` records failed proof/verification or
  replay. Never record proof, nonce, token/hash, or arbitrary body.
  `pending_action.step_up_token_id` records the consumed confirmation row id, not its secret.

  God Mode user deactivation uses the canonical `delete` action on exactly one `user` target.
  Its server-selected confirmation is `typed_name_step_up`; the typed value is the target
  account's exact current email, supplied as `typedName` to approval, while the PA-15 token
  is sent in `X-TaskDesk-Step-Up-Token`. The action payload binds the user id and fixed route
  `POST /api/instance/users/{id}/deactivate`; the allowlisted summary carries the current
  email for confirmation. Requesting creates no lifecycle mutation. Approval re-reads and
  locks the current person/user, requires the same active person and exact unchanged email,
  re-evaluates current instance-admin authority, and consumes the token bound to this
  pending-action id in the same transaction as IP-15 `end_memberships`, the terminal action
  state, audit rows, and outbox event. A target/email/authority mismatch leaves the action
  unexecuted and requires a fresh request when its stored target is stale.

  The database retains `user_deactivation` as a read-only compatibility value for durable
  rows written by migration 0109. New requests use only `delete`/`user`, and the canonical
  approval path rejects a legacy row before target lookup or step-up consumption. Historical
  pending and terminal rows, their person-id targets, payload hashes, and proof bindings are
  preserved. Approval remains unavailable for a pending legacy row; its requester can use
  the existing cancel action, then submit a fresh request through the canonical flow. Self-read
  and terminal decision DTOs expose a legacy row as `delete`/`user` only after resolving its
  single stored person-id target to the linked user id. The DTO keeps the stored summary and
  adds that resolved `userId`; it does not rewrite the row, payload, hash, or proof binding.
  Missing resolution returns the existing `409 pending_action_target_changed` conflict.

<a id="pending-actions-confirmation-levels"></a>
### Confirmation levels

The server decides the required confirmation from `target_type` and `action`; the client
cannot lower it. The dialog always shows the **exact target** and the **action**.

| Target | The dialog shows | Confirmation required |
| --- | --- | --- |
| Comment, attachment, personal saved view | Exact target, parent work item | Explicit click |
| Work item | Key, title, project, requester and portal-visibility impact, the soft-delete recovery period | Explicit click |
| **Bulk deletion** of **50 items or fewer** | Total count, the exact filter/query, workspace/project scope, representative targets | **Typed count**. Never a model-supplied value |
| **Bulk deletion above 50 items** | As above, plus the full blast radius of the filter | **Typed count + step-up** (`typed_count_step_up`) |
| Project | Affected work items, members, attachments, integrations; recovery and purge behaviour | **Typed project key or exact name + step-up** |
| Workspace, organisation | Full operational and security impact | **Typed exact name + step-up** |
| API key, webhook, identity connection / provider | Who and what depends on it; what stops working | **Typed exact name + step-up** |
| Hard purge (`PA-13`) | What will be irrecoverably removed; legal-hold and retention check result | **Typed exact name + step-up**, `instance:admin` |
| God Mode person deactivation | Exact current account email and IP-15 lifecycle impact | **Typed current email + step-up** (`typed_name_step_up`) |
| MCP destructive that is not a deletion (`PA-14`: `decide_approval`, bulk > 50 items) | The decision or the batch, and the work items it touches | Explicit click |
| **Any other single deletable record** — role (with its holders reassigned, `RL-8`), custom field (`CF-8`), team, service calendar, automation rule, time entry, shared or team saved view, label, relation | Exact target and its dependants | Explicit click |

Each row states **one** required confirmation, never a choice between two: the column is the
`confirmation_required` enum value, and "A or B" is not something the enum can hold or a test
can assert. The enum is `click | typed_name | typed_count | typed_count_step_up |
typed_name_step_up`.

The ladder rises with blast radius, and `typed_count_step_up` exists because it did not. Bulk
deletion by filter is the largest blast radius in the product — every work item in a workspace,
in one request — and it previously stopped at a typed count with no second factor, while
deleting a single webhook required one. A stolen browser session (the "compromised staff
session" adversary in [security-model.md](#security-model-threat-model)) could therefore
destroy a workspace's entire work-item corpus without a second factor. Above 50 items — the
same threshold the corpus already uses for MCP bulk — it now needs one.

Step-up is the action-bound confirmation token minted by `PA-15`; the token names the pending
action id, so one step-up cannot approve two things.

<a id="pending-actions-permissions"></a>
### Permissions

| Action | Who |
| --- | --- |
| Request a deletion | Whoever the route's own policy allows — `work_item:delete`, `project:delete`, … |
| View or cancel a pending action | The requester only (`authenticated + self`), from **any** credential — so an API or MCP client can poll `PA-4` |
| Approve or deny a pending action | The requester only (`authenticated + self`), **in a browser session** — never an API key, MCP key or impersonation session |
| See all pending actions in a workspace (read-only, for support) | `workspace:manage_settings`, reach-filtered |
| Hard purge | `instance:admin`, elevated |

<a id="pending-actions-screens"></a>
### Screens

- **Pending action approval** — a dialog over whatever screen requested it (P1).
- **Profile → Pending actions** — `/dashboard/settings/account/pending-actions`: the list of
  actions awaiting my approval, with origin (web/api/mcp), requesting key, target, expiry
  (P4).
- **No portal dialog.** Customers cannot delete anything ([customer-portal.md](feature-contracts-p3.md#customer-portal),
  "May not: delete anything"); the portal has no `DELETE` route, so nothing there needs
  approval. Withdrawal of a submission (`CP-15`) is a state change, not a deletion.


<a id="pending-actions-api"></a>
### API

```
DELETE  <any deletable resource>                          route's own policy → 202 + pending action
GET     /api/me/pending-actions                           authenticated + self
GET     /api/me/pending-actions/{id}                      authenticated + self
POST    /api/me/pending-actions/{id}/approve              authenticated + self, session-only
POST    /api/me/pending-actions/{id}/deny                 authenticated + self, session-only
POST    /api/me/pending-actions/{id}/cancel               authenticated + self
POST    /api/me/step-up/challenges                       authenticated + self, session-only  (PA-15)
POST    /api/me/step-up                                   authenticated + self, session-only  (PA-15)
GET     /api/workspaces/{id}/pending-actions              workspace:manage_settings (read-only)
POST    /api/instance/purge                               instance:admin  E  (PA-13)
```

The self list returns only the caller's `pending` actions, ordered by
`created_at DESC, id DESC`. It uses the standard opaque cursor and `limit` contract
from [api-design.md](#api-design-collections): default 50, maximum 200, and returns
`{ data, page: { nextCursor, hasMore }, meta: { total } }`, where `meta.total` is the
count of all pending actions owned by the caller. `GET /api/me/pending-actions/{id}`
returns that caller's action in any state so API and MCP clients can poll its outcome;
another requester's id is indistinguishable from a missing id and returns 404.

Both reads resolve the caller's current database identity before querying actions, for
session and API-key credentials alike. No current valid identity (including an inactive
person, banned user, or an inapplicable customer organisation/key) returns 401 on both
routes, consistently with [RBAC](permissions.md). A surviving credential
does not preserve a deactivated owner's access. This refusal happens before action lookup
and writes no `pending_action.viewed` audit. A valid identity still gets 404 for a missing
or foreign action. The authenticated-self policy does not require a workspace capability.

Both routes return the same explicit allowlisted DTO, in camel case:
`id`, `action`, `origin`, `targetType`, `targetIds`, `summary`, `confirmation`, `state`,
`approvalSupported`, `createdAt`, `expiresAt`, `invalidationReason`, `decidedAt`,
`executedAt`, and `requestingKeyName`. `approvalSupported` is server-derived from the stored
action, target, route, and confirmation and reports whether this API build has a registered
approval executor for that action. It is informational UI state, not authorization: the API
still enforces requester, session, state, current capability, target, and proof checks on
every approval. Legacy `user_deactivation`/`person` rows project as `delete`/`user` with
`approvalSupported: false`; the UI leaves cancellation available and does not offer approval.
`summary` is the stored `payload_summary` and must be a JSON object.
`confirmation` is `confirmation_required`. `requestingKeyName` is the name of the
requesting person's API key when the credential is an API key and that key still exists;
it is otherwise null. Reads never return the stored payload, payload hash, route key,
credential id, step-up token id, trace id, or internal error.

Rendering a list row or detail summary in a person's session (the approval dialog or the
pending-actions page) is a `pending_action.viewed` audit action (PA-11). The read fails if the
audit write fails; it must not return an unaudited summary. An API-key read of the list or a
detail is polling, not a render: it writes no `viewed` row and takes no audit-chain lock.

The first line covers ordinary records. A `DELETE` on an **elevated** target (workspace,
organisation, project, API key, webhook, identity connection, `auth.*` plugin) carries
`sessionOnly: true` and returns `403 session_required` on any non-session credential rather
than a 202 — `PA-5`.

`202` is added to the status table in [api-design.md](#api-design-errors); the response
body carries the `summary` the UI renders.

<a id="pending-actions-edge-cases"></a>
### Edge cases

| Case | Behaviour |
| --- | --- |
| Approver's session expires mid-dialog | The action stays `pending` until `expires_at`; re-sign-in and approve from Profile → Pending actions |
| Requester's session is explicitly signed out or revoked | Actions bound to that original session become `invalidated` with `credential_revoked`; signing in again cannot revive them |
| Requesting API key is disabled or revoked | Actions bound to that key become `invalidated` with `credential_revoked`; re-enabling the key cannot revive them |
| Requesting API key expires naturally | Actions bound to that key become terminal with `credential_revoked`; extending the same key after expiry cannot revive them |
| Requester loses action-required reach or capability | The affected action becomes `invalidated` with `reach_lost` or `capability_removed`; restoring access cannot revive it. Changes that do not remove the action's required access do not invalidate it |
| Two identical delete requests | **One** pending action. The idempotency layer replays the stored `202` for a keyed retry; an unkeyed repeat hits the partial unique index and returns `409 pending_approval` with the existing id (`PA-4`) |
| Elevated `DELETE` presented on an API key or MCP key | `403 session_required` before the policy runs — no pending action, nothing to poll (`PA-5`) |
| Target moved to another project or workspace between request and approval | `PA-6` step 3a → `409 target_changed`, action `invalidated` with `invalidation_reason = 'target_scope_changed'`, even if the approver holds the capability in the new scope |
| Step-up token expires while the approver reads the summary | `403 step_up_expired`; the action stays `pending` and a fresh token is minted from `POST /api/me/step-up` (`PA-15`) |
| Target already soft-deleted by someone else | `PA-6` step 2 → 404, action `invalidated` |
| Requester is impersonated | Impersonation sessions cannot request or approve deletions (`GM-9`) |
| Work item edited between request and approval | `409 target_changed`; the requester asks again and sees the new summary |
| Client sends `confirm: true` or any approval field | Ignored; `PA-2` response unchanged |
| Legal hold on the organisation | Soft delete is allowed and stays recoverable; purge (`PA-12`/`PA-13`) is refused while the hold stands |

<a id="pending-actions-out-of-scope"></a>
### Out of scope

- Approval by *someone else* (four-eyes deletion). Not in this design; a future
  specification if a customer requires it.
- Automation-initiated deletion (`AM-13` — none before P4; any later capability needs its
  own spec, blast-radius control, dry run, human approval, audit and security review).
- Undo of an executed hard purge — by definition impossible; that is what the confirmation
  levels are for.

<a id="pending-actions-testing"></a>
### Required behavior cases

`tests/api-integration/pending-actions/` and `tests/e2e/security/`:

```
delete-returns-202-and-deletes-nothing.test.ts
api-key-delete-requires-ui-approval.test.ts
service-key-cannot-delete.test.ts
approval-rejected-from-api-key-and-mcp-key.test.ts
approval-rejected-from-impersonation-session.test.ts
impersonation-cannot-request-deletion.test.ts
approval-replay-and-target-substitution-refused.test.ts
approval-invalidated-on-revocation-deactivation-lost-reach.test.ts
approval-invalidated-on-target-version-change.test.ts
bulk-delete-requires-typed-count.test.ts
bulk-delete-above-50-requires-step-up.test.ts
elevated-delete-from-api-key-is-403-session-required.test.ts
retry-while-pending-returns-409-and-creates-nothing.test.ts
approval-invalidated-when-target-moves-scope.test.ts
step-up-token-is-bound-to-one-pending-action-and-re-mintable.test.ts
project-delete-requires-typed-key-and-step-up.test.ts
model-supplied-confirm-field-ignored.test.ts
retention-purge-needs-no-second-approval.test.ts
no-mcp-purge-tool.test.ts
legal-hold-blocks-purge.test.ts
pending-action-expires-after-15-minutes.test.ts
every-transition-audited.test.ts
```

<a id="realtime"></a>
## Realtime
Two people looking at the same board must see each other's changes without refreshing.
That is the whole requirement, and it should not cost a message broker.

<a id="realtime-transport"></a>
### Transport

WebSocket at `/api/ws`, via `@hono/node-server`'s built-in upgrade helper and the `ws`
server, on the same origin as the API so the session cookie authenticates the upgrade.
**Cookie-authenticated upgrades are not protected by the same-origin policy.**

P0 exposes native browser realtime only on the configured agent origin. CP-19 denies every
portal `/api` request and websocket upgrade with the same generic 404 before authentication,
session/API-key resolution, or socket handling. This denial takes precedence over the
otherwise applicable handshake checks below. The internal `portalAuth` instance is not a
public login or realtime surface; portal socket availability waits for the reviewed P3
identity boundary and a corresponding CP-19 change.

Before an agent-host route returns `101`, the request `Host` must identify exactly the
configured agent origin, including its port. Every handshake that resolves a session,
regardless of whether the credential arrived in a cookie or an explicit header, must carry
exactly one non-`null` `Origin`, equal to that host's complete configured origin (scheme,
host and port). A missing, literal `null`, malformed, duplicated or comma-list, foreign,
or mismatched `Origin` returns `403` before upgrade. An unknown or mismatched `Host` is
rejected by the host-routing guard with the generic `404` before upgrade.
Compare against the configured public origin, including when TLS terminates at a proxy;
HTTP CORS and origin values derived from the request URL or forwarding headers do not
replace this check. The session's stored `portal` must also be `agent`. Legacy sessions
without a stored portal are refused and require a fresh sign-in.

<a id="realtime-native-work-item-endpoint-and-protocol-p0"></a>
#### Native work-item endpoint and protocol (P0)

The native work-item subscription transport is `GET /api/ws` on the agent origin. It uses
one socket and explicit `subscribe` / `unsubscribe` frames for work-item topics. The legacy
`/api/ws/user` notification socket and `/api/ws/{projectId}` Task-model socket remain for
their existing clients; they are not sources for native work-item event delivery. Their
retirement requires migrating those consumers separately. Both legacy sockets reauthenticate
before every event and on the 60-second floor, including private identity invalidation
signals. The project socket decides exactly what the native `project:{projectId}` topic
decides: one shared rule (`authorizeProjectSocketRead`) applies **project reach**, the
**`project:read`** capability, an API key's stored scope (the key must hold `project:read` and
`work_item:read`), the project's own customer organisation (`rbac.md` Reach step 6) and the
exclusion of archived and soft-deleted projects. A project the caller cannot reach, one in
another workspace, an archived or soft-deleted one, an unknown id, a caller without the
capability and a key without the scope are all refused with the same `401` before the upgrade
(`1008` on a later recheck), so no subscription exists for them. An instance admin with no
workspace role holds reach but no `project:read`, and is refused on both sockets. The socket
rereads that decision before delivery. A person may hold at most **five** legacy project
sockets **per API replica** (the native limit, counted in each process, so N replicas allow up to 5N); a sixth is closed with `1008` and reason "connection limit". To
keep a burst of events from repeating the whole lookup (about eleven queries) once per event per
connection, a legacy project socket reuses one passing lookup for **1.5 seconds**: a
revocation that is announced on the control channel (membership, role, project, session or
archive changes publish `identity.invalidate`) and the 60-second floor always look again at
once, and a revocation that is written without being announced is noticed by the next event
after the window. Loss of the original credential, an inactive or banned identity, or lost
project reach (including a removed project membership) closes that legacy connection without
sending the queued event. A failed authority
lookup fails closed. Event checks are ordered per connection; disconnecting discards in-flight
delivery, and an exhausted bounded authorization queue closes the connection so the client
can reconnect and refetch. The native handshake authenticates
and checks the configured agent Host, exact Origin, and stored session portal before upgrade
using the rules above. API keys remain subject to their stored capability subset. This
endpoint is delegated to the WebSocket handshake in the route-policy registry; authorization
is performed again for each topic and periodically for the life of the connection.

Frames are JSON objects validated against a closed Zod union. The client may send
`{ "type": "subscribe", "topic": "project:{id}" }`,
`{ "type": "subscribe", "topic": "work_item:{key}" }`,
`{ "type": "unsubscribe", "topic": "…" }`, or `{ "type": "ping" }`.
Unknown properties, malformed JSON, unknown frame types, malformed topics, and more than
the existing per-socket frame limit close the connection. A successful subscription
returns `{ "type": "subscribed", "topic": "…" }`. A missing, foreign, archived, or
otherwise unreadable resource returns the same `{ "type": "subscription_denied" }`
shape; the server does not reveal whether it exists. The topic identifier is resolved from
the database and compared to authoritative project/work-item containment, never trusted as
 a request hint. `project:{projectId}` requires project reach (not only workspace
membership) and the `project:read` capability, plus `work_item:read` scope for an API key,
the same decision the legacy project socket makes. `work_item:{key}` requires the same `work_item:read`
capability and row/project reach as `GET /api/work-items/{key}`. `user:` and `instance` topics are reserved for later protocol migrations and are denied by the native P0 work-item endpoint. Existing notification delivery continues over the legacy user socket.

Subscription authorization is refreshed on the 60-second floor and on existing identity,
membership, role, project, or session invalidation signals. A revoked session closes the
socket; lost resource reach drops the affected topic and sends the indistinguishable denial
frame. The server rechecks that a work item remains in its recorded project before every
fan-out. No subscription survives a key's move to a different project.

Only a request that resolves a valid API key, with no session, may omit `Origin`. This
includes the existing explicit `x-api-key` and `Authorization: Bearer` API-key paths. If
that request supplies `Origin`, it must still be the single exact configured origin for
its `Host`. An explicit bearer token that resolves a session is subject to the session
Origin and stored-portal rules, even though HTTP CSRF treats bearer credentials as
non-ambient. An invalid explicit credential returns `401` without falling back to an
accompanying cookie. With the currently pinned better-auth configuration, `bearer()` is
removed and a bare session token in `Authorization: Bearer` does not resolve a session;
it must receive `401`, not an Origin exemption. This rule does not enable that transport
or introduce a query credential, portal parameter, route or capability. The HTTP CSRF
rule in [security-model.md](#security-model-sessions-csrf-and-step-up) does not by
itself settle WebSocket handshake policy.

```
Client                          Server
  │  GET /ws  (cookie, Origin)    │
  ├──────────────────────────────►│  check Origin == this host's configured origin
  │                               │  resolve session → identity; portal must match host
  │                               │  reject if no session (401) or wrong origin/portal (403)
  │◄──────────────────────────────┤  101 Switching Protocols
  │  { "type": "subscribe",       │
  │    "topic": "project:abc" }   │
  ├──────────────────────────────►│  authorize: may they read this project?
  │◄──────────────────────────────┤  { "type": "subscribed" }
  │                               │
  │◄──────────────────────────────┤  { "type": "work_item.updated", … }
```

**Subscription is authorized — and re-authorized.** A client asking for `project:xyz` it
cannot read is refused, and the refusal never distinguishes "does not exist" from "not in
reach" (the 404 rule applies on the socket too). Because a socket is long-lived and has no
"next request", the decision is not made once: every subscription is re-checked every 60 s.
In the current implementation a membership or role change is observed on that recheck.
Inbound frames are
Zod-validated; topics are parsed into a discriminated union, never prefix-matched; `user:` and `instance` topics are denied by the native P0 endpoint. Subscribe frames are rate-limited per socket. Broadcast is not a way around
policy.

<a id="realtime-topics"></a>
### Topics

| Topic | Who subscribes | Carries |
| --- | --- | --- |
| `project:{projectId}` | Native P0: readers with project reach and `project:read` (a key also needs `work_item:read`); the legacy `/api/ws/{projectId}` socket applies the same rule | Work item create/update and state changes |
| `work_item:{key}` | Native P0: readers with item reach and `work_item:read` | Work item detail and visible activity invalidations |
| `user:{personId}` | Legacy user socket during migration; native topic reserved | Notifications, assignment to you, approval requests |
| `instance` | Later protocol scope; denied by native P0 endpoint | Plugin config changes, job failures, import progress (`import.chunk_completed`) |

<a id="realtime-messages"></a>
### Messages

```jsonc
{
  "type": "work_item.updated",
  "topic": "project:abc",
  "eventId": "evt_…",           // immutable outbox id; client deduplication key
  "at": "2026-09-05T10:14:22Z",
  "payload": { "key": "SUP-1234" }
}
```

The native work-item socket projection is deliberately key-only. It contains the canonical
event `type`, authorized `topic`, immutable `eventId`, `at`, and `payload.key`. It never
contains a work-item record, changed-field names, before/after values, comment body or id,
visibility, staff name, or the outbox payload. `events.md` remains the sole event-key and
domain-payload catalogue. The socket frame is an invalidation hint, and all displayed data
is fetched through the normal policy-enforced API.

| Existing canonical event | Project topic | Work-item topic | Customer portal |
| --- | --- | --- | --- |
| `work_item.created` | invalidate list | — | unavailable in P0; portal edge is denied |
| `work_item.updated`, `work_item.transitioned`, `work_item.assigned`, `work_item.unassigned` | invalidate list | invalidate matching item | unavailable in P0; portal edge is denied |
| `work_item.escalated`, `work_item.unblocked`, `work_item.mentioned` | invalidate list when the projection changes | invalidate matching item/activity | unavailable in P0; portal edge is denied |
| `work_item.commented` | invalidate list only if list projection depends on activity | invalidate matching activity | unavailable in P0; portal edge is denied |
| `work_item.deleted` | invalidate list | invalidate matching item/activity | unavailable in P0; portal edge is denied |

One event may reach both an authorized project and item topic. Clients deduplicate by
`eventId` for the life of the socket and always invalidate affected active queries,
including after their own mutation. Customer visibility suppression happens before fan-out and is based on the committed mutation's
visibility, not a client-supplied field. No socket event is emitted for an internal-only
comment or internal-only field change to a customer subscription.

**Messages carry what changed, not the full record.** The client invalidates the relevant
TanStack Query keys and refetches through the normal, policy-enforced API path. This
means:

- The socket never becomes a second, unaudited data path with its own authorization bugs.
- Payloads stay small.
- A client that missed messages recovers simply by refetching.

The one exception is presence, which has no REST equivalent and is sent whole.

<a id="realtime-client-integration"></a>
### Client integration

```ts
useRealtime({
  topic: `project:${projectId}`,
  onMessage: (msg) => {
    // The native hook deduplicates affected query keys per event and socket.
    // It batches the resulting invalidations for 150 ms.
  },
});
```

The native client invalidates the affected list, detail, or activity query keys from the
key-only event envelope and debounces them for 150 ms. If one event arrives under more than
one subscribed topic, a later frame can contribute an affected key absent from the first;
duplicate keys are invalidated once on that socket. Independent sockets maintain separate
deduplication state. Cleanup flushes queued keys as stale without refetching unmounted queries,
and ignores late frames from a disposed or replaced socket. Comment events refresh activity;
item mutations refresh detail and the project list when its projection may change. Reconnect
and outage polling remain active until subscription acknowledgement and while the socket is
unavailable.

<a id="realtime-scaling-across-replicas"></a>
### Scaling across replicas

```
        replica A                 replica B
        ┌────────┐                ┌────────┐
 client │  ws    │                │  ws    │ client
   ─────┤ adapter│                │ adapter├─────
        └───┬────┘                └────┬───┘
            │       Valkey pub/sub     │
            └──────────► taskdesk:ws ◄─┘
```

Two adapters implement the same interface:

- **`memory`** — default, single replica, zero dependencies.
- **`valkey`** — selected automatically when `TASKDESK_VALKEY_URL` is set. A mutation on
  replica A publishes to the channel; every replica fans out to its local sockets.

Nothing in application code knows which adapter is active.

Native cross-replica hints use the separate `taskdesk:ws-native:broadcast` Valkey channel. Native work-item changes are written as exactly one canonical `events.md` envelope to the
existing `outbox` in the same database transaction as the work-item mutation, activity and
required audit rows. The current in-process EventEmitter is not a durable source and does
not authorize publication before commit. After commit, the outbox dispatch seam publishes
one best-effort realtime invalidation using the outbox `eventId`; socket publication failure
is logged/observable but never rolls back a committed mutation. Realtime fan-out is an
at-most-once hint, not a replaying outbox consumer. The durable outbox remains available to
its registered consumers; reconnect refetch and active-query polling repair missed hints.
There is no new event key, table, retention policy, or feature flag.

<a id="realtime-the-control-plane-is-a-separate-channel"></a>
#### The control plane is a separate channel

User-facing topics travel on `taskdesk:ws`. **Replica coordination** — `auth.reload`,
`plugin.reload`, `flags.reload`, identity-cache invalidation — travels on `taskdesk:control`
and is never exposed to a browser. Pub/sub is an accelerator, not the source of truth: every
replica also polls the relevant `config_version` every 10 s, so a deployment with no Valkey
converges within the poll interval rather than silently diverging
([auth-runtime-reconfiguration.md](#auth-runtime-reconfiguration)).

`identity.invalidate` is a private control message used by native work-item WebSockets after
committed authority changes. Its strict payload is `{ type: "identity.invalidate", userId?,
workspaceId?, projectId? }`; at least one target is required. Identifiers are internal routing
keys only and are never forwarded to browser sockets or logged. `userId` causes connections for
that person to reauthenticate immediately; `workspaceId` and `projectId` cause matching topic
subscriptions to be reauthorized and denied topics to be dropped. Publishers emit it only
after the corresponding session, membership, role, or project mutation commits. A control
message received before the mutation is visible is harmless because authorization is re-read
from PostgreSQL, and the 60-second refresh remains the recovery floor if publication is lost.
The in-memory adapter delivers within one process; the Valkey adapter uses `taskdesk:control`
for cross-replica delivery. This is control traffic, not a domain event or durable outbox row.

<a id="realtime-connection-management"></a>
### Connection management

| Concern | Handling |
| --- | --- |
| Reconnect | Exponential backoff, 1 s → 30 s, with jitter |
| Missed messages | On reconnect the client refetches active queries. No replay buffer — the REST API is always the source of truth |
| Keepalive | Client sends a ping every 30 s; the server replies with `pong` |
| Backpressure | Native sockets close when buffered output exceeds 64 KiB; the client reconnects and refetches |
| Limits | 5 concurrent sockets per person **per API replica and per socket kind** (the native and the legacy project sockets are counted separately, each in its own process, so N replicas allow up to 5N of each kind); 50 topic subscriptions per socket |
| Session revoked | The socket re-authenticates at least every 60 s and closes when the session is no longer valid |
| Permission revoked | Affected topics are dropped on the invalidation message; the client is told which and refetches |
| Subscribe flood | Per-socket rate limit on inbound frames; a client exceeding it is closed |
| Transport unavailable | Show the shared-design-system status indicator and poll only active list/detail/activity queries every 30 s while foregrounded |
| Transport restored | Clear the indicator after successful upgrade and subscription; stop fallback polling |

<a id="realtime-presence-and-typing-stage-4"></a>
### Presence and typing (Stage 4)

Presence — who else is on this work item — is stored in Valkey with a short TTL and
broadcast on the topic. If Valkey is absent, presence is simply unavailable; it is not a
correctness feature.

Typing indicators in comment threads follow the same pattern, throttled to one message
every 3 seconds per person.

<a id="realtime-collaborative-editing--explicitly-later"></a>
### Collaborative editing — explicitly later

Plane runs Hocuspocus for CRDT-backed collaborative rich text. It is genuinely nice and it
is genuinely a whole subsystem: a second server process, Y.js documents, awareness state,
persistence and conflict resolution.

**Not in scope before Stage 5.** Until then, concurrent edits to a description are handled
with optimistic concurrency: a `409` and a clear "someone else changed this" affordance.
Revisit when there is evidence people actually co-edit descriptions.

<a id="realtime-fallback"></a>
### Fallback

An initial socket connection and its topic subscription acknowledgements are a pending
state, not an outage. Active queries keep the 30-second foreground polling fallback until
all requested topics are acknowledged, but the unavailable indicator appears only after a
connection error, close, or denied subscription. After an outage, keep the indicator and
polling active through reconnect until all requested topics are acknowledged again.

If the WebSocket cannot connect — a proxy that strips upgrades, a hostile corporate
network — the client falls back to polling active queries every 30 seconds and shows a
small "live updates unavailable" indicator. The application remains fully usable.

The legacy project socket follows the same rule. A close that the client did not cause shows the
indicator until the socket opens again, so a terminal stop keeps it showing: the per-person
connection limit (`1008`, "connection limit", which the client does not retry because the server
would accept the upgrade and close it again) and the retries used up. A remount, or a change of
project or session, starts the socket over and clears the indicator. The client does not retry
the limit close on its own after a route change that keeps the same project mounted; that retry
is not specified here, and the pages poll every 30 seconds meanwhile.

<a id="realtime-testing"></a>
### Required behavior cases

| Test | Asserts |
| --- | --- |
| `ws-auth.test.ts` | Upgrade without a valid credential is refused. On the pinned auth stack, an issued session token sent as `Authorization: Bearer` without its cookie returns `401` on the agent host; it does not become an API key or a newly supported bearer session |
| `ws-origin.test.ts` | On the agent-host Node route, matching configured `Host` and one exact same-origin `Origin` can reach `101`; missing, `null`, malformed, duplicate/list, foreign Origins return `403` before `101`; an unknown or wrong-port Host receives the generic host-denial 404. Use raw handshake headers for duplicate/list cases; HTTP CORS is not evidence. Portal upgrades are covered by the CP-19 generic-denial host-routing test. |
| `ws-explicit-credential-origin.test.ts` | On the agent host, a valid explicit `x-api-key` and bearer API key without `Origin` retain access subject to existing reach policy; a supplied foreign Origin is refused. An invalid explicit bearer token or key with a valid cookie cannot fall back to that cookie. |
| `ws-portal-session.test.ts` | The agent host rejects non-agent, unbound legacy, and revoked session rows before upgrade. The portal public edge returns CP-19's generic 404 without session resolution; internal portal session binding tests do not assert public socket reachability. |
| `ws-subscribe-policy.test.ts` | Subscribing to an out-of-reach project is refused, indistinguishably from a non-existent one |
| `ws-project-reach.test.ts` | The legacy `/api/ws/{projectId}` socket: an in-reach member (session and scoped API key) and a workspace owner or admin subscribe and receive events; a same-workspace member without project reach, a member whose project role lacks `project:read`, a key scoped to anything but `project:read` and `work_item:read`, an instance admin with no workspace role, another workspace's member, and a missing, archived or soft-deleted project receive the identical `401` with no upgrade; revoking project membership or the capability closes an open socket; a customer and an archived project are decided identically to the native socket, from the project's own customer organisation; at most five sockets per person across credentials; a burst of events costs one authority lookup; an unannounced revocation closes within the reuse window and an announced one at once |
| `ws-reauthorize.test.ts` | Subscribe, revoke the membership, assert no further events arrive |
| `ws-frame-validation.test.ts` | Malformed frames and `user:` topics for another person are refused |
| `ws-fanout.test.ts` | Two clients, one mutation, both receive it once |
| `ws-valkey-adapter.test.ts` | Cross-replica delivery via a real Valkey container |
| E2E `realtime.spec.ts` | Two independently signed-in browser contexts open the same native work-item list. Create through the UI, then update through a real CSRF-protected, versioned API request; the other context observes the native `/api/ws` connection and renders both committed list responses before the 30-second polling fallback. This is the `work_item` path, not the legacy `task` board. The focused `node-server-websocket.test.ts` separately verifies two authorized actors receive one key-only hint per persisted POST/PATCH. Portal-host WebSocket denial remains covered by `ws-portal-session.test.ts` and CP-19 host-routing tests |

<a id="security-model"></a>
## Security model
<a id="security-model-threat-model"></a>
### Threat model

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
| **Compromised upstream** (kaneo before the fork; a dependency) | Ship malicious code in our image | kaneo snapshot audited and SHA-pinned at fork and inspected across the retained router surface — a scanner finds known CVEs, not a planted change; lockfile frozen; `pnpm audit` + Trivy + secret-scanning gates; signed images and archives with provenance; better-auth upgrades reviewed as security changes |
| **Compromised CI identity** (a malicious PR job, a leaked repository secret) | Produce a *validly signed* malicious image every deployment accepts | Release workflow runs only from `main`/`release/*` on manual dispatch, behind branch protection with no bypass; `id-token: write` granted to that one job only; `permissions:` read-only by default on every workflow; the cosign verification in `deploy.sh` pins the **workflow identity** (`repo`, `workflow`, `ref`), not just the issuer; third-party actions pinned by SHA ([ci-cd.md](ci-gates.md)) |
| **Malicious MCP client / runaway agent / typosquatted `@taskdesk/mcp`** | Exfiltrate via a key; amplify writes; harvest `TASKDESK_API_KEY` | Key capability subset ∩ owner authority; `is_mcp` keys read-only by default; `is_mcp` ceiling; burst auto-disable; idempotency; no MCP-only data path; `@taskdesk` scope reserved, provenance + 2FA on publish, internal packages `private` |
| **Hostile content read by a model** (prompt injection through ticket text) | Make a staff agent or an AI feature act with staff authority | Tool output marked untrusted (`MC-15`); destructive/bulk tools need out-of-band human approval (`MC-7`); AI retrieval scoped to the triggering identity; model output sanitised as user input — [AI and MCP surfaces](#security-model-ai-and-mcp-surfaces) |
| **Rogue automation / job** | Act beyond the rule author's authority | Automations run as their `effective_role_id` (clamped, `AM-3`); placeholder expansion checked against the destination's visibility (`AM-11`); jobs carry `actor_type = 'system'` and still write through scoped repositories; manual job triggers are `instance:manage_jobs`, audited, rate-limited; per-organisation job workload caps |
| **Account-recovery social engineering** ("please reset my MFA") | Get an administrator to remove a second factor | An elevated `reset-mfa` operation requires with an operation-bound fresh proof, a recorded verification note, notification to the user’s canonical address, and revocation of all sessions and keys. It does not solve bootstrap ownership merely by existing ([auth-and-identity.md](#auth-and-identity-multi-factor-authentication)) |
| **Compromised SCIM token, or a hostile customer's own IdP** | Create staff, reach another organisation, grant authority, enumerate users | Organisation and portal are fixed by the connection the token belongs to, never by the request (`IP-4`); a customer connection can create only customer-side people in its own organisation with the customer role (`IP-2`); no connection can grant `instance:admin` or `sees_all`; token hashed, rotatable with immediate invalidation, rate-limited; every denial is a provisioning event — [SCIM](#security-model-scim--an-inbound-privileged-management-api) |
| **A deletion nobody meant** (mis-click, scripted key, injected agent) | Destroy data faster than anyone can stop it | Every user-initiated deletion is a `pending_action` approved by the requesting human in a browser session; bound to exact targets and payload; single-use; 15-minute expiry; re-authorised at execution; no model, key or automation can approve — [Deletion approval](#security-model-deletion-approval) |
| **Anonymous internet** | Enumerate TaskDesk user accounts or provider inventory; bomb mail; DoS; distinguish "not found" from "not yours" | Anonymous rate-limit class; constant-time auth responses; **constant-shape 404** (same body, same lookup path, same bucket); minimal `/api/public/*`; `health/deep` authenticated; quotas with real defaults; event-loop lag alerting. A visitor may infer whether a submitted domain has customer SSO and see its public IdP redirect destination through home-realm routing; this limited disclosure is accepted and defined in `IP-29`, not a TaskDesk account-existence or inventory disclosure. |
| **Legal hold / e-discovery** (not an adversary — an obligation) | Delete what must be retained; fail to produce what must be produced | A per-organisation or per-person **legal hold** suspends `audit-purge`, matching read-notification, notification-child, digest-group and event-envelope retention purges, soft-delete purge in `session-cleanup`, `attachment-gc`, and hard delete for that scope. Credential/ephemeral expiry cleanup, including expired `outbox_dedupe_reservation` rows, continues; see the per-table matching and exception rules in [background-jobs.md](background-jobs.md) and [data-protection.md](operations-and-distribution.md#data-protection) |

Residual risks accepted, and where they are recorded: no malware scanning by default
([attachments.md](feature-contracts-p1.md#attachments)); metering integrity is contractual
([risks.md](retained-constraints.md#risks) R18); DB admins can read business data (above);
`unsafe-inline` styles for Tailwind (below); **no encryption at rest below the
application** — business data, attachments and backups are plaintext to whoever holds the
volume, so a deployment that needs more enables volume encryption and encrypts the backup
target with a key held separately from `TASKDESK_ENCRYPTION_KEY`
([backup-and-restore.md](operations-and-distribution.md#backup-and-restore)). What leaves the
instance, to whom, under which configuration, is the sub-processor register in
[data-protection.md](operations-and-distribution.md#data-protection).

<a id="security-model-inherited-interface-and-route-boundary"></a>
### Inherited interface and route boundary

Anonymous public-project boards and removed integration/authentication routers stay removed. Every retained inherited route declares one supported policy kind. Coverage enumerates the actual inherited router and non-Hono listeners, not an empty application or documentation-only route list. The original Kaneo interface is extended through those persisted, policy-enforced surfaces.


<a id="security-model-the-structural-controls"></a>
### The structural controls

<a id="security-model-1-every-route-declares-its-policy--or-the-build-fails"></a>
#### 1. Every route declares its policy — or the build fails

Five policy kinds, defined once in [RBAC](permissions.md): capability (optionally `orOwner`),
`authenticated + self`, `portal + predicate`, `public + reason`, `delegated + reason`.
`tests/permissions/route-coverage.test.ts` enumerates Hono `app.routes` and every non-Hono
listener manifest exported by its runtime constructor, not the OpenAPI document. `/auth/*`
and `/ws` are Hono/delegated surfaces; the internal `GET /metrics` listener is a separate
Node server on port 9464 and is absent from `app.routes`. Its constructor must export its
exact method/path/port/delegated-policy key, and coverage compares the constructed listener
with that manifest. A planned listener manifest does not establish actual coverage. `/auth/*` is one mounted handler whose endpoint set is defined by the
better-auth **plugin list**, which is rebuilt at runtime from database configuration. The
control there is a different assertion — the constructed plugin list must equal the approved
list (no `anonymous`, no `deviceAuthorization`, no `bearer`) — re-run on every runtime
rebuild, logging and alerting on a diff. Policies also carry `elevated` and `sessionOnly`,
so elevation is a build failure to omit rather than a prose table someone forgot ([RBAC](permissions.md)).

<a id="security-model-2-the-scope-object-is-resolved-by-the-framework-not-the-handler"></a>
#### 2. The scope object is resolved by the framework, not the handler

A policy's `scope` names *which* object the capability is checked against; the policy
middleware **loads that object from the route's declared scope source, checks reach, checks
authority, and hands the already-authorized row to the handler**. The scope source is the
path parameter for most routes and, for workspace-scoped collection routes with no workspace
in the path (`/api/custom-fields`, `/api/capabilities`, `/api/webhooks`, `/api/views`), the
required `X-Workspace-Id` header or `?workspace=` query parameter, validated the same way;
`POST /api/work-items/search` takes it from the filter body. `/api/notification` is instead
session-self scoped: the recipient is the session person, and each notification is additionally
filtered against current reach to its referenced resource. Collection filtering happens before
pagination and counts; direct reads or mutations of an inaccessible or deleted resource's
notification return not found. Notification preference routes are also session-self scoped;
workspace/project preference mutations separately validate current reach to that workspace or
project. Handlers never re-load by id from user input. This closes the classic IDOR (a valid capability in
project A, an id from project B): `tests/permissions/idor-fuzz.test.ts` takes every scoped
route and substitutes ids from the other seeded tenant **at every scope source — path segment,
header and search body alike** — asserting 404.

<a id="security-model-3-permission-matrix-twice--plus-generated-roles"></a>
#### 3. Permission matrix, twice — plus generated roles

`matrix.test.ts` runs every built-in role against every route for **capability** and again
for **reach**. `custom-role.property.test.ts` generates random capability sets and random
(actor rank, target rank) pairs and asserts the evaluator's decision equals the
set-membership prediction and that every rank guardrail holds — the escalation bugs live in
the configurations the fixture never enumerates.

<a id="security-model-4-negative-e2e-suites"></a>
#### 4. Negative E2E suites

Playwright projects that attempt forbidden things and assert failure — cross-tenant 404,
self-approval 403, de-escalation 403, viewer writes, expired/revoked session, revoked key,
forged `X-Forwarded-For`, cross-origin WebSocket, CSRF on an elevated route.

<a id="security-model-5-secrets-never-serialise-queries-are-never-unscoped"></a>
#### 5. Secrets never serialise; queries are never unscoped

Response schemas are explicit; there is no `select *` to the wire. A repository query that
can return cross-organisation data takes the resolved identity and applies the caller's reach
in the statement predicate. Any additional `workspaceId` or `projectId` narrows that scope and
must be checked against the identity; an id alone does not establish reach. Keeping statements
in named repositories is an ownership convention; it does not itself prove that a query is
scoped. A repository-location gate enforces query ownership rather than tenant-predicate semantics. These
explicit predicates remain required regardless of the gate. No universal `forIdentity`/
`ScopedQuery` type guarantee is claimed. RLS remains rejected as the
*primary* control ([multi-tenancy.md](#multi-tenancy)) — but as a **backstop** it is no longer
deferred: a P0 prototype covers `work_item`, `comment` and `attachment`, and P0 closes with it
either merged and measured or dropped with the reason in the decision log (decided 2026-09-06).

---

<a id="security-model-internal-account-erasure-safety-summary"></a>
### Internal account-erasure safety summary

For the authenticated account-deletion subject, the internal erasure planner may read a
narrow summary of the subject's current persisted workspace memberships: own workspace IDs,
own owner status, member/owner counts, and names of those currently joined workspaces used
only in the existing conflict message. This lifecycle entitlement is bound to the actual
authenticated deletion subject; it grants no general query exception or workspace access.
It exposes no other members' identities or individual role rows.

Safety counts must include every persisted membership relevant to the existing deletion
checks, including when the subject has no usable canonical identity (for example, inactive
or legacy memberships). Filtering through ordinary canonical reach must not omit a safety
check or permit deletion of a workspace others still use. Preserve the existing ownership
interpretation, transactional locks, two-pass recheck, refusal before invalidation/deletion,
and existing conflict behavior. This does not authorize broader content reads, a new
capability, or changes to account-deletion eligibility. Thomas approved this bounded summary
on 2026-10-16; see the decision log.

<a id="security-model-reach-authority-and-the-404-rule"></a>
### Reach, authority, and the 404 rule

Covered fully in [RBAC](permissions.md). The security-relevant summary:

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

<a id="security-model-identity-provisioning-and-account-linking"></a>
### Identity provisioning and account linking

IdP claims can influence stored grants only through validated, connection-bound
provisioning or reconciliation. Stored TaskDesk grants, not claims, authorize requests, so
the trust boundary is constrained hard:

- **Protocol floor first:** every `auth.oidc` plugin uses PKCE (`S256`), a single-use
  `state` bound to the session and portal, and a validated `nonce`; the ID token's
  signature, `iss`, `aud` and `exp` are checked before any claim is read
  ([auth-and-identity.md](#auth-and-identity-what-every-authoidc-plugin-must-do--the-protocol-floor)).
  Nothing below applies to an unvalidated token.
- **The durable identity key is `(connection, issuer, subject)` plus the SCIM `externalId`**
  — never the email address, which is a changeable attribute. Organisation and portal are
  properties of the connection, resolved server-side.
- **Entra subject admission is distinct from new-person JIT.** After exact selected-
  connection `iss`, `tid` and `aud` validation, every Entra connection requires its exact
  configured `required_entra_app_role` and signed `acct=0` before any login session is
  issued or person/membership is created (`IP-27`), including existing identities with JIT
  disabled. Missing/malformed account type or role, and guests, fail closed. A valid
  negative token retires only that identity's OIDC/JIT grants; invalid/unverified tokens and
  invalid persisted configuration are not revocation evidence. Other provider JIT remains
  disabled until its own admission rule is approved.
- **Identity routing and admission follow `IP-9`.** A typed customer-login domain may route
  an unauthenticated login initiation to a configured connection; the selected connection's
  persisted organisation, portal and id are then bound in single-use state. Callback claims
  cannot reselect scope. Email-like claims are contact/display metadata only, and a
  post-validation domain collision can deny but never admit. Upstream app-role deassignment
  alone does not promise immediate revocation of an already issued TaskDesk session; existing
  TaskDesk lifecycle controls apply.
- Provisioning `side = staff`, or a group→role rule that grants above `member`, is an
  elevated configuration change.
- OIDC group mappings are re-evaluated on every validated login through the same identity
  connection. A complete, well-formed groups array replaces only that external identity's
  OIDC group grants; absent, malformed, or overage groups retire only that identity's prior
  OIDC group grants. A permitted JIT-default grant and independent direct, SCIM, and other-
  connection grants remain governed by their own current evidence. Overage raises the
  existing provisioning event and operator warning; there is no Graph lookup in the first
  release. Invalid or unverified tokens cause no grant mutation. One connection's login
  never re-evaluates or retires another connection's grants.
- SCIM group mappings change only when an authenticated SCIM synchronization or an
  administrative mapping/connection change supplies that source's evidence. SCIM group
  removal retires only its linked SCIM grant; it does not retire OIDC, direct, or other
  SCIM grants. Upstream removal between validated logins or SCIM updates is not observable
  immediately; the documented cache and session revocation controls still apply.
- **No automatic account linking on email.** A sign-in through provider B for an email that
  exists via provider A is refused with an explanation; linking requires an authenticated
  session on A plus an explicit confirmation. better-auth's auto-link defaults are off.
- **Planned upstream-MFA contract:** verified per-login `amr`/`acr` evidence may satisfy a
  configured provider mapping; absent or unsupported evidence must not satisfy a required
  policy. A static per-provider flag is configuration only, never proof that a particular
  sign-in used MFA or fresh step-up proof. Current API source has no upstream-MFA verifier,
  so this configuration does not establish MFA availability.

<a id="security-model-scim--an-inbound-privileged-management-api"></a>
### SCIM — an inbound privileged management API

Decided 2026-09-05: Microsoft Entra SCIM is core P3 delivery
([identity-provisioning.md](feature-contracts-p3.md#identity-provisioning)). It is the one API
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
- The SCIM mount is registered before the ordinary session/API-key guard because its
  credential is the per-connection SCIM bearer. It authenticates only `Authorization:
  Bearer …` by SHA-256 digest comparison with an enabled `scim_connection`; it resolves
  the parent identity connection and its persisted portal, organisation, resource allowlist,
  and mappings into request-local SCIM context. It never populates Better Auth user/session
  context, and never falls through to cookie or API-key authentication. Missing, malformed,
  revoked, disabled, and unknown bearers share the SCIM 401 response. The requested resource
  and every row lookup are constrained by that resolved context. Invalid authenticated
  requests are recorded against the owning connection without recording token or payload
  values.

<a id="security-model-deletion-approval"></a>
### Deletion approval

Every user-initiated deletion — web UI, REST API, personal API key, MCP — is a
`pending_action` that the requesting human approves in a browser session; the server
re-runs the route policy at approval, verifies the payload hash and target versions, and
executes exactly the approved targets. Confirmation levels rise with blast radius (click →
typed name → typed count → typed count + step-up → typed name + step-up), one required level
per target type, never a choice between two. No model-supplied field, API key,
impersonation session or automation can approve; automations have no delete action before
P4; there is no MCP purge tool; hard purge is retention lifecycle or an elevated
`instance:admin` operation that checks legal hold first. The whole mechanism, table, routes
and tests: [pending-actions.md](#pending-actions).

<a id="security-model-portal-boundary"></a>
### Portal boundary

Two origins, two cookies, two route trees. Enforced:

1. **At login callback** — a customer completing a login on the agent origin gets no
   session and an audit row.
2. **Per request** — `session.portal` must match the request host.
3. **At build** — a check asserts no `routes/agent/*` or `components/god-mode/*` module
   appears in the portal bundle graph.

The bundle split reduces information disclosure. It is **not** the security boundary.
The server is.

<a id="security-model-sessions-csrf-and-step-up"></a>
### Sessions, CSRF and step-up

| Control | Rule |
| --- | --- |
| Cookies | HTTP-only, `Secure`, host-only (no `Domain`), `__Host-` prefix, `SameSite=Lax`; `SameSite=Strict` for the elevated-action routes |
| CSRF | **No state-changing GET, ever** (a lint rule). Every unsafe cookie-session request to a custom API route requires a single exact `Origin` matching the configured agent origin; only when `Origin` is absent may a valid same-origin `Referer` substitute. Missing, duplicate, malformed, literal `null`, portal, or other foreign origins fail with `403 {"message":"csrf_origin_invalid"}`. It also requires `X-TaskDesk-CSRF` to exactly match the HttpOnly CSRF cookie and a valid HMAC signature bound to the current live session id, configured agent origin, random nonce, and ten-minute expiry. Missing/mismatched/invalid values return the finite `csrf_token_missing`, `csrf_token_mismatch`, or `csrf_token_invalid` response; tokens cannot be replayed across sessions or origins. `GET /api/me/csrf-token` authenticates the current agent session, validates an exact same-origin Origin/Referer before changing a cookie, and returns `{token,expiresAt}` with `Cache-Control: no-store`. With neither Origin nor Referer, that safe issuer GET accepts only `Sec-Fetch-Site: same-origin`; unsafe requests have no such fallback. The issuer reuses a still-valid token for the same session/origin so another tab does not invalidate it. HTTPS uses the HttpOnly host-only `__Host-tdk_csrf` cookie (`Secure; SameSite=Strict; Path=/`, no Domain); explicitly configured HTTP development/test uses the signed host-only `tdk_csrf_dev` cookie (`SameSite=Strict; Path=/`, no Domain, not Secure). Better Auth `/api/auth/*` bootstrap and login retain Better Auth's own trusted-origin checks. A resolved personal/service API key or other actually authenticated non-ambient credential is exempt; a merely-present Authorization header is not. Portal (`__Host-tdk_portal_session`) cookie-session unsafe requests have no token issuer — `/api/me/csrf-token` is agent-only and 404 on the portal host — and instead require a single exact `Origin` (or same-origin `Referer`) equal to the configured portal origin, else `403 {"message":"csrf_origin_invalid"}`; the portal web build therefore never requests the agent token. Before this check portal sessions were not covered by the CSRF middleware at all. `SameSite` alone is not the control — the agent and portal are sibling subdomains. This is the single statement of the rule; [api-design.md](#api-design) cites it |
| Session rotation | The session id is regenerated on authentication, on impersonation start/end, and on MFA enrolment (fixation) |
| Defaults | Idle 12 h, absolute 30 days, concurrent 5 — configurable in God Mode within maxima of 7 days idle / 90 days absolute |
| Step-up for elevated actions | Re-authentication means the **second factor** when the account has one — never "password *or* MFA". The initial supported account class is a current local-password session with no enrolled or required second factor, after rechecking the current identity and verifying that password. SSO-only accounts require a validated IdP response with exact configured issuer/audience and single-use `state`/`nonce` bound to challenge/session/subject/connection, a `prompt=login` request, and signed `auth_time` satisfying `challenge.created_at - 60s <= auth_time <= callback_received_at + 60s` and `callback_received_at - auth_time <= 5min`; callback must precede challenge expiry. If policy requires MFA, fresh `amr`/`acr` evidence must satisfy the configured provider mapping or a real local factor; a static upstream-MFA flag is insufficient. Missing/untrustworthy evidence, changed subject/connection/session, or unavailable required verifier fails closed (`403 step_up_unavailable` or authentication failure), with no password/email-OTP fallback. `POST /api/me/step-up/challenges` and `POST /api/me/step-up` mint a single-use confirmation only after actual proof verification. It binds either to one existing pending-action id/payload hash or to one PA-15-registered operation (`metrics_token_rotate`, `mfa_reset`, `instance_admin_grant`, `identity_connection_create`, `identity_connection_configure`, `oidc_group_mapping_create`, `oidc_group_mapping_update`, `scim_admin_update`, `scim_token_rotate`, or `scim_token_revoke`) with its exact route, resource version and server-computed canonical request-binding hash; OIDC mapping bindings include the connection and mapping path ids as well as the validated request body. No session-wide window exists. The token is valid five minutes after issuance, hash-only at rest, and consumed atomically with its protected action. Existing pending-action tokens remain re-mintable while the action is pending. Operation challenges are limited to five per person/session/operation in a rolling 15-minute window, with one credential-verification attempt per challenge; failed proof or nonce expires the challenge. Identity connection creation/configuration, OIDC mapping changes and SCIM administration use distinct strict operation bindings; the identity-connection body and version contract is in [api-design.md](#api-design-identity-connection-create-and-configuration-compare-and-set--pa-15). No other operation proof may be reused. Missing required verification support fails closed with `403 step_up_unavailable`. Actual required-method verification is mandatory; a configured plugin or upstream-MFA setting does not prove support. Details: [pending-actions.md](#pending-actions) `PA-15` |
| Elevated list | The single list in [RBAC](permissions.md) |

The local pending-action and registered-operation challenge/proof producers acquire the
pending-action lifecycle gate before their first row lock and retain one transaction through
factor verification and final binding checks. Better Auth's local TOTP/backup-code adapter
work runs on that transaction's backend through nested savepoints. Its session-delete native
authorization effect queues with the child savepoint and publishes only after outer commit.
A supported local-factor-policy PATCH acquires that same gate as its first transaction
statement, before its existing required-role then singleton lock order. This serializes policy
updates with final factor revalidation and proof issuance; it does not invalidate proofs that
were issued before a later policy update.
A successful verifier remains one-shot when final proof minting is denied or its savepoint
fails; successful factor-side effects commit with the outer transaction and no token is
returned. This is an implementation invariant for [PA-15](#pending-actions),
not a promise across outer transaction or connection failure.

<a id="security-model-impersonation"></a>
### Impersonation

Rules `GM-7`–`GM-11` in [god-mode.md](feature-contracts-p4.md#god-mode): 30-minute cap, doubly
audited (`impersonator_id` on every row), never another instance admin, and **forbidden
during impersonation**: approvals, elevated actions, further impersonation, credential or
MFA changes, and anything that creates durable authority — API keys, webhooks, invitations,
role edits. The impersonated person is **notified** (in-app and email) that a support
session happened.

<a id="security-model-input-handling"></a>
### Input handling

| Vector | Control |
| --- | --- |
| Injection | Drizzle parameterises everything. No string-built SQL, no exceptions. Filter grammar whitelists fields and compiles to parameters |
| Filter as an oracle | Filterable fields carry their own read capability; the filter is evaluated **after** identity scoping; `meta.total` counts only rows in reach |
| XSS | React escapes by default. Rich text is a Tiptap **JSON document, never raw HTML**; sanitised against an allowlist on write **and** normalised on render; importers write through the same domain-layer sanitiser as the API. `dangerouslySetInnerHTML` is banned by lint |
| Uploads | Extension and MIME allowlist, magic-byte sniff at `complete`, size cap; presigned POST pins key, `content-length-range` and content type; served from a separate origin with `Content-Disposition: attachment`; only `state = 'ready'` rows are served. No malware scanner — accepted residual risk; a future `storage.antivirus` plugin is reserved, not built ([roadmap.md](../roadmap.md)) |
| SSRF / egress | **One HTTP client for every outbound call** — webhooks, OIDC discovery, SMTP, S3/Azure endpoints, AI providers, OTLP, Sentry, marketplace APIs, and plugin `test()` — resolves and checks the target against private, link-local and metadata ranges (`169.254.169.254`, `fd00:ec2::254`) before connecting and again at connect time; never follows redirects to a new host. The **egress allowlist** is stated once, here, and cited from `WH-12`: in production it is a God Mode-configurable, **default-empty**, per-host list whose every edit is an elevated, audited change, and it may be used **only** by `ai.*` plugins reaching a self-hosted model on a private address; `notify.*`, `webhook` and `import.*` may never target private, link-local or metadata ranges in production, and no God Mode entry can make them. Thomas approved one laptop-only exception (26 Oct): the fixed Mailpit capture profile requires `TASKDESK_LOCAL_MAILPIT_CAPTURE=true`, both canonical local HTTPS origins, and exactly `mailpit:1025` without authentication or TLS. It cannot select another private target and is unavailable at public origins, including when the flag is set. Ordinary SMTP protections remain mandatory. A separate development allowlist relaxes the HTTPS requirement and exists **only** when `NODE_ENV=development`. Plugin `test()` is rate-limited and **audited even when nothing is saved** |
| Path traversal | Object keys are generated, never derived from user filenames |
| Mass assignment | Zod schemas are strict; unknown keys rejected, not stripped |
| ReDoS | User-supplied patterns never compiled to regex |
| Prototype pollution | No deep merge of user input; `Object.create(null)` for dynamic maps |
| Client IP | Read from `X-Forwarded-For` only at the trusted-proxy hop count set by `TASKDESK_TRUST_PROXY`; a forged header moves no rate-limit bucket and satisfies no API-key IP allowlist (tested) |

<a id="security-model-websocket"></a>
### WebSocket

- Session resolution selects Better Auth by exact configured request host and rejects a
  stored session whose `portal` does not match that host, including when its cookie value
  is copied into the other portal's cookie name. Legacy sessions without a stored portal
  fail closed and require a fresh sign-in. Cookie-authenticated WebSocket upgrades also
  require the configured request-host `Origin` before `101`; browser same-origin policy
  does not protect the upgrade. The rule covers **every resolved session regardless of
  credential carrier**; only a resolved API key without a session may omit `Origin`.
  Exact single, non-`null` Origin parsing, credential classification, and real mounted
  route tests are specified in [realtime.md](#realtime-transport).
- Subscriptions are **re-authorized**, not only authorised at subscribe: the socket
  subscribes to the identity-cache invalidation channel and drops affected topics the moment
  a membership or role changes; as a floor, every subscription is re-checked every 60 s.
- Inbound frames are Zod-validated; topics are parsed into a discriminated union, `user:`
  topics are asserted against the session identity, `instance` requires `instance:admin`.
- Subscribe messages are rate-limited per socket, and a refused subscribe never
  distinguishes "does not exist" from "not in reach".

Detail: [realtime.md](#realtime).

<a id="security-model-ai-and-mcp-surfaces"></a>
### AI and MCP surfaces

Both consume text written by customers while holding staff authority — the MCP server
through a staff member's key, the `ai.*` features through the identity that triggered
them. Prompt injection is therefore the primary threat on both, and "off by default" is
not a control. The rules, owned by the two specs and summarised here so a reviewer has one
list:

| Rule | Where |
| --- | --- |
| **MCP is an alternate client, not a second authorization system.** Effective authority = owner's current RBAC ∩ key subset ∩ current reach ∩ route policy ∩ feature availability; no `mcp:*` capabilities exist; a personal MCP key is owned by a named human; service keys are never MCP keys (schema `CHECK`) | [rbac.md](permissions.md), [mcp-server.md](feature-contracts-p4.md#mcp-server) |
| Tool output and retrieved content are **untrusted, attacker-controlled data**, marked as such in the response envelope and in tool descriptions | `MC-15`, [mcp-server.md](feature-contracts-p4.md#mcp-server) |
| Destructive and bulk operations need an **out-of-band human approval** (`pending_action_id` approved in the UI) — never a model-supplied `confirm: true` | `MC-7`, `MC-17` |
| `is_mcp` keys are **read-only by default**; write capabilities are an explicit, warned opt-in | `MC-16`, `AK-9` |
| AI retrieval context is assembled through the **same scoped repositories** as any read, for the triggering identity — no workspace-wide corpus, no cross-organisation duplicate detection | [plugin-architecture.md](features.md) |
| Model output is sanitised on the same path as user rich text; never executed, never an instruction to another component | same |
| Per-feature declaration of what leaves the instance; `ai.sent_externally` audit row per work item; prompts and completions **not logged** by default; per-organisation spend cap and opt-out | same |
| All AI and MCP-related outbound calls go through the central egress client; `ai.ollama` private addresses are allowlisted per host by the administrator | [Input handling](#security-model-input-handling) |
| `tests/mcp/injection.test.ts` and the AI plugin's scoped-retrieval test are CI gates | `MC-18`, [testing-strategy.md](retained-constraints.md#testing-strategy) |

<a id="security-model-transport-and-headers"></a>
### Transport and headers

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

Thomas approved a narrow frame exception on 25 October 2026: allow only HTTPS `https://www.youtube.com/embed/` frames produced by the existing Kaneo embed component, with iframe sandbox restrictions. Other external frames remain blocked. The baseline `frame-src none` applies without this registered exception.

Thomas also approved `blob:` in `img-src` on 25 October for existing local upload and avatar previews. `data:` images and blob scripts, objects and arbitrary frames remain blocked. This is the only local-image exception to the baseline policy.

The required AT-9 PDF viewer uses the exact same-origin `/pdf-preview.html` frame. It has an enforced CSP and `sandbox="allow-scripts"`, without same-origin permission. Only this constant viewer page uses `X-Frame-Options: SAMEORIGIN`; ordinary pages retain `DENY`. Public renderer modules accept opaque-origin loads. PDF bytes travel from the authorized parent through a nonce-bound channel; the child cannot fetch API or attachment data. Blob workers are permitted only inside this isolated renderer.

<a id="security-model-secrets"></a>
### Secrets

| Secret | Storage and rotation |
| --- | --- |
| Plugin configuration secrets | AES-256-GCM per row: envelope `key_id ‖ iv ‖ ciphertext ‖ tag`, a fresh random 96-bit IV per write, and the row id as **AAD** so a ciphertext cannot be moved between rows. Rotation is `secrets-rekey`, resumable, staged by the operator ([runbook](operations-and-distribution.md#runbook)) |
| Entra OIDC client secrets | `identity_connection.client_secret` uses the same row-bound AES-256-GCM envelope. Its binary encoding is ASCII `TDK1`, the first 8 bytes of SHA-256 over the decoded 32-byte encryption key, a fresh 12-byte IV, ciphertext, and the 16-byte GCM tag; the exact `identity_connection.id` UTF-8 bytes are AAD. Readers accept the current key or the configured previous key only when the envelope key id matches. The secret and envelope are never returned in an API response or audit record. |
| Webhook signing secrets | Same envelope; per-webhook rotation with a 24 h dual-signing window (`WH-13`); **rotate all** is a God Mode incident action |
| `TASKDESK_AUTH_SECRET` | Env only. Rotation signs everyone out — a documented incident action with a warning banner, not an accident; dual-secret verification during a window where better-auth supports it |
| API keys | Hashed (Argon2id); only a prefix stored in clear; **revoke all** is a God Mode incident action |
| Invitation tokens | ≥ 128 bits CSPRNG, SHA-256 hash only, bound to the invited email, 7-day default expiry, revoked when the inviter loses `member:invite` |
| Setup token | 32 bytes, printed once to the container log, one hour or one use |
| Passwords | better-auth default (scrypt) |
| The "unchanged" write | Omitting a secret field means unchanged; there is **no in-band sentinel string**, and an omitted field is honoured only for the same plugin row |

<a id="security-model-audit"></a>
### Audit

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
on `audit_log` ([migrations.md](design-and-decisions.md#migrations)); rows are hash-chained
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
An **audit write failure alerts** through
`taskdesk_audit_write_failures_total{operation}` and a safe error-level log line, because
the deliberate trade in `AU-14` — the mutation still succeeds — is only acceptable if
someone finds out. The metric is an operational signal, not the required durable notification
to every current instance administrator. Interactive and background failures require that durable notification. The expiry worker groups notifications by degraded batch while retaining one metric increment per failed append. Rows contain PII deliberately; the erasure position is in
[data-protection.md](operations-and-distribution.md#data-protection).

<a id="security-model-public-and-operational-endpoints"></a>
### Public and operational endpoints

- `/api/public/auth-providers` returns **only** what the login page needs — a button label
  and provider id — never discovery URLs, tenant ids or domain restrictions in that API
  response. The later redirect to a selected IdP may reveal its public destination, including
  host or tenant path, under the limited domain-specific disclosure in `IP-29`; that redirect
  is not a secrecy boundary.
- `/api/public/health/live` and `/ready` are anonymous. A dependency-enumerating deep check
  belongs at `GET /api/instance/health/deep`, policy kind 1 with `instance:admin`; it must not live behind a per-route
  exception under a router whose blanket kind is `public` because it enumerates dependencies.
- `/metrics` is a bearer-guarded target surface with a constant-time comparison on a
  separate Node listener at fixed internal port 9464, not published to the host or exposed
  through Traefik. The listener accepts only exact `GET /metrics` without a query; `HEAD`,
  `OPTIONS` and other methods on that path return 405, while other paths return 404. The
  hash-only credential must be reread from PostgreSQL on every scrape and
  authorize policy kind 5 (`delegated: 'metrics'`) for **`/metrics` and nothing else** —
  never an alternative credential for `/api/instance/health/deep` or any other route.
- An **anonymous rate-limit class**, keyed by IP and — for anything that sends mail — by
  target email, covers `/api/public/*`, the non-login `/auth/*` endpoints (magic link, OTP,
  reset) and the WebSocket upgrade. Those endpoints respond identically and in constant time
  whether or not the account exists.
- Multi-replica deployments **require Valkey** for rate limiting; without it the limiter is
  per replica and the app logs a prominent warning and sets a metric.

<a id="security-model-dependencies-and-supply-chain"></a>
### Dependencies and supply chain

- `pnpm audit` in CI; high or critical fails the build.
- Renovate weekly for patch and minor — **except better-auth**, whose upgrades are reviewed
  as security changes, with a named subscription to its advisories.
- Lockfile committed; `--frozen-lockfile` in CI.
- SBOM (CycloneDX) generated per release.
- Container image scanned with Trivy; high or critical **with a vendor-supplied fix
  available** fails the release (`ignore-unfixed: true`, decision log 2026-09-27).
- Image **and release archive** signed (cosign, keyless via the CI OIDC identity) with a
  build-provenance attestation; `scripts/deploy.sh` and the installer verify before starting
  a new digest (explicit opt-out for air-gapped mirrors).
- The kaneo snapshot taken at P0 is itself a supply-chain input: lockfile audited and tree
  scanned **before** the fork commit, SHA recorded in `THIRD-PARTY-NOTICES.md`.
- **Plugins are fully trusted code.** A plugin runs in-process with the database handle and
  the encryption key; installing one is a supply-chain decision equivalent to a core commit.
  No mechanism for untrusted third-party plugins exists, and none will without a separate
  ADR ([roadmap.md](../roadmap.md) candidate).

<a id="security-model-data-lifecycle"></a>
### Data lifecycle

Organisation hard delete purges: work items, comments, attachments and objects, time and
cost entries, notifications, `notification_delivery` children, empty `notification_digest`
groups, sessions, API keys, webhooks, invitations, `outbox` event envelopes and their
`outbox_dedupe_reservation` rows (which cascade from delivery ownership), idempotency
responses, `metric_snapshot` rows carrying its `organisation_id`, search vectors, and cached
identity entries. Delete scoped notification children before empty groups; delete a parent
event only after no child references it, so no digest membership or event-child reference
dangles. Person deletion also
removes that person's children, then empty groups and reservations owned by those children.
Lease expiry ends reservation authority immediately and allows takeover; daily
`session-cleanup` later physically removes expired reservation rows. No recipient id remains
in a reservation after person deletion or expiry cleanup. Audit rows keep an organisation
tombstone. Deleted data persists in backups for the retention period stated in
[backup-and-restore.md](operations-and-distribution.md#backup-and-restore) — the answer a DPA asks for.
Quotas ship with **real defaults** (storage 20 GB, portal users 500, webhooks 10, API
600/min per organisation), not "unlimited", and the installer applies them.

<a id="security-model-vulnerability-disclosure-and-advisories"></a>
### Vulnerability disclosure and advisories

- `SECURITY.md` at the repo root and `/.well-known/security.txt` on both origins name a
  security contact and a 90-day coordinated-disclosure window.
- Advisories are published as GitHub Security Advisories with a CVE where warranted, and
  every advisory ships with a patch release the same day per
  [release-plan.md](retained-constraints.md#release-plan).
- Self-hosted operators learn they must upgrade through God Mode → Health's version check
  (which compares against `stable.txt`) and the advisory feed — a stated obligation of
  distributing a container image, and a marketplace listing requirement.

<a id="security-model-required-security-cases"></a>
### Required security cases

The cases below describe required evidence, not passing results or a per-change review process. Current agent instructions control review timing. Real external identity and external security dependencies must be reported honestly.

| Test | Where |
| --- | --- |
| Route policy coverage (Hono router, five kinds) | `tests/permissions/` |
| Permission matrix — capability and reach; custom-role property tests | `tests/permissions/` |
| IDOR fuzz — other-tenant ids on every scoped route | `tests/permissions/` |
| Tenant isolation | `tests/api-integration/` |
| Negative E2E (incl. state-changing GET refusal; cookie-authenticated unsafe requests with missing/mismatched `Origin` or `Referer`, or missing/mismatched double-submit token; forged `X-Forwarded-For`; cross-origin WS; re-auth on revoke) | `tests/e2e/security/` |
| Auth reconfiguration suite | `tests/api-integration/auth/` |
| Dependency audit | CI |
| Container scan, SBOM, signing | CI |
| Service-key clamp, owner-team reach, webhook delivery reach, OIDC PKCE/`state`/`nonce`, MCP injection | `tests/permissions/`, `tests/api-integration/auth/`, `tests/mcp/` |
| SCIM/Entra acceptance tests 01–25 ([identity-provisioning.md](feature-contracts-p3.md#identity-provisioning-testing)) — against a **real Entra test tenant** before the P3 identity gate | `tests/api-integration/identity/` |
| Pending-action suite ([pending-actions.md](#pending-actions-testing)) — 202-not-performed, no self-approval from API/MCP/impersonation, target/payload binding, single use, expiry, re-authorisation, step-up | `tests/api-integration/pending-actions/`, `tests/e2e/security/` |
| Session-only routes refuse API and MCP keys | `tests/permissions/session-only.test.ts` |

At go-live, the one consolidated independent phase review includes hostile-seed authorization, portal-boundary and retained-Kaneo-route checks in a fresh reviewer context before real customer data. This is not an extra per-change approval round. An external penetration test is required before the first external customer and annually thereafter. No synthetic or AI test is represented as that external service.

<a id="security-model-incident-response"></a>
### Incident response

| | |
| --- | --- |
| **Contact** | `security@<domain>` (in `SECURITY.md`); Thomas is the owner until a rota exists |
| **Triage** | S1 active breach or credential exposure — respond within 1 h; S2 exploitable vulnerability — 24 h; S3 hardening — next release |
| **Contain** | Revoke sessions (rotate `TASKDESK_AUTH_SECRET`), revoke all API keys, rotate webhook secrets, disable the affected plugin or account — all God Mode incident actions |
| **Assess** | The audit log is the source of truth for what was touched; the hash chain proves it is intact |
| **Notify** | Affected organisations within 72 h, per contractual obligation; downstream operators via advisory |
| **Remediate** | Fix, regression test, patch release the same day |
| **Record** | Decision log entry and a lesson added here |

Full procedure: [runbook](operations-and-distribution.md#runbook).

<a id="storage-and-attachments"></a>
## Storage and attachments
Attachment **bytes** live in object storage. Attachment **metadata** lives in Postgres.
The backend is a plugin, so a deployment chooses SeaweedFS, S3, Azure Blob or the local
filesystem without a code change.

Storage configuration belongs in runtime administration. A fresh filesystem installation remains usable without an object-store dependency. The attachment feature supersedes legacy task-image paths rather than creating a second authorization surface. Bootstrap driver compatibility is registered in [configuration](configuration.md). Backend changes require a migration plan for existing bytes; selecting a new driver does not migrate or clean up old bytes.

<a id="storage-and-attachments-backends"></a>
### Backends

| Plugin id | Use |
| --- | --- |
| `storage.s3` | The production recommendation — any S3-compatible endpoint: AWS S3, Garage, Wasabi, B2, or SeaweedFS shipped as an **opt-in Compose profile**; a plain S3-API client; not MinIO, see [tech stack](architecture-and-experience.md#tech-stack). **A fresh install runs `storage.filesystem`** until an administrator chooses otherwise (decision log, 2026-09-05) |
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

<a id="storage-and-attachments-object-keys"></a>
### Object keys

Generated, never derived from the user's filename:

```
{workspaceId}/{yyyy}/{mm}/{attachmentId}{ext}     ← workspaceId = attachment.workspace_id, denormalised at insert (a submission attachment has one too)
```

- No user-controlled path segment ⇒ no traversal.
- The original filename is stored in the database and returned in
  `Content-Disposition` on download.
- The date prefix keeps prefixes shallow and makes lifecycle rules easy.

<a id="storage-and-attachments-upload-flow"></a>
### Upload flow

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

<a id="storage-and-attachments-validation"></a>
### Validation

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

<a id="storage-and-attachments-download-and-serving"></a>
### Download and serving

- Downloads are **presigned URLs with a 5-minute TTL**, issued only after a policy check.
- The storage plugin's configured **public endpoint must equal the browser-facing origin**:
  an S3 SigV4 signature covers the `Host` header, so a URL presigned for `seaweedfs:8333`
  fails at `https://files.<domain>`. The bucket's CORS allows exactly the agent and portal
  origins. `files.<domain>` and its Traefik router exist **only** when an operator-owned S3
  endpoint is served behind this Traefik ([deployment.md](operations-and-distribution.md#deployment));
  on `storage.filesystem` the API serves bytes itself and no third hostname exists.
  The object store is never public.
- `Content-Disposition: attachment` for everything except images that are being displayed
  inline in the UI.
- Where the storage backend permits, downloads are served from a **separate origin** so
  that even a successfully uploaded hostile file cannot execute against the application
  origin. When it cannot, a restrictive `Content-Security-Policy: sandbox` header is set.
- Every download writes an audit row: who, what, when.

<a id="storage-and-attachments-visibility"></a>
### Visibility

Each attachment carries `customer_visible`. Staff-uploaded files default to **not**
visible; customer-uploaded files default to visible. The portal API filters on this
server-side — never in the client.

An attachment on an internal comment is always internal, regardless of its own flag.

<a id="storage-and-attachments-images-in-rich-text"></a>
### Images in rich text

Tiptap images are ordinary attachments. Pasting or dropping an image into a description
or comment runs the same presign → upload → complete flow, and the editor stores an
attachment reference rather than a base64 blob. This matters: base64 in a JSONB column is
how document tables become gigabytes.

<a id="storage-and-attachments-quotas"></a>
### Quotas

Optional, per organisation, configured in God Mode. Exceeding returns `429` naming the
quota. Usage is visible in workspace settings so it is not a surprise.

<a id="storage-and-attachments-deletion-and-lifecycle"></a>
### Deletion and lifecycle

- Deleting an attachment marks the row deleted; `attachment-gc` removes the object the
  following night. This makes accidental deletion recoverable for a day.
- Deleting a work item cascades to its attachments through the same path.
- Deleting an organisation purges its objects during hard delete.
- Optional lifecycle rules on the bucket (transition to infrequent access after 90 days)
  are an operator concern, documented but not managed by the application.

<a id="storage-and-attachments-backup"></a>
### Backup

Object storage is backed up **separately from the database**, and the two must be
restored to a consistent point. A database restored to yesterday alongside today's bucket
will show attachments that the database does not know about — harmless — while the
reverse shows rows whose objects are missing, which is not.

Restore order is therefore: database first, then object storage forward-only.
See [Backup and restore](operations-and-distribution.md#backup-and-restore).

<a id="storage-and-attachments-testing"></a>
### Required behavior cases

| Test | Asserts |
| --- | --- |
| `presign-policy.test.ts` | Presign refuses without `work_item:update` on the target |
| `mime-sniff.test.ts` | A `.png` containing a PE header is rejected at complete |
| `visibility.test.ts` | Portal API never returns a non-visible attachment |
| `traversal.test.ts` | A filename of `../../etc/passwd` produces a safe generated key |
| `gc.test.ts` | Orphaned objects and stale pending rows are removed |
| E2E `attachments.spec.ts` | Upload, view, download, delete, in both portals |

## Contract tensions and owner decisions

- **Required-factor support:** PA-15's embedded historical source-status sentences conflict with later local-factor requirements. Keep every PA binding, freshness, transaction and denial rule. No factor is treated as available until its actual verifier and integrated journey are verified; a static setting never supplies proof.
- **Closed operation bindings:** PA-15 is the complete operation allowlist, including `instance_admin_suspend`; an older security-summary list omitting it is not a new allowlist or permission to share another operation's proof.
- **OIDC library versus protocol:** the historical plugin table called generic OAuth the connection protocol. The later connection-bound Entra admission contract governs: generic decoded claims cannot replace the signed issuer/audience/subject/app-role/account-type verifier. Other providers require their own approved admission profile.
- **Portal rollout:** CP-19's P0 public-host denial is phase-specific. A later customer journey needs the maintained P3 identity/portal contract and its boundary decision; an internal or seeded session is not evidence of public authentication acceptance. Do not silently widen a P0 denial to match a running page.
- **Native versus reserved socket topics:** native work-item realtime denies `user:` and `instance`; generic older topic descriptions do not enable them. Legacy notification consumers keep their separate migration boundary.
- **Label scopes:** the retained first-label API description names workspace-only catalogue labels, while the maintained canonical bulk contract explicitly validates workspace/project catalogues. Preserve the latter integration contract; broader label-search/profile changes still need their own storage/visibility contract. Do not infer label support merely from code.
- **Upload transport and cleanup:** direct object-store presign flow and the filesystem adapter need an explicit backend-specific byte-transfer contract; do not pretend filesystem URLs are true object-store presigned URLs. The shared jobs contract owns stale-pending cleanup naming. Recovery requires a reachable user journey, not retained bytes alone.
- **Quota units:** the six-limit tenancy table says 20 GiB while an older security summary says 20 GB. Preserve the explicit table and flag a conflicting implementation/unit interpretation for owner reconciliation; do not silently change a quota threshold or report both as equivalent.
- **Audit purge ordering:** the older security text describes an anchor after deletion; the shared jobs contract requires the anchor before deletion. Preserve atomic anchor/history durability and refusal if anchoring fails; physical SQL ordering must be reconciled before claiming a restore/purge acceptance result.
- **Log examples versus bounded projection:** illustrative older log examples do not authorize arbitrary message strings or actor/tenant identifiers. The finite event/label registry, typed own-data projection and redaction rules govern each actual log producer.
- **Remaining external evidence:** real Entra interoperability, physical replica/Valkey behavior, supported-provider tests, shipping-image provenance/signing, backup/restore and external security work are requirements, not results supplied by this reference.

## Related maintained references

The retained product/operation clauses have maintained destinations below. Source names are historical provenance, not archive dependencies or current execution claims. Existing [requirements](../requirements.md), [alignment](../alignment.md) and the requirement index preserve scope and unresolved owner decisions.

<a id="pending-docs01-architectureadr0003-better-auth-primary"></a>
- [Maintained clause](design-and-decisions.md#0003-better-auth-primary); historical source: `docs/01-architecture/adr/0003-better-auth-primary.md`.
<a id="pending-docs01-architectureadr0004-two-portals-two-origins"></a>
- [Maintained clause](design-and-decisions.md#0004-two-portals-two-origins); historical source: `docs/01-architecture/adr/0004-two-portals-two-origins.md`.
<a id="pending-docs01-architectureadr0009-lazy-sla-evaluation"></a>
- [Maintained clause](design-and-decisions.md#0009-lazy-sla-evaluation); historical source: `docs/01-architecture/adr/0009-lazy-sla-evaluation.md`.
<a id="pending-docs01-architectureadr0015-membership-grant-provenance"></a>
- [Maintained clause](design-and-decisions.md#0015-membership-grant-provenance); historical source: `docs/01-architecture/adr/0015-membership-grant-provenance.md`.
<a id="pending-docs01-architecturetech-stack"></a>
- [Maintained clause](architecture-and-experience.md#tech-stack); historical source: `docs/01-architecture/tech-stack.md`.
<a id="pending-docs02-designux-quality-gates"></a>
- [Maintained clause](architecture-and-experience.md#ux-quality-gates); historical source: `docs/02-design/ux-quality-gates.md`.
<a id="pending-docs04-engineeringcoding-standards"></a>
- [Maintained clause](retained-constraints.md#coding-standards); historical source: `docs/04-engineering/coding-standards.md`.
<a id="pending-docs04-engineeringmigrations"></a>
- [Maintained clause](design-and-decisions.md#migrations); historical source: `docs/04-engineering/migrations.md`.
<a id="pending-docs04-engineeringrepository-bootstrap"></a>
- [Maintained clause](retained-constraints.md#repository-bootstrap); historical source: `docs/04-engineering/repository-bootstrap.md`.
<a id="pending-docs04-engineeringtesting-strategy"></a>
- [Maintained clause](retained-constraints.md#testing-strategy); historical source: `docs/04-engineering/testing-strategy.md`.
<a id="pending-docs05-operationsbackup-and-restore"></a>
- [Maintained clause](operations-and-distribution.md#backup-and-restore); historical source: `docs/05-operations/backup-and-restore.md`.
<a id="pending-docs05-operationsdata-protection"></a>
- [Maintained clause](operations-and-distribution.md#data-protection); historical source: `docs/05-operations/data-protection.md`.
<a id="pending-docs05-operationsdeployment"></a>
- [Maintained clause](operations-and-distribution.md#deployment); historical source: `docs/05-operations/deployment.md`.
<a id="pending-docs05-operationsrunbook"></a>
- [Maintained clause](operations-and-distribution.md#runbook); historical source: `docs/05-operations/runbook.md`.
<a id="pending-docs05-operationsscaling"></a>
- [Maintained clause](operations-and-distribution.md#scaling); historical source: `docs/05-operations/scaling.md`.
<a id="pending-docs07-planningdecision-log"></a>
- [Maintained clause](retained-constraints.md#decision-log); historical source: `docs/07-planning/decision-log.md`.
<a id="pending-docs07-planningrelease-plan"></a>
- [Maintained clause](retained-constraints.md#release-plan); historical source: `docs/07-planning/release-plan.md`.
<a id="pending-docs07-planningrisks"></a>
- [Maintained clause](retained-constraints.md#risks); historical source: `docs/07-planning/risks.md`.
<a id="pending-docs07-planningroadmap"></a>
- [Maintained clause](../roadmap.md); historical source: `docs/07-planning/roadmap.md`.
