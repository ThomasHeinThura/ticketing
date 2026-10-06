# Independent ordinary review — P0 authorization/API permissions bulk

- **Exact candidate SHA:** `f19b3bed6bc2e60d71906423b985fadb089da212`
- **Accepted base:** `8ddb9de8d4d242a0832f6f91e12872300480a905`
- **Authorization baseline:** `64d3ce895e952879d81c444f4276b730781c312a`
- **Reviewer:** fresh independent GPT-6 Luna context; I did not author, direct, or remediate the candidate.
- **Panel position:** ordinary reviewer A of the three-context bulk panel. This is not a security review or phase finalizer.
- **Verdict:** **CLEAR — no blocking or non-blocking findings in the assigned scope.**

## Scope examined

Reviewed the complete API/permissions/authorization delta from the historical independently Sol-reviewed authorization baseline through the frozen candidate, including route registration and strict enforcement, policy context construction, identity resolution, capability/reach separation, legacy read-policy changes, customer/private-resource restrictions, and related permission regressions. Inspected current complete mechanisms against `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, `docs/01-architecture/rbac.md`, `docs/01-architecture/security-model.md`, `docs/01-architecture/auth-and-identity.md`, and applicable project, customer portal, search, and time-entry contracts. Historical review notes were used as context only; their assertions are not claimed as my checks or findings.

The original eight hostile nonmember read families were considered as a group against their current route policies and enforcement mechanism. I also checked task, activity, comment, relation, link, time-entry, and asset paths; ordinary-member and assigned-role behavior; wildcard and membership predicates; strict-vs-shadow execution; instance-admin reach vs actual workspace authority; and the preserved customer-private boundary. The documented B1 parent/team representation remains future scope and does not justify widening authority; B2 private customer restriction remains present.

## Checks actually performed

- Confirmed checkout `HEAD` was the exact requested SHA before review; worktree was clean.
- Inspected the full current strict enforcement path (`strict-route-registration.ts`, `strict-policy-enforcement.ts`, `enforcement-config.ts`), identity mapper/loader, workspace legacy permission helpers, route policies, relevant routes and evaluator reach/capability semantics.
- Examined the exact authorization changes from the specified historical Sol-reviewed baseline and the final authority-source commit `dda49351328ff69bbc5f40bdd090ef4c8ddbbba5`.
- Ran focused API unit tests:

  ```text
  pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts ../../tests/api/permissions/enforcement-config.test.ts ../../tests/api/permissions/strict-route-registration.test.ts ../../tests/api/permissions/resolve-identity.test.ts
  ```

  **Passed: 3 files, 63 tests.**
- Ran `git diff --check` for the reviewed authorization source and policy paths: clean.
- Read the supplied private packet summary and earlier `c68e84d4` outcome only for attribution and acceptance context. The 18/22 G11 result is earlier-source evidence and remains a failure, not a current-candidate pass. No raw auth logs, secrets, cookies, OTPs, or setup links were read or reproduced.

## Findings

None. In particular, the final authority correction preserves `instance:admin` global reach while requiring the caller's actual workspace role for workspace-scoped capabilities. Route terminal wrapping leaves declared middleware and validation order intact; enforced sources are exact registered policy-source names, with task policy constrained to the final position after all other registered sources. Policy evaluation re-loads addressed rows for scope, derives capability scope from verified row/request provenance, refuses missing or inconsistent evidence, and evaluates reach separately from authority. Customer-private work items are restricted to requester/participants for customer identities while staff with project reach remain able to handle them. The reviewed policy changes consistently add the declared read-capability decision where the former path only checked reach/membership.

The route-level and pure regression coverage inspected pins the relevant constraints; the focused tests above pass. The provided authored report states the original eight negative probes and assigned-capability/member cases pass, but I did not independently execute those PostgreSQL probes in this review.

## Limits and deferred acceptance

I did not run PostgreSQL integration tests, broad CI, Docker/image/traffic proof, full build, or browser checks. The dedicated runtime actor owns the current-source image/traffic proof, and the user explicitly bounded this review away from those checks. The root combined CI and current-image/traffic proofs remain separate acceptance evidence; this report does not claim either passed. Three actual clean UTC date buckets, strict cutover, and the independent GPT-6 Sol phase finalizer remain pending and are not blockers for this code-review verdict by themselves. Historical `c68e84d4` performance evidence is not current-source acceptance.

## Checkout integrity

After review, `HEAD` remains `f19b3bed6bc2e60d71906423b985fadb089da212`; `git status --porcelain` is empty. No source, tests, commit, branch, or external review state was modified.
