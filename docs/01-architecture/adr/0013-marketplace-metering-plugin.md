# 0013 — Marketplace listing and usage metering are an optional plugin, never a default

- **Status:** Accepted — *addendum 2026-09-05:* the marketplace listing itself is deferred
  beyond the current three-to-four-month scope, and when it comes, a **BYOL / contract**
  listing is preferred over usage metering. This ADR's decision (metering is an optional
  plugin, never a default) stands unchanged; only the expected first listing type moved
- **Date:** 2026-09-05
- **Deciders:** Thomas

## Context

The product should be listable on AWS Marketplace — and, later, possibly Azure or GCP
marketplaces — so a customer can discover, procure and pay for it through infrastructure
they already trust and already have a billing relationship with. Cloud marketplace
container listings typically expect one of: a flat bring-your-own-licence (BYOL) listing
with no usage reporting, or a metered listing that reports consumption to the
marketplace's own metering service (AWS Marketplace Metering Service, for a paid tier
billed per hour or per seat) so the vendor gets paid through the marketplace rather than
billing the customer directly.

This collides with something the product has promised since
[ADR 0006](0006-plugin-registry.md): **one image, any customer**, self-hosted, AGPL, with
no phone-home. A customer who has never heard of AWS Marketplace must get an identical
image, behaving identically, with nothing reporting anywhere. Building marketplace
metering *into* the application as a standing feature would either force it on everyone or
require an environment variable to turn it off — both of which are exactly the pattern
[ADR 0006](0006-plugin-registry.md) exists to prevent.

## Decision

**Marketplace entitlement and usage metering is a plugin, of a new kind: `license`.**

- `license.none` — the default. No entitlement check, no metering, no network call to
  anywhere related to licensing. Feature availability is governed entirely by the existing
  `instance_feature_flag` mechanism from
  [plugin-architecture.md](../plugin-architecture.md), configured directly by whoever
  administers the instance. This is what every self-hosted deployment runs unless someone
  deliberately changes it.
- `license.aws-marketplace` — an optional plugin an administrator enables and configures
  with AWS Marketplace product and customer identifiers. Once active, it:
  - Resolves the buyer's entitlement (which tier they purchased) via the AWS Marketplace
    Entitlement Service.
  - Emits usage records to the AWS Marketplace Metering Service on a schedule, exactly like
    any other scheduled job — `croner` plus the `job_lease` table from
    [ADR 0007](0007-in-process-jobs.md), no bespoke scheduling mechanism.
  - Sets `locked` instance feature flags to match the purchased tier, reusing the same
    locking mechanism [ADR 0006](0006-plugin-registry.md) already defined for vendor
    tiering — **no new tiering mechanism is introduced.**
  - Implements the same `validate()` / `test()` contract as every plugin (
    [plugin-architecture.md](../plugin-architecture.md)): a test emits a zero-value
    heartbeat usage record so an administrator can confirm metering actually works before
    relying on it for billing.
  - Credentials are stored exactly like any other plugin secret: encrypted at rest, never
    returned by the API.
- `license.azure-marketplace` / `license.gcp-marketplace` are left as future entries of the
  same kind, added without redesign if and when those listings are pursued.
- **The container image is identical everywhere.** The image published to AWS
  Marketplace's ECR repository is the same artefact published to Docker Hub. Marketplace
  packaging (a CloudFormation quick-launch template, a listing description, a security
  self-assessment, buyer-facing documentation) is process and packaging work, tracked in a
  dedicated operations document, not an application-level concern — see
  [AWS Marketplace listing](../../05-operations/aws-marketplace.md).

## Consequences

### Positive

- **The self-hosted, AGPL promise is kept exactly.** No plugin, no phone-home, ever, unless
  an administrator explicitly enables one — which is the same trust model every other
  plugin kind already has.
- **One image serves every route to market.** A free self-hosted user, a customer who
  procured through AWS Marketplace, and a future Azure Marketplace customer all run the
  same build.
- **No new tiering mechanism.** Marketplace-driven entitlement rides on the `locked`
  feature-flag mechanism that already exists for exactly this purpose.
- Future marketplaces are additive — a new plugin in the `license` kind — not a redesign.

### Negative

- **Marketplace container-product listings expect artefacts beyond the application**: a
  CloudFormation quick-launch template, a documented security posture (AWS Marketplace
  Vendor Insights / ISV workload qualification, per current AWS requirements — see the
  operations document for specifics as they stand at listing time, since marketplace
  requirements move faster than this ADR should be revised), and a committed support and
  patch cadence. This is real, ongoing sales-engineering work, not a one-time task.
- **AGPL's network-copyleft obligation lands on the buyer, not us**, and is easy for a
  buyer to miss: a company that procures our AGPL image through AWS Marketplace and then
  offers *their own* users a service built on it must, in turn, make the corresponding
  source available to those users. The Marketplace listing description and the buyer-facing
  documentation must say this plainly. See
  [Licensing and attribution](../../00-overview/licensing-and-attribution.md).
- **Metering correctness is a billing-integrity problem, not just an engineering one** — a
  missed or duplicated usage record either underbills us or overbills a customer.
  Mitigated by idempotent usage records (see the outbox pattern already used for
  webhooks — [data model](../data-model.md)), by the `test()` heartbeat, and by treating a
  failed metering send as a job-retry case rather than a silent drop.

- **Metering integrity is contractual, not technical, in a self-hosted AGPL product.** The
  buyer is the instance administrator and may lawfully modify the source, so AWS's
  "buyer cannot bypass metering" requirement cannot be met structurally. Recorded as
  **R18** in [risks.md](../../07-planning/risks.md); the recommended resolution is a BYOL /
  contract listing where the plugin resolves entitlement only and meters nothing.
- **AGPL §6 applies to the Marketplace image**, not only §13: shipping the image to a buyer
  is distribution, so the corresponding source for that exact build is linked from the
  listing — the same SHA the image's provenance attestation names.
- If a metered dimension is ever chosen: `MeterUsage` (aggregate, seat-based) runs under a
  lease on one replica like any other job; `RegisterUsage` (per running task) must run
  **unleased on every replica** at start — the opposite of the lease model — and the plugin
  says which it does.

### Neutral

- Whether an AMI-based listing is pursued alongside, or instead of, a container-product
  listing is a packaging decision with no bearing on this plugin architecture, and is left
  to [AWS Marketplace listing](../../05-operations/aws-marketplace.md).

## Alternatives considered

**A separate "Marketplace edition" build with metering compiled in.** Rejected — recreates
the N-codebases problem [ADR 0006](0006-plugin-registry.md) exists to eliminate, and means
a security patch must be built and released twice.

**Metering on by default, disabled via an environment variable for self-hosted
deployments.** Rejected. It inverts the trust model: the default behaviour of every other
plugin in this system is "does nothing until an administrator configures it," and licensing
telemetry is exactly the kind of thing that must not default to on.

**List only on AWS Marketplace via an AMI, skipping a container-product listing
entirely.** Not rejected, genuinely open — recorded as a packaging decision for the
operations document, since it does not change anything decided here.

## Related

- [ADR 0006 — Plugin registry](0006-plugin-registry.md) · [Plugin architecture](../plugin-architecture.md)
- [ADR 0007 — In-process jobs](0007-in-process-jobs.md)
- [AWS Marketplace listing](../../05-operations/aws-marketplace.md)
- [Licensing and attribution](../../00-overview/licensing-and-attribution.md)
