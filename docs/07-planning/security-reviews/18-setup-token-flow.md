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

---

# Delta confirmation — 2026-09-22

**Reviewed head:** `039804c9d9b5ef0d23a1a24fbc74edb5c3fe4860`

Reviewed by a second fresh, independent Opus context that neither authored, directed, nor
remediated this change, and which did not perform the original review above. Checked out in
an isolated worktree at the exact head above (merge-base with `main` is
`407c706c02f025613d548d71f307388e472f1bb5`), against a private Postgres database
(`td_opus_227_delta`, `td_opus_227_f2` on `td-lane-pg`), not against `main`.

Scope: confirm the remediation of **B1** and **F2–F5** claimed in `75b80ce`. **F1** was
deferred to a tracked follow-up and was not re-derived here.

**Verdict: CHANGES NEEDED — B1 is closed on the path that was tested and re-opened by a
one-field variant of the same request; F4's claimed fix does not do what it claims and its
regression test is vacuous.**

## Delta actually reviewed

The originally-reviewed head `7b41597` is the branch's *first* commit, so four commits sit
between it and the current head — one more than the remediation commit named in the brief:

| Commit | Contents | In the claimed remediation? |
| --- | --- | --- |
| `f3e6f4b` | `data-model.md` — names `setup_token_hash` / `setup_token_expires_at` | No (docs only) |
| `f96e2cb` | deletes `apps/web` `get-instance-status.ts` fetcher + `use-instance-status.ts` hook | No (dead-code cleanup the original review flagged) |
| `75b80ce` | B1 + F2–F5 | Yes |
| `a154be9` | merge of `origin/main` — brings only `docs/07-planning/status.md` | n/a |
| `039804c` | this review note | n/a |

Both out-of-claim commits are benign and verified: the two deleted web modules have **zero**
remaining references anywhere in `apps/web/src`, both parent directories are gone, and the
`apps/web` suite is green. Nothing else outside the claimed remediation slipped in.

## Findings

### D1 (BLOCKING) — B1's scanning oracle is re-opened by adding any `invitationId` to the same request

The B1 message fix is real and its test is genuinely load-bearing (reverting only the message
literal makes `(B1)` fail — verified). But it closes the oracle only for a sign-up request
that carries **no** invitation id. Adding one syntactically-valid junk id — the whole
requirement is `/^[a-z0-9_-]{1,128}$/i` — restores the distinguisher, still unauthenticated,
still one request.

The cause is `auth.ts`'s HTTP-level `hooks.before` middleware, which computes
`isInstanceAdminSetup = existingUserCount === 0` and returns *early* on a zero-user instance,
so an unclaimed instance never reaches `checkRegistrationAllowed` at all and is refused later
by the `databaseHooks` branch with the "no invitation presented" message — while a claimed
instance does reach `checkRegistrationAllowed`, which has **two** distinct refusal strings.

Measured on a real instance, `DISABLE_REGISTRATION=true`, both requests unauthenticated:

| Request | Unclaimed instance | Claimed instance |
| --- | --- | --- |
| no `invitationId` | 403 `Registration is currently disabled. Please use a valid invitation link to create an account.` | 403 *(identical)* |
| `invitationId: "notarealinvite"` | 403 `Registration is currently disabled. Please use a valid invitation link to create an account.` | 403 `Registration is currently disabled. You need a valid invitation to create an account.` |

The second row is the finding. This is not a new class — it is B1, in the exact configuration
B1 is about, reachable by adding one field. It is strictly weaker than the original (it does
not name `TASKDESK_BOOTSTRAP_ADMIN_EMAIL`), but "unclaimed" is precisely the signal that makes
guessing the bootstrap address worth attempting, so it feeds the same chain. The per-IP
sign-up limiter (3/60s) does not mitigate host-scanning, which sends one request per host.

The original review's own "Not done in this review" section says it did not re-audit
`checkRegistrationAllowed` — which is where the remaining half of the oracle lives.

Suggested fix: refuse the uncredentialed zero-user case with `checkRegistrationAllowed`'s
message **for the same inputs** (i.e. call it and reuse `result.reason`), or collapse
`check-registration-allowed.ts`'s two refusal strings into one. The `(B1)` regression test
must then be parameterised over `invitationId` present/absent — as written it would not have
caught this.

