# Pre-merge security review — PR #109 (S8a, native set-active cutover)

**Reviewed head:** `889794619d456d6e06c17072b5eff41a3c360362`
**Base:** `origin/main` = `6bfc0f437796ced76610556ef5a46411cca8486a`

**Verdict: CLEAR WITH FINDINGS.** No HIGH, no MEDIUM, **zero blocking**. Seven non-blocking
findings, none of them a weakening.

**Status of the gate:** this review ran **before** merge and closes the mandatory independent
Opus security review for the head named above, **and for that head only.** A later commit
touching anything outside `docs/07-planning/security-reviews/` voids it. No waiver was sought
or used; none is authorized.

**Reviewer independence.** A fresh Opus context that authored no part of the change — including
no part of the rebase conflict resolution, which was authored by the orchestrator and was
therefore reviewed with more suspicion, not less. It made no edit, commit, push or comment, and
used its own database (`taskdesk_rev109b_test`) so concurrent lanes could not corrupt its
measurements. It left the tree pristine: three untracked probe files, then deleted, with
`git status --porcelain` empty and HEAD unchanged afterwards.

**Classification, self-confirmed rather than accepted.** `await readSecurityReviewScope()` —
23 globs, `removed: []`, `added: []`; non-vacuity probe `apps/api/src/auth.ts` MATCH, negative
probe `README.md` NO-MATCH. **2 of 18 changed files in security scope**
(`apps/api/src/workspace/index.ts`, `apps/api/src/workspace/policy.ts`). The reviewer also ran
the known trap deliberately — calling `readSecurityReviewScope()` *without* `await` yields
`scope.globs === undefined`, hence an empty glob list and a vacuous pass — reproducing the
failure shape in order to confirm it had avoided it.

---

## What was established by demonstration

| Claim | Evidence |
| --- | --- |
| **The activate route enforces membership at runtime** | Non-member → `403`, and *neither* session row moved. Ex-member (membership deleted after a successful activation) → `403`. Nonexistent workspace id → refused. Genuine member → `200`, own row moves — the oracle proving the harness can produce a success. The declarative policy row cannot show this; the middleware does |
| **…and that check is non-vacuous** | Re-running with the assertion flipped to expect `200` for the non-member failed with `expected 403 to be 200`. The refusal is observed, not assumed |
| **One caller cannot move another user's active workspace** | With two live sessions for one user, activating from session 1 moved **only** session 1's row — matched by session id via the stored token, not by `userId`. An injection attempt passing `sessionId`, `userId`, `workspaceId` and `activeOrganizationId` naming a victim, in both the query string and the JSON body, returned `200` with the **victim's row untouched**. The route declares `request: { params }` only and takes the session from `c.get("session")`, so there is no caller-supplied identity to poison |
| **…and that check is non-vacuous** | The reviewer performed the exact vulnerable write the code *would* do if it keyed on `userId` (`.where(eq(sessionTable.userId, …))`) and re-ran the same oracle: it failed. The per-session comparison genuinely detects a cross-session write |
| **A stale active-workspace pointer grants nothing** | Deleting the active workspace NULLs the pointer for every session (`delete-workspace.ts:28-32`) and the dangling id cannot be re-activated. Revoking membership at the data layer *does* leave the pointer stale — and it authorizes nothing: `GET /api/workspace/{id}` and `/members` both flip from `200` to refused for the same cookie. Repo-wide, `activeOrganizationId`'s only API consumers are the sign-in backfill and the three controllers that clear it. Asserting the insecure outcome failed with `expected 403 to be 200` |
| **The still-mounted plugin route keeps its own protection** | `POST /api/auth/organization/set-active` for a member → `200`, pointer moved (so it is mounted, not 404ing). Non-member → `403 USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION`, foreign workspace not adopted. No test in the repo covered this path before; it is intact |
| **Zero live `setActive` callers remain** | Every remaining match in `apps/web/src` is a comment. **Non-vacuity:** a planted file containing a real call *was* found by the same grep, then removed |
| **The permission fixture was regenerated, not widened** | Capability grid **byte-identical** under canonical JSON; 26 → 27 routes; added exactly `POST /api/workspace/{workspaceId}/activate`; none removed, none changed. The reviewer then regenerated the grid from the **live registry** and confirmed the checked-in fixture equals it, and that the new row is identical to the pre-existing `leave` row. **Non-vacuity:** the comparator caught a tampered fixture (one widened `viewer.inReach` cell) and, separately, one with the new row dropped |
| **The conflict resolution swallowed no error path** | At base `6bfc0f4` the three route files had **no `if (error)` branch to delete** — #112 had already collapsed each handler into one `try/catch` that toasts. The branch dropped in the resolution came from **#109's own pre-rebase side**, which predated #112. `accept-invitation.ts:14-17` throws on non-ok, so `mutateAsync` rejects and `data.invitation.workspaceId` is only ever read on success. `accept.$inviteId.tsx` correctly kept its `authClient` import — still used at line 42 for `useSession()` — and the two files that lost theirs have no remaining reference outside comments |

