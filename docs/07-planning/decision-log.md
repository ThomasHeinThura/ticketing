# Decision log

Decisions too small for an [ADR](../01-architecture/adr/README.md) but worth recording:
dependency choices, convention changes, scope calls, gate waivers.

Newest first.

## Format

```markdown
### YYYY-MM-DD · Short title
**Decision:** what we are doing
**Why:** the reasoning
**Alternatives:** what was rejected, briefly
**Decided by:** who
```

---

### 2026-09-05 · Tech stack versions reviewed against current upstream status; MinIO dropped

**Decision:** after checking every pin in [tech stack](../01-architecture/tech-stack.md)
against actual current upstream status (not memory), three changes:

- **PostgreSQL 16 → 18.** 18 has been GA for a year, is the AWS/Azure-recommended default,
  and adds native OAuth auth, SCRAM-over-md5 enforcement, TLS 1.3 cipher control and
  checksums-on-by-default — all security-relevant. 19 is in beta; not a target yet.
- **Valkey 8 → 9.**
- **MinIO dropped as the shipped default self-hosted object-storage backend.** MinIO
  Community Edition's admin console was stripped from the AGPL build in May 2025, image
  publishing stopped in October 2025, and the upstream repository was archived in April
  2026 — the removed functionality is now sold only as a paid product. **SeaweedFS**
  (Apache-2.0, actively maintained) replaces it as the shipped default; **Garage**
  (AGPL-3.0, matching our own licence) is documented as the lightweight alternative. Real
  AWS S3 in production is unaffected either way, because `storage.s3` was always a plain
  S3-API client, never a MinIO-specific one — this is a reference-implementation swap, not
  an architecture change.

Confirmed unchanged after the same check: **Node 24** (Active LTS to April 2028 — correct
pin), **Traefik v3** (currently 3.7.x, no v4), **Keycloak 26** (currently 26.7.x, no
newer major). **OpenAPI 3.1 → 3.2** — see the entry below. Noted for later, action needed
only when kaneo is actually forked in P0: kaneo has begun adding **Base UI**
(`@base-ui/react`) alongside Radix, following shadcn/ui's mid-2026 default switch; we
inherit whatever mix kaneo is using at fork time, per [ADR 0001](../01-architecture/adr/0001-kaneo-as-foundation.md).

**Why:** an explicit requirement to use "all updated and most secure" versions, and
because a stale pin recorded in a planning document is worse than no pin — it reads as
current when it is not.

**Decided by:** Thomas

---

### 2026-09-05 · OpenAPI target moved from 3.1 to 3.2

**Decision:** [API design](../01-architecture/api-design.md) targets OpenAPI 3.2, the
current release (shipped September 2025) rather than 3.1. 3.2 is a small, strictly
3.1-compatible feature release — structured tag navigation, streaming-friendly media
types, arbitrary HTTP methods, clearer OAuth2 device-flow support — so nothing already
decided about schema-first Zod generation changes.

**Why:** "latest version" was an explicit requirement, and `@hono/zod-openapi` generates
the document, so targeting 3.2 costs nothing beyond confirming the library's support for
it at implementation time.

**Decided by:** Thomas

---

### 2026-09-05 · CHANGELOG.md added; release notes formalised alongside the auto-generated log

**Decision:** a `CHANGELOG.md` exists at the repo root from today, in Keep a Changelog
format, with an honest "no code released yet" `[Unreleased]` entry rather than fabricated
history. [CI/CD](../04-engineering/ci-cd.md) gains a **Release notes** section requiring a
short human-written summary at every phase close, alongside the entries
`semantic-release` generates automatically, and ties that moment to updating the
[screen inventory](../02-design/screen-inventory.md) and
[feature index](../03-features/README.md) status columns together, so "what shipped"
answers consistently from all three places.

**Why:** an explicit requirement for changelogs, feature-completion tracking and release
documentation. A generated commit log alone doesn't answer "what can I do now that I
couldn't before"; a separate, disconnected release-notes process drifts from what the
screen inventory and feature index say. Tying the three together at one moment (the phase
close, [SDLC](../04-engineering/sdlc.md) stage 8) is cheaper than reconciling them later.

**Decided by:** Thomas

---

