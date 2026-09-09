# CI/CD

## Pipelines

Two, following v1's structure, which was sound.

| Pipeline | Trigger | Does |
| --- | --- | --- |
| **Build** | Push to `main`, and every pull request | Verify, version, build, push images |
| **Promote** | Manual | Move a tested digest from UAT to production |

The build pipeline **never deploys** and **never holds production secrets**. It has Docker
registry credentials and nothing else. This separation is deliberate: a compromised build
pipeline should not be able to reach production.

**Platform: GitHub Actions** (decided 2026-09-05 — the repository is on GitHub, keyless
cosign and `semantic-release`'s GitHub integration both assume it; v1's Azure Pipelines are
not carried over). Concurrency on `main` is
`concurrency: { group: main, cancel-in-progress: false }`, so two merges cannot race a
release.

## Pull request pipeline

Two required stages, so the fast one stays fast enough that nobody routes around it. **This
is the single list of CI checks**; [testing-strategy.md](testing-strategy.md) links here.
`pnpm test:all` is the local alias that runs every check in this list; CI runs them as the
stages below.

**Fast — required on every push, target under 15 minutes:**

```
┌─ Setup ──────────────────────────────────────────┐
│ pnpm install --frozen-lockfile                   │
├─ Static ─────────────────────────────────────────┤
│ pnpm lint            biome                       │
│ pnpm typecheck       tsc across the workspace    │
│ pnpm check:tokens    G2, G3 — tokens, contrast   │
│ pnpm check:ui        G1 — no bespoke primitives; │
│                      no Radix/Base UI import     │
│                      outside packages/ui; Radix  │
│                      only per KNOWN-RADIX.md     │
│ pnpm check:deps      no cycles, no boundary break│
│ pnpm check:i18n      en-US complete              │
│ pnpm audit           high/critical fails         │
│ pnpm check:overrides one override source only    │
│ gitleaks             no secrets in the diff      │
│ pnpm check:queries   no db.select() outside repo │
│ pnpm check:inventory screen counts match rows    │
│ pnpm check:reviews   review section empty        │
│ pnpm check:env       no stray process.env        │
│ pnpm check:vocabulary identifiers registered     │
│ pnpm check:skips     no .skip / .only            │
│ pnpm test:ci-scripts  gate checkers + red probes │
│ pr-template check    sections filled, tiers named│
│ no-inherited-routes  removals stay removed       │
├─ Test ───────────────────────────────────────────┤
│ pnpm test                unit + component        │
│ pnpm test:coverage       90 % on packages/domain │
│ pnpm test:permissions    route coverage (Hono    │
│                          router), role × route   │
│                          matrix ×2, custom roles │
│ pnpm test:contract       Redocly lint + oasdiff  │
│ pnpm test:mcp            tool → route parity     │
├─ Build ──────────────────────────────────────────┤
│ pnpm build               all apps and packages   │
│ check:bundle-purity      G12 — portal is clean   │
│ check:bundle-size        G11 — size budgets      │
│ helm lint + helm template   charts/taskdesk      │
└──────────────────────────────────────────────────┘
```

**Full — required before merge, runs on the merge queue (or on the `ready-for-review`
label), target under 45 minutes, sharded four ways:**

```
├─ Integration ────────────────────────────────────┤
│ pnpm test:integration    Testcontainers Postgres,│
│                          lifecycle/, migrations  │
│                          from empty, anonymiser  │
├─ Browser ────────────────────────────────────────┤
│ pnpm test:e2e            agent + portal          │
│ pnpm test:e2e --project=security                 │
│ pnpm test:e2e --project=reduced-motion   G9      │
│ pnpm test:e2e --project=mobile-320       H6      │
│ pnpm test:a11y           G4 — axe                │
│ pnpm test:visual         G8 — snapshots          │
│ pnpm test:perf           G11 — budgets           │
└──────────────────────────────────────────────────┘
```

