# Roadmap

Phases in order, with what each unlocks and what it retires. Detail in
[phases.md](phases.md).

**No dates here, on principle** — the phase sequence below is the reference for what each
phase *is* and what "done" means for it, independent of any calendar.

A **dated** mapping of this same scope onto a real Sept–Dec 2026 calendar, at Thomas's
explicit request and with every quality-gate trade-off named, lives separately in
[accelerated-delivery-plan.md](accelerated-delivery-plan.md) — read that for "what ships
by which date," and this page for "what does each phase actually mean."

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

## What each phase makes possible

| Phase | After it, we can… |
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
| **SAML** | better-auth does not cover it. Keycloak-as-broker serves the need meanwhile |
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

## Decisions with deadlines

| Decision | By when | Consequence of not deciding |
| --- | --- | --- |
| **CLA, for a possible dual licence** | Before the first external contribution is merged | Retrofitting requires tracking down every contributor, or rewriting their work |
| **Product name** | Before P7 | Branding, domains and documentation all assume one |
| ~~Whether to sell externally~~ **Decided:** yes, via AWS Marketplace first | — | See [decision log](decision-log.md) and [AWS Marketplace listing](../05-operations/aws-marketplace.md) |
| **AWS Marketplace seller registration** | Before P7 closes | Registration and the security review have their own lead time; start before the product is feature-complete |
| **PITR / WAL archiving** | Before real customer data lands | Determines the achievable RPO |

Tracked in [risks.md](risks.md).

## How progress is tracked

- [status.md](status.md) — the live picture, updated at the end of every session
- [screen-inventory.md](../02-design/screen-inventory.md) — every screen with its phase and status
- [03-features/README.md](../03-features/README.md) — feature status
- Phase reviews — written at each phase close, **including what went wrong**

## The one thing that must not happen

**Do not start a phase before the previous one is finished.**

v1 had twenty-five screens at roughly sixty per cent each, and it died of it. Fifteen
screens at a hundred per cent would have been a product. Every pressure in a project pushes
toward breadth, because breadth is visible and depth is not.

This is [product principle 7](../00-overview/product-principles.md), and it is the one most
likely to be quietly broken.

## Related

- [Phases](phases.md) · [Status](status.md) · [Risks](risks.md)
- [Vision](../00-overview/vision.md)
