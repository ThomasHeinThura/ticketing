# Pre-merge security review — PR #16 (inherited attack-surface removal)

**Status of the gate:** this review ran **before** merge and is complete for the code. Two
independent Opus reviews were performed, at two heads. The second returned **CHANGES REQUIRED
— body/process only**: every code finding was verified closed, and what blocked was three
factual defects in the pull-request body itself. This note is one of the three fixes, so it
exists to close the gate it documents. **The current head is not independently cleared** — see
*This rebase and prune pass* below.

**PR #16's purpose.** It is a slice of issue **#6**: delete the inherited kaneo attack surface
and the unsafe auth defaults. The public-project route and `is_public`; the six integration
routers and their tables; billing, trials and Creem; Sentry, Session Replay and Turnstile;
demo mode; kaneo's in-process MCP server and its OAuth consent flow; and from better-auth:
`anonymous()` guest sign-in (**on by default** upstream), `bearer()`, `deviceAuthorization()`,
account linking, the session cookie cache and `openAPI()`. It also fails closed on a missing
auth secret, makes credentialed CORS reflection an explicit development opt-in, relocates the
SSRF guard and stops following outbound redirects, and derives the client IP by trusted hop
count instead of trusting `X-Forwarded-For`.

**Reviewed at:** `a4147a1` (original, merge base `38ff9ac`) → `e022ad5` (remediation).
**Each review saw exactly one head, and its verdict attaches to that head.** The chain is set
out below so no reader can infer a review covered code it never read.

**Method:** both reviewers were fresh independent Opus sessions, neither the authoring session
nor the remediation agent. Both worked in detached throwaway worktrees pinned at the head under
review and explicitly refused the pull-request body as evidence — every claim was re-derived
from the diff, the code, a migrated database, or runtime behaviour. The second review proved F2
by **mutation**: it broke each invariant in turn and recorded which single test failed.

**Reviewer independence caveat, stated plainly:** the same orchestrating session that drove
this branch's remediation also spawned these reviewers. Each was a separate session with fresh
context and no knowledge of the authoring rationale, which satisfies "a different session" — but
it is not an outside pair of eyes and is not recorded as one. Both reviewers corrected the
branch on substance, which is some evidence the independence was real; it is not proof.
**Thomas should treat the CRITICAL list as needing his own confirmation.**

---

## The review chain — which head each review actually saw

