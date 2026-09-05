# Product principles

Nine rules. When a decision is contested, the higher-numbered principle yields to the
lower-numbered one.

---

## 1. The interface is the product

A feature that exists but is unpleasant to use has negative value: it costs
maintenance and it makes the product feel worse. v1 proved this.

**In practice:** no feature merges without passing the
[UX quality gates](../02-design/ux-quality-gates.md). "Functionally complete" is not
complete.

---

## 2. Steal the design system, don't design one

We are not a design team. kaneo already solved this: 60+ Radix-based primitives,
Tailwind v4 tokens, Geist typography, motion specs, dark mode, and a coherent visual
language across boards, lists, settings and dialogs.

**In practice:** `packages/ui` is the only place UI primitives may live. A raw
`<button>`, a hex colour, or a bespoke dropdown outside that package is a lint error.
If a primitive is missing, add it *to `packages/ui`* — never inline.

---

## 3. Configuration, not compilation

We ship one image. A customer's identity provider, branding, enabled features, roles,
workflows, SLA policies, notification channels and storage backend are **runtime data**,
edited in God Mode by an administrator.

**In practice:** if you are about to write `if (process.env.CUSTOMER === …)` or add a
provider-specific code path, stop and add a registry entry instead. This is not limited to
the plugin registry's current six kinds — it is a shape every feature follows. See
[Plugin architecture § the engine pattern](../01-architecture/plugin-architecture.md#the-engine-pattern-making-any-feature-pluggable).

---

## 4. Deny by default, and prove it

Every route declares the capability it requires, at definition time. A route with no
declared policy fails the build. Every role × route combination is asserted in a
permission matrix test.

**In practice:** v1 shipped 11 authorization holes past a green test suite. The fix is
not "be careful", it is making the omission mechanically detectable. See
[Security model](../01-architecture/security-model.md).

---

## 5. Reach and authority are separate

*Which* projects you can see is a different question from *what* you may change in them.
Conflating them means widening someone's visibility silently widens their power.

**In practice:** `packages/permissions` models these as two axes. Inherited from v1,
which got this right. See [RBAC](../01-architecture/rbac.md).

---

## 6. Every screen has a URL

Anything a user can see must be linkable, bookmarkable, back-buttonable and
middle-clickable. No modal-only state, no tab state that lives in React alone.

**In practice:** a route registry with a round-trip test. Filters, tabs, lenses and
selected records are URL state.

---

## 7. Finish one phase before starting the next

v1 had 25 screens at 60% each. That is worse than 15 screens at 100%.

**In practice:** a phase is done when its features pass the Definition of Done, including
UX gates and E2E tests. Only then does the next phase start. See
[Phases](../07-planning/phases.md).

---

## 8. Honest data beats flattering data

If there is not enough data to compute a metric, say so. Never show `0%` or `100%` for
"unknown". Never average away an outlier that matters.

**In practice:** metrics return `null` for insufficient data and the UI renders
"not enough data" with the sample size. Inherited from v1, which got this right.

---

## 9. Boring technology, current versions

Postgres, Hono, React, Tailwind, Drizzle. Nothing exotic. But kept current — Node 24,
React 19, Tailwind v4 — because falling behind is its own kind of debt.

**In practice:** no new runtime dependency without an entry in the
[decision log](../07-planning/decision-log.md) explaining what it replaces.

---

## Anti-principles

Things we explicitly are **not** optimising for:

- **Not** feature parity with Jira on day one.
- **Not** horizontal scale beyond a few thousand users per tenant. Single-container
  plus Postgres is the target; we will solve scale when we have it.
- **Not** offline support.
- **Not** a public API stability guarantee before v2.0 ships.
- **Not** upstream-mergeable with kaneo. We took the code once and it is ours now.
