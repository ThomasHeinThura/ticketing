# Release plan

- **Status:** Accepted 2026-09-05 — see [decision log](decision-log.md)
- **Companion to:** [phases.md](phases.md) (what "done" means), [accelerated-delivery-plan.md](accelerated-delivery-plan.md) (target dates), [ci-cd.md](../04-engineering/ci-cd.md) (the mechanism)

## Purpose

[phases.md](phases.md) says what gets built and in what order. [ci-cd.md](../04-engineering/ci-cd.md)
says a merge to `main` produces a versioned image via `semantic-release`. Neither says
**what a customer is allowed to install, when, and what we promise about it afterwards.**
This document does. It exists because "we ship continuously" and "we sell a product" pull
in different directions unless someone writes down where the seams are.

## Versioning

**Software version starts at `2.0.0-alpha.1`.** Not `0.1.0`, not `1.0.0`, and not a
continuation of kaneo's `2.22.x`:

- The product is *TaskDesk v2*; the version and the product generation should agree, so
  nobody has to explain why "v2" runs software version `0.4`.
- [api-design.md](../01-architecture/api-design.md) already anchors API stability to
  "when v2.0 ships" — the version number has to be the thing that promise points at.
- kaneo's `2.22.x` tags describe kaneo's history, not ours. The code is taken once
  ([ADR 0001](../01-architecture/adr/0001-kaneo-as-foundation.md)); the version history
  starts fresh, with kaneo credited in `THIRD-PARTY-NOTICES.md`, not in our tag list.

Semantic versioning, computed by `semantic-release` from conventional commits, unchanged
from [ci-cd.md](../04-engineering/ci-cd.md): `fix:` → patch, `feat:` → minor, `feat!:` →
major.

## Channels

Three, and they are **image tags and installer pointers**, not branches — there is still
only one long-lived branch, `main`, per [ci-cd.md](../04-engineering/ci-cd.md).

| Channel | Image tag | Who installs it | Produced |
| --- | --- | --- | --- |
| **edge** | `edge`, plus `sha-<gitsha>` | Us, UAT | Every merge to `main` |
| **pre-release** | `2.0.0-alpha.N` → `beta.N` → `rc.N` | Pilot users who accepted that it is not finished | Every merge to `main` while `main` is in pre-release mode |
| **stable** | `2.x.y`, plus `latest` | Customers | Only after the digest has been promoted through UAT and smoke-tested |

**`latest` means latest *stable*, not latest merge.** [ci-cd.md](../04-engineering/ci-cd.md)'s
main pipeline tags every merge `edge` + `sha-<gitsha>`; the `latest` tag moves only when a
stable release is promoted. The one-line installer's `stable.txt` pointer
([one-line-install.md](../05-operations/one-line-install.md)) follows the same rule. A
customer who runs `docker compose pull` must never receive an untested build because they
used the default tag.

