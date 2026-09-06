# Roadmap

Stages in order, with what each unlocks and what it retires. Detail in
[phases.md](phases.md).

**No dates here, on principle** — the stage sequence below is the reference for what each
stage *is* and what "done" means for it, independent of any calendar.

A **dated** mapping of this same scope onto a real Sept–Dec 2026 calendar, at Thomas's
explicit request and with every quality-gate trade-off named, lives separately in
[accelerated-delivery-plan.md](accelerated-delivery-plan.md) — read that for "what ships
by which date," and this page for "what does each stage actually mean."

## Sequence

```
P0 Foundation          ─┐
P1 Core work            │  retires: MS Planner
P2 Service desk         │  retires: Power Apps ticketing
P3 Portal + identity    │  ← the differentiator
P4 Governance           │  ← "one image, any customer" becomes true
P5 Insight + agile      │  retires: Jira, Plane
P6 Import + cutover     │  retires: Azure DevOps
P7 Polish              ─┘  ← externally sellable
```

## What each stage makes possible

| Stage | After it, we can… |
| --- | --- |
| **P0** | Build features without accumulating design debt |
| **P1** | Run a team's work here, and prefer it |
| **P2** | Run a real support queue with SLAs and approvals |
| **P3** | Let customers self-serve; deploy into any identity landscape |
| **P4** | Hand the image to a customer and configure it entirely in the UI |
| **P5** | Answer "how are we doing?" in thirty seconds |
| **P6** | Switch the five old systems off |
| **P7** | Sell it |

## Retirement plan

| System | Retired after | Because |
| --- | --- | --- |
| MS Planner | P1 | Core work management covers everything it did |
| Power Apps ticketing | P2 | Request types, intake and SLA replace it |
| Jira | P5 | Needs cycles, estimates and reporting first |
| Plane | P5 | Same |
| Azure DevOps | P6 | Needs the importer, and it holds the most history |

Nothing is switched off before its replacement is finished. Running two systems briefly is
uncomfortable; running one that does not do the job is worse.

## Beyond P7 — candidates, not commitments

Recorded so they are not forgotten, and explicitly *not* scheduled.

| Candidate | Why it is not in scope yet |
| --- | --- |
| **Collaborative editing** (Hocuspocus / CRDT) | A whole subsystem. Wait for evidence people actually co-edit descriptions |
| **SAML** | better-auth does not cover it; no broker is in scope either — Microsoft Entra OIDC only in core delivery (deferral table below) |
| **LDAP / Active Directory sync** | Same |
| **Inbound email to ticket** | Genuinely useful, genuinely fiddly. Parsing, threading, spam, spoofing |
| **Formula and rollup custom fields** | A small language. Easy to start, hard to finish |
| **Mobile applications** | The responsive portal should be measured first |
| **AI: classification, duplicate detection, summarisation** | Plugin contracts exist; the feature does not. Many customers will not permit it |
| **AI: draft articles from resolved tickets** | Promising, and needs care not to publish nonsense |
| **Multi-language knowledge base** | Wait until there is a second language in use |
| **Public status page** | Adjacent product |
| **Asset management / CMDB** | Deliberately out of scope — see [service management](../03-features/service-management.md) |
| **Multi-currency conversion** | Needs an exchange rate source and a policy on when rates apply |
| **Read replicas, sharding, multi-region** | Solve when measured, not before |
| **Third-party plugin loading** | Contracts are shaped for it; sandboxing and supply chain are not solved |
| **Azure Marketplace / GCP Marketplace listings** | Same `license` plugin kind as AWS ([ADR 0013](../01-architecture/adr/0013-marketplace-metering-plugin.md)); no architecture work needed, only packaging, once AWS is proven |

### Explicitly deferred beyond the current three-to-four-month scope (decided 2026-09-05)

Recorded so no implementation agent "helpfully" builds them early. Each has its extension
point in place and nothing else.