### D2 (non-blocking, but the claim is wrong) — F4 is not fixed, and its test cannot fail

`normaliseEmail()` NFKC-normalizes before folding case. NFKC maps **U+212A KELVIN SIGN to
`K`**, which then lowercases to `k` — so the exact trick F4 named still produces a false
match. Measured:

- configured `koperator@example.com`, candidate `Koperator@example.com` → `true`
  under the old code **and** `true` under the new code. Unchanged.
- NFKC also *widens* matching: fullwidth `ａdmin@example.com` vs `admin@example.com` was
  `false` before and is `true` now.

The shipped `(F4)` test does not detect this because its candidate **prepends** the Kelvin
sign to the configured address (`K` + `operator@example.com` vs `operator@example.com`)
rather than substituting it for a `k`. That is a different string by one extra character
under any normalization. Verified directly: reverting `normaliseEmail` to the bare
`value.trim().toLowerCase()` it replaced leaves the `(F4)` test **passing**.

End-to-end security impact remains nil, for the reason the original review gave and for one
more: on an unclaimed instance, presenting the *correct* bootstrap address already succeeds by
design, so a homograph of it grants nothing extra. But a green test asserting a property that
is not true is the failure mode this project's process exists to prevent, and the note that
F4 is closed should not stand. Either normalize *and* reject non-ASCII/non-normalized
addresses, or withdraw the claim; either way the test must fail when the fix is removed.

### D3 (informational) — one read F3 claims to have scoped is still unscoped

`isSetupCompleted()` and `verifyAndConsumeSetupToken()` are now `WHERE id = 'singleton'`, but
the read inside `auth.ts`'s advisory-locked `after` hook is still
`.from(instanceSettingTable).limit(1)` with no `WHERE`. Harmless in practice — the new CHECK
makes a second row impossible — but the remediation's claim of "WHERE-scoped reads" is not
complete.

## Confirmed correct

- **B1 (partial, see D1).** Message is byte-identical to `check-registration-allowed.ts`'s
  no-invitation-presented string; the `(B1)` test fails when only the message literal is
  reverted.
- **B1's chained escalation, re-derived.** Presenting the *correct* `TASKDESK_BOOTSTRAP_ADMIN_EMAIL`
  on an unclaimed, registration-closed instance still returns 200 and `role: admin`. That is
  the specified headless-install path, not a defect — B1 was always about the message naming
  the mechanism, not about the mechanism. Confirmed unchanged and correct.
- **F2.** Verified against the *shipped* SQL, not a reimplementation, on two databases:
  migrated a fresh database to 0060-equivalent state, inserted a user row, ran
  `0061_instance_setting.sql` verbatim through `psql` → singleton row created with
  `setup_completed_at` non-null. On a genuinely fresh database (no `user` rows) the
  `WHERE EXISTS` guard correctly wrote nothing. `--> statement-breakpoint` splits cleanly and
  `drizzle-kit migrate` applies the file without error.
- **F3.** The CHECK is really on the table
  (`CHECK (id = 'singleton'::text)`). `INSERT ... VALUES ('not-singleton')` is rejected by
  Postgres with `instance_setting_id_singleton`; `INSERT ... VALUES ('singleton')` succeeds;
  a second default insert is rejected by the primary key. PK + CHECK together make exactly-one-row
  a real invariant.
- **F5 (partial, as claimed).** `ensureSetupToken()` now `.returning()`s and returns `null`
  when the `onConflictDoUpdate` WHERE guard suppresses the write, so it can no longer print a
  token it did not store. `sign-up.tsx` captures the token into a ref on first render and
  strips it from the URL with a mount-only `replace` navigation. The one-hour TTL still has
  **no** regression test — correctly still open.
- **F1 / issue #231.** Open, and an accurate description of the deferred finding: the
  zero-admin liveness race between two simultaneously-armed mechanisms, explicitly noting two
  admins remain impossible, that `main` is worse today, the DB-access recovery path, and a
  concrete suggested fix plus the regression test it needs.

## Evidence

