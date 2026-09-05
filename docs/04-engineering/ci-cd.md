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

**Fast — required on every push, target under 15 minutes:**

```
┌─ Setup ──────────────────────────────────────────┐
│ pnpm install --frozen-lockfile                   │
├─ Static ─────────────────────────────────────────┤
│ pnpm lint            biome                       │
│ pnpm typecheck       tsc across the workspace    │
│ pnpm check:tokens    G2, G3 — tokens, contrast   │
│ pnpm check:ui        G1 — no bespoke primitives  │
│ pnpm check:deps      no cycles, no boundary break│
│ pnpm check:i18n      en-US complete              │
│ pnpm audit           high/critical fails         │
│ gitleaks             no secrets in the diff      │
│ pnpm check:queries   no db.select() outside repo │
│ pnpm check:inventory screen counts match rows    │
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
The Opus **security review** is a required PR-template section, checked non-empty by CI
whenever the diff touches `apps/api/src/{middleware,plugins}/**`, `packages/permissions/**`
or any `policy.ts` — see [agent-workflow.md](agent-workflow.md#model-tiers-within-claude-code).

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
- `main` requires: all checks green, one approval, up to date with `main`.

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

**At every phase close** ([SDLC](sdlc.md) stage 8 — Document), in addition to the
generated entries:

1. Update the [screen inventory](../02-design/screen-inventory.md) status column for every
   screen the phase touched.
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
/api/health/deep  reports every dependency healthy
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