| Deferred | Position | Revisit when |
| --- | --- | --- |
| **Antivirus / malware scanning of attachments** | Not built, not installed. Accepted residual risk stated in [attachments.md](../03-features/attachments.md); the allowlist, magic-byte check, separate files origin and download headers stand | Unknown external users can upload, or a customer/security requirement asks |
| ~~**PostgreSQL row-level security**~~ **Moved into P0 as a prototype** (2026-09-06) on `work_item`, `comment`, `attachment` — a backstop, never the primary control ([multi-tenancy.md](../01-architecture/multi-tenancy.md)) | A compliance-sensitive customer requires database-level defence in depth |
| **AWS Marketplace** | Not implemented, and **not a P7 task**. When a listing decision is taken, prefer a **BYOL / contract** listing over self-hosted usage metering ([aws-marketplace.md](../05-operations/aws-marketplace.md), [ADR 0013](../01-architecture/adr/0013-marketplace-metering-plugin.md)) | After the current scope closes — a separate listing decision |
| **Notification / chat integrations** | Future only, in this order: **Email is core**; then Microsoft Teams → Slack → Telegram → Viber → others. Inherited kaneo Slack/Discord/Telegram routers are removed at fork | After P4, one at a time, each as a `notify.*` plugin |
| **Developer-tool integrations** | Future only: GitHub → GitLab → Gitea → Bitbucket → Azure DevOps. Inherited kaneo GitHub/Gitea routers are removed at fork; `external_link` is the extension point | After P4 |
| **Public boards** | **Removed completely in P0** — not deferred as dormant code; a future feature needs its own spec and security review | If ever |
| **Customer self-service IdP configuration** | Instance administrators configure every customer connection in the first release ([identity-provisioning.md](../03-features/identity-provisioning.md) `IP-5`) | A separate spec, security review, validation workflow and approval model |
| **Further identity providers** (Okta, Keycloak, Google Workspace, generic OIDC, other SCIM sources) | Same `identity_connection` architecture; **Microsoft Entra only** in core delivery | Provider by provider, after Entra is proven |
| **SCIM `/Bulk`** | Not implemented | Only if Entra interoperability testing proves it necessary |

## Decisions with deadlines

| Decision | By when | Consequence of not deciding |
| --- | --- | --- |
| **CLA, for a possible dual licence** | Before the first external contribution is merged | Retrofitting requires tracking down every contributor, or rewriting their work |
| **Product name** | Before P7 | Branding, domains and documentation all assume one |
| ~~Whether to sell externally~~ **Decided:** yes — but the AWS Marketplace listing itself is **deferred beyond the current scope** (2026-09-05), BYOL/contract preferred when it comes | — | See [decision log](decision-log.md) and [AWS Marketplace listing](../05-operations/aws-marketplace.md) |
| **AWS Marketplace seller registration** | Only once a P7 listing decision is taken — the listing is **deferred** beyond the current scope (2026-09-05) | Registration and AWS's security review have their own lead time, so when the decision comes, start it before the product is feature-complete; BYOL/contract preferred |
| **PITR / WAL archiving** | Before real customer data lands | Determines the achievable RPO |

Tracked in [risks.md](risks.md).

## How progress is tracked

- [status.md](status.md) — the live picture, updated at the end of every session
- [screen-inventory.md](../02-design/screen-inventory.md) — every screen with its stage and status
- [03-features/README.md](../03-features/README.md) — feature status
- Stage reviews — written at each stage close, **including what went wrong**

## The one thing that must not happen

**Do not start a stage before the previous one is finished.**

v1 had twenty-five screens at roughly sixty per cent each, and it died of it. Fifteen
screens at a hundred per cent would have been a product. Every pressure in a project pushes
toward breadth, because breadth is visible and depth is not.

This is [product principle 7](../00-overview/product-principles.md), and it is the one most
likely to be quietly broken.

## Related

- [Stages](phases.md) · [Status](status.md) · [Risks](risks.md)
- [Vision](../00-overview/vision.md)