- `apps/api` integration: **64 files / 582 tests passed** (expected 64/582).
- `apps/api` unit: **48 / 323 passed** (expected 48/323; requires `packages/permissions` and
  `packages/email` built first — a bare worktree fails to resolve them).
- `apps/api` permissions: **10 / 79 passed**, unchanged.
- `apps/web`: **57 files / 236 tests passed** (expected 57/236).
- `drizzle-kit check`: `Everything's fine` — no drift.
- `instance-setup-bootstrap.test.ts` alone: 18 passed, including all five new cases.
- Negative controls: reverting only the B1 message literal → `(B1)` fails as designed.
  Reverting only the F4 NFKC call → `(F4)` still passes (D2).

## Not done in this delta confirmation

- Did not re-derive the original review's cleared areas (cryptography, single-use consumption,
  the durable marker, advisory-locked promotion, `GET /api/instance/status`) beyond confirming
  `75b80ce` did not disturb them.
- Did not re-derive F1; it is tracked in #231 and out of scope here.
- Did not exercise the `sign-up.tsx` URL-stripping in a real browser — read and reasoned
  about only; the `apps/web` suite has no test covering it.
- Did not audit the invitation flow itself, only the two refusal strings in
  `check-registration-allowed.ts` that D1 depends on.
- Did not test OAuth/OIDC or magic-link creation paths.

---

## Remediation of D1 and D2 — 2026-09-22 (orchestrating session, awaiting delta-confirmation)

Both findings above addressed in commit `c45bf2e`.

**D1:** `invitationId` is now normalized once, up front, and the SAME
`checkRegistrationAllowed(user.email, invitationId, ...)` call decides the refusal message
in both the zero-user bootstrap branch and the ordinary registration branch — identical
inputs now produce identical outputs regardless of claimed/unclaimed state, for any
request shape, not just the plain one B1 originally tested. When that call itself reports
`allowed: true` (registration open), there is no error message to mirror (a claimed+open
instance answers 200, not an error body), so this falls back to the original fixed refusal
text; the residual 200-vs-403 signal in that one configuration is inherent to never letting
an unauthenticated signup through on an unclaimed instance at all.

**D2:** replaced the NFKC-then-lowercase comparison with an ASCII-only case fold
(`foldAsciiCase`, matching only `[A-Z]`), which cannot touch U+212A regardless of NFKC's own
decomposition tables. Also rewrote the F4 test: it now substitutes U+212A for the leading
"k" of a same-length configured address (`kelvinSignVariant.length === "koperator@example
.com".length`, asserted explicitly), rather than the original's length-mismatched
construction that could never have failed regardless of the underlying bug.

New test (D1) and rewritten test (F4/D2) both confirmed, by the orchestrating session, to
fail against their respective pre-fix code and pass against the fix (temporarily reverted
each in turn, re-ran, restored). Full suite re-verified: 64 files/583 tests (integration,
+1 over the prior 582), 48/323 unit, 10/79 permissions (unchanged), `drizzle-kit check`
clean.

