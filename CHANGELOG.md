# Changelog

All notable changes to TaskDesk are recorded here and maintained alongside releases.
The release workflow creates GitHub release notes for a selected source SHA but does not
write this file. At every stage close, add a short human-written summary of what actually
shipped — see [Release notes](docs/04-engineering/ci-cd.md#release-notes).

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning
follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

Three signed prereleases exist (`2.0.0-alpha.1` to `2.0.0-alpha.3`, below). See
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
- 2026-09-15 — governance reset: merge execution delegated to the orchestrating Claude
  session once every required gate is green on the exact candidate (previously
  Thomas-only); subagent model routing simplified to Sonnet (implementation, ordinary
  review, project-alignment checking) and Opus (final independent security/critical review
  only, spawned explicitly), dropping an earlier multi-provider-router and non-Claude
  specialist-subagent experiment that had not worked out in practice; a live UAT deployment
  made an active near-term priority rather than a later item. See the
  [decision log](docs/07-planning/decision-log.md), 2026-09-15.

**P0 implementation is well underway** — dozens of pull requests have merged covering the
CI gate matrix, the permissions/policy registry, the deployment skeleton, and a substantial
part of the `organization()` plugin retrofit. This file does not enumerate them individually
— that is exactly the kind of live count that goes stale here; `status.md` and
`gh pr list --state merged` are the live record. Real, per-feature release entries begin
once the first version actually ships.

This file starts recording real entries from the first change merged in
[P0](docs/07-planning/phases.md). Until then, treat
[status.md](docs/07-planning/status.md)'s session log as the record of what happened, and
this file as the promise of where product-facing entries will live once there is a product
to log.

### Fixed

- **Installer re-run (#623, `f4f6b011`, merged 2026-10-10, not yet in a release).** A
  first production install writes `TASKDESK_FILES_HOST=files.<domain>` into `.env`. On the
  next run of `install.sh`, `2.0.0-alpha.3` checked that name in DNS and stopped with "DNS
  name files.<domain> does not resolve", even when the S3 profile was not in use. The
  installer now checks the files host only with `--profile s3` or an explicit
  `--files-host`. Nothing was changed when the old behaviour stopped; it failed safe. The
  published installer hash changed to `ab4e319e…`. The same change corrects the documented
  `/api/public/health/live` response (`{"status":"ok"}`) and adds a runbook note about
  re-signing in after the cookie rename. Evidence:
  `p0-installer-proof-4-20261010T115535Z` (re-run and S3 cases pass; see the
  [P0 stage review](docs/07-planning/p0-stage-review.md)).

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

## [2.0.0-alpha.3] - 2026-10-10

Signed prerelease, source `b704f707`. The P0 claim binds to this release
([P0 stage review](docs/07-planning/p0-stage-review.md)).

### Added
- Database migrations 0088 to 0118 (#618) and 0119 (#620), taking a fresh schema to 120
  migration rows. They are additive, apart from some constraint changes. 0119 adds
  tenant-composite foreign keys for saved views and notification deliveries.

### Changed
- File and attachment URLs are now built from the configured public origin, not from the
  request's Host or forwarded headers (#619).
- `deploy.sh` now decides whether a port is published from the container engine's own
  data, and reads image digests from registry bytes (#621).

### Fixed
- `deploy.sh` no longer aborts in production on a Docker Compose that prints `:0` for an
  exposed but unpublished port (#621). This stopped the `2.0.0-alpha.2` deploy.

### Security
- `deploy.sh` now takes the image digest from the registry's own bytes and judges port
  publication from the container engine, so a wrong digest or a published port is rejected
  from what the engine and registry report, not from parsed tool text (#621). The
  release-tag binding of the signature check (`--annotations "tag=${tag}"`) is older than
  #621; it was already in `deploy.sh` at `3096cb04`.

### Known issues
- Running `install.sh` a second time on a default production install (no S3 profile, no
  `files.<domain>` DNS record) stops with a DNS error. Nothing is changed. Fixed in #623
  (see Unreleased).
- `/api/public/health/live` returns `{"status":"ok"}`. The container-image doc said it also
  returned version and SHA. Corrected in #623.
- No release-to-release rollback is proven. Proof 3 rolled back to the edge image
  `sha-8ddb9de8` (schema 80, boot and reads only; old-image writes were not tested).
  `2.0.0-alpha.1` and `2.0.0-alpha.2` cannot complete a production install, so they are not
  a rollback target.

## [2.0.0-alpha.2] - 2026-10-10

Signed prerelease, source `511c917f`. **Superseded; do not install.** A production deploy
still fails at the port check (see Known issues).

### Fixed
- `deploy.sh` no longer fails on the padded `Digest:` line that newer `docker buildx`
  prints. It now stops on malformed output instead of continuing (#617).

### Changed
- Repository policy and the pull-request template check were reworked (#615, #616). These
  change how reviews are recorded, not product behaviour.

### Known issues
- A production deploy stops at the port check on Docker Compose versions that print `:0`
  for an unpublished port. Fixed in `2.0.0-alpha.3`.

## [2.0.0-alpha.1] - 2026-10-10

First signed prerelease, source `b64f8062` (#602 merge). **Superseded; do not install.**
`deploy.sh` fails on the digest line (see Known issues). Container image published to GHCR
with signature and provenance.

### Added
- The P0 foundation: CI gate matrix, policy registry with route-coverage test, Docker
  image, Compose files, `scripts/deploy.sh` and the one-line `install.sh`, observability
  and health endpoints, seed profiles, a PostgreSQL RLS prototype, and the shared UI
  foundation. See the pull-request list in the
  [GitHub release](https://github.com/ThomasHeinThura/ticketing/releases/tag/v2.0.0-alpha.1)
  (#394 to #602).
- Two entry points served by one image: the agent app on the agent host, and on the portal
  host only a "portal unavailable" notice (customer portal is disabled in this release).
- Pending actions: persisted deletion approvals with self-read, deny, cancel and expiry
  routes.
- Work-item, comment, attachment, workflow-transition and project-plan API routes.

### Changed
- **Sessions: the agent session cookie is now `__Host-tdk_agent_session` (Secure,
  host-only).** Sessions from an earlier image are not accepted after an upgrade. Users
  must sign in again. Cookies are not interchangeable after a rollback. (The portal
  cookie is `__Host-tdk_portal_session`.)
- Anonymous sign-in, account linking and the cookie cache are off.

### Known issues
- `deploy.sh` fails on the padded `Digest:` line from newer `docker buildx`. Fixed in
  `2.0.0-alpha.2`.
- No full E2E, screen-reader, keyboard, cross-browser, realistic-data, load or restore
  evidence exists. Thomas deferred these to before `2.0.0` on 2026-10-10 (see the
  [decision log](docs/07-planning/decision-log.md) and the P0 stage review).

## Related

- [Status](docs/07-planning/status.md) · [Roadmap](docs/07-planning/roadmap.md)
- [CI/CD § Releases](docs/04-engineering/ci-cd.md#releases) · [Decision log](docs/07-planning/decision-log.md)