---

## Findings — seven, none blocking

- **NB-1** — `routes/_layout/_authenticated/dashboard/index.tsx:49` swallows activation failure
  with `.catch(() => {})` and does not block navigation. The pre-rebase plugin call swallowed
  the same failure, and the pointer is not an authorization input, so the worst case is a stale
  UI landing workspace.
- **NB-2** — in the two invitation pages and `accept.$inviteId.tsx`, a failure of *activation
  alone* now lands in the shared `catch` and shows the `acceptError` toast while skipping
  navigation, **even though the invitation was already accepted durably**. Cosmetic
  mis-messaging with no security effect; re-entering the page shows the accepted membership.
  Worth a follow-up so the toast does not contradict the database.
- **NB-3** — `routes/.../dashboard/settings/workspace.tsx:59` now `await`s a throwing call
  inside a route loader where the plugin call resolved with a swallowed `{error}`, so a 5xx
  becomes a router error instead of a silent continue. Strictly **fail-closed**, and guarded by
  the `if (session.session?.activeOrganizationId) return;` early exit above it.
- **NB-4** — `controllers/activate-workspace.ts:34-38` does not check that the `UPDATE` affected
  a row, so a vanished session would return `200 {workspaceId}` having written nothing.
  Unreachable behind `requireSessionOnly()` + `requireSessionId`, and a no-op write is fail-safe.
- **NB-5** — **a gate-scoping gap worth carrying forward.** `apps/api/src/workspace/controllers/**`
  is not in `docs/04-engineering/ci-cd.md`'s security-review glob list, so the file that performs
  the actual privileged write classifies **out** of security scope. This PR entered scope only via
  `workspace/index.ts` and `workspace/policy.ts`. Pre-existing, and this PR did correctly trigger
  a review — but a change confined to a controller would not.
- **NB-6** — a cross-site `POST` carrying a valid cookie reaches the native route and performs the
  write. **No posture change:** the reviewer measured the still-mounted plugin route doing exactly
  the same thing (both `200`, both wrote), the pre-existing S5 `leave` route has the identical
  shape, and `sameSite: "lax"` (`get-default-cookie-attributes.ts:35`) stops the browser sending
  the cookie at all for the default same-origin deployment.
- **NB-7** — the declarative row is `allow`/`allow` for all eight roles including out-of-reach, so
  **all** resource enforcement lives in route middleware. Byte-identical to the pre-existing
  `leave` row, documented at `policy.ts:218-234`, and the middleware was demonstrated to enforce.
  Carry into **#8**: when the registry is wired into the live request path, `self` + `sessionOnly`
  must not be read as sufficient on its own for this route.

## Gates, run by the reviewer rather than taken from the author

`typecheck --force` exit 0 (8 tasks, 0 cached) · `lint:ci` exit 0 (1090 files, 0 errors, 57
warnings — **none in any changed file**) · `test` exit 0 (126 files, **847 tests**) ·
`test:permissions` exit 0 (10 files, **76 tests**) · `test:integration` exit 0 on its own
database (50 files, **395 tests**) · `check:openapi` exit 0 (132 operations) ·
`check:route-policy` exit 0. Adversarial probes 11/11 passed; **red probes 3/3 failed as
required**; regeneration probes 4/4 passed. `ps aux | grep vitest` showed **0** concurrent runs
before the integration run, so none of the 395 results are cross-talk.

## What the reviewer explicitly did not do

It did not exercise the change in a browser, so the `authClient.$store.notify("$sessionSignal")`
reactivity claim in the fetcher is covered by its unit tests rather than observed live — the
orchestrator's browser pass, recorded in the pull request's `## Screens opened`, covers that
surface separately. It also did not red-probe the route-policy gate by removing the policy entry,
because that required editing a tracked file, which its brief forbade.
