# Plugin architecture

> **The rule:** if it varies between deployments, it is runtime configuration edited in
> God Mode — never an environment variable read at boot, never a compile-time branch,
> never a customer-specific code path.
>
> One image. Any customer. Configured after it starts.

## Why

We want to hand the same container to our own operations team and to a paying customer,
and have both of them configure it entirely through the UI. That means:

- Customer A uses Entra ID for staff and email OTP for customers.
- Customer B uses Keycloak for everyone.
- Customer C uses built-in email + password with TOTP, and no external IdP at all.
- Customer D stores attachments in Azure Blob; everyone else uses the default SeaweedFS.
- Customer E wants Slack notifications; Customer F wants ntfy; Customer G wants neither.

None of that may require a rebuild, a different image tag, or a `docker-compose`
edit beyond the database URL and a secret.

## The model

```
┌──────────────────────────────────────────────────────────┐
│  packages/plugins-contracts                              │
│  Interfaces only. No implementations.                    │
│   AuthProvider · StorageBackend · NotificationChannel    │
│   Importer · SearchBackend · AiProvider                  │
└──────────────────────────────────────────────────────────┘
              ▲                              ▲
   implements │                              │ implements
┌─────────────┴──────────┐      ┌────────────┴───────────┐
│ built-in implementations│      │ future: external       │
│ shipped in the image    │      │ packages / OSS add-ons │
└─────────────────────────┘      └────────────────────────┘
              ▲
              │ registered at boot
┌─────────────┴────────────────────────────────────────────┐
│  Registry  (in-process Map<pluginId, Implementation>)     │
│  + instance_plugin_config rows from PostgreSQL            │
│  = the set of ACTIVE, CONFIGURED plugins                  │
└──────────────────────────────────────────────────────────┘
              ▲
              │ CRUD
┌─────────────┴────────────────────────────────────────────┐
│  God Mode UI  →  /api/instance/plugins                    │
│  Generated from each plugin's config schema (Zod → form)  │
└──────────────────────────────────────────────────────────┘
```

Each plugin declares a **Zod config schema**. God Mode renders the settings form
*from that schema* — so adding a plugin adds its settings page automatically, with no
bespoke UI work.

## Contract

```ts
// packages/plugins-contracts/src/plugin.ts
export interface Plugin<TConfig> {
  /** Stable identifier, e.g. "auth.oidc". Never changes. */
  id: string;
  kind: PluginKind;
  displayName: string;
  description: string;
  /** Drives the God Mode form and validates stored config. */
  configSchema: z.ZodType<TConfig>;
  /** Keys within config that must be encrypted at rest. */
  secretFields: (keyof TConfig)[];
  /** Can this plugin be enabled more than once? e.g. many OIDC providers. */
  multiInstance: boolean;
  /** Called when config is saved. Must not throw for transient failures. */
  validate(config: TConfig): Promise<ValidationResult>;
  /** "Send a test email", "Try a login", "Write a test object". */
  test?(config: TConfig): Promise<TestResult>;
  /** Build a live instance from stored config. */
  create(config: TConfig, ctx: PluginContext): Promise<PluginInstance>;
}
```

## Storage of configuration

```
instance_plugin_config
  id              text pk
  plugin_id       text        -- "auth.oidc"
  instance_key    text        -- distinguishes multiple instances of one plugin
  display_name    text        -- what admins see: "Contoso Entra ID"
  enabled         boolean
  config          jsonb       -- non-secret settings
  secrets         bytea       -- AES-256-GCM, key from TASKDESK_ENCRYPTION_KEY
  scope           text        -- "instance" | "workspace"
  workspace_id    text null
  portal_scope    text        -- "agent" | "customer" | "both"   (auth plugins)
  created_at, updated_at, updated_by
```

- Secrets are **encrypted at rest** and **never returned by the API**. Reads return
  `"••••••••"`; writes accept a new value or the sentinel meaning "unchanged".
- Every change writes an audit row with the actor, the plugin and the changed keys —
  values excluded.

## Plugin kinds

### `auth` — identity providers

The most important kind. See [Auth and identity](auth-and-identity.md) for the full
picture.

