# Pre-merge security review — PR #77 (retrofit S5, native membership writes)

**Reviewed head:** `58ed36683cb6632f42e3435de932c00ce30a1b0f`
**Reviewed head:** `4629511c26119c41a152270162aafc4869c03139`

**Verdict: CLEAR** at `4629511c26119c41a152270162aafc4869c03139` — **no BLOCKING, no HIGH, no
MEDIUM.** **Four review rounds**, two of which
returned CHANGES REQUIRED, and the third of which found a BLOCKING that the first three had
missed. No waiver was sought or used; none is authorized for this pull request.

**Reviewer independence.** Four fresh, review-only Opus contexts, each authoring no part of the
change and none reviewing its own remediation. Every one confirmed `git status --porcelain`
empty at start and finish with `HEAD` unmoved, and worked in scratch mirrors — one of them
noting that `cp -al` produces hardlinks that leak edits back into the lane, and rebuilding with
`git archive` with inodes verified distinct. The S5 implementation was authored by a Sonnet lane;
the B1/B2/H1 and N1 remediations by the orchestrator, an Opus context. **Both are author
verification and neither is this clearance.**

**Reviewed at a head level with `origin/main` (behind = 0)**, after #80 and #84 landed, so this
applies to the tree that merges rather than a stale one.

---

## Round 1 — `f4300a07`, CHANGES REQUIRED: two BLOCKING and one HIGH

The duplicate-row fix was **conservative in one direction only** — it made "is the target an
owner" conservative and left "are there other owners" row-based.

- **B1** — the last-owner guards counted owner **ROWS, not distinct USERS**. One owner user
  holding two `"owner"` rows counted as 2, the guard passed, and the delete (matching
  `(workspaceId, userId)`, so removing *every* row for the pair) left the workspace with **zero
  owners**.
- **B2** — `transferWorkspaceOwnership` set `role = "owner"` on **every** row of the incoming
  owner, **manufacturing exactly the state B1 misread**. The chain to a zero-owner workspace had
  no unauthorized step in it.
- **H1** — a comment claimed the capability middleware and the transfer controller "can never
  disagree". False: one reduced with `.every(...)`, the other with `length !== 1`, so for
  `["owner","owner"]` the gate **granted** and the controller **refused** — fail-closed, but it
  locked the only owner out of their own transfer route with nobody else holding the capability.
- **And the test helper had the same bug as the code.** `ownerCount()` returned a row count,
  which is why no probe could ever have caught B1.

## Round 2 — `e2291125`, CHANGES REQUIRED: one BLOCKING (N1)

The three above were verified closed. Then N1, and it is the most consequential finding on this
pull request **because it means these native routes were LESS SAFE than the better-auth routes
they replace**.

`anyRoleIsOwner` was `roles.includes("owner")`, an **exact** match per row. But
`workspace_member.role` can hold `"owner,admin"` as ONE row's value — better-auth's `parseRoles`
comma-joins an array — so the exact match returned **false** and the last-owner guards did not
recognise the workspace creator as an owner at all. Measured on real PostgreSQL over real HTTP,
with better-auth's own routes as the control:

| with a sole `"owner,admin"` owner | native, before | better-auth |
| --- | --- | --- |
| that owner leaves | **200, zero owners** | 400, refused |
| an admin removes them | **200, zero owners** | n/a |
| an admin PATCHes them to `viewer` | **200, zero owners** | 403 |

The setup is **authorized and ordinary**: the owner gives *themselves* `role: ["owner","admin"]`
through the still-mounted plugin route (measured 200). Then a plain admin holding only
`member:update` demotes the workspace creator — an authority better-auth explicitly denies them.
**Unrecoverable**: with zero owners nobody can ever transfer ownership.

A second path: `create-role` only lowercases names, so a role *named* `"owner,x"` is creatable
and assignable, after which the genuine sole owner's account deletion stopped being blocked —
measured `realOwnersAfter = []`.

## Round 3 — `58ed36683`, CLEAR

**No BLOCKING, no HIGH.** The reviewer supplied a stronger proof of the fix than the author's own
reasoning, and it is recorded because it is the load-bearing argument:

- **Monotonicity.** `role = 'owner'` exact **implies** `roleGrantsOwner(role)`, so
  `exactOwnerUsers ≤ inclusiveOwnerUsers`, so `exactCount <= 1` is true **at least as often** —
  the guard refuses at least as often as a fully comma-aware variant would. The exact count is a
  *lower bound* on genuine owners. For a wrong PERMIT, `distinctOwnerUserCount` would have to
  **over**-count, and a row whose role is the literal `owner` is by definition an owner —
  unreachable.
- **`anyRoleIsOwner` is used only in refusal positions** — grep-complete, three sites, all
  `throw`. It never gates a grant, so widening it cannot escalate.
- **All five native writes** to `workspace_member.role` produce the literal `"owner"` or are
  guarded, so exact counting is *complete* for all natively-reachable state. Only the
  still-mounted plugin route makes comma-joined values. The asymmetry is coherent with the write
  side, not merely the read side.
- **`delete-account-data.ts` runs the same pair the other way round.** `planAccountDeletion`
  blocks on `isOwner && ownerCount <= 1`, so **over**-counting owners *skips* the block. Inclusive
  `isOwner` and exact `ownerCount` both bias toward refusing. **An earlier write-up of this
  reasoning, on issue #82, had the direction inverted and is corrected there.**
- **No false positive** in the incoming-value guards: `"co-owner"`, `"ownership-admin"` and
  `"downer"` are correctly **allowed**, because the predicate compares whole comma-separated
  pieces rather than testing a substring.
