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

## Pull request pipeline

Runs on every pull request. Everything is required.

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
├─ Test ───────────────────────────────────────────┤
│ pnpm test                unit + component        │
│ pnpm test:integration    Testcontainers Postgres │
│ pnpm test:permissions    G — route coverage,     │
│                              role × route matrix │
├─ Build ──────────────────────────────────────────┤
│ pnpm build               all apps and packages   │
│ check:bundle-purity      G12 — portal is clean   │
│ check:bundle-size        G11 — size budgets      │
├─ Browser ────────────────────────────────────────┤
│ pnpm test:e2e            agent + portal          │
│ pnpm test:e2e --project=security                 │
│ pnpm test:e2e --project=reduced-motion   G9      │
│ pnpm test:a11y           G4 — axe                │
│ pnpm test:visual         G8 — snapshots          │
│ pnpm test:perf           G11 — budgets           │
└──────────────────────────────────────────────────┘
```

Runtime target: under 15 minutes. Beyond that people start working around it. Static and
test stages run in parallel; browser stages shard across four workers.

## Main pipeline

On merge:

1. Everything above.
2. Full E2E across Chrome, Firefox, Safari and Edge.
3. Compute the next semantic version from conventional commits.
4. Build the container image, multi-arch (amd64, arm64).
5. Scan with Trivy — high or critical fails.
6. Generate a CycloneDX SBOM.
7. Push to the registry, tagged with the version, the git SHA, and `latest`.
8. Commit the bumped version back to `main` with `[skip ci]`.
9. Publish `@taskdesk/mcp` to npm if it changed.
10. Deploy the documentation site.

`batch: true` — concurrent runs serialise, so two merges cannot race on the version bump.
This is carried directly from v1, which learned it the hard way.

## Promotion

Manual, and **by digest, not by tag**.

```
Select a version → verify it is running healthily in UAT
                 → resolve its digest
                 → deploy that digest to production
                 → smoke test
                 → done
```

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
| Deploy | `scripts/deploy.sh local` | Automatic on merge | Manual promotion |
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