| Plugin id | Backed by | Notes |
| --- | --- | --- |
| `auth.password` | better-auth email + password | Always available, cannot be removed |
| `auth.magic-link` | better-auth magic link | |
| `auth.email-otp` | better-auth email OTP | |
| `auth.totp` | better-auth two-factor | MFA, can be *required* per role |
| `auth.passkey` | better-auth passkey | WebAuthn |
| `auth.oidc` | better-auth genericOAuth | **multi-instance** — add as many as you like |
| `auth.entra` | `auth.oidc` preset | Pre-filled endpoints, tenant id field |
| `auth.keycloak` | `auth.oidc` preset | Pre-filled realm URL pattern |
| `auth.google` / `auth.github` / `auth.gitlab` | better-auth social | |
| `auth.saml` | later | Phase 5+ |

Each auth plugin instance carries `portal_scope`, so an administrator can say
"Entra for staff, email OTP for customers" **entirely in the UI**.

It also carries `jit_provisioning` rules: on first login, which organisation and which
role does this person get? Without that, an OIDC provider is only half-configured.

### `storage` — attachment backends

| Plugin id | Notes |
| --- | --- |
| `storage.s3` | SeaweedFS (shipped default), AWS S3, Garage, Wasabi, Backblaze B2 — anything S3-compatible. Not MinIO — see [tech stack](tech-stack.md) |
| `storage.azure-blob` | |
| `storage.filesystem` | Single-node deployments |

Contract: `put`, `get`, `delete`, `presignUpload`, `presignDownload`, `stat`.

### `notify` — notification channels

| Plugin id | Notes |
| --- | --- |
| `notify.email` | SMTP. Config includes host, port, TLS, credentials, from-address |
| `notify.webhook` | Generic JSON POST with HMAC signature. SSRF-guarded |
| `notify.slack` · `notify.teams` · `notify.discord` | Incoming webhook URL |
| `notify.ntfy` · `notify.gotify` | Self-hosted push |

Users choose per-channel preferences; administrators choose which channels exist.

### `import` — data importers

`import.azure-devops`, `import.plane`, `import.jira`, `import.csv`.
See [Import strategy](../06-data-import/import-strategy.md).

### `search` — search backends

`search.postgres` (default, full-text) and `search.meilisearch` (optional).
Only add the second if the first is measured to be insufficient.

### `ai` — optional AI assistance

`ai.openai`, `ai.azure-openai`, `ai.ollama`, `ai.anthropic`.
Used for suggested request classification, duplicate detection and summarisation.
**Off by default**, because many customers will not permit it.

### `license` — marketplace entitlement and usage metering

| Plugin id | Notes |
| --- | --- |
| `license.none` | **Default.** No entitlement check, no metering, nothing phones home |
| `license.aws-marketplace` | Resolves entitlement, meters usage to AWS, sets `locked` feature flags per tier |
| `license.azure-marketplace` / `license.gcp-marketplace` | Future — same kind, no redesign needed |

Exists so a marketplace listing never requires a different build. See
[ADR 0013](adr/0013-marketplace-metering-plugin.md) and
[AWS Marketplace listing](../05-operations/aws-marketplace.md).

## Feature toggles

A second, simpler axis of configurability: switching whole features off so the UI stays
small. Modelled on Plane's project feature toggles.

```
instance_feature_flag   (feature_key, enabled, locked)
workspace_feature_flag  (workspace_id, feature_key, enabled)
project_feature_flag    (project_id,   feature_key, enabled)
```

Resolution: project → workspace → instance → built-in default.
`locked` at instance level prevents lower levels from overriding — this is how a vendor
sells tiers without shipping different images.

| Flag | Hides |
| --- | --- |
| `feature.cycles` | Cycles/sprints |
| `feature.modules` | Modules |
| `feature.estimates` | Story points / estimates |
| `feature.intake` | Intake queue |
| `feature.sla` | SLA policies, SLA badges, SLA reports |
| `feature.approvals` | Approvals and CAB |
| `feature.time_tracking` | Timesheets, time entries |
| `feature.cost_tracking` | Rates, budgets, cost reports |
| `feature.knowledge_base` | KB |
| `feature.service_catalogue` | Services, changes, releases |
| `feature.customer_portal` | The whole portal origin |
| `feature.gantt` · `feature.calendar` · `feature.pages` | Those views |

The UI reads flags from a single `useFeature('cycles')` hook. Navigation, routes and
API endpoints all respect them — a disabled feature returns `404` from the API, not just
a hidden menu item.

## Branding

Also runtime, also God Mode: product name, logo (light/dark), favicon, accent colour,
login background, support email, footer links, custom CSS variables override.

Stored in `instance_branding`, served through `/api/public/branding` — unauthenticated,
because the login page needs it.

