# Licensing and attribution

> **Read this before copying any code from another project into this repository.**

## Our licence

**TaskDesk v2 is licensed under AGPL-3.0.**

Consequences you must understand:

- **Network-triggered copyleft.** If we host TaskDesk and users interact with it over a
  network, those users are entitled to the corresponding source. This applies to the
  customer portal, not just to redistribution of the image.
- **Whole-work copyleft.** Anything linked into the product must be AGPL-compatible.
- **Selling is still fine.** AGPL does not prevent charging. It prevents withholding
  source from users of the hosted instance.

If the commercial model later requires a proprietary edition, the options are a
dual-licence (requires a CLA from every contributor from day one) or a clean-room
re-implementation. **Decide this before external contributions are accepted.** Tracked as
a risk in [risks.md](../07-planning/risks.md).

## Upstream projects and what we may take

| Project | Licence | Compatible with AGPL-3.0? | What we take |
| --- | --- | --- | --- |
| [kaneo](https://github.com/usekaneo/kaneo) | **MIT** | Yes (MIT → AGPL is permitted) | **Code, wholesale.** Foundation of the repo. |
| [plane](https://github.com/makeplane/plane) | **AGPL-3.0** | Yes (same licence) | Code is legally reusable, but see policy below. |
| [openproject](https://github.com/opf/openproject) | **GPL-3.0** | GPL-3.0 → AGPL-3.0 is permitted | Ruby; ideas only in practice. |
| TaskDesk v1 | Ours | N/A | Anything. Domain logic especially. |
| [chatwoot](https://github.com/chatwoot/chatwoot) | MIT (core) + a separate licence for `enterprise/` | Core: yes. `enterprise/`: unclear, treat as no | Ideas only — see [competitive inspiration](competitive-inspiration.md) |
| [freescout](https://github.com/freescout-help-desk/freescout) | AGPL-3.0 | Yes (same licence) | Ideas only |
| [glpi](https://github.com/glpi-project/glpi) | **GPL-3.0** | Yes | Ideas only |
| [nocobase](https://github.com/nocobase/nocobase) | Apache-2.0 (part) + a separate proprietary-style licence (part) | Apache-2.0 part: yes. Other part: no | Ideas only — mixed licensing, verify per file if ever in doubt |
| [osTicket](https://github.com/osTicket/osTicket) | **GPL-2.0** | Yes (GPL-2.0 → AGPL-3.0 is permitted) | Ideas only |
| [zammad](https://github.com/zammad/zammad) | AGPL-3.0 | Yes (same licence) | Ideas only — the most architecturally relevant of the six, see [competitive inspiration](competitive-inspiration.md) |

## Policy — what we actually do

Legality and wisdom are different questions.

### kaneo → copy freely

kaneo is MIT and is the **foundation of this repository**. `apps/api`, `apps/web`,
`packages/ui`, `packages/permissions`, `packages/libs`, `packages/email`, the Dockerfile,
the Helm chart, the i18n structure and the design system are taken directly.

**Obligation:** MIT requires the copyright notice and permission notice be retained. We
satisfy this via `THIRD-PARTY-NOTICES.md` at the repo root and `NOTICE` in the image.
Do not delete kaneo's copyright headers from files we took verbatim.

### plane → inspiration, not copy-paste

Legally we could copy plane's TypeScript. We choose not to, for engineering reasons:

- Plane's frontend is MobX + React Router; ours is TanStack Query + TanStack Router.
  Grafting one onto the other produces two competing state models.
- Plane's data model assumes Django/DRF idioms; ours is Drizzle.
- Mixing two architectural styles is how codebases become unmaintainable.

**What we take from plane:** the *shape* of ideas — the God Mode admin concept, the
three-tier settings hierarchy, project feature toggles, numeric role ranks, the
cycles/modules/estimates model, intake. Reimplemented in our idiom.

**If you do copy a non-trivial plane file verbatim,** record it in
`THIRD-PARTY-NOTICES.md` with the source path and commit SHA. For kaneo itself the notice
carries the licence verbatim with its holder line — "MIT License — Copyright (c) 2024 Andrej
Acevski" — and the snapshot commit exactly as recorded in
[inherited-features.md](../01-architecture/inherited-features.md) (proposed upstream main
`42bb8011`, pending Thomas's confirmation).

### openproject → ideas only

Ruby on Rails. Nothing is directly portable. We borrow domain concepts:
type × role × status workflows, custom field sections, project hierarchy with role
inheritance, dual time/cost tracking with rate cards, journals for point-in-time
reconstruction, rich relation types.

### TaskDesk v1 → reimplement the domain logic

v1's `.NET` domain layer is the most valuable non-kaneo asset we have. Reimplement in
TypeScript in `packages/domain`:

- SLA engine (lazy evaluation against service calendars)
- Workflow engine (versioned state machines, transition note policies)
- Approvals and CAB gating
- Assignment rules
- Access scope (reach vs authority)
- Service calendars (8×5 / 12×5 / 24×7, holidays)
- Audit trail

Read v1's code, understand the rules, write fresh TypeScript. Do not attempt a mechanical
C#→TS transliteration; the idioms do not survive it.

### The six additional ITSM systems → ideas only, same policy as openproject

Chatwoot, FreeScout, GLPI, NocoBase, osTicket and Zammad are cloned into `ITSM/` for
reference and reviewed in [competitive inspiration](competitive-inspiration.md). None of
their code is ever pasted into this repository, for the same engineering reason as
plane — different stacks, different idioms — and, for two of them, because it would not
even be straightforwardly legal: chatwoot's `enterprise/` directory and part of nocobase
are **not** under an OSI-approved licence. Treat every file in those two repositories as
"look, do not touch" until proven otherwise, and never assume the rest of a mixed-licence
repository is safe merely because most of it is.

## Rules for contributors and AI agents

1. **Never paste code from a source not listed above** without checking its licence and
   recording it in `THIRD-PARTY-NOTICES.md`.
2. **Never paste code from Stack Overflow, a blog, or a model's memory of a proprietary
   codebase** into this repository.
3. **kaneo-derived files keep their copyright headers.** If you rewrite a file so
   thoroughly that nothing of kaneo's remains, you may remove the header — but say so in
   the commit message.
4. **When in doubt, ask.** A licensing mistake found at audit time is far more expensive
   than a question.

## Required repo-root files

| File | Contents |
| --- | --- |
| `LICENSE` | AGPL-3.0 full text |
| `THIRD-PARTY-NOTICES.md` | kaneo MIT notice; any other copied source with path + SHA |
| `NOTICE` | Short attribution, baked into the container image |
| `AGENTS.md` | Points every AI agent at this document |

## Related

- [ADR 0001 — kaneo as foundation](../01-architecture/adr/0001-kaneo-as-foundation.md)
- [ADR 0005 — AGPL-3.0 licensing](../01-architecture/adr/0005-agpl-licensing.md)