| # | Review | Head reviewed | Posted | Verdict at that head |
| --- | --- | --- | --- | --- |
| 1 | [Independent security review](https://github.com/ThomasHeinThura/ticketing/pull/16#issuecomment-5560626919) | `a4147a1` | 2026-09-06 16:36Z | **CHANGES REQUIRED** — C1/C2/C3 VERIFIED-CLOSED; F1 and F2 block; 6 low, 1 info open |
| 2 | [Delta re-verification](https://github.com/ThomasHeinThura/ticketing/pull/16#issuecomment-5565015014) | `e022ad5` | 2026-09-07 04:25Z | **CHANGES REQUIRED — body/process only.** F1, F2, F3 VERIFIED-CLOSED; C1/C2/C3 not reopened; **no remaining code blocker** |

Review 1 raised F1 and F2 as blockers and F3 as a suggested-path item; the remediation commit
`e022ad5` closed all three. Review 2's delta was **one commit** — 33 files, +344/−747 — with
`a4147a1` a linear ancestor, no history rewrite, and the head stable at start and end.

**Neither review has seen the current head.** Review 2 predates the rebase onto merged #21 and
the ratchet prune.

---

## Totals

| Severity | Count | Disposition |
| --- | --- | --- |
| **CRITICAL** (inherited from #13) | **3** | **All VERIFIED-CLOSED at `a4147a1`, confirmed not reopened at `e022ad5`** |
| MEDIUM | 3 | F1, F2, F3 — all **VERIFIED-CLOSED** at `e022ad5` |
| LOW | 6 | open follow-ups; none exploitable, none this slice's to fix |
| INFO | 1 | de-branding / dead-config leftovers |
| Body / process blockers | 3 | B1, B2, B3 — fixed in this pass |

---

## CRITICAL — the three from the #13 kaneo-import review

These are not #16's defects; they are what #16 exists to close. All three were re-proved at
runtime rather than read off the diff.

### C1 — a missing auth secret silently became a published constant · VERIFIED-CLOSED

kaneo passed `secret: process.env.TASKDESK_AUTH_SECRET || ""`, and an empty string is falsy
inside better-auth, so its own chain fell through to a constant published in its source. The
length guard only fired when the variable was already set, and `validateSecret` only *threw* for
the default under `NODE_ENV === "production"` — which is routinely unset on a self-hosted box.
The documented Helm install therefore signed every session cookie with a value anyone can read
on npm.

**Verified at `a4147a1`, against the built bundle:** `TASKDESK_AUTH_SECRET` unset → `exit 1`;
10 characters → `exit 1`; `BETTER_AUTH_SECRET` set instead → `exit 1`; `AUTH_SECRET` set instead
→ `exit 1`. No fallback to a library default, no short secret accepted, **no listener bound**.
Re-run against the bundle at `e022ad5` with the same four results.

### C2 — credentialed CORS reflected any origin on the default deployment · VERIFIED-CLOSED

`reflectUnconfiguredOrigins = process.env.NODE_ENV !== "production"` — and "not production"
includes *unset*. With `credentials: true`, any site a logged-in user visited could read their
authenticated responses.

**Verified at runtime:** `NODE_ENV` unset, no `CORS_ORIGINS`, no `TASKDESK_AGENT_URL`, and
`Origin: https://attacker.example` on `GET /api/auth/get-session` returns **no
`access-control-allow-origin` header at all**. Reflection is now `NODE_ENV === "development"` —
explicit opt-in, failing closed for unset and for unexpected values.

### C3 — `bearer()` published the raw session token to any origin · VERIFIED-CLOSED

`bearer()` emits the session token in a `set-auth-token` response header with
`Access-Control-Expose-Headers`; chained with C2 it was readable cross-origin with no XSS.

**Verified by plugin-graph enumeration plus live header capture.** Mounted plugin ids at
`e022ad5`: `last-login-method, magic-link, email-otp, organization, generic-oauth, api-key,
admin`. **Zero** bearer / anonymous / device / jwt / one-time-token / mcp / openAPI. Sign-up and
sign-in responses carry **no `set-auth-token`** and **no `Access-Control-Expose-Headers`**, and a
substring search for the issued session token across every non-cookie header returns nothing.

**Blast radius at `e022ad5`, checked rather than inferred:** the delta touches `auth.ts` **no**,
`index.ts` **no**, `drizzle/**` **no**, `pnpm-lock.yaml` and `apps/api/package.json` **no**. The
only `utils/` file touched is `get-settings.ts`, and only to delete the `hasGuestAccess` line.

---

## The three findings this branch's own review raised

### F1 — guest sign-in removed server-side, retained client-side, still advertised · VERIFIED-CLOSED

`anonymous()` was gone from the server plugin list while `auth-client.ts` still registered
`anonymousClient()`, `sign-in.tsx` and `sign-up.tsx` still called `authClient.signIn.anonymous()`,
and `get-settings.ts` still returned `hasGuestAccess: DISABLE_GUEST_ACCESS !== "true"` —
**default true**. Net effect: a default deployment rendered "Continue as guest", the button
**404**ed, and `/api/config` misreported instance capability to any caller. The PR had touched
both screens for the Turnstile removal and left the guest path alone.

Not exploitable — but the review's point stands: this is the loose end the slice exists to
eliminate, and a config endpoint that lies about instance capability is a security-relevant lie.

**Closed in `e022ad5` and verified at that head:** the client plugin, both call sites, the
rendering flag, `hasGuestAccess` and `DISABLE_GUEST_ACCESS` are all gone.

### F2 — the SSRF fix had no regression guard at all · VERIFIED-CLOSED, non-vacuously

The most consequential finding, because it was a **false coverage claim** rather than a code
defect. The hardening in `0e046a6` (H10/H12) was correct — the reviewer read both halves and
said so — but nothing anywhere in `tests/` asserted `redirect: "manual"`, and nothing asserted
that the relocated `assertPublicWebhookDestination` was still invoked by the three senders that
import it. **Deleting either line broke no test.** That directly contradicted the branch's own
ticked checklist item *"Each fix has a regression guard that fails if the defect returns"* — on a
branch whose entire thesis is that the guards are what prove the work.

`e022ad5` added `tests/api/notification-preferences/delivery-ssrf.test.ts`, which mocks the
database and the secret decryptor **only**. The guard itself is not mocked: it runs against real
loopback and link-local addresses and really throws, and the `RequestInit` handed to `fetch` is
inspected rather than fabricated.

**Verified by mutation — four mutations, each reverted, none pushed:**

| # | Mutation | Result | Failing assertion |
| --- | --- | --- | --- |
| 1 | delete `redirect: "manual"` | **1 failed / 3 passed** | `expected undefined to be 'manual'` |
| 2 | remove the **ntfy** guard | **1 failed / 3 passed** | `expected "fetch" to not be called at all, but actually been called 1 times` |
| 3 | remove the **gotify** guard | **1 failed / 3 passed** | same |
| 4 | remove the **webhook** guard | **1 failed / 3 passed** | same |

Every mutation fails **exactly one** test, and exactly the corresponding one. The old fixture's
failure mode — passing while never reaching the sender — cannot recur, because mutations 2–4
prove each sender is individually reached and the assertion is *"nothing left the process"*
rather than *"it threw"*. Baseline 4 passed / 4.

**Not covered, non-blocking:** the three save-time guard calls in `service.ts`. Those are input
validation; the delivery path is the actual sink and is now pinned.

### F3 — the dead MCP OAuth device-flow client · VERIFIED-CLOSED

`packages/mcp` retained the entire device-flow client: `device-flow.ts` still POSTed to
`/api/auth/device/code` and `/api/auth/device/token` — **both 404 at HEAD** — `auth-service.ts`
still drove it as the interactive fallback, and `token-store.ts` still persisted `accessToken` to
`~/.config/taskdesk-mcp/credentials.json`. Its tests passed only because they mocked `fetch`.

`e022ad5` deleted the flow and, deliberately, **the credential read path with it**. A
`credentials.json` still on disk holds a token minted by a removed authorization path; reading it
would let that token keep authenticating. `clearCredentials()` remains so a stale file can be
purged rather than left lying around ignored.

**Verified at `e022ad5`** by enumerating every credential-file write in `packages/mcp` — the read
path is gone, and a test asserts a stored credential is no longer honoured in a way that cannot
be satisfied except by not reading the file.

---

## Open follow-ups — deliberately not fixed in this slice

None is exploitable; each is recorded so it is not rediscovered as new.

| # | Finding | Owner |
| --- | --- | --- |
| L1 | `GET /api/auth/device` route wrapper survived `deviceAuthorization()` — `security: []`, published in the OpenAPI document, and a document navigation still 302s to a `${TASKDESK_AGENT_URL}/device` route that does not exist. Non-document requests fall through to `auth.handler` → 404 | #6 follow-up |
| L2 | `deviceAuthorizationClient()` residue in the web app | #6 follow-up |
| L3 | Stale, now-false security statement served in the public API spec — `getAsset`'s description still says *"Readable without signing in only when it belongs to a public project"*. `GET /api/openapi` returns 200 unauthenticated, so the false claim is publicly served. **The code is correct**; doc string only | #6 follow-up |
| L4 | `requireBulkTaskEntitlement` is a no-op that still parses the body. Authorization is unaffected — `requireBulkTaskPermission` runs immediately before it — but the name reads as an enforced control | #6 follow-up |
| L5 | Hop counting trusts a chain of exactly `trustDepth` entries without consulting the peer, so a forged single-entry `X-Forwarded-For` at the default depth 1 is taken verbatim. **Safe as shipped** — `compose.yml` publishes no ports and says why, `deploy/compose.prod.yml` publishes none and sets `TASKDESK_TRUST_PROXY: "1"`. Residual only when the image runs outside the shipped compose with the port exposed. Accepted design | accepted |
| L6 | `open@^11.0.0` declared and unused in `packages/mcp/package.json` — removing it needs a lockfile regeneration | **#19** lockfile/audit pass |
| I1 | De-branding / dead-config leftovers: `DEVICE_AUTH_CLIENT_IDS`, `VITE_SENTRY_DSN`, and the SSRF bypass switch still named `KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS` | #6 follow-up |

---

## Body and process blockers — what actually held the second verdict at CHANGES REQUIRED

Review 2 found **no remaining code blocker**. Three body facts held it, each named as a one-line
fix, all three fixed in this pass:

- **B1** — `## Security review` still asserted the review was **not done**, while the body said
  the opposite seven lines further down. The section contradicted itself, and no #16 review note
  was committed where `definition-of-done.md` requires one. **This document is that note**, and
  the section now records the chronology truthfully.
- **B2** — the section headed *"every figure re-measured at HEAD `e022ad5`"* contained an
  unlabelled **stale count table** (490 / api 38·243 / mcp 8·33) contradicting the correct
  summary table fifteen lines above it, and the delta's own test changes were not reconciled at
  all. Every current figure has been re-measured after the rebase and reconciled.
- **B3** — the `## Gates` table produced **15 reproducible failures** against
  `check-pr-template.mjs`, because its Result cells carried prose (`n/a — no new UI`) where the
  checker accepts only `pass`, `n/a` or `waived`. Reproduced here with #19's real checker, and
  fixed by moving every reason into prose beneath the table.

Review 2 reproduced B3 by running the real checker; B1 and B2 it verified as factual
contradictions inside the body.

---

## This rebase and prune pass — not independently reviewed

PR **#21** merged to `main` as `cc5d732` while this branch was still based on `38ff9ac`. This
pass rebases onto it and reconciles the two monotonic ratchets #21 introduced.

**The rebase replayed all 14 commits with zero conflicts.** Every security-verified file is
byte-identical to `e022ad5` — proved by comparing blob hashes for `require-auth-secret.ts`,
`index.ts`, `auth.ts`, `assert-public-destination.ts`, `delivery.ts`, `delivery-ssrf.test.ts`,
`resolve-client-ip.ts` and all three `packages/mcp/src/auth/` files, and by a name-status diff
that shows **zero deletions and zero modifications** to anything this branch owns.

**Ratchet prune, derived rather than hand-matched.** #21's suite loads the real constructed Hono
app and the real better-auth instance, so its own `baselineStale` answers exactly the question
the prune asks.

| | main (`cc5d732`) | after #16 |
| --- | ---: | ---: |
| Router routes | 138 | **90** |
| `inherited-uncovered.json` entries | 128 | **80** |
| `pendingRemoval` entries | 4 | **1** |

Routes deleted by #16: **48**. Routes added: **0**. `baselineStale`: **48** — the *identical
set*. `orphanedPolicies` and `uncovered` are both **0**, which is the security-relevant part:
#16 deleted only routes still in #8's unclassified backlog, none of the ten #21 had classified,
and it added none. `organization` **remains** pending removal, because the plugin is still
mounted while the retrofit is written.

**Both ratchets are live for the first time.** #21's own independent review recorded them as
inert on its bootstrap path, because neither file existed at its merge base. They exist at this
one: the growth check reads both at the merge base with `main`, reports **0 added**, and an
injected probe entry is caught.

**Two changes in this pass go beyond pruning, and a reviewer should treat each as reopening an
invariant:**

1. **`open-api`'s verdict moved from `kept` to `removed`** in `packages/permissions/src/better-auth-plugins.ts`,
   with the same correction in `docs/01-architecture/auth-and-identity.md`. `checkPluginList`
   asserts `keptMissing` is empty, and `open-api` was absent from the constructed graph while the
   contract still called it *"kept — development only"*. #16 removed `openAPI()` deliberately: it
   mounts an unauthenticated `/api/auth/reference` pulling an **unpinned**
   `cdn.jsdelivr.net/npm/@scalar/api-reference` bundle into the API's own cookie origin — **H19**
   of the [#13 review](13-kaneo-import.md), and the first item on that review's *"add to issue #6's
   removal list"*. Re-adding the plugin would restore the hole; adding it to `pendingRemoval`
   would be false, since it is not constructed. The API's **own** OpenAPI document is
   `@hono/zod-openapi` at `GET /api/openapi` and is untouched. **This is a shared-contract change
   to a file #21 owns and #21's review cleared.**
2. **A dangling import was removed** from `tests/api-integration/helpers/database.test.ts`. `fc34d20`
   deleted `mcpOauthStateTable` from the schema and the test that used it, but left the symbol in
   the import list — an import of a name the module no longer exports. **No gate caught it:**
   `apps/api/tsconfig.json` includes `src/**/*` only, so asking `tsc` to list its program files
   returns **zero** under `tests/api-integration`; vitest transforms with esbuild, which strips
   types without resolving them, so the dead import was erased and never failed at runtime
   either. biome's `noUnusedImports` was the only thing that saw it, as a warning.

**New finding, not fixed here:** `tests/api-integration/**` is outside every typecheck program,
so a broken import in an integration test is invisible to `pnpm typecheck`. That is a
CI-configuration matter for **#10/#19**, not a #6 removal, and was reported rather than widened
into.

---

## Gate evidence — re-measured after the rebase

| Gate | Result | vs `e022ad5` |
| --- | --- | --- |
| `pnpm --filter @taskdesk/permissions test` | **233 passed / 11 files** | 10 / 1 → **+223, +10 files** (all #21) |
| `pnpm test:permissions` | **74 passed / 10 files** | new — the gate did not exist on this branch before |
| `pnpm --filter @taskdesk/api test` | **247 passed / 39 files** | unchanged |
| `pnpm test --force` (9/9 tasks, cache bypassed) | **714 passed / 111 files** | 491 / 101 → **+223, +10** |
| `pnpm --filter @taskdesk/mcp test` | **30 passed / 7 files** | unchanged |
| `@taskdesk/web` | **185 passed / 47 files** | unchanged |
| SSRF regression file, run directly | **4 passed / 4** | unchanged |
| `pnpm test:integration` (**fresh** database, PostgreSQL 18.6) | **189 passed / 24 files**, 0 failed, 0 skipped | unchanged |
| `pnpm typecheck --force` | **6/6, 0 cached**, exit 0 | unchanged |
| `pnpm build --force` | **5/5, 0 cached**, exit 0 | unchanged |
| `biome ci .` | exit 0, **945 files**, 42 warnings, **0 errors** | 902 → 945 (+43 from #21's new files); warnings all `noUndeclaredEnvVars` in inherited code |
| `pnpm i18n:check` | exit 0, all locales in sync | unchanged |
| `pnpm i18n:report` | **exit 1 — RED, and red on `main` too** | see below |
| `pnpm audit` | **0 critical · 8 high · 3 moderate — RED, inherited, transitive, NOT called green** | unchanged |
| GitGuardian | **failure — RED, NOT called green** | unchanged |
| CodeQL · Analyze (javascript-typescript) | pass | unchanged |

The full-unit reconciliation is exact. Review 2 derived `491 = 247 + 185 + 30 + 16 + 10 + 3`
across api, web, mcp, email, permissions and libs. Only `packages/permissions` changed:
`index.test.ts` was renamed to `legacy-better-auth-access-control.test.ts` with **one import line
altered** (`R099`), so its 10 tests are the same 10 tests, now counted inside #21's 233.
**491 − 10 + 233 = 714**, and **101 + 10 = 111 files**.

**Two reds are inherited and are not being called green.** `pnpm audit` is 8 high and 3 moderate,
all transitive (`js-yaml`, `nanoid`, `deepmerge-ts`, `mysql2`, `qs`, `fast-uri`), and is owned by
**#19**'s lockfile/audit pass. **GitGuardian fails**, as it did at both reviewed heads; review 1
noted it had no dashboard access and could not confirm which literal fires, and ten files on
`main` carry inherited credential-shaped literals. Neither is this slice's to fix.

`pnpm i18n:report` exits 1 on `main` as well (2,666 reported keys) and exits 1 here (2,989). The
increase is #16 deleting the integrations, billing and demo-mode screens while their translation
strings remain. `pnpm i18n:check` — the sync gate — is green. Removing ~323 orphaned keys across
twenty-odd locale files is a separate change and was not attempted here.

---

## What this PR completes, and what it does not

**Issue #6 remains OPEN after this PR.** #16 is a slice. What remains inside #6 is the
`organization()` retrofit — the plugin is still mounted, `organization` is still the one entry on
the pending-removal list, and Throttle 1's second condition requires the **issue** to complete,
including the retrofit through S10, not merely that a slice merged.

**Issue #17 is untouched and must not be read as satisfied.** The F3 cleanup stops the MCP client
from **presenting** a stale credential. It revokes nothing server-side. Sessions the device and
MCP-OAuth flows already minted remain live 30-day rows in `session`; migrations `0048` and `0049`
say exactly this in their own comments, and the replacement code repeats it. **#17 is the
server-side revocation of already-minted sessions**, and it is still open.

**Issue #8 owns the runtime obligations**, including the H2 registration-order finding reopened
against it after #21 merged. Nothing in this PR classifies a route or attaches the evaluator.

---

## Disposition summary

- **3 CRITICAL — all VERIFIED-CLOSED**, each re-proved at runtime against the built bundle or a
  live plugin graph, and confirmed not reopened by the delta.
- **F1, F2, F3 — all VERIFIED-CLOSED.** F2 with a four-mutation proof in which every mutation
  fails exactly one test, which is the standard this branch's own false coverage claim made
  necessary.
- **6 LOW and 1 INFO open**, none exploitable, each with a named owner.
- **B1, B2, B3 fixed in this pass** — the three body/process defects that were the entire
  remaining content of review 2's CHANGES REQUIRED verdict.
- **The current head is NOT independently cleared.** Review 2's clearance attaches to `e022ad5`.
  This pass rebased onto merged #21, pruned both ratchets, corrected a shared contract in
  `packages/permissions` and removed a dangling import. A scoped delta re-verification is owed.
- **Not merged. Only Thomas decides merge.**