## The engine pattern — making any feature pluggable

The six plugin kinds below (`auth`, `storage`, `notify`, `import`, `search`, `ai`, plus
`license` from [ADR 0013](adr/0013-marketplace-metering-plugin.md)) are the plugin
registry's current members, but the *pattern* is not limited to them. **Every feature in
this product — the ones specified today and any added later — is expected to follow the
same shape**, whether or not it ever gets a literal `Plugin` implementation:

1. **A contract, not an implementation.** The behaviour is defined as an interface or a
   data shape ([`packages/plugins-contracts`](#contract) for a swappable backend; a table
   plus a small set of pure functions in `packages/domain` for something like the
   lifecycle engine). Either way, the *shape* of the feature is decided before any one
   version of it is built.
2. **A registry or a settings screen, never a hardcoded branch.** Concretely: the
   `auth`/`storage`/`notify` plugin registry for swappable backends; the `state` /
   `workflow` tables plus the workflow editor for the lifecycle engine
   ([ADR 0011](adr/0011-ticket-lifecycle-engine.md)); `terminology_override` plus a
   settings screen for renameable nouns ([ADR 0012](adr/0012-terminology-overlay.md)).
   Whichever mechanism fits, the rule is the same one stated at the top of this document:
   *if it varies between deployments, it is configured, never compiled in.*
3. **Configuration generated from a schema, not a bespoke form.** A Zod config schema
   drives a plugin's God Mode form (`GM-5` in [God Mode](../03-features/god-mode.md));
   the same idea applies to a workflow's transition editor or a custom report's builder —
   the *editing surface* is generated from the *shape* of the thing being edited, so a new
   instance of the pattern (a new plugin, a new workflow, a new report) never requires new
   bespoke UI work.
4. **A feature flag to switch it off**, independent of whether it is configured. See
   [Feature toggles](#feature-toggles) below.
5. **A validate/test affordance where "wrong" is otherwise silent.** A plugin's
   `validate()`/`test()`; a workflow's publish-time validation panel
   ([workflows.md](../03-features/workflows.md)); a custom report's live preview
   ([reports-and-dashboards.md](../03-features/reports-and-dashboards.md)) — the common
   thread is that an administrator can prove a configuration works *before* relying on it,
   never "save and hope."

**When specifying a new feature, ask which of these five a feature is missing before
calling the spec done.** A feature that skips this checklist to hit a date has not
actually shipped the thing this product is for — see
[accelerated-delivery-plan.md](../07-planning/accelerated-delivery-plan.md#what-never-moves-regardless-of-the-calendar),
which names this explicitly as one of the two things that never compress, whatever the
calendar looks like.

## Rules for developers and agents

1. **Never `process.env.SOMETHING_CUSTOMER_SPECIFIC`.** Environment variables are for
   bootstrapping only: database URL, encryption key, bind port, public URLs.
2. **Never `if (provider === 'entra')`** inside a handler. Add a plugin or a preset.
3. **New plugin = new folder under `apps/api/src/plugins/<kind>/`** exporting a `Plugin`.
   Register it in the kind's index. God Mode picks it up automatically.
4. **Every plugin needs a `test()`** where meaningful. "Save and hope" is not acceptable
   for SMTP or OIDC; administrators must be able to verify before relying on it.
5. **Failures must be legible.** A misconfigured plugin shows the real error in God Mode,
   not "something went wrong".

## Bootstrap environment variables

The only things not configurable at runtime, because they are needed to reach the
configuration:

| Variable | Purpose |
| --- | --- |
| `TASKDESK_DATABASE_URL` | Where configuration lives |
| `TASKDESK_ENCRYPTION_KEY` | Decrypts plugin secrets. 32-byte hex |
| `TASKDESK_AUTH_SECRET` | Session signing |
| `TASKDESK_AGENT_URL` | Public agent origin |
| `TASKDESK_PORTAL_URL` | Public portal origin |
| `TASKDESK_PORT` | Bind port |
| `TASKDESK_VALKEY_URL` | Optional |
| `TASKDESK_BOOTSTRAP_ADMIN_EMAIL` | First-run only; creates the instance admin |

Everything else — SMTP, OIDC, S3, Slack, branding, features — is God Mode.

Full list: [Configuration reference](../05-operations/configuration-reference.md).

## Related

- [ADR 0006 — plugin registry](adr/0006-plugin-registry.md)
- [Auth and identity](auth-and-identity.md)
- [God Mode](../03-features/god-mode.md)