### 2026-09-05 · The engine pattern generalises beyond the six plugin kinds; the calendar is allowed to move, the pattern is not

**Decision:** [plugin-architecture.md § the engine pattern](../01-architecture/plugin-architecture.md#the-engine-pattern-making-any-feature-pluggable)
states explicitly that every feature — not only the six current plugin kinds — is
expected to follow the same shape (contract, registry or settings screen, generated
configuration, a feature flag, a validate/test affordance) before its spec is considered
done. Paired with this: the [accelerated delivery plan](accelerated-delivery-plan.md)'s
calendar is explicitly **not** held under pressure — Thomas: *"we can adjust the
timeline... dates are just a number... no pressure"* — while the engine-pattern
requirement and the security gates are the two things that do not flex regardless of the
calendar.

**Why:** an explicit requirement that "every feature, every release" stays pluginable, and
an equally explicit correction that the aggressive calendar in the accelerated plan should
not be read as license to cut the engine pattern or security to hit a date. Recording both
together because they are the same instruction from two directions: flex the number, not
the architecture.

**Decided by:** Thomas

---

### 2026-09-05 · Model tiers for Claude Code's own subagents; security review is Opus, always

**Decision:** within Claude Code's own orchestration of Task/Agent subagents, the main
session plans and reviews on Opus or Fable; implementation subagents write code and tests
on Sonnet 5. Security review is carved out as its own mandatory checkpoint on Opus, at
every pull request and every phase gate, distinct from the general architecture/QA review
even when the same model performs both. Recorded in
[agent-workflow.md](../04-engineering/agent-workflow.md#model-tiers-within-claude-code) and
referenced from [SDLC](../04-engineering/sdlc.md) stages 5 and the phase gate.

**Why:** an explicit requirement driven by cost and setup overhead — running every
mechanical implementation step on the most expensive model multiplies token spend for
narrowly-scoped, spec-driven work without a proportional quality gain, while the review
and security checkpoints are exactly where a stronger model earns its cost.

**Decided by:** Thomas

---

### 2026-09-05 · Reporting is three tiers, not one report builder

**Decision:** [reports-and-dashboards.md](../03-features/reports-and-dashboards.md) now
names three explicit tiers — fixed reports (the existing fourteen, unchanged), selectable
row-and-column reports (a saved [Table view](../03-features/views.md) configuration,
modelled on MS Planner's grid and Plane's spreadsheet view), and customisable reports (a
small ad-hoc builder — filter, group, aggregate, chart — modelled on Azure DevOps
Analytics and Jira dashboards, but deliberately not a query language). All three persist
through the existing `saved_view` mechanism with a different `layout`; no new storage
engine.

**Why:** an explicit requirement distinguishing three genuinely different reporting needs
that one mechanism serves badly. Reusing `saved_view` and the existing filter grammar
keeps tier 3 to "20% of the concepts, 90% of the value" — the same bar already applied to
the automation rule builder and to rejecting formula custom fields.

**Alternatives:** one fully general report/dashboard builder covering all three needs.
Rejected — this is exactly the shape [risk R8](risks.md) (scope creep) warns about, and a
general builder is where OpenProject and Jira both become, in our own words, "visually
exhausting."

**Decided by:** Thomas

---

### 2026-09-05 · AWS Marketplace is the first external sales channel; metering is an optional plugin

**Decision:** pursue an AWS Marketplace container-product listing as the first externally
sellable channel, alongside the existing self-hosted distribution. Usage metering and
entitlement resolution are built as a new `license` plugin kind
([ADR 0013](../01-architecture/adr/0013-marketplace-metering-plugin.md)), off by default,
so the self-hosted, no-phone-home promise is unaffected for every customer who does not
enable it. This effectively resolves the open "whether to sell externally" question in
[status.md](status.md) in the affirmative, with AWS Marketplace as the named first channel;
Azure and GCP marketplaces are recorded as later candidates on the same mechanism, not
committed now.

**Why:** an explicit product requirement. Packaging and seller-registration work is tracked
in [AWS Marketplace listing](../05-operations/aws-marketplace.md) and lands in P7, since it
needs a stable, feature-complete product to list; the plugin mechanism it depends on is
architecture and is decided now so nothing downstream has to be retrofitted.

**Alternatives:** metering compiled in and toggled by an environment variable. Rejected —
inverts the trust model every other plugin already establishes.

**Decided by:** Thomas

---

### 2026-09-05 · One-line installer wraps `scripts/deploy.sh`, does not replace it

**Decision:** add `curl -fsSL https://get.taskdesk.dev | bash` as the recommended install
path, documented in [One-line install](../05-operations/one-line-install.md). It downloads
a checksummed release archive and runs the existing `scripts/deploy.sh`, unchanged. The
manual `git clone` path in [Deployment](../05-operations/deployment.md) remains fully
documented and is exactly what the installer automates — there is one deployment
mechanism, not two.

**Why:** the smallest customer should be able to go from a clean machine to a signed-in
session in one command, without cloning a repository or reading `.env.example` first. The
`--dry-run` flag and the documented "download and read before piping" alternative address
the trust question a hosted `curl | bash` script always raises.

**Alternatives:** a `git clone` requirement for everyone. Rejected as an unnecessary floor
for the smallest, least technical self-hosting customer, who is exactly who this product
must also work for.

**Decided by:** Thomas

---

### 2026-09-05 · Ticket lifecycle engine and terminology are formally separated, both fully renameable

**Decision:** formalise, as [ADR 0011](../01-architecture/adr/0011-ticket-lifecycle-engine.md)
and [ADR 0012](../01-architecture/adr/0012-terminology-overlay.md), what `work-items.md`,
`workflows.md` and the data model already implied but never stated outright: there is one
lifecycle engine (states + workflow transitions) for every category of work item, with
only a five-value `group` fixed in code and every state name, transition and workflow graph
fully editable per project and per type through settings; and, separately, a bounded set of
domain nouns ("Ticket", "Project", "Cycle", …) is renameable per instance through a new
terminology overlay, independent of state naming. A `terminology_override` table is added
to the data model; no table is needed for marketplace licensing, which reuses
`instance_plugin_config`.

**Why:** confirms, in writing, that nothing about the ticket lifecycle is hardcoded the way
v1's status enum was — a direct requirement — and separates two things that are easy to
conflate: the *stages* a ticket passes through (ADR 0011) versus the *words* used to name
the concepts (ADR 0012).

**Alternatives:** leave the mechanism implicit across existing feature docs, as before.
Rejected once it became a question someone would reasonably ask "why on earth is it like
this" about — exactly the ADR criterion.

**Decided by:** Thomas

---

### 2026-09-05 · Customer self-service lifecycle reconfirmed; withdrawal added

**Decision:** reconfirm that customers create their own requests and act on their own
lifecycle in the portal — this was already the design in `customer-portal.md` and
`request-types-and-catalogue.md` (raise, comment, escalate, approve what's addressed to
them, reopen, rate), modelled deliberately on Jira Service Management's constrained-but-real
customer authority rather than a read-only view. One genuine gap is closed: a customer may
now **withdraw** their own submission before it is triaged (`CP-15`, `IQ-16a`), which was
previously unstated.

**Why:** an explicit requirement to confirm customers are not limited to viewing. The
design already met this; withdrawal was the one missing everyday action — raising something
in error with no way to retract it — worth adding explicitly rather than leaving customers
to rely on a triager noticing and declining it.

**Alternatives:** let customers delete a submission outright. Rejected — deletion removes
the record a triager needs to understand "why did this disappear", where a `withdrawn`
status preserves it.

**Decided by:** Thomas

---

### 2026-09-05 · Documentation corpus created before any code

**Decision:** write the full `docs/` corpus — architecture, design, features, engineering,
operations, planning — before writing a line of application code.

**Why:** the team is one person and three AI agents. Agents have no memory between
sessions, so the repository *is* the memory. A spec-first process is not overhead here, it
is the mechanism by which three agents produce one coherent codebase. It also forces the
hard decisions — tenancy, RBAC, plugins, SLA — to be made deliberately rather than
discovered during implementation.

**Alternatives:** start coding and document as we go — which is what v1 did, producing
excellent documentation *about* a product nobody wanted to use.

**Decided by:** Thomas

---

### 2026-09-05 · Product name provisionally "TaskDesk"

**Decision:** carry v1's name forward for now, as a placeholder.

**Why:** a name is needed for documentation and configuration. Choosing a real one is a
branding exercise that should not block the build.

**Deadline:** before P7, since branding, domains and the documentation site all assume one.

**Decided by:** Thomas

---

### 2026-09-05 · No dates on the roadmap until P1 closes

**Decision:** the roadmap sequences phases but gives no dates.

**Why:** throughput for one human plus three agents is unknown. Dates now would be fiction,
and fiction that gets planned against is worse than no plan. After P0 and P1 there is
evidence.

**Decided by:** Thomas

---

### 2026-09-05 · No arbitrary limits on navigation or form size

**Decision:** reject a cap on sidebar entries or on fields per form. Quality is gated by
progressive disclosure and by "does it look like kaneo?", not by counting.

**Why:** kaneo's shell handles a long navigation well — sections collapse, the project list
scrolls, the command palette makes depth survivable. Feature flags remove what a deployment
does not use. An arbitrary number would force bad grouping and would be gamed rather than
respected.

**Alternatives:** a hard cap, as originally proposed. Rejected as constraining the wrong
thing.

**Decided by:** Thomas

---

### 2026-09-05 · Formula and rollup custom fields deferred

**Decision:** custom fields support fixed formats only. No formulas in v2.

**Why:** a formula field is a small programming language — evaluation order, dependency
graphs, error handling, performance. It is easy to start and very hard to finish, and
OpenProject's implementation needed a dedicated error-logging mechanism, which is
indicative.

**Alternatives:** ship a limited formula subset. Rejected — a limited subset generates
immediate requests to extend it.

**Decided by:** Thomas

---

### 2026-09-05 · Round-robin assignment out of scope

**Decision:** no automatic load-balanced or round-robin assignment.

**Why:** it rewards gaming, it assigns work to people who are unavailable, and it removes
the moment of judgement where someone looks at a queue and decides. A default assignee per
project and per request type covers the real need.

**Decided by:** Thomas

---

### 2026-09-05 · Multi-currency conversion out of scope

**Decision:** store currency per row; group by currency in reports; never convert.

**Why:** conversion requires an exchange rate source, a policy on which date's rate applies,
and historical rate storage. Reporting in two currencies separately is honest; reporting a
converted total computed with an unstated rate is not.

**Decided by:** Thomas

---

### 2026-09-05 · Postgres full-text before any search engine

**Decision:** ship with Postgres full-text search. A Meilisearch plugin exists as an option
but is not enabled.

**Why:** one fewer service, one fewer thing to back up, one fewer thing to be inconsistent
with the database. Postgres full-text with a weighted GIN index is genuinely good at our
scale. Adding a search engine is a decision to be made with a measurement, not in advance.

**Decided by:** Thomas

---

### 2026-09-05 · No row-level security in Postgres

**Decision:** tenant isolation is enforced in the application, through scoped repositories
and the policy layer, not through Postgres RLS.

**Why:** RLS moves policy away from the code that gets reviewed, complicates connection
pooling, and cannot express reach-versus-authority. What we do instead is make the omission
detectable — the route coverage test, the permission matrix and the tenant isolation suite.

**Alternatives:** RLS as defence in depth. Not rejected forever; revisit if a customer
requires it for compliance.

**Decided by:** Thomas

---

### 2026-09-05 · Collaborative editing deferred past P5

**Decision:** no Hocuspocus or CRDT editing in v2. Concurrent description edits use
optimistic concurrency with a clear conflict affordance.

**Why:** it is a whole subsystem — a second server process, Y.js documents, awareness state,
persistence, conflict resolution. Plane runs it, and it is genuinely nice. We have no
evidence that people co-edit ticket descriptions.

**Decided by:** Thomas

---

## Waivers

Gate waivers, recorded per [UX quality gates](../02-design/ux-quality-gates.md).

*(None yet.)*

```markdown
### YYYY-MM-DD · Waived <gate> in PR #n
**Gate:** G-n
**Reason:**
**Follow-up:** issue #n
**Approved by:** Thomas
```

## Related

- [ADR index](../01-architecture/adr/README.md) · [Risks](risks.md) · [Status](status.md)
