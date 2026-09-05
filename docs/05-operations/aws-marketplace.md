# AWS Marketplace listing

- **Status:** ⬜ Planned — P7
- **Depends on:** [ADR 0013 — marketplace metering plugin](../01-architecture/adr/0013-marketplace-metering-plugin.md), a feature-complete product

Researched against AWS's current (2026-09-05) Marketplace seller documentation. AWS
updates these pages on its own schedule with no version number — reconfirm the specifics
below directly against `docs.aws.amazon.com/marketplace` before actually submitting a
listing, rather than treating this document as a frozen source of truth.

## Listing type: container product, not SaaS, not AMI

TaskDesk runs entirely inside the **customer's own AWS account**, with no control plane we
operate. AWS's own SaaS architecture rules require a SaaS listing's control plane to sit in
infrastructure the *seller* manages — otherwise AWS classifies it as a "managed service,"
not SaaS — so a purely self-hosted product does not qualify for a SaaS listing. A
standalone AMI listing is not needed either, since we ship a container, not a VM image.

**The fit is a Container-based product**: the Docker image plus the Helm chart as a
"delivery option," deployable on EKS, ECS, Fargate, EKS Anywhere, ECS Anywhere, ROSA,
self-managed on-prem Kubernetes, or plain EC2. A product may declare up to four delivery
options — worth knowing if a bare-Compose delivery option is ever added alongside Helm.

## Security review is automatic and mandatory

Every "Add Version" submission gets an AWS-run, layer-by-layer static vulnerability scan;
critical or remotely-exploitable findings block publishing outright. AWS recommends
pre-scanning with a tool such as Trivy — which [Security model](../01-architecture/security-model.md)
already runs in CI — before ever submitting. Mandatory container policies, all already
consistent with our own [security model](../01-architecture/security-model.md):

- No known vulnerabilities, malware, or end-of-life packages in the image.
- **No embedded AWS credentials, ever** — IAM roles for service accounts (IRSA on EKS) or
  IAM roles for tasks (ECS) only.
- Least-privilege IAM, non-root containers by default.
- No hardcoded secrets, and no password-based auth for any bundled service — including a
  generated or reset password. `auth.password` in our own [plugin
  architecture](../01-architecture/plugin-architecture.md) is administrator-configured at
  runtime, never a bundled default credential, so this is already satisfied.

**AWS Marketplace Vendor Insights** — a security self-assessment with optional third-party
certifications (SOC 2, ISO 27001, PCI-DSS, HIPAA, FedRAMP) — is a **SaaS-only** feature and
does not apply to a container-product listing. Its automated-evidence option is being
phased out via AWS Audit Manager's own maintenance-mode transition regardless, so it is not
a gap worth chasing here.

## Metering and entitlement

Handled entirely by the `license.aws-marketplace` plugin from
[ADR 0013](../01-architecture/adr/0013-marketplace-metering-plugin.md), which:

- Resolves the buyer's entitlement via the AWS Marketplace **Entitlement Service**.
- Meters usage via the AWS Marketplace **Metering Service** — `MeterUsage` for a
  self-defined pricing dimension (for example, active-agent-seats per month), or
  `RegisterUsage` for AWS's own per-running-task/pod hourly metering.
- For a contract or annual-commit price instead of metered usage, integrates **AWS License
  Manager**, which holds the entitlement but performs no metering of its own — that
  responsibility stays with the plugin.

Both metering calls must resolve the AWS region dynamically at runtime (a hardcoded region
throws `InvalidRegionException`) and must authenticate via an IAM role, never an embedded
key — consistent with the container-security policy above and with [security
model](../01-architecture/security-model.md)'s existing secret-handling rules.

**Anti-tamper requirement, worth designing for from the start:** a seller must ensure a
buyer cannot bypass or substitute the metering call — for example by editing a Helm value
or overriding the container entrypoint — and must not let a free product code stand in for
a paid one. The `license` plugin's configuration should not be reachable or overridable
through any Helm value a buyer would normally touch.

## Helm chart requirements

AWS validates the chart at submission:

- Image references live only in `values.yaml`, as variables — never hardcoded elsewhere in
  a template.
- `helm lint` and `helm template` must pass cleanly, against Helm ≥ 3.19.0.
- **Every image the chart references — including open-source dependencies — must be pushed
  into the AWS-Marketplace-owned ECR repository created for the listing.** Docker Hub,
  Quay, or a public ECR reference is not accepted. This affects our own Helm chart's
  dependency images (for example, a Traefik or PgBouncer sidecar, if either is ever
  bundled by the chart rather than left to the cluster operator) and should be checked
  explicitly when the chart is finalised, not assumed away.
- A ServiceAccount the chart creates by default (`serviceAccount.create=true`), with
  narrowly-scoped RBAC — named `resourceNames`, never a wildcard.

## AGPL and the buyer's own obligation

None of AWS's container, AMI or SaaS policy pages address open-source licence type one way
or the other — it is not a stated blocker, but it is also not confirmed as a non-issue by
AWS itself, and is worth a direct question to AWS Partner / Marketplace Business
Development before relying on the assumption.

What is certain regardless of AWS's position: **AGPL's network-copyleft obligation lands
on the buyer, not on us** — see [ADR 0013](../01-architecture/adr/0013-marketplace-metering-plugin.md)
and [Licensing and attribution](../00-overview/licensing-and-attribution.md). A company
that procures TaskDesk through AWS Marketplace and offers *their own* users a service built
on it must, in turn, make the corresponding source available to those users. The listing
description and buyer-facing documentation must say this plainly — it is easy for a buyer
unfamiliar with AGPL to miss, and a support conversation is a bad place to discover it.

## Seller registration checklist

1. Confirm the seller's country is eligible for direct AWS Marketplace registration
   (unsupported countries must sell through a reseller).
2. A dedicated seller AWS account, least-privilege IAM, root access locked down.
3. Company profile: display name, site, a short bio, and a logo (≤ 500 KB, SVG or PNG,
   300×150).
4. Tax forms — W-9 for a US entity, W-8BEN or W-8BEN-E plus VAT/GST details otherwise.
5. A US bank account, or a Hyperwallet virtual account, for payouts.
6. Accept the AWS Marketplace Seller Terms and Conditions.
7. In the Marketplace Management Portal: **Product → Server → Create server product →
   Container** — generate the product ID and code, add the dedicated ECR repository, add
   the initial version, wire up `MeterUsage`/`RegisterUsage` or License Manager if the tier
   is paid, and submit an "Update visibility" request from Limited to Public once AWS
   Seller Operations review passes.
8. A paid listing is required to start at a placeholder price (commonly $0.01) for internal
   testing before the real price is set at go-public.
9. Default listing cap is 20 public container-product listings per seller account; a higher
   cap is discretionary and tied to seller performance.

## Timing

This is packaging and seller-operations work layered on a finished product, not
application-level engineering — it lands in [P7](../07-planning/phases.md), after the
product is feature-complete and the Helm chart is already the release artefact for every
other Kubernetes target. Registration itself (steps 1–6 above) has its own lead time and
can start in parallel with the last weeks of P7 rather than waiting for it to close — see
[roadmap.md](../07-planning/roadmap.md)'s deadline table.

## Related

- [ADR 0013 — marketplace metering plugin](../01-architecture/adr/0013-marketplace-metering-plugin.md)
- [Deployment](deployment.md) · [Licensing and attribution](../00-overview/licensing-and-attribution.md)
- [Security model](../01-architecture/security-model.md)
