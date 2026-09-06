# 0001 — kaneo as the foundation, taken once, not forked

- **Status:** Accepted
- **Date:** 2026-09-05
- **Deciders:** Thomas

## Context

TaskDesk v1 was feature-rich and unusable. Its failure was not missing capability; it was
that every UI primitive was hand-written, producing an inconsistent, dense, amateurish
interface that people avoided. Multiple AI-assisted redesign attempts improved details
without fixing the underlying absence of a design system.

We evaluated [kaneo](https://github.com/usekaneo/kaneo) and found an application whose
UI/UX is exactly the standard we want, built on a stack we would have chosen anyway:
Hono, Drizzle, PostgreSQL, better-auth, React 19, TanStack Router and Query, Tailwind v4,
63 primitives, predominantly Base UI (43 of the 63 import `@base-ui/react`; exactly one
imports Radix), dnd-kit, Tiptap, Framer Motion — plus motion design specs and UI-review
skills already written down.

kaneo is **MIT licensed**, so we may use its code without restriction beyond attribution.

The question was how to relate to it.

## Decision

**Take kaneo's code once, as the foundation of a new repository, and then own it
outright. Do not maintain a fork. Do not track upstream.**

Specifically:

- `Ticketing.v2` starts as a copy of kaneo's monorepo structure, API, web application,
  design system, Dockerfile, Helm chart, i18n and tooling configuration.
- **The snapshot is one commit, recorded once** — the SHA, why that commit, the upstream CI
  run it passed and the verification done before the copy live in
  [inherited-features.md](../inherited-features.md), not here; this ADR does not name a
  commit, so it cannot go stale against one.
- We immediately de-brand, remove what we do not want (billing, seats, trials, cloud
  abuse mitigations as always-on), and restructure what we need to change (tenancy, RBAC,
  service desk domain).
- kaneo's MIT copyright notice is retained in `THIRD-PARTY-NOTICES.md`, in `NOTICE`, and
  in the headers of files taken verbatim.
- Future kaneo releases are read for ideas and cherry-picked **manually** if genuinely
  valuable. There is no merge relationship.

## Consequences

### Positive

- We start with a finished design system rather than trying to grow one. This directly
  addresses v1's cause of death.
- We start with a working, coherent codebase: auth, realtime, boards, drag and drop,
  command palette, settings shell, i18n, Docker, Helm.
- Our roadmap is entirely our own. We can restructure the data model for organisations,
  SLAs, approvals and reach/authority RBAC without fighting anyone's upstream.
- One language, one stack, one mental model.
- No merge conflicts, ever.

### Negative

- **We do not get upstream bug fixes or features for free.** If kaneo fixes a bug in a
  component we took, we will not know unless we look. Mitigation: a quarterly review of
  kaneo's changelog, with anything relevant cherry-picked deliberately.
- **We inherit kaneo's existing bugs and design debt** without its maintainers' context.
- **We must genuinely understand the code we took.** Copying code you do not understand
  is how you get a codebase nobody can change. Phase 0 includes a deliberate
  read-and-strip pass, not just a `cp -r`.
- Attribution obligations persist forever and must survive refactoring.

### Neutral

- We are free to contribute fixes back to kaneo, and should where it is easy — but we owe
  nothing.
- The relationship is one of inspiration and provenance, not dependency.

## Alternatives considered

**Fork kaneo and track upstream.** Rejected. Every upstream release becomes a merge
against our service-desk additions, forever. Our roadmap becomes coupled to theirs. And
the changes we need — organisations as a tenant boundary, reach/authority RBAC, SLA and
approval domains — diverge so far from kaneo's model that "fork" would quickly become a
fiction while still costing merge pain.

**Use kaneo as an upstream dependency (npm packages).** Rejected. kaneo does not publish
its application as consumable packages, and even if it did, we need to change the data
model, not extend it.

**Extract only the design system and write the rest.** Rejected as unnecessarily
expensive. kaneo's API architecture, auth setup, realtime layer and build tooling are
good and would take months to reproduce at the same quality.

**Continue v1 and redesign the frontend again.** Rejected. Two redesign attempts had
already failed. The problem is structural — no design system, and a three-language,
three-service backend that makes every change expensive. Replacing the frontend alone
leaves the second problem.

**Start entirely from scratch.** Rejected. That was effectively v1's approach, and it
produced a hand-rolled UI. Starting from a finished design system is the whole point.

## Related

- [Licensing and attribution](../../00-overview/licensing-and-attribution.md)
- [ADR 0008 — single design system](0008-single-design-system.md)
- [Phases](../../07-planning/phases.md)