**Pre-release numbering, honestly.** `semantic-release` computes versions from commits:
with `prerelease` on `main`, the first `feat:` after `2.0.0-alpha.1` yields
`2.1.0-alpha.1`, not `2.0.0-alpha.2` — so the phase-to-version table below cannot hold if
versions are left to the tool. Two rules make it hold: (1) **the version is pinned at each
phase close** with a `chore(release): 2.0.0-beta.1` commit that sets the tag explicitly,
and `semantic-release` only ever bumps within the pinned pre-release line between closes;
(2) this is **verified by a dry run in accelerated week 1** — a twenty-minute experiment
that prevents a confusing release history. No `next`/`beta` branches for pre-releases,
because a second long-lived branch is exactly the merge problem
[ci-cd.md](../04-engineering/ci-cd.md) refuses to have. Releases are cut by a **manually
dispatched Release workflow** (kaneo's pattern), not by a version-bump commit on every
merge — which also means no CI identity needs a branch-protection bypass.

## Releases mapped to phases

What each phase close *is*, as a release, and who could honestly be sold it.

| Release | Phase close | What it is | Sellable to |
| --- | --- | --- | --- |
| `2.0.0-alpha.1` | P0 | The gated skeleton: sign-in, policy registry, CI green on an empty app | Nobody. This is infrastructure |
| `2.0.0-alpha.N` | P1 | A polished self-hosted work manager — kaneo-parity, hardened | Nobody *as a product*: kaneo itself is free. Usable internally; replaces Planner |
| `2.0.0-beta.1` | P2 | + SLA, workflows, approvals, request types, intake — a real service desk | An internal IT or support team, as a pilot. Not yet multi-customer |
| `2.0.0-beta.N` | P3 | + customer portal, pluggable identity | An MSP or agency with customers, as a pilot |
| `2.0.0-rc.1` → **`2.0.0`** | **P4** | + God Mode, editable roles, feature flags: **"one image, any customer" becomes true** | **The first genuinely sellable release.** Self-hosted customers who configure it themselves |
| `2.1.0` | P5 | + cycles/modules/estimates, time & cost, three-tier reporting, knowledge base, service catalogue | Delivery teams; leadership who need "how are we doing?" |
| `2.2.0` | P6 | + importers (Azure DevOps, Plane, Jira, CSV) | Anyone migrating off another tool — the release that closes deals stuck on "but our history" |
| `2.3.0` | P7 | + full a11y audit, i18n, penetration test, marketplace packaging | **External paying customers and AWS Marketplace buyers** — the pentest is what makes this release different, not features |

Two honest consequences of this table:

- **P0 and P1 are not sellable, and it is a mistake to pretend otherwise.** They are what
  makes P2–P4 buildable without the design debt v1 accumulated. Their value is real and it
  is entirely internal.
- **`2.0.0` is the first sellable release, and it is self-hosted-only.** Selling to an
  *external* paying customer, or listing on a marketplace, waits for the P7 penetration
  test ([risks.md](risks.md) **R4**) — a security gate, not a feature gate, and not one
  that compresses under the [accelerated plan](accelerated-delivery-plan.md).

Under the accelerated calendar, the P0–P5 reduced-scope go-live maps to **`2.0.0-rc.1`**
at the end of week 4 and **`2.0.0`** after the week-5 production-testing pass; `2.1`–`2.3`
then land inside the 3-month window as their deferrals are paid down.

## Reduced scope and deferrals — stated here, not only by reference

Six full phase gates cannot fit in five weeks with one human: each gate as written in
[sdlc.md](../04-engineering/sdlc.md) needs a VoiceOver *and* NVDA pass, a keyboard-only
session, a fresh-eyes test, four browsers, a 10,000-item data run, a k6 baseline, a
holistic Opus security review and a written review. So the accelerated `2.0.0` is defined
**by what it deliberately does not yet contain**, and that list lives in two places that
must agree — [accelerated-delivery-plan.md](accelerated-delivery-plan.md)'s deferral
register, and here:

- **Gate activities consolidated**: the manual accessibility pass, fresh-eyes test,
  four-browser check and k6 baseline are run **once, before `2.0.0`**, over the whole
  surface, instead of once per phase. Automated gates (`G1`–`G13`), route/permission tests
  and the Opus security review of every merge are **not** consolidated — they run as
  specified.
- **Features deferred to `2.1`–`2.3`**: the accelerated plan's register — full report set
  and tier-3 builder, time & cost, service management, knowledge base, import, i18n beyond
  `en-US`, the manual accessibility audit, load at scale, the penetration test, marketplace
  packaging.
- **Penetration test booked in week 1** ([risks.md](risks.md) **R19**), scoped to auth,
  tenancy and the portal boundary, with a second pass before external sale.

The first slipped gate is a signal to move the date or narrow the scope
([accelerated-delivery-plan.md](accelerated-delivery-plan.md#what-happens-if-week-4-looks-tight))
— never to convert quietly into "quality later", the failure
[definition-of-done.md](../04-engineering/definition-of-done.md) names by name.

## Cadence

- **Edge and pre-release:** every merge, automatically. No ceremony.
- **Stable:** promoted when the phase gate (or, in the 3-month window, a two-week release
  train) passes — never on a calendar alone. A stable release that is not ready waits; the
  edge channel keeps moving.
- **Patch releases:** `fix:` commits to `main` produce a patch immediately and are promoted
  to stable as soon as UAT smoke-tests pass — same day for a security fix.

## Support and upgrade policy

| | Policy |
| --- | --- |
| **Supported line** | One: the latest stable minor. Until there are external customers, "upgrade to latest" *is* the support policy |
| **After the first external customer** | The previous minor receives security patches for **90 days** after the next minor ships. **Mechanism:** a `release/2.N` branch is cut at the moment of each stable minor promotion — short-lived by definition, only security fixes cherry-picked onto it, deleted at the end of the window. Compatible with "no long-lived *feature* branches"; the cherry-pick-and-release procedure is in the [runbook](../05-operations/runbook.md) |
| **Upgrade path** | Any stable release must upgrade cleanly from the **two preceding minors**, proven by the **migration matrix** in [migrations.md](../04-engineering/migrations.md): restore the schema snapshot of each preceding minor, migrate forward against synthetic data, run the integration suite. The production-copy dry run is a separate *operator* step against a restored anonymised backup ([runbook](../05-operations/runbook.md)) — never a CI job, because CI holds no production data. Skipping more than two minors is supported only via stepping stones, documented per release |
| **Migrations** | Forward-only, two-phase for anything destructive, per [data-model.md](../01-architecture/data-model.md) — this is what makes rollback of the *image* safe while the schema stays |
| **Rollback** | Redeploy the previous digest ([ci-cd.md](../04-engineering/ci-cd.md)): under five minutes. Never a database restore, except for a failed *major* upgrade, which is why a backup is taken before every major |
| **Deprecation** | API: two minor releases with `Deprecation` and `Sunset` headers, per [api-design.md](../01-architecture/api-design.md). Plugin contracts (`packages/plugins-contracts`): versioned separately once third-party plugins exist; until then they move with the product |
| **LTS** | None before `3.0`. Revisit when there is a marketplace listing, because AWS Marketplace buyers expect a stated patch cadence and support window ([aws-marketplace.md](../05-operations/aws-marketplace.md)) |

## Stable-release checklist

Every stable promotion, in addition to the phase gate in [sdlc.md](../04-engineering/sdlc.md):

1. `CHANGELOG.md` has its human-written summary above the generated entries
   ([ci-cd.md § Release notes](../04-engineering/ci-cd.md#release-notes)).
2. [Screen inventory](../02-design/screen-inventory.md) and
   [feature index](../03-features/README.md) status columns updated in the same change.
3. Trivy scan clean at high/critical; `pnpm audit` clean; SBOM attached to the GitHub
   release.
4. **Image and release archive signed and attested** — cosign signatures and a
   build-provenance attestation published alongside them ([ci-cd.md](../04-engineering/ci-cd.md)
   step 8), so a customer, the installer, or a marketplace scanner can verify what they
   pulled is what CI built.
5. Migration matrix passed in CI ([migrations.md](../04-engineering/migrations.md)); for a
   release after the first production deploy, the operator dry run against a restored
   anonymised backup recorded in the runbook.
6. Deployed to UAT, automated smoke test passed, then promoted **by digest**.
7. `latest` moved, the installer's stable pointer moved, GitHub release published, docs
   site deployed.
8. For a **major**: a backup taken and its restore verified first, and the
   [accelerated plan](accelerated-delivery-plan.md)'s deferral register reviewed — anything
   still deferred is either scheduled or consciously carried, never silently.

## Related

- [Phases](phases.md) · [Accelerated delivery plan](accelerated-delivery-plan.md) · [Roadmap](roadmap.md)
- [CI/CD](../04-engineering/ci-cd.md) · [Deployment](../05-operations/deployment.md) · [One-line install](../05-operations/one-line-install.md)
- [CHANGELOG.md](../../CHANGELOG.md)
