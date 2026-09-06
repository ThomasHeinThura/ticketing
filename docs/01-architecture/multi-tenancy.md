# Multi-tenancy

## The model

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

## Isolation

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
finding it is the point). **P0 exit:** the prototype is either merged with those answers
written down, or dropped with the reason recorded in the [decision log](../07-planning/decision-log.md).
Either outcome closes the question; leaving it open does not.

What does not change: omission stays detectable in the application — see
[Security model](security-model.md).

### Query scoping

Every query that can return cross-organisation data passes through a scoped repository
helper that takes the resolved identity:

```ts
const items = await workItems.forIdentity(identity).inProject(projectId).list(filter);
```

A lint rule forbids calling `db.select().from(workItem)` outside
`apps/api/src/*/repository.ts`, so ad-hoc unscoped queries cannot creep into controllers.

### The 404 rule

A read outside reach returns **404**, never 403. Returning 403 would confirm the record
exists, which is a cross-tenant leak. `tests/api-integration/tenant-isolation.test.ts`
seeds two organisations and asserts that every read route returns 404 across the boundary.

### Customer scoping

For a customer identity, reach is `{ kind: 'organisation', ids: [theirOrg] }` and cannot
be widened by any role. Even a customer with an inflated role sees only their
organisation. This is enforced in the evaluator, not by role configuration, so it cannot
be misconfigured away.

## Cross-organisation work

Staff in the internal organisation routinely work across customer organisations. That is
reach granted by project membership, or by an explicit `sees_all` flag on a workspace
membership for roles such as service-desk triage.

`sees_all` grants **reach only**. It never grants authority. This is the distinction v1
got right and is worth repeating: a triage agent who can see every ticket still cannot
change a project's SLA policy.

## Data residency and separation

Single database, shared schema, application-level scoping. Reasons:

- One migration path, one backup, one connection pool.
- Cross-organisation reporting for the internal organisation is a first-class requirement,
  and schema-per-tenant makes it painful.
- Our scale does not justify the operational cost of separation.

**If a customer requires physical separation**, the answer is a separate instance —
a separate container and database, same image. This is exactly why everything is
configured at runtime: a dedicated instance costs a `docker compose up` and a God Mode
session, not a build.

## Branding per tenant

Instance branding is instance-wide. Where a customer-facing portal must carry the
customer's own branding, that is a separate instance.

Within one instance, per-organisation customisation is limited to: the request catalogue
they see, their service calendar, their SLA policies and their notification settings.

## Identity across tenants

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
  ([god-mode.md](../03-features/god-mode.md) `GM-7`, `GM-8`). A second account is for
  someone who genuinely *is* a customer contact in their own right, not for support work.

**Known limitation, accepted deliberately (2026-09-06):** a consultant who is genuinely a
contact at two customer organisations needs two customer-side `person` rows and signs in to
each through that organisation's own connection. There is no single identity spanning
customer organisations, and the schema is **not** being redesigned for it now — the cost is
a rare person signing in twice; the alternative is a many-to-many identity model paying for
itself on every authorization check.
- Identity providers are bound per portal, and a customer connection is bound to exactly
  one organisation by `identity_connection.organisation_id`
  ([identity-provisioning.md](../03-features/identity-provisioning.md) `IP-1`). **That
  column is the only thing that selects the organisation.**
- A connection's `domain_bindings` do something narrower and easier to misread: a domain
  binding **refuses** a token whose address domain belongs to a *different* connection. It
  never selects the organisation, and it is not a second, weaker route to one — an email
  domain is evidence for rejecting, never for choosing (`IP-9`,
  [auth-and-identity.md](auth-and-identity.md#what-every-authoidc-plugin-must-do--the-protocol-floor)).

## Provisioning a new customer organisation

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
Organisations → *org* → Identity ([god-mode.md](../03-features/god-mode.md),
[identity-provisioning.md](../03-features/identity-provisioning.md) `IP-5`).

No deploy. No restart. This is the operation that must be effortless, because it is the
one performed most often.

## Deleting an organisation

1. Soft-delete: portal access revoked, sessions invalidated, projects archived.
2. A 30-day window during which restore is one click.
3. Hard delete purges the **complete** list in [security-model.md § Data lifecycle](security-model.md#data-lifecycle)
   — work items, comments, attachments and objects, time and cost entries, notifications,
   sessions, API keys, webhooks, invitations, outbox rows, idempotency responses,
   `metric_snapshot` rows for the organisation, search vectors and cached identities.
   `audit_log` rows are retained with `organisation_id` set null as the tombstone, because
   deleting an audit trail on request defeats its purpose. Backups retain deleted data for
   their stated retention; [data-protection.md](../05-operations/data-protection.md) states
   the position a customer's DPA will ask about.
4. The whole sequence is audited and requires re-authentication.

## Limits and quotas

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

## Testing

| Test | Asserts |
| --- | --- |
| `tenant-isolation.test.ts` | Two seeded orgs; every read route returns 404 across the boundary |
| `customer-reach.test.ts` | A customer role with inflated capabilities still cannot widen reach |
| `sees-all-authority.test.ts` | `sees_all` grants no capability |
| `org-delete.test.ts` | Hard delete removes all owned rows and leaves audit tombstones |
| E2E `cross-tenant.spec.ts` | Customer A cannot reach Customer B's ticket by URL |

## Related

- [RBAC](rbac.md) · [Security model](security-model.md) · [Data model](data-model.md)
