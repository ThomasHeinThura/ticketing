# Security review — PR #227 (issue #18: replace the zero-user admin bypass with a setup-token flow)

**Reviewed head:** `7b4159760f947fdee88a91d1a0ff0d084984157b`

Reviewed by a fresh, independent Opus context that neither authored, directed, nor
remediated this change. Reviewed in an isolated worktree checked out at the exact head
above (single commit; merge-base with `main` is `6d9f17990538cd15c51a155fa5574db7975627f4`),
against a private Postgres database (`opusrev227_test`, `opusrev227b_test` on `td-lane-pg`),
not against `main` and not by reading the pull-request body.

**Verdict: CHANGES NEEDED — one blocking finding (B1), five non-blocking (F1–F5).**

The cryptography, the atomic single-use consumption, the durable marker, the advisory-locked
promotion, and the neutered `GET /api/instance/status` are all correct and were independently
re-derived rather than accepted. The blocking finding is that the change does not actually
achieve one of the two security objectives it states: the unclaimed-instance scanning oracle
that `GET /api/instance/status` used to provide is re-created, verbatim and more loudly, by
the new sign-up error message — while `policy.ts`, the OpenAPI description and the pull-request
body all assert that it is gone. The fix is roughly three lines.

## What this PR does

Replaces `apps/api/src/auth.ts`'s unconditional `if (existingUserCount === 0) { return; }`
bypass — under which the first person to sign up on any empty instance became its
administrator with no proof of authorization — with the flow specified in
`docs/01-architecture/auth-and-identity.md` § Break-glass and `security-model.md`'s secrets
table. New `instance_setting` singleton table carries `setup_completed_at`; every boot of an
unclaimed instance prints a fresh 32-byte token (one hour or one use); the zero-user branch
now demands that token (`x-taskdesk-setup-token`) or `TASKDESK_BOOTSTRAP_ADMIN_EMAIL`, and
only while `!setup_completed_at`; the advisory-locked promotion hook re-checks the marker;
`GET /api/instance/status` returns a constant `{status:"ok"}`.

25 files, 6244 insertions. Migration `0061_instance_setting.sql` (one additive `CREATE TABLE`,
no existing object altered), correctly sequenced after PR #225's `0060` on `main`.

## What was independently verified, and how

Everything below was re-derived on a real database with real concurrent HTTP requests, not
read and trusted.

**Token generation and storage (task item 2) — correct.**
`randomBytes(32)` is Node's CSPRNG (`crypto.randomBytes`, OpenSSL-backed), not
`Math.random()`, whose xorshift128+ state is recoverable from a handful of outputs and would
make the token predictable to anyone who had seen any other random value the process emitted.
256 bits, `base64url`-encoded to 43 characters — confirmed at runtime. Only the SHA-256 hex
digest reaches the database: dumped `SELECT * FROM instance_setting` immediately after
generation and asserted the raw token is absent and the expected digest present. No read-back
path exists — `setup_token_hash` is never selected into any response, and the sole plaintext
emission is the documented one-time boot log.

**Single-use atomicity (task item 1, first half) — correct, proven under real concurrency.**
`verifyAndConsumeSetupToken` is one `UPDATE … WHERE hash = ? AND expires > now() RETURNING id`.
Ten concurrent calls with the same valid token: exactly one returned `true`, nine `false`.
Ten concurrent HTTP `/sign-up/email` requests carrying the same token with registration
closed: exactly one 200, nine 403, one user row, one admin. This is Postgres row-level
locking doing the work — the losers block on the row, re-evaluate the `WHERE` under
READ COMMITTED after the winner commits, find `setup_token_hash` now NULL, and match nothing.
There is no read-then-write window.

**The two-mechanism race (task item 1, second half) — see F1.** The `after` hook's
`totalUserCount === 1` test correctly evaluates false for the second arrival, so **two admins
are impossible** — 8/8 trials, never more than one. But the same test can leave *zero*; F1.

**Expiry (task item 3) — correct and genuinely inert.** Both conditions are in the one
statement, so there is no window in which an expired row verifies. Backdated
`setup_token_expires_at` by an hour: `verifyAndConsumeSetupToken` returned false, the HTTP
sign-up returned 403, repeated attempts stayed false, and the expired row sat in the table
harmlessly — it can never match again because the expiry predicate is evaluated on every
attempt, and the next boot overwrites it. Inert in fact, not only by design.

**`isBootstrapAdminEmail` normalization (task item 4) — not exploitable end-to-end.**
At unit level the comparison is *not* the exact match its comment claims: with
`TASKDESK_BOOTSTRAP_ADMIN_EMAIL=kim@example.com`, `"Kim@example.com"` (U+212A KELVIN
SIGN, which JS lowercases to `k`) returns `true`, as does a trailing newline. Reaching the
hook with such a value through HTTP fails — better-auth rejects both with 400 before the hook
runs, confirmed. `+tag`, dotted-local-part, trailing-dot, `NUL`, a `toString`-bearing object,
empty string and a whitespace-only configured value all correctly return `false`. Pure-ASCII
case folding (`KIM@EXAMPLE.COM`) does match, which is right for email. So: safe today, but
defended by a validator in a dependency rather than by the function itself — F4.