- Mutation: reverting `anyRoleIsOwner` gives **3 failed / 11 passed**, N1a/N1b/N1c red and N1d
  green, reproducing the claim precisely.

Findings left: one MEDIUM and three LOW, none merge-blocking.

## Round 4 — `58ed366..4629511`, test-only, **CLEAR**

**No BLOCKING, no HIGH, no MEDIUM.** Two LOW, neither affecting whether the probes catch their
defect.

**The MEDIUM it closed was the fifth instance in one day of the class issue #93 tracks** — a
guard that is correct and can be deleted with the suite still green — and it was in the
remediation itself. Reverting `delete-account-data.ts`'s `ownerCount` to the inclusive reading
left the **full suite green**, because `planAccountDeletion`'s tests hand-feed `ownerCount` as a
literal and cannot catch a wrong *derivation*.

The reviewer confirmed each probe is the **unique** witness for what it claims, by mutation:

| Mutation | Result |
| --- | --- |
| revert `ownerCount` to `hasOwnerRole` | **1 failed / 366 passed** across the whole integration suite |
| reword `CallerNotOwnerError` to coincide with the gate's message | **1 failed / 269 passed** across all unit tests |
| mutate `roleGrantsOwner` to a substring test | **1 failed / 269 passed** |

It also went further than asserting non-vacuity: it re-ran the account-deletion probe's seeding
**under the mutation with instrumentation instead of assertions**, confirming the `"owner,x"` row
really produces the described state (`DID_THROW false`, `FINAL_ASSERTION_VALUE false`) — so the
probe fails for its stated reason rather than incidentally. And it checked the probe is
discriminating rather than a clone of its neighbour: the pre-existing `"Acme"` test has the same
shape but seeds `"member"`, a non-owner under both readings, and stays green.

On the shape list for `roleGrantsOwner`, it considered and dismissed the gaps worth considering:
`"owner,"`, `",owner"` and doubled commas all evaluate `true` under both the real implementation
and every mutation already killed, so they add nothing; Unicode lookalikes evaluate `false`, which
is correct rather than a bypass; `trim()` already handles NBSP. **No legitimate product role name
is wrongly refused** — a false positive needs a whole comma-piece to equal `"owner"`, and the
realistic near-miss `"co-owner"` is pinned explicitly.

**The two LOWs, recorded rather than fixed** — fixing either means another content commit and
therefore another full Opus round, and Opus capacity was exhausted once already today:

- **LOW 1a** — `L1`'s `readFileSync` assertion greps the source for a literal that appears at two
  sites in the file, so it cannot tell which path produced it, and any behaviour-preserving
  refactor (hoisting to a shared const, extracting a `forbidden()` helper, a formatter line-wrap)
  turns it red. A behavioural alternative sits in the same file — `probe()` returns a real
  `Response` from a Hono app running the actual middleware. The assertion that actually pins R4
  (`.not.toBe` on the error's message) is behavioural and sound, so this is brittleness in a
  belt-and-braces check.
- **LOW 2a — a factual error in a comment, and it is the orchestrator's.** The account-deletion
  probe's trailing comment says `realOwnersAfter` "came back empty"; measured, it returns
  `[{role: "owner,x"}]`, length 1. The query has **no role filter**, so both the variable name
  and the comment describe a role-filtered query that was never written — the `= []` figure was
  carried over verbatim from round 3's report without being re-checked against the query actually
  committed. **The assertion itself is correct and non-vacuous.** Tracked so a future reader does
  not act on the wrong description.

**A harness note the reviewer recorded, worth keeping:** its first scratch build via `git archive`
had no git history, which made five permissions tests fail on "could not resolve a merge base with
origin/main". That was the harness, not the code — it rebuilt scratch as a real clone and the
suite was clean. Anyone reviewing this repository in a scratch tree needs real history.

---

## Also established, across the rounds

- **Advisory locks** are the first statement before any read in all five controllers, and
  genuinely held (`pg_try_advisory_xact_lock` returns false while held). Concurrency probes:
  exactly one transfer succeeds; concurrent leave/remove never reaches zero owners. **The lock
  protects only writes that take it** — the plugin's `leave`, `remove-member` and
  `update-member-role` remain mounted and lockless until S10.
- **`workspace:transfer_ownership`** is owner-only with admin excluded and no instance-admin
  bypass; the capability is registered in `docs/01-architecture/rbac.md` (do-not 11); route
  policy, permission matrix and effective runtime authority agree.
- **The add/add conflict resolution** against #80's copy of `workspace-member-roles.ts` is sound:
  both shared function bodies are byte-identical to `main` (sha256 verified on both sides), and
  the superset lost nothing.
- **#88's `UNIQUE (workspace_id, user_id)` becomes a must-land-with dependency** once these
  routes ship. #80's reviewer measured that on the pre-S5 `main` **no HTTP route could create a
  duplicate membership row for another user** — eight concurrent invites from eight distinct IPs
  yielded exactly one pending invitation. **These native member routes are what open that path.**
  The application-layer defence here is what holds the line until the constraint lands, and it
  should be kept afterwards rather than removed.
- **Not fixed here, tracked as #93:** three of five advisory locks are deletable with the suite
  green. The locks are correct; they are unwitnessed.

## Method

Mutations applied to scratch mirrors with inodes verified distinct and byte-identity confirmed on
restore; the lane was never written to. `/tmp` avoided via `TMPDIR` because that filesystem is
inode-constrained on this host. Private test databases were used where the shared `taskdesk_test`
risked cross-session interference. Full findings:
`/home/ubuntu/.taskdesk-scratch/reviews/review-77*.md`.
