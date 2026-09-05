# Architecture Decision Records

An ADR records a decision that was **hard to make and expensive to reverse**, with the
context that made it the right call at the time.

Write one when: the decision constrains future work, a reasonable engineer would ask
"why on earth is it like this?", or you spent more than an hour choosing.

Do **not** write one for: library choices with no lock-in, naming, or anything you would
happily change next week.

## Format

```markdown
# NNNN — Title

- **Status:** proposed | accepted | superseded by [NNNN](…) | deprecated
- **Date:** YYYY-MM-DD
- **Deciders:** …

## Context
What is true that forces a decision. Constraints, requirements, prior pain.

## Decision
What we are doing. Present tense, definite.

## Consequences
### Positive
### Negative        ← be honest; an ADR with no downsides is marketing
### Neutral

## Alternatives considered
Each with why it was rejected.
```

## Index

| # | Title | Status |
| --- | --- | --- |
| [0001](0001-kaneo-as-foundation.md) | kaneo as the foundation, taken once, not forked | Accepted |
| [0002](0002-single-backend.md) | One backend, not three | Accepted |
| [0003](0003-better-auth-primary.md) | better-auth primary, identity providers as runtime plugins | Accepted |
| [0004](0004-two-portals-two-origins.md) | Two portals, two origins, one codebase | Accepted |
| [0005](0005-agpl-licensing.md) | AGPL-3.0 | Accepted |
| [0006](0006-plugin-registry.md) | Runtime plugin registry over build-time configuration | Accepted |
| [0007](0007-in-process-jobs.md) | In-process scheduled jobs, no worker service | Accepted |
| [0008](0008-single-design-system.md) | One design system package, no bespoke primitives | Accepted |
| [0009](0009-lazy-sla-evaluation.md) | SLA computed on read, never stored | Accepted |
| [0010](0010-route-policy-registry.md) | Every route declares its policy; CI enforces it | Accepted |
| [0011](0011-ticket-lifecycle-engine.md) | One generic lifecycle engine for every work item, not per-category logic | Accepted |
| [0012](0012-terminology-overlay.md) | Terminology overlay: renameable nouns, separate from renameable states | Accepted |
| [0013](0013-marketplace-metering-plugin.md) | Marketplace listing and usage metering are an optional plugin, never a default | Accepted |

## Numbering

Sequential, never reused. A superseded ADR stays in place with its status updated and a
link forward — the history is the point.