**When `setup_completed_at` is set relative to the bootstrap-email check (task item 4).**
The marker is written only in the `after` hook, inside `pg_advisory_xact_lock(2026)`, in the
same transaction as the `role = 'admin'` update, and only when `totalUserCount === 1 &&
!setupAlreadyCompleted`. The bootstrap-email path is read in the `before` hook, strictly
inside `existingUserCount === 0 && !(await isSetupCompleted())`. So the env var cannot be a
standing bypass on a claimed instance — verified: after claiming, deleting every user row,
and then setting the env var, the named address signed up as an ordinary non-admin user.
The one way the marker fails to read back is F3.

**The upgrade path (task item 5) — the hooks' own count makes it harmless for escalation,
but nothing back-fills; see F2.** Simulated an instance that predates this PR (two real users,
no `instance_setting` row). `isSetupCompleted()` correctly returns `false`; the migration
back-fills nothing; `runStartupTasks` back-fills nothing. No bootstrap window opens, because
`existingUserCount === 0` is false by definition on a populated instance — confirmed by
signing up with a freshly issued token and getting an ordinary non-admin user while the
pre-existing admin was untouched. The residual consequences are F2.

**The public route (task item 6) — genuinely constant.** `{"status":"ok"}`, byte-identical
unclaimed and claimed. No other pre-auth surface distinguishes the two either: `/api/config`
is byte-identical in both states, `/api/health` returns the same constant, `/api/health/ready`
is 401 in both. `apps/web` has no remaining reader of `hasUsers`/`hasAdmin` — both call sites
were removed with their `useEffect`s, and the fetcher's type was narrowed with a comment
warning future callers off re-adding the fields. See F5 for the leftover hook.

**Regression tests (task item 7) — 13/13 pass, and they are not vacuous.** Ran
`tests/api-integration/instance-setup-bootstrap.test.ts` on a private database: 13 passed.
Full API integration suite at this head: **64 files / 577 tests, all green**, matching the
pull-request body's claim exactly. Three deliberate mutations:

| Mutation | Caught? |
| --- | --- |
| Restore the unconditional `if (existingUserCount === 0) return;` in the `before` hook | **Yes** — 5 tests fail |
| Drop `&& !setupAlreadyCompleted` from the `after` hook's promotion test | **Yes** — 2 tests fail |
| Drop `gt(setupTokenExpiresAt, now)` from `verifyAndConsumeSetupToken` | **No** — 13/13 still pass |

The third is F5: the "one hour" half of "one hour or one use" has no regression test.

**Scope (task item 8) — clean.** `git diff` against the merge-base touches nothing outside
the change: no dependency, lockfile or `pnpm-workspace.yaml` change at all; no permission,
policy-map or route-shape change beyond the one `instance/policy.ts` entry this PR is about
(`test:permissions` 79/79 unchanged); the nine other touched test files only swap
`signUpUser` for the new `signUpInstanceAdmin`, or call the new `ensureNotFirstSignup`, to
keep tests that never meant to depend on bootstrap timing working — no assertion is weakened
or removed. `ensureNotFirstSignup` correctly sets the marker rather than planting a user row,
avoiding the count inflation its own comment describes. `drizzle-kit check` clean; journal
chain `0059 → 0060 → 0061` intact with no duplicate index. OpenAPI contract matches the
handler.

---

## B1 — BLOCKING: the sign-up error message re-creates the unclaimed-instance oracle

The stated purpose of flattening `GET /api/instance/status` was that "an unauthenticated
caller cannot scan for an unclaimed instance to race for admin" (the OpenAPI description, in
`apps/api/src/index.ts`), and `instance/policy.ts` now records the reviewable assertion
`"public liveness probe for the auth surface; reveals no setup state"`. Both are false as
implemented. `apps/api/src/auth.ts`'s new `APIError` reaches the client verbatim:

- Unclaimed instance, any registration setting, no token:
  `403 {"message":"This instance has not been set up yet. Use the setup URL and token printed
  in the container log (or ask your operator), or set TASKDESK_BOOTSTRAP_ADMIN_EMAIL for a
  headless install."}`
- Claimed instance, registration closed:
  `403 {"message":"Registration is currently disabled. Please use a valid invitation link to
  create an account."}`
- Claimed instance, registration open: `200`.