Because the orchestrating session authored this remediation, it cannot also be the
independent reviewer who clears it (`CLAUDE.md`'s no-self-review rule) — a further delta
confirmation by a fresh, independent context is required before this PR can merge.

---

# Second delta confirmation (third Opus pass) — 2026-09-22

**Reviewed head:** `52953c861ff95a66380b968126bede147b5fca81`
(branch `fix/18-setup-token-flow`; remediation commit under review `c45bf2e`, plus the
docs-only `52953c8` on top of it)

**Reviewer:** fresh, independent Opus context. Did not author PR #227, the B1/F2–F5
remediation, or the D1/D2 remediation, and did not orchestrate any of them.

**Verdict: CLEAR WITH FINDINGS.** D1's fix is correct and I could not break it by any
request shape I could construct. D2's fix is correct and generalises properly to Unicode
confusables beyond the Kelvin sign. The restructuring introduced nothing new. Two findings
below (D3, D4) are real and worth closing, but neither is caused by `c45bf2e` and neither is
a regression against `main` — D3 is a pre-existing oracle in code this PR never touched, and
D4 is a test-fidelity gap, not a defect in the shipped behaviour.

## Delta actually reviewed

`git diff 039804c..52953c86` is four files and nothing else:
`apps/api/src/auth.ts`, `apps/api/src/instance/setup-token.ts`,
`tests/api-integration/instance-setup-bootstrap.test.ts`, and this note. The source diff
matches the remediation description exactly; no unrelated change rode along. The full
`git diff` against the merge-base with `main` (`407c706c`) is coherent with the PR's stated
purpose — no dependency-graph, CI-machinery or migration-journal change beyond the
already-reviewed `0061_instance_setting`.

## D1 — confirmed fixed

Verified with real HTTP requests against a real Postgres database (a dedicated
`opus_r3_d1d2_test` on `td-lane-pg`, migrated with `drizzle-kit migrate`), comparing an
unclaimed instance against a claimed one for each request shape, byte-for-byte on both
status and body:

| request shape (`DISABLE_REGISTRATION=true`) | unclaimed vs claimed |
| --- | --- |
| plain sign-up, no invitation | byte-identical 403 |
| `invitationId` in the JSON body, unresolvable | byte-identical 403 |
| `x-invitation-id` header, unresolvable | byte-identical 403 |
| `?invitationId=` query string, unresolvable | byte-identical 403 |
| `invitationId` that fails `normalizeInvitationId`'s syntax regex | byte-identical 403 |

The body-field case is the one D1 named, and it is closed: both instances now return
`"Registration is currently disabled. You need a valid invitation to create an account."`
where previously the unclaimed one returned the other message. Reverting only the D1 hunk
(restoring the hard-coded message) makes the `(D1)` test fail with exactly that message
divergence; restored afterwards.

Three further things I checked rather than assumed:

- **`allowInvitationByEmail` consistency.** Both call sites now use the literally identical
  expression `{ allowInvitationByEmail: isOAuthCallbackPath(ctx?.path) }` on the same `ctx`,
  so they cannot diverge for the same request. For `/sign-up/email` it is `false` on both
  sides; for `/callback/*` the `hooks.before` middleware's registration check is skipped on
  a claimed instance too (its final block is gated on `ctx.path === "/sign-up/email"`), so
  both claimed and unclaimed reach the same `databaseHooks` call with `true`. Symmetric.
- **The `bootstrapRefusal.allowed` fallback.** With registration open, an unclaimed instance
  answers 403 and a claimed one answers 200 with a session — the inherent signal the fix's
  own comment claims, and I confirmed it is the *only* difference there: the 403 body is the
  same fixed text with and without an `invitationId`, so the open configuration adds no
  *new* distinguishing signal beyond that 200-vs-403.
- **Computing `invitationId` earlier.** `normalizeInvitationId` is pure, the binding is a
  `const` in the same function block, it shadows nothing (the other `invitationId` is in the
  separate `hooks.before` middleware), and it is read by both branches. No behavioural change
  anywhere else.

## D2 — confirmed fixed, and it generalises

`foldAsciiCase` matches `/[A-Z]/g` only, so no non-ASCII code point is ever rewritten.
Verified directly, with `TASKDESK_BOOTSTRAP_ADMIN_EMAIL` set and `isBootstrapAdminEmail`
called for real:

- U+212A KELVIN SIGN substituted for the leading `k` of a same-length configured address →
  **rejected** (and I asserted in the same run that `.toLowerCase()` on that string *does*
  produce the configured address, so the test is exercising a real fold, not a length
  mismatch).
- U+017F LATIN SMALL LETTER LONG S for `s` → **rejected** (this one folds under NFKC +
  `toLowerCase()` too, so the old approach would have matched it as well — the ASCII fold
  closes the whole class, not just the one instance F4 named).
- Cyrillic а U+0430 and А U+0410, fullwidth Ａ U+FF21 and ａ U+FF41, Turkish ı U+0131 and
  İ U+0130 → all **rejected**.
- Ordinary ASCII case-insensitivity still works: `KOPERATOR@EXAMPLE.COM`,
  `KoPeRaToR@ExAmPlE.cOm` and a whitespace-padded form all **match**.

End-to-end over the real HTTP sign-up path, on an unclaimed instance with the bootstrap
email configured: the U+212A variant and a Cyrillic variant are both refused with no user
row created, and the plain ASCII-uppercase form is accepted (200, one user, promoted).
Note that the non-ASCII variants are stopped one layer earlier than `isBootstrapAdminEmail`
— better-auth's own validator answers `400 VALIDATION_ERROR` before the hook runs — which is
precisely the "correct by accident of a dependency" situation F4 flagged; the ASCII fold now
makes the function correct on its own terms as well, which is what matters.

Reverting only the D2 hunk (back to `.normalize("NFKC").trim().toLowerCase()`) makes the
`(F4/D2)` test fail on `isBootstrapAdminEmail(kelvinSignVariant)` returning `true`;
restored afterwards. The rewritten test is genuinely load-bearing now.

One deliberate narrowing worth recording, not a defect: `normaliseEmail` no longer folds
case for non-ASCII letters at all, so a configured `TASKDESK_BOOTSTRAP_ADMIN_EMAIL`
containing an uppercase non-ASCII letter will not match its lowercase form. That is the safe
direction for an authorization check and matches the documented contract.

## D3 — non-blocking, pre-existing, NOT introduced here: `DISABLE_PASSWORD_REGISTRATION` still distinguishes unclaimed from claimed

The B1/D1 invariant ("this refusal must be impossible to distinguish from an ordinary
registration refusal, for EVERY shape of request") holds for every request *shape*. It does
not hold across every instance *configuration*. With `DISABLE_PASSWORD_REGISTRATION=true`
set at boot, one unauthenticated `POST /api/auth/sign-up/email` still separates the two
cases — both 403, different bodies:

- unclaimed → `"Registration is currently disabled. Please use a valid invitation link to
  create an account."`
- claimed → `"Password registration is currently disabled. Please use a configured social or
  OIDC sign-in method."`

Reproduced live for both `DISABLE_REGISTRATION=true` and `=false`. The cause is
`apps/api/src/auth.ts`'s `hooks.before` middleware, where the password-registration refusal
(and, on `KANEO_CLOUD` deployments, the disposable-email `400`) is gated on
`!isInstanceAdminSetup` — i.e. deliberately skipped while the instance has zero users, so
that a legitimate setup-token bootstrap can still get through with those flags set. On an
unclaimed instance the request therefore falls past both guards into the
`databaseHooks.user.create.before` bootstrap refusal, which emits a different message.

Why this is not a blocker on this candidate: those three `!isInstanceAdminSetup` gates are
byte-identical to their state at the merge-base (`git diff 407c706c..52953c86 --
apps/api/src/auth.ts` touches none of them), and before this PR the same configuration was
distinguishable far more cheaply — the first signup simply *succeeded* and became admin.
This PR strictly improves the situation; it just does not reach this particular residual.
It is also closable, unlike the 200-vs-403 signal the fix documents as inherent: the
bootstrap refusal could mirror the password-registration message when that flag is set.
**Recommendation:** open a follow-up issue rather than reopening this PR. If the reviewer of
record considers B1's invariant absolute across configurations as well as request shapes,
this is the same class and belongs in #227 — that is a call for Thomas or the orchestrating
session, not for this review to make unilaterally after four rounds on one finding class.

## D4 — non-blocking: the B1 and D1 regression tests do not exercise the path a real deployment uses for the claimed case

`apps/api/src/auth.ts` captures `DISABLE_REGISTRATION` and `DISABLE_PASSWORD_REGISTRATION`
into **module-level consts at import time**, and `tests/api-integration/setup.ts` pins both
to `"false"` before any test module is imported. Setting `process.env.DISABLE_REGISTRATION`
inside a test therefore never reaches the `hooks.before` middleware — only
`checkRegistrationAllowed`, which re-reads the variable on every call. So in the `(B1)` and
`(D1)` tests the *claimed* instance is refused by the `databaseHooks` ordinary branch, not by
the middleware that would actually refuse it in a real deployment with the flag set at boot.

The invariant still holds on the real path — I re-ran the comparison with the env set before
module load (`vi.resetModules()` + dynamic re-import) and unclaimed vs claimed came back
byte-identical for `DISABLE_REGISTRATION=true, DISABLE_PASSWORD_REGISTRATION=false`. So
this is a test-fidelity finding, not a behaviour finding: the tests pass for a slightly
different reason than they appear to, and a future change to the middleware's message could
regress B1 without either test noticing. Worth a note in the test file, or a boot-time-env
variant of the `(D1)` case, in the same follow-up as D3.

## Evidence

- Dedicated database `opus_r3_d1d2_test` on `td-lane-pg` (127.0.0.1:55440), created for this
  review and migrated from scratch with `drizzle-kit migrate`. `drizzle-kit check` →
  `Everything's fine` (no drift).
- Isolated detached worktree at the exact head SHA; `git status` clean at the end (all probe
  files removed, both temporary reverts restored via `git checkout --`).
- `apps/api` integration: **64 files / 583 tests passed** — matches the claimed count.
- `apps/api` unit: **48 files / 323 tests passed**. Permissions: **10 files / 79 tests
  passed** (unchanged). `apps/web`: **57 files / 236 tests passed**.
- `instance-setup-bootstrap.test.ts` alone: 19 passed, including `(D1)` and `(F4/D2)`.
- Revert experiments: reverting only the D1 hunk fails `(D1)`; reverting only the D2 hunk
  fails `(F4/D2)`. Both restored.

## Not done in this review

- I did not re-derive passes 1 and 2. F1, F2, F3 and F5 were not re-examined; their prior
  dispositions stand.
- I could not drive a real OAuth `/callback/*` request (no provider configured in the test
  harness). The `allowInvitationByEmail` symmetry for that path is established by reading the
  source — both branches use the identical expression on the identical `ctx` — not by
  execution.
- I did not measure timing. On an unclaimed instance a bogus setup token costs one extra hash
  plus one `UPDATE` that a claimed instance never performs; at a 3-per-60s sign-up rate limit
  this is not a practical oracle, but it is not zero either, and nothing in this PR tries to
  equalise it.
- I did not review the `apps/web` changes, the migration, or the OpenAPI delta beyond
  confirming they were unchanged since pass 2.

---

## Post-review CI fix — 2026-09-22 (orchestrating session, self-verified)

CI at head `d5633cb` failed on two mechanical issues unrelated to any security finding:
the `## Gates` table used "pass — 79/79, unchanged" instead of a bare `pass` (the checker
requires an exact `pass`/`n/a`/`waived` match in that column, detail belongs in the third
column instead — fixed in the PR body, no code change), and `apps/web`'s stricter
`tsconfig.app.json` (not the looser config this session had typechecked against locally)
flagged an implicit-`any` parameter on the `navigate()` search-updater callback added for
D2's URL-stripping fix.

Fixed in commit `8e2aa13`: added an explicit `prev: typeof search` type annotation to that
one arrow-function parameter. Self-verified rather than sent through a fourth review round:
a type annotation is erased at compile time and has zero runtime effect — the emitted
JavaScript is unchanged before and after (confirmed: the callback's body, `{ ...prev,
setupToken: undefined }`, is untouched; only the parameter's compile-time type declaration
changed). Re-ran `apps/web`'s exact CI command (`tsc --noEmit -p tsconfig.app.json`)
locally: clean. No other file touched.

**Reviewed head:** `8e2aa13e64a1440ab9919c6e1c12095fa08c1cb0` (mechanical fix only; no new
security-relevant surface)

CI still failed on the same head with two further `apps/api` typecheck errors under
`tsconfig.tests.json` (also not checked locally against before): a dynamic
`@paralleldrive/cuid2` import whose types don't resolve from `tests/`, and an unguarded
array index (`statements[statements.length - 1]`) under `noUncheckedIndexedAccess`. Fixed
in `eb777ba`: dropped the explicit `id` from the F2 test's user insert (`userTable.id`
already has its own `$defaultFn`, so passing one was never necessary) and switched to
`.at(-1)` with an explicit guard. Neither changes what the test actually does — same insert
shape, same migration statement executed — self-verified the same way as the prior
mechanical fix: re-ran the exact CI typecheck command (`tsc --noEmit -p tsconfig.tests.json`)
and the test itself (19/19 pass) locally.

**Reviewed head:** `eb777baefdc8a318397d3ce3f137acb14ed91245` (mechanical fix only; no new
security-relevant surface)
