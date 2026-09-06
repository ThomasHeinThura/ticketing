# Changelog

All notable changes to TaskDesk are recorded here, generated primarily by
`semantic-release` from conventional commits ([CI/CD](docs/04-engineering/ci-cd.md)) and
supplemented, at every stage close, with a short human-written summary of what actually
shipped — see [Release notes](docs/04-engineering/ci-cd.md#release-notes).

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning
follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

No code has been released yet. Planning is complete — see
[status.md](docs/07-planning/status.md) for the live picture and
[accelerated-delivery-plan.md](docs/07-planning/accelerated-delivery-plan.md) for the
current target calendar.

**Planning milestones** (not releases — recorded so the first release notes have a
starting point):

- 2026-09-05 — planning corpus complete: ADRs 0001–0013, authoritative data model, five
  policy kinds, threat model, screen inventory (133 at that pass; 136 after the closure
  pass below), release plan, one-line installer and
  marketplace listing specified; six-reviewer audit run and every high-severity finding
  closed in the documents; the corpus pushed as `docs/v2-planning-corpus` (PR #1).
- 2026-09-05 (later) — documentation-closure pass: Thomas's confirmed decisions A–N
  recorded; Microsoft Entra OIDC + SCIM made core P3 delivery with an authoritative data
  model and a feature spec; universal deletion approval (`pending_action`) added as a
  cross-cutting control; deferred-scope list (antivirus, RLS, marketplace, integrations)
  recorded; external readiness review ("Conditional GO") filed and answered. P0 step 1 may
  start when this merges.
- 2026-09-06 — pre-P0 check applied: the corpus corrected against kaneo's real source
  (snapshot SHA proposed, fork-time removal list, environment migration table, inherited
  authentication defaults disabled), security and identity contradictions resolved, data
  model columns added, Radix → Base UI, PR template written, do-not 16 and the third
  absolute added, go-live rehearsal gate defined. P0 step 1 starts when Thomas confirms
  the SHA.

This file starts recording real entries from the first change merged in
[P0](docs/07-planning/phases.md). Until then, treat
[status.md](docs/07-planning/status.md)'s session log as the record of what happened, and
this file as the promise of where product-facing entries will live once there is a product
to log.

<!--
Entries from here on follow this shape, oldest section at the bottom:

## [2.0.0-alpha.1] - YYYY-MM-DD
### Added
- What shipped, in user-facing language, not commit-message language.
### Changed
### Fixed
### Security
- Security-relevant fixes are called out here explicitly, even when the commit message
  that generated the entry didn't say "security" — see
  docs/01-architecture/security-model.md.
-->

## Related

- [Status](docs/07-planning/status.md) · [Roadmap](docs/07-planning/roadmap.md)
- [CI/CD § Releases](docs/04-engineering/ci-cd.md#releases) · [Decision log](docs/07-planning/decision-log.md)
