# Independent ordinary review — PR #589 auth/identity/permissions/schema scope

- **Reviewer:** fresh independent GPT-6 Luna context; did not author, direct, or remediate the candidate.
- **Candidate:** `7dd3cbb461e9a6567acb07eda64cd3bbaaac54de`
- **Base:** `3096cb044bdf6ae98488bfc385f532fa6386343a`
- **Lineage:** candidate `HEAD` verified exact; candidate parent is `7c2c9ac5f67238545b6071de06849844c1c4db72`; merge-base with stated base verified exact. Worktree clean at review start and finish.
- **Verdict:** **BLOCK** — one P1 finding in auth configuration reload detection.

## Scope checked

Read the repository agent workflow, OpenAI operating guide, current status and recent decision-log material, relevant auth/identity/security/permission contracts, P3 identity provisioning rules, ADR-0015, and the bulk review packet. Inspected the integrated auth construction/reload hooks, portal routing and session identity checks, OIDC callback/session-source binding, current identity lookup and SCIM lifecycle/revocation areas, strict policy identity resolution, current instance-admin guard, provenance preflight/cut-over implementation, and relevant migrations/schema. The staged scope reviewed included the separation between `instance_plugin_config` local-auth providers and `identity_connection` OIDC providers, customer portal admission, operation-bound step-up, external grant authority limits, and legacy membership migration fail-closed rules.

This was a focused code review, not whole-repository line-by-line review. I did not run the DB-backed integration/migration suite, apply SQL, build/boot the image, run hosted CI, exercise browser flows, or validate with a real Entra tenant. I did not edit source or control files.

## Finding

### [P1] Track configuration changes per row, not by one maximum version

**Location:** `apps/api/src/auth.ts:1020-1025`; row readers at `apps/api/src/auth/repository.ts:488-504`.

`getStoredAuthPluginConfigRows()` and `getIdentityConnectionConfigVersions()` return per-row versions, but `reloadAuthConfiguration()` collapses both sets into `Math.max(...)` and skips construction whenever that scalar equals the previously cached value. These rows have independent counters, each incremented from its own current value. Therefore a change can be invisible whenever another row already has the greater version. For example, if an identity connection is at version 4 and an `auth.magic-link` config row is at version 1, changing the latter to version 2 leaves `nextVersion` at 4; the local-auth configuration is not re-read into the active Better Auth instances. The `auth.reload` subscriber also calls this same function, so pub/sub does not repair this case, and polling keeps observing the same maximum. Similar collisions occur between independently versioned identity-connection rows.

This breaks the promised convergence behavior: an enabled/disabled auth provider change can leave replicas using stale configuration indefinitely, beyond the stated 10-second no-Valkey fallback. The design document says both tables' maxima form the polled version (`docs/01-architecture/auth-runtime-reconfiguration.md:100-106`), but the implementation returns only the greatest scalar across all rows, not a change-sensitive version vector. A version vector/hash over stable row identity plus each row's config version (or a global monotonic generation) would make any row change observable. The downstream route writer is intentionally not accepted in this packet, but the candidate has already wired runtime loading and reload semantics for these stored rows; the defect should be fixed before that contract is relied on.

## Checks run

- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts src/auth/step-up-service.test.ts ../../tests/api/identity/step-up-canonicalization.test.ts ../../tests/api/identity/oidc-token.test.ts ../../tests/api/identity/oidc-provider.test.ts ../../tests/api/identity/membership-provenance-preflight.test.ts ../../tests/api/auth/portal-cookie-boundary.test.ts ../../tests/api/database/drizzle-snapshot-chain.test.ts` — **6 files, 35 tests passed**.
- `pnpm --filter @taskdesk/permissions exec vitest run --config vitest.config.ts` — **14 files, 267 tests passed**.

These focused tests cover operation-bound step-up canonicalization, token/provider verification helpers, provenance preflight, portal cookie boundaries, migration snapshot chain, and evaluator/permission behavior. They do not exercise reload version collisions; no test asserting that every individual row-version change triggers a reload was found in the auth runtime-reconfiguration test inventory.

## Other disposition and limits

No additional blocker was substantiated in the reviewed auth/identity/permission/migration scope. In particular, the source keeps `instance:admin` authority distinct from external grants; customer identity lookup requires an active customer person, active portal-enabled organisation, and customer role; OIDC session provenance is bound after the optional local-factor challenge; the portal session guard checks portal host and current customer identity; and the provenance cut-over refuses unresolved/duplicate legacy state rather than guessing. These are inspection findings, not claims of end-to-end acceptance.

The candidate remains subject to the rest of the independent ordinary panel, exact-head security review, DB/SQL, hosted CI, image/boot, browser, and other acceptance evidence recorded in the packet. This verdict is only for this fresh reviewer context and exact SHA.