The fast stage exists because a required check that takes an hour gets worked around; the
full stage exists because the things it checks cannot be made fast. Both block a merge.
The Opus **security review** is a required section of `.github/pull_request_template.md`
(the template is specified in [definition-of-done.md](definition-of-done.md#the-pull-request-template)).
CI checks it non-empty, naming Opus, whenever the diff touches **any** of — this list is the
authoritative scope; [sdlc.md](sdlc.md) and [security-model.md](../01-architecture/security-model.md)
cite it and do not restate it:

```
apps/api/src/**/policy.ts            packages/permissions/**
apps/api/src/middleware/**           packages/plugins-contracts/**
apps/api/src/plugins/**              apps/api/src/scim/**
apps/api/src/auth*                   apps/api/src/storage/**
apps/api/src/webhooks/**             any new route file (a new *.ts exporting a Hono router)
apps/api/src/utils/**                apps/api/src/index.ts
apps/api/src/**/index.ts             apps/api/src/capabilities/**

.github/**                           package.json
scripts/ci/**                        **/package.json
turbo.json                           pnpm-lock.yaml
docs/04-engineering/ci-cd.md         pnpm-workspace.yaml
                                     .npmrc
                                     .pnpmfile.cjs
```

**Why the last two lines of the first block were added** (2026-09-09, from an independent
Opus audit of `main@5270954`). They were missing, and their absence meant **the entire
authorization enforcement layer sat outside this list.** Demonstrated by running the
repository's own `lib/security-paths.mjs` over real paths: `require-workspace-permission.ts`
— the authorization engine — `require-session-only.ts`, `validate-workspace-access.ts`,
`is-instance-admin.ts`, `verify-api-key.ts`, `apps/api/src/index.ts` (the app-wide guard,
whose own comment warns that breaking it makes "every request through this guard succeed
unauthenticated"), `workspace/index.ts` (the native write routes) and
`capabilities/capability-checks.ts` **all reported OUT of scope.** Only `**/policy.ts` and
`auth*` were in.

The sharpest instance: **the fix for #66 — a privilege-restoration fail-open — edits
`require-workspace-permission.ts`, which this list did not cover.** A P0 security fix would
not have tripped its own gate.

`apps/api/src/**/index.ts` is here because that is where every router module lives: the 20
route modules are declared with `apiRouter()` (`apps/api/src/openapi.ts:25`), and a route's
middleware chain — which is what actually enforces authorization — is written in that file
next to the route. Covering it **by path** makes the "any new route file" clause below a
backstop rather than the primary control, which matters because that clause was matching
almost nothing (see the note on `looksLikeHonoRouter` in `lib/security-paths.mjs`).

Four globs in the first block — `apps/api/src/middleware/**`, `apps/api/src/scim/**`,
`apps/api/src/webhooks/**`, `packages/plugins-contracts/**` — point at paths that **do not
exist yet**. They are deliberately kept: SCIM is P3 and webhooks are P4, and a glob that is
in place before the directory appears is scope that cannot be forgotten at the moment it
starts to matter. They are not evidence the list was reviewed.

**Why the second block exists** (Thomas's decision, 2026-09-08 — see the
[decision log](../07-planning/decision-log.md)). The first block is the application's
security surface. The second is the machinery that decides whether ANY surface gets
reviewed, plus the dependency-control files that decide what code is in the graph at all.
Without it, the gate could not see changes to itself: PR #19 — the pull request that
builds this very gate — touched `.github/**`, `scripts/ci/**`, `package.json`,
`pnpm-workspace.yaml` and `pnpm-lock.yaml`, and the checker correctly reported *"no
security-review path touched"*. Its own independent review then found a HIGH in
`scripts/ci/`, a HIGH in the dependency overrides, and a fail-open in
`scripts/ci/lib/diff.mjs`. All three lived in the blind spot.

A gate that cannot require review of edits to itself is a gate anyone can quietly widen.
`pnpm-lock.yaml` and `pnpm-workspace.yaml` are here for the same reason: a version floor
can be deleted without any advisory firing, so `pnpm audit` cannot be the control — a
human reading the diff is.

**The list above is not the whole scope. The scope is the UNION of this list at the merge
base and this list at HEAD.** Expanding the list takes effect immediately; **narrowing it
does not take effect on the pull request that narrows it**, and narrowing is itself
security-sensitive — a diff that removes a glob requires the review even if nothing else
in it matches either list. The reason is the reason the second block exists, one level up:
the list lives in a document the diff may edit, so a pull request that shrank
`scripts/ci/**` and `docs/04-engineering/ci-cd.md` out of the list, in the same commit
that edited `scripts/ci/`, matched nothing and reported *"no security-review path
touched"*. The files performing the reduction stopped matching the scope because of the
reduction. If the merge base cannot be resolved, or the document exists there and cannot
be parsed, the check **fails closed** — "the scope could not be computed" and "nothing
sensitive was touched" are different facts.

**The committed note is bound to the code it reviewed.** `## Security review`'s
`**Note:**` must link a committed
`docs/07-planning/security-reviews/<pr>-<slug>.md`, and that note must declare, on its own
line, the head each review actually read:

```
**Reviewed head:** `6b32ef316c49cc14cc841b32fdcce637a442b813`
```

Full forty-character SHAs. SHAs written in prose are not parsed — the notes on file cite
merge bases and post-rebase orphans in the same sentence as reviewed heads. The newest
declared head must be an ancestor of HEAD, and **every commit that LANDED between it and
HEAD must have touched nothing outside `docs/07-planning/security-reviews/`**. So the
shape is: a code head is reviewed, a **note-only** commit records it and the gate goes
green, and any later code commit makes the note stale until a fresh delta review adds its
own `**Reviewed head:**` line for the new head. Recording that new head is itself a
note-only commit, so closing the gate does not reopen it. Existence of the note was the
whole of the old check, and existence never expires.

**Landed commits, not the net tree.** The invariant is over history, and the difference is
a bypass: a commit that changes code plus a later commit that exactly reverts it leaves
the two endpoint trees identical, so a `git diff <head>..HEAD` comparison saw an empty
range and the old review passed with two unreviewed commits landed. **Reverting does not
restore a clearance** — the reverted diff is still in the branch's history, it is what a
bisect replays, and a revert can itself be wrong, so a reviewer has to see both. Merges
are attributed **conservatively**: `git rev-list` enumerates the commits a merge brought
in individually, and the merge itself is charged the **union of its per-parent diffs**.
Not a combined diff — that reports only what differs from *every* parent, so a merge whose
tree is taken wholesale from an ancestor reports **nothing** while the reviewed content is
silently replaced (constructible with `git commit-tree`, and constructed as a probe). The
union can charge a merge with a path a side-branch commit in the same range is also
charged with; that over-attribution costs a fresh delta review, whereas
under-attribution ships unreviewed content. One consequence, stated rather than discovered: merging `main` into the branch
after a review makes the note stale, because the tree the reviewer read is not the tree
that would merge.

**A waived gate needs a declaration, not a sentence.** `## Gates`' third cell must cite
one decision-log entry **with its `#anchor`**, and that entry must contain, on one line:

```
**Waives gate:** `G1` · **PR:** #19 · **Follow-up:** #123
```

The gate identifier is compared exactly, the pull-request number must be the one being
checked, and the follow-up issue is
[§ Waiving a gate](../02-design/ux-quality-gates.md#waiving-a-gate) step 3 made mechanical.
Prose is deliberately not accepted: the previous check looked for the gate identifier
anywhere in the document, which the sentence *"G1 is not waived"* satisfied. **What is
still not enforceable is who authorised it** — agents commit through the same repository
identity Thomas does, so nothing readable from a file proves authorship. The declaration
provides a durable, specific, gate-bound, PR-scoped record; Thomas confirms the authority
at the merge button, and CI says so rather than implying it checked.

The same fast-stage **PR-template check** asserts every fixed section is present, that none
is empty unless marked `n/a` with a reason, that `## Reviewed by` names a different model or
session from `## Implemented by`, that `## Screens opened` is non-empty when `apps/web/**`
changed, and that no checklist box is left unticked and unmarked.

**`## Screens opened` declares a state, read from its first meaningful line** — `n/a` /
`not applicable`, `BLOCKED — <why>`, or the screens themselves. When `apps/web/**` changed,
`n/a` in any form is rejected; an explained `BLOCKED` is **accepted as an honest gap** and
is explicitly *not* a readiness signal, because the screens still were not opened and
AGENTS.md do-not 18 is still unsatisfied. A bare `BLOCKED` with nothing after it is
rejected like a bare `n/a`. Only the first line sets the state: the earlier check matched
the token `n/a` anywhere in the section and therefore **rejected the honest sentence "I am
not marking this n/a — that would misrepresent a real gap"**, reading a negation as an
assertion and teaching authors to explain less. The parser is structural on purpose — no
sentiment or negation analysis, each of which is a new class of false positive. **`check:reviews`** fails
when a feature spec named in the diff still has a non-empty section in
`docs/07-planning/reviews/2026-09-05/` (the `pre-p0-check-fable/` folder is an applied audit
trail and is excluded). **`check:env`** fails on a `process.env` read outside
[configuration-reference.md](../05-operations/configuration-reference.md)'s list;
**`check:vocabulary`** on a table, capability, event key or job name absent from its
authority document; **`check:skips`** on `.skip(`, `.only(` or `describe.skip`.
**`tests/permissions/no-inherited-integration-routes.test.ts`** asserts no route matches
`public-project|github|gitea|slack|discord|telegram|generic-webhook`, that `octokit` and
`@octokit/webhooks` are absent from the lockfile, and that the better-auth plugin list equals
the approved list (no `anonymous`, `deviceAuthorization` or `bearer`) — the fork-time removal
list made executable ([decision log](../07-planning/decision-log.md)).
`pnpm test:a11y` and `pnpm test:perf` are Playwright projects invoked separately in the full
stage; [testing-strategy.md](testing-strategy.md) describes them the same way.

## Main pipeline

On merge:

1. Everything above.
2. Full E2E across Chrome, Firefox, Safari and Edge.
3. Compute the next semantic version from conventional commits.
4. Build the container image, multi-arch (amd64, arm64).
5. Scan with Trivy — high or critical fails.
6. Generate a CycloneDX SBOM.
7. Push to the registry, tagged with the version, the git SHA (`sha-<gitsha>`) and
   `edge`. **Not `latest`** — `latest` means latest *stable* and moves only at promotion;
   see [release-plan.md](../07-planning/release-plan.md).
8. **Sign the image** with cosign (keyless, using the CI job's OIDC identity) and publish a
   build-provenance attestation alongside it, so anyone — a customer, the marketplace
   scanner, our own deploy script — can verify the digest they pulled is the one this
   pipeline built.
9. Package and publish the Helm chart (`helm package`, pushed as an OCI artefact next to the
   image).
10. Publish `@taskdesk/mcp` to npm if it changed.
11. Deploy the documentation site.

**No version-bump commit on merge.** Stable and pre-release versions are cut by a
**manually dispatched Release workflow** — kaneo's pattern — which computes the version,
tags, signs, publishes the GitHub release with notes, and rewrites `get.taskdesk.dev/stable.txt`
on a stable promotion. This keeps `main` protected without a CI bypass identity and matches
[release-plan.md](../07-planning/release-plan.md)'s pinned pre-release numbering.

**UAT delivery is pull, not push.** A small updater on the UAT host polls the registry for
the `edge` tag's digest every few minutes, verifies its cosign signature, pulls, and runs
`docker compose up -d --wait`. CI never holds UAT credentials and never deploys — the
security boundary above is preserved, and "UAT: automatic on merge" in
[environments.md](../05-operations/environments.md) means exactly this.

## Promotion

Manual, and **by digest, not by tag**.

```
Select a version → verify it is running healthily in UAT
                 → resolve its digest, verify its signature
                 → deploy that digest to production
                 → smoke test
                 → retag that digest `latest`; move the installer's stable pointer
                 → done
```

Channels, cadence and the support policy behind this flow are in
[release-plan.md](../07-planning/release-plan.md).

Promoting by tag means the artefact you tested and the artefact you deployed are only
probably the same. By digest, they are identical by construction.

## What CI does not do

Explicitly, because the boundary matters:

- **Does not run migrations.** The application applies them at start, under an advisory
  lock.
- **Does not seed data.**
- **Does not provision infrastructure.**
- **Does not hold production credentials.**
- **Does not deploy.** Deployment pulls; CI does not push.

## Image

Single multi-stage Dockerfile.

```dockerfile
FROM node:24-alpine AS base
# → deps        install with frozen lockfile
# → build-api   compile the Hono API
# → build-web   build both bundles: agent and portal
# → runtime     production deps + compiled API + both bundles
#               non-root user, HEALTHCHECK on /api/health/live
```

One image serves the API, the agent bundle and the portal bundle. Which bundle is served
depends on the request host.

Labels carry the version, the git SHA and the build time, so a running container can be
traced to a commit.

## Secrets

| Secret | Where | Used by |
| --- | --- | --- |
| Registry credentials | CI variable group | Build pipeline |
| npm token | CI variable group | Package publish |
| Production `.env` | On the host, root-owned, `0600` | The running stack |
| `TASKDESK_ENCRYPTION_KEY` | On the host | The application |

No production secret ever enters CI. Everything else that used to be a secret is now
runtime configuration in God Mode — see
[plugin architecture](../01-architecture/plugin-architecture.md).

**Workflow hardening — because a compromised CI identity produces a *validly signed*
image** ([security-model.md](../01-architecture/security-model.md#threat-model)):

- Every workflow declares `permissions:` read-only at the top; `id-token: write` and
  `packages: write` are granted to the single signing/publishing job only.
- The Release workflow runs only on manual dispatch from `main` or `release/*`, behind
  branch protection with no bypass actor; `pull_request` jobs never sign or publish, and
  fork PRs run with no secrets.
- Third-party actions are pinned by **commit SHA**, not tag; Renovate updates them.
- `scripts/deploy.sh` and the installer verify the cosign signature against the **exact
  workflow identity** — repository, workflow file and ref — not just the OIDC issuer.
- gitleaks runs on every push (above); a hit fails the fast stage.

## Branching

```
main                    always deployable, protected
  └── feat/…            one feature, one agent, one branch
  └── fix/…
  └── docs/…
```

- No long-lived branches. A branch older than a week is a merge problem forming.
- Squash merge, so `main` has one commit per change and the history is readable.
- `main` requires: all checks green, up to date with `main`, and **Thomas to press merge**.
  The `protect-main` ruleset blocks deletion and non-fast-forward pushes and dismisses stale
  approvals on push. **Required approving reviews is `0` and Require review from Code Owners
  is off**, both deliberately — a required approval from a one-person team documents a
  protection it does not provide (decision log, 2026-09-06).
- `CODEOWNERS` (`* @ThomasHeinThura`) is **ownership metadata**: it says who to ask. It is
  not the mechanism behind "only Thomas merges" — that is Thomas, and the ruleset enforces
  the parts a machine can. **The security review and design review requirements below are
  unaffected and remain independent hard gates.**

## Releases

`semantic-release` from conventional commits.

| Prefix | Bump |
| --- | --- |
| `fix:` | patch |
| `feat:` | minor |
| `feat!:` or `BREAKING CHANGE:` | major |

The changelog is generated, not written. A release creates a git tag, a GitHub release
with notes, and the tagged image.

## Release notes

`CHANGELOG.md` at the repo root is the durable record — `semantic-release` writes to it
directly, entry per commit. That is necessary and not sufficient: a list of commit
messages does not answer "what can I now do that I couldn't yesterday," which is the
question a release note exists to answer.

**At every stage close** ([SDLC](sdlc.md) step 8 — Document), in addition to the
generated entries:

1. Update the [screen inventory](../02-design/screen-inventory.md) status column for every
   screen the stage touched.
2. Update [03-features/README.md](../03-features/README.md)'s status column for every
   feature that reached its Definition of Done — ⬜ → 🟡 → ✅. A feature does not move to
   ✅ here until [definition-of-done.md](definition-of-done.md) is actually satisfied, not
   when it merely compiles.
3. Add a short, human-written paragraph to that release's `CHANGELOG.md` entry, above the
   generated commit list, summarising what a user can now do — the same discipline
   [status.md](../07-planning/status.md) already applies to session logs: *describe state,
   not intent*.
4. Cross-reference the [accelerated delivery plan](../07-planning/accelerated-delivery-plan.md)'s
   deferral register if the release closes out something previously listed there as
   deferred — that register should shrink over time, visibly.

This is what makes "features finished" answerable from three different angles that all
agree with each other: the screen inventory (what exists), the feature index (what's
done), and the changelog (when it happened and what it means).

## Environments

| | Local | UAT | Production |
| --- | --- | --- | --- |
| Deploy | `scripts/deploy.sh local` | Pulled by the UAT host's updater on every `edge` digest | Manual promotion by digest |
| Data | Seeded | Anonymised copy | Real |
| Standard | — | **Held to production standard** | — |

UAT is held to the production standard deliberately, carried from v1's decision log. A UAT
you do not trust is a UAT nobody uses, and then problems are found in production.

## Rollback

1. Identify the last known-good digest.
2. Deploy it.
3. Verify.

**Migrations are forward-only**, so rolling back code does not roll back the schema. This
is why destructive migrations are two-phase: add and dual-write, backfill, switch reads,
drop in a *later* release. At every intermediate point, the previous image still works
against the current schema.

Target: under five minutes from decision to healthy.

## Verification after deploy

Automated smoke test, not a manual glance:

```
/api/health/ready returns 200
/api/instance/health/deep  reports every dependency healthy (instance:admin session)
sign in as a seeded account
list projects
create and delete a work item
the agent bundle loads
the portal bundle loads
```

v1's deploy script probed the API before declaring success, and it caught a whole class of
"the container started but nothing works" failures. Keep that.

## Related

- [Deployment](../05-operations/deployment.md) · [Environments](../05-operations/environments.md)
- [Testing strategy](testing-strategy.md)
