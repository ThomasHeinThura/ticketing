# Technical verification contracts

Laptop checks provide implementation feedback. Required remote contexts and branch protection
remain in force when publishing. The command lists below retain the existing reconciliation
contract; this document does not impose waiting for CI during implementation or per-change reviews.
Existing planned/disabled entries remain distinguishable from enabled gates in `test-all.mjs`.
Performance, permission, isolation, safety and security budgets are not waived.

**Fast — existing remote stage:**

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
│ pnpm check:ui:raw-elements G1a — no raw form     │
│                      controls outside packages/ui│
│ pnpm check:deps      no cycles, no boundary break│
│ pnpm check:i18n      en-US complete              │
│ pnpm audit           high/critical fails         │
│ pnpm check:overrides one override source only    │
│ pnpm check:dockerfile-deps Dockerfile=workspace  │
│ gitleaks             no secrets in the diff      │
│ pnpm check:queries   no new direct queries (#580)│
│ pnpm check:inventory screen counts match rows    │
│ pnpm check:reviews   phase boundary evidence        │
│ pnpm check:env       no stray process.env        │
│ pnpm check:vocabulary identifiers registered     │
│ pnpm check:events    published keys registered   │
│ pnpm check:skips     no .skip / .only            │
│ pnpm check:policy    agent policy coherent       │
│ pnpm test:ci-scripts  gate checkers + red probes │
│ pr-template check    sections filled, tiers named│
├─ Test ───────────────────────────────────────────┤
│ pnpm test                unit + component        │
│ pnpm test:coverage       90 % statements, lines,  │
│                          functions on domain     │
│ pnpm test:permissions    route coverage (Hono    │
│                          router), role × route   │
│                          matrix ×2, custom roles │
│ pnpm test:no-inherited-routes  fork removals stay │
│                          absent from the router,  │
│                          auth plugins and lockfile│
│ pnpm test:contract       OpenAPI lint, drift,    │
│                          and breaking changes   │
│ pnpm test:mcp            tool → route parity     │
├─ Build ──────────────────────────────────────────┤
│ pnpm build               all apps and packages   │
│ pnpm check:bundle-purity G12 — portal is clean   │
│ pnpm check:bundle-size   G11 — size budgets      │
│ helm lint + helm template   charts/taskdesk      │
└──────────────────────────────────────────────────┘
```

**Full — existing remote stage:**

```
├─ Integration ────────────────────────────────────┤
│ pnpm test:integration    Testcontainers Postgres,│
│                          lifecycle/, migrations  │
│                          from empty, anonymiser, │
│                          additive seed profiles  │
├─ Browser ────────────────────────────────────────┤
│ pnpm test:e2e            protected-route redirect│
│                          browser smoke today;    │
│ pnpm test:e2e --project=security                │
│ pnpm test:e2e --project=reduced-motion   G9     │
│ pnpm test:e2e --project=mobile-320       H6     │
│ pnpm test:a11y           G4 — axe                │
│ pnpm test:visual         G8 — snapshots          │
│ pnpm test:perf           G11 — budgets           │
└──────────────────────────────────────────────────┘
```

**Sharding.** Required checks target under 10 minutes and must finish within 20. Four required
names are aggregators over explicit shard jobs and fail closed (`scripts/ci/assert-integration-shards.mjs`)
unless every named job succeeded: `static` (typecheck, tokens, checks), `unit + component`
(3 shards, `pnpm test -- --shard=i/3`), `integration - Postgres 18` (8 shards) and
`e2e - protected-route redirect` (8 `pnpm test:e2e --shard=i/4` shards, four over the smoke set
and four over the `*-persisted.spec.ts` journeys, chosen by a file-path filter argument, plus `e2e-image`, the
real-Docker deploy helpers and the candidate shipping image).
Each gate still runs once, over
the whole suite, @a11y specs included; sharding removes, skips and weakens nothing.

## Security-sensitive scope

The effective scope is the union at HEAD and the merge base. Its own enforcement and
contracts stay protected. Existing route-detection and minimum-parse checks remain active.
Relocation cannot narrow the merge-base scope; old contracts may be read from Git history,
never from ignored archive files in the current checkout.

```
apps/api/src/**/policy.ts            packages/permissions/**
apps/api/src/plugins/**              apps/api/src/storage/**
apps/api/src/auth*                   apps/api/src/auth/**
                                     apps/api/src/index.ts
apps/api/src/utils/**                apps/api/src/capabilities/**
apps/api/src/**/index.ts             any new route file (a new *.ts exporting a Hono router)
apps/api/src/**/controllers/**       apps/api/drizzle/*.sql
apps/api/src/policy-registry.ts      apps/api/src/database/**
packages/mcp/src/auth/**             scripts/deploy.sh
packages/domain/src/identity/**      apps/api/src/permissions/**
apps/api/drizzle.config.ts

apps/api/src/middleware/**           (path does not exist yet)
apps/api/src/webhooks/**             (path does not exist yet, P4)
apps/api/src/scim/**                 (path does not exist yet, P3)
packages/plugins-contracts/**        (path does not exist yet)

.github/**                           package.json
scripts/ci/**                        **/package.json
turbo.json                           pnpm-lock.yaml
docs/04-engineering/ci-cd.md         pnpm-workspace.yaml
docs/04-engineering/agent-workflow.md
                                     .npmrc
                                     .pnpmfile.cjs
trivy.yaml                           .trivyignore
.trivyignore.yaml
scripts/lib/**                       tests/api-integration/global-setup.ts
**/vitest.config.*                   apps/web/playwright.config.ts
**/vitest*.config.*
apps/web/e2e/**                      scripts/ci/redocly.yaml
scripts/ci/openapi-approved-breaks.json
docs/technical/**                   AGENTS.md
```

## Consolidated phase review

Ordinary integration runs of `check:reviews` report **phase not submitted**; they do not
claim a review or acceptance. Before phase completion or release, run
`pnpm check:reviews --phase P0 --report <repository-relative JSON report>` for the applicable
phase. One independent AI reviewer covers design, integration and security together. Fixes
and evidence belong in that report; no additional per-change review is introduced.

A report lives at `docs/evidence/Pn-review.json`. It records `phase`, `sourceSha`,
`sourceDigest`, `reviewer`, `implementers`, `coverage` (design, integration, security),
`evidence` (nonempty requirements/diff/tests/browser/security path arrays),
`evidenceSha256` (every referenced artifact's hash), and `findings` (unique ID,
resolved disposition and repair evidence). Open/deferred findings do not pass.
Reviewer identity differs from every implementer; no special model is required.

`sourceSha` must be a verified ancestor of the current source head. On pull requests,
the payload head must agree with the actual checkout's PR parent. `sourceDigest` binds
tracked and nonignored untracked file paths, bytes and executable state, including all
maintained requirements, technical contracts, agent instructions and evidence. Only the
exact requested non-normative report artifact is excluded. Source symlinks must resolve to regular files inside the checkout and outside the ignored archive; their link destinations and resolved file bytes are bound. Referenced evidence is also
hashed explicitly, including ignored files. Thus committing the report does not force
another review round, while changed requirements, source or evidence invalidate the binding.

Generate the source digest with `node scripts/ci/check-reviews.mjs --print-source-digest
--report docs/evidence/Pn-review.json`; `--print-evidence-digests --report <report>` prints
hashes for paths already listed in the report. These commands do not conduct a review.

Ordinary PRs describe their result and actual validation. No per-change reviewer, model,
security-review note or screenshot section is mandatory. An explicit `Phase completion`
section with Phase/Report fields invokes this same source-bound validator in the existing
required PR job. Unfinished integration reports phase not submitted, never accepted.
Versioned release dispatch takes only `source_sha` and `version`. Before build or publication
it requires `source_sha` to be reachable from `main` and every required status check in the
live `main` ruleset to have a successful run on that commit (or on the merged branch head for
checks that only run on pull requests); a missing, pending, skipped or failed check stops the
release. Known fail-closed limits: dispatch a merge commit (a squash or rebase commit has no
merged branch head to fall back to); an old cancelled suite on the branch head keeps blocking even after a re-run
(it stays a separate suite), so release from a later eligible `main` commit instead; a ruleset context without a
pinned app accepts a same-named run from any installed app, so pin the app when that matters.
Main-push Edge artifacts remain CI outputs, not acceptance. Existing required
job/context names are unchanged.

Passing validates evidence structure and binding; it cannot prove reviewer identity,
review quality or runtime acceptance. Thomas's walkthrough and decision remain separate.
