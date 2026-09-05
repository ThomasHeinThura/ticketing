# 0005 — AGPL-3.0

- **Status:** Accepted
- **Date:** 2026-09-05
- **Deciders:** Thomas

## Context

TaskDesk v2 is built on kaneo (MIT) and draws design inspiration from Plane (AGPL-3.0)
and OpenProject (GPL-3.0). We need a licence that:

1. Permits building on kaneo.
2. Permits reusing Plane or OpenProject code should we ever choose to.
3. Allows the product to be sold and hosted for customers.
4. Reflects the intent that this is an open project, not a closed one.

MIT would permit everything except (2). A proprietary licence would permit (3) most
freely but forecloses (2) permanently and contradicts (4).

## Decision

**TaskDesk v2 is licensed under AGPL-3.0.**

- kaneo's MIT code is compatible: MIT may be incorporated into an AGPL work, with the MIT
  notice retained. We retain it in `THIRD-PARTY-NOTICES.md`, in `NOTICE` inside the image,
  and in the headers of files taken verbatim.
- Plane (AGPL-3.0) and OpenProject (GPL-3.0) code may be incorporated. We choose, for
  engineering reasons rather than legal ones, to take ideas rather than code from both.
  See [Licensing and attribution](../../00-overview/licensing-and-attribution.md).

## Consequences

### Positive

- Maximum freedom to draw on the open-source ecosystem in this space, which is almost
  entirely (A)GPL.
- Aligns with the projects that inspired us; contributing back is frictionless.
- Prevents a third party taking our work, hosting it as a service, and giving nothing
  back — the specific scenario AGPL exists to address.
- Selling and hosting remain permitted. AGPL restricts withholding source, not charging
  money.

### Negative

- **Network copyleft applies to the hosted product.** Users who interact with our hosted
  instance over a network — including customers using the portal — are entitled to the
  corresponding source. In practice this means publishing the source of what we deploy,
  including our modifications.
- **Some enterprise customers refuse AGPL software outright**, on policy grounds, without
  analysis. This is a real commercial constraint and it will cost us deals.
- **A proprietary edition is foreclosed** unless we either dual-licence — which requires a
  Contributor Licence Agreement from every contributor **from the first external
  contribution onward** — or perform a clean-room rewrite.
- Any dependency we link must be AGPL-compatible. Notably, this excludes some commercial
  component libraries and some database drivers.

### Neutral

- Internal use within the company triggers no obligation beyond making source available to
  those users, who are colleagues.
- Our own customers hosting their own instance receive the source, which they are entitled
  to modify. That is intended.

## The decision this forces, soon

**If a proprietary or dual-licensed edition is ever wanted, a CLA must be in place before
the first external contribution is merged.** Retro-fitting one requires tracking down every
contributor and obtaining agreement, which in practice means rewriting their work.

This is recorded as an open risk in [risks.md](../../07-planning/risks.md) with a decision
deadline of "before the repository accepts its first external pull request".

## Alternatives considered

**MIT / Apache-2.0.** Rejected. Permits a competitor to take the work, host it and
contribute nothing. Also forecloses reusing Plane or OpenProject code, since permissive
licences cannot absorb copyleft.

**GPL-3.0.** Rejected. Copyleft triggers on distribution, not on network use — so a
competitor could host a modified TaskDesk as a service and never publish. For a
server-side product, AGPL is the version of GPL that actually does the job.

**Proprietary / source-available (BSL, Elastic Licence).** Rejected. Forecloses reuse of
the ecosystem we are drawing on, and contradicts the intent of the project. Worth
revisiting only if the commercial model changes materially — and it would require the
clean-room work described above.

**Dual licence (AGPL + commercial) from day one.** Not rejected, but deferred. It is the
strongest commercial position and it is compatible with this decision, provided a CLA is
adopted before external contributions begin. Flagged as the decision to make.

## Related

- [Licensing and attribution](../../00-overview/licensing-and-attribution.md)
- [Risks](../../07-planning/risks.md)