One unauthenticated POST per host distinguishes unclaimed from claimed, with no session and
no token — the same capability `{hasUsers:false}` used to give, on a route the sign-up page
already calls. It is worse than the old oracle in one respect: the message names
`TASKDESK_BOOTSTRAP_ADMIN_EMAIL`, telling the attacker which second attack to try.

Chained with F3-adjacent behaviour this is a real takeover path, not only reconnaissance:
verified that on an unclaimed instance with `TASKDESK_BOOTSTRAP_ADMIN_EMAIL` set and
`DISABLE_REGISTRATION=true`, a caller who merely *knows* the configured address — no token,
no mailbox proof, no session — gets `200` and `role = "admin"`. Administrator addresses are
routinely guessable (`admin@`, `it@`, `ops@` at the customer's domain). The oracle turns
"guess the address of an instance you happen to know about" into "scan for every unclaimed
TaskDesk on the internet, then guess". `/sign-up/email` is rate-limited to 3/60s per IP,
which bounds neither scanning across hosts nor a distributed guess.

This does not make the change worse than what it replaces — before this PR *any* address
worked, with no guess needed — so it is not a regression. It is blocking because the change
does not accomplish what it says it accomplishes, and because a route-policy `reason` string
and an OpenAPI description are governance artifacts this repository treats as reviewable
assertions, not prose.

**Fix.** Make the tokenless zero-user refusal indistinguishable from the ordinary
registration refusal — reuse `checkRegistrationAllowed`'s existing message, or a neutral
equivalent, and move the operator-facing instructions to the boot log (which already prints
them) and the runbook. Nothing real is lost: the operator learns what to do from the
container log, and the setup page is reached by the printed URL, never by probing. Then
either correct or keep the `policy.ts`/OpenAPI claims, which become true.

## F1 — non-blocking: two simultaneously-armed mechanisms can leave the instance with *zero* administrators

Reproduced 8/8. With a setup token issued **and** `TASKDESK_BOOTSTRAP_ADMIN_EMAIL` set — which
is the *default* state of every headless install, because `ensureSetupToken()` prints a token
on every boot of an unclaimed instance regardless of whether the env var is set — two
concurrent sign-ups, one using each mechanism, both pass the `before` hook (correctly: each
presented a valid credential). Both user rows commit before either `after` hook acquires the
advisory lock, so both see `totalUserCount === 2`, neither is promoted, and
`setup_completed_at` is never written. Result: two ordinary users, no administrator, and the
bootstrap window now permanently shut because `existingUserCount !== 0`.

Two admins are correctly impossible — this is a liveness failure, not an authority failure,
which is why it is not blocking. Recovery does not need the `grant-instance-admin` CLI that
the pull request correctly records as absent: deleting the two user rows re-opens the window.
But that needs direct database access, and an attacker who knows the bootstrap address can
trigger it deliberately against an operator mid-setup.

The same shape exists on `main` (where it needs no credential at all, so this PR strictly
improves it), so it is pre-existing rather than introduced. It is recorded here because this
PR is the change that redesigns this gate, and because the pull-request body's backend
checklist claims "a real concurrent-signup race test (`Promise.all`) resolves to exactly one
admin" — true only for the same-token case the shipped test covers, not for two different
mechanisms.

**Fix.** Condition promotion on "this signup was the authorized bootstrap" rather than on
`totalUserCount === 1` — e.g. have the `before` hook stash the fact that it admitted a
bootstrap signup and have the `after` hook promote on that plus `!setupAlreadyCompleted`,
leaving the advisory lock and marker write exactly as they are. Add the two-mechanism race
to the regression file.

## F2 — non-blocking: no back-fill, so the durable-marker guarantee does not cover any instance that already exists

Neither the migration nor `runStartupTasks` writes `setup_completed_at` for an instance that
already has users. Verified consequences on a simulated pre-PR instance:

- `ensureSetupToken()` issues and prints a full "TaskDesk first-run setup / Setup URL / Setup
  token" banner **on every boot, forever**, on every already-deployed instance — including the
  live UAT stack. Confusing, and it puts a live secret into logs that are often readable more
  widely than the database.
- The headline property is absent: after deleting every user row on such an instance,
  `isSetupCompleted()` is still `false`, a token is reissued, and signing up with it produced
  `role = "admin"`. The "wiping admins cannot re-open the bootstrap window" guarantee holds
  only for instances first claimed *after* this change.

Not blocking: emptying the `user` table needs database write access, which already implies
compromise. But the fix is one additive statement in `0061_instance_setting.sql`, it closes
both the log noise and the residual re-arm, and it should land before the UAT redeploy:

```sql
INSERT INTO instance_setting (id, setup_completed_at)
SELECT 'singleton', now() WHERE EXISTS (SELECT 1 FROM "user");
```

## F3 — non-blocking today, but this is the gate: the singleton assumption is asserted in comments and enforced by nothing

`isSetupCompleted()` and the `after` hook both read `SELECT … FROM instance_setting LIMIT 1`
with no `WHERE` and no `ORDER BY`. Postgres returns an arbitrary row. The table has a primary
key on `id` and a `DEFAULT 'singleton'`, but **no constraint restricting `id` to `'singleton'`**
(confirmed against `pg_constraint`: only the PK and three NOT NULLs).

Demonstrated end-to-end: with a second row (`id = 'branding'`, `setup_completed_at` NULL)
ordered physically first, `isSetupCompleted()` returned `false` 10/10 on a genuinely claimed
instance, and the `after` hook's read saw `null`. With users then wiped and
`TASKDESK_BOOTSTRAP_ADMIN_EMAIL` set, a sign-up returned **200 with `role = "admin"`** on a
claimed instance with `DISABLE_REGISTRATION=true` — a complete re-arm of the window the
marker exists to close. (The token half is incidentally saved by `ensureSetupToken`'s
`where: isNull(setupCompletedAt)` guard, which correctly refuses to re-arm — though it still
prints and returns a token it did not persist; see F5.)

Nothing inserts a second row today — grepped every write to `instance_setting` across
`apps/`, `packages/`, `scripts/` and `tests/`; all four use `id = 'singleton'`. So this is
latent, not live, and therefore not blocking. It is recorded at this weight because
`schema.ts`'s own comment invites the P4 God Mode lane to `ALTER` this table, `data-model.md`
documents a much larger `instance_setting` row, and a second row arriving from that work would
silently fail this P0 gate open with no test going red.

**Fix.** Add `.where(eq(instanceSettingTable.id, SETUP_TOKEN_SINGLETON_ID))` to both reads
(and, for consistency, to `verifyAndConsumeSetupToken`'s `UPDATE`), and add
`CHECK (id = 'singleton')` to the table so the comment's claim is enforced rather than
asserted.

## F4 — non-blocking: `isBootstrapAdminEmail` is not the exact match its contract claims

Detailed above. Safe end-to-end only because better-auth's email validation rejects the
inputs first. Comparing after a Unicode NFKC normalization, or restricting to a strict
ASCII-email comparison, would make the function correct on its own terms rather than
dependent on a validator in another package that a version bump could relax.

Separately, and as a **decision for Thomas rather than a defect**: this PR introduces the
first code anywhere in the repository that actually reads `TASKDESK_BOOTSTRAP_ADMIN_EMAIL`
(previously it appeared only in docs and `scripts/deploy.sh`). It makes an unverified,
frequently-guessable email address sufficient proof to become instance administrator on an
unclaimed instance. That is the plain reading of `auth-and-identity.md` § Break-glass, so the
implementation is spec-faithful; whether the spec should additionally require the token, or
require the mailbox to be verified before promotion, or simply state that a headless instance
must not be internet-reachable before it is claimed, is a product decision, not a review call.

## F5 — non-blocking: smaller items

- **The one-hour TTL has no regression test.** Deleting the expiry predicate leaves 13/13
  green. Add a test that backdates `setup_token_expires_at` and asserts a 403.
- **`ensureSetupToken()` can print and return a token it did not store.** When the
  `onConflictDoUpdate … where isNull(setupCompletedAt)` guard fires, the upsert is a no-op but
  the function still logs the raw token and returns it. Harmless (an unstored token can never
  verify) but the log then advertises a token that does not work. Return `null` when the
  upsert affects no row.
- **The setup token travels in a URL query string** (`/auth/sign-up?setupToken=…`), and
  `sign-up.tsx` does not strip it after use, so it persists in browser history and is exposed
  to `Referer` on any third-party subresource the page loads. Bounded by one hour and one use,
  and the spec prescribes a setup URL, so this is acceptable — but clearing the search
  parameter once the token has been read would cost nothing.
- **`apps/web/src/hooks/queries/instance/use-instance-status.ts` is now dead code** — both
  call sites were removed and nothing else references it.
- The `POST /api/auth/sign-up/email` query-parameter form of the token correctly does **not**
  work (header only), and the header is correctly matched case-insensitively. A token is
  **not** burned when the sign-up subsequently fails validation (better-auth validates before
  the hook), so there is no self-inflicted denial of setup. Both verified.

## Not done in this review

- Did not exercise the flow in a real browser or against the UAT stack; the frontend wiring
  was read and reasoned about, and the header pass-through was verified at the HTTP level via
  the API suite, not by clicking through the setup page.
- Did not test OAuth/OIDC or magic-link first-user creation end-to-end (no live IdP). Verified
  structurally instead: no code anywhere inserts into `user` outside better-auth's adapter, so
  every creation path passes through these hooks; an email-OTP attempt on a fresh instance
  created no user.
- Did not re-audit `checkRegistrationAllowed` or the invitation flow beyond confirming this
  PR does not change them.
