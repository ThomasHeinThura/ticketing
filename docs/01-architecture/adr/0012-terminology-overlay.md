# 0012 — Terminology overlay: renameable nouns, separate from renameable states

- **Status:** Accepted
- **Date:** 2026-09-05
- **Deciders:** Thomas

## Context

Every tool we studied has opinions about what to call things, and bakes those opinions
into every string in the product. kaneo says "Task". Plane says "Issue" and "Cycle".
OpenProject says "Work package". Jira Service Management says "Request" to a customer and
"Issue" to an agent. v1 said "Ticket" everywhere, in the UI, in email templates, and in
support documentation, and changing it would have meant a find-and-replace across a
codebase.

We ship **one image to every customer** ([ADR 0006](0006-plugin-registry.md)). Two
customers may reasonably want the same product to say "Ticket" and "Case" respectively, or
"Sprint" instead of "Cycle", without either commissioning a fork or waiting for a release.
This is a distinct problem from [ADR 0011](0011-ticket-lifecycle-engine.md), which makes
*state names* ("Resolved", "Fixed") fully data-driven per project. ADR 0011 covers the
stages a work item passes through. This ADR covers the **nouns** used to name the concepts
themselves — work item, project, cycle, epic — which are hardcoded today in every system
we looked at, our own v1 included.

## Decision

**A bounded, enumerated set of domain nouns is overridable per instance (and, where it
matters, per workspace), rendered through the existing i18n layer as an override on top of
the built-in translation — never a second templating system, and never an arbitrary
free-text key.**

- `terminology_override` (`scope: instance | workspace`, `workspace_id` nullable,
  `term_key`, `locale`, `singular`, `plural`) stores administrator-supplied labels for a
  **fixed, enumerated list of term keys** defined in code —
  `work_item`, `project`, `cycle`, `module`, `epic`, `sprint` *(alias of `cycle`)*,
  `request`, `submission`, `service`, `change` — not an open dictionary. Adding a new
  overridable noun is a small, reviewed code change to the enumeration; it is never an
  admin typing an arbitrary key.
- Overrides are entered in **God Mode → General → Terminology**, with a live preview
  panel showing a sample screen re-rendered with the new nouns before saving — the same
  discipline the request-type form builder already applies to its live preview
  ([request-types-and-catalogue.md](../../03-features/request-types-and-catalogue.md)).
- Rendering resolves **`workspace override → instance override → built-in locale
  string`**, per locale, mirroring the feature-flag precedence already established in
  [plugin-architecture.md](../plugin-architecture.md).
- **The API is never affected.** Every response, resource path and OpenAPI schema uses the
  stable internal key (`work_item`, `project`, …) permanently. Only the *rendered label* in
  the UI, in outgoing email and in notification text changes. A customer's API integration
  does not break when they rename "Ticket" to "Case".
- Portal-facing terminology (see `customer-portal.md`'s `CP-5`: *"request", not "work
  item"*) is itself just the default override applied to the `customer` portal scope — a
  special case of this mechanism, not a separate one.

## Consequences

### Positive

- A customer says "Case" instead of "Ticket", or "Sprint" instead of "Cycle", entirely in
  the UI, with no rebuild and no support ticket to us.
- Reuses the i18n pipeline that already exists rather than inventing a second one — an
  override is simply another translation source, resolved with higher precedence than the
  shipped locale file.
- Because the term-key set is enumerated in code, it is exhaustively tested: a snapshot
  test can assert every screen re-renders correctly under a worst-case override (very long
  strings, a plural that looks nothing like the singular) without needing to enumerate
  every possible customer's actual words.
- Distinguishes the product from every reviewed competitor, none of which expose renaming
  of these nouns to an administrator at runtime.

### Negative

- **Grammar does not follow automatically across locales.** An override supplied for
  `en-US` says nothing about how the equivalent noun pluralises or declines in `de-DE` or
  `ja-JP`. Mitigated by scoping overrides per locale (an admin who cares about a non-English
  deployment sets the override once per locale they support) and by falling back cleanly
  to the shipped translation for any locale with no override.
- **Support and documentation drift from what the customer actually sees.** A screenshot in
  our own docs says "Ticket"; the customer's screen says "Case". Mitigated by keeping the
  default English noun and the internal key visible in tooltips and `aria-label`s, so a
  support agent can always ask "what does your instance call a Ticket?" and orient
  instantly, and by our public documentation always using the default vocabulary and
  saying so.
- **A half-considered rename can produce an ungrammatical UI** ("1 Case" vs "1 Cases" if an
  admin leaves the plural equal to the singular). Mitigated by the live preview surfacing
  exactly this before save, not by restricting what an admin may type.

### Neutral

- This is additive to, and independent of, [ADR 0011](0011-ticket-lifecycle-engine.md).
  A deployment can rename every state without touching terminology, rename terminology
  without touching states, or both.

## Alternatives considered

**Per-customer build-time string replacement or a forked locale file per customer.**
Rejected — recreates the N-codebases problem [ADR 0006](0006-plugin-registry.md) exists to
eliminate, and forked locale files drift the moment either the base translation or the
customer's fork is updated.

**An unrestricted, admin-defined dictionary of arbitrary keys.** Rejected. An unbounded
surface cannot be typed, cannot be exhaustively tested, and reliably ends with half the UI
overridden and half not, which reads as broken rather than customised.

**Treat a customer's preferred vocabulary as a new locale (a "fake language").** Rejected —
it conflates translation (a linguistic concern, owned by `i18n/`) with branding (an
instance-configuration concern, owned by God Mode), and would require maintaining a
complete parallel locale file per customer rather than a handful of noun overrides.

## Related

- [ADR 0011 — Ticket lifecycle engine](0011-ticket-lifecycle-engine.md)
- [ADR 0006 — Plugin registry](0006-plugin-registry.md) · [Plugin architecture](../plugin-architecture.md)
- [God Mode](../../03-features/god-mode.md) · [Customer portal](../../03-features/customer-portal.md)
