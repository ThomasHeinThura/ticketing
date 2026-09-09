# Pre-merge security review — PR #80 (#66, the missing-`workspace_role` fail-open)

**Reviewed head:** `e618e407f071db1ce5864195e0e1668871dea36c`
**Reviewed head:** `7666139de8584602d0041df918e037f2c3071bcf`
**Reviewed head:** `a3e78f3ad0fb537f8eb9a623b5862b778c61d218`

**Verdict: CLEAR** — **no BLOCKING, no HIGH.** One MEDIUM and three LOW, none blocking, none a
weakening.

**Status of the gate.** This review ran **before** merge and is complete. It closes the
mandatory independent Opus security review for the head named above, **and for that head
only.** A later content commit voids it and requires a fresh delta review. No waiver was
sought or used; none is authorized for this pull request.

**Reviewer independence.** A fresh, review-only Opus context that authored no part of the
change. `git status --porcelain --untracked-files=all` empty at start and end; `HEAD` never
moved; behind `origin/main` = 0, so this clearance applies to the tree that merges. Every
mutation ran in a scratch copy under `/home/ubuntu/.taskdesk-scratch/rev80/tree` with
hardlinks broken on the touched files and inode-verified; the lane was never written to.
`/tmp` was avoided via `TMPDIR` because that filesystem is inode-constrained on this host.

**The orchestrator authored part of this change** — it moved the default-role seed READ inside
the rollback `try` and wrote the `A2-P24` relabel — and a Sonnet panel reviewed in parallel.
**Neither is this clearance.** The orchestrator's own verification is author verification.

---

## What was wrong

`hasWorkspacePermission` fell back to the compiled static built-in roles when a
`workspace_role` row was **absent**, so **deleting a role row restored privileges instead of
removing them** — a privilege-restoration fail-open, and the reason #66 had to close before
#40's `DELETE /api/roles/{id}` could ship.

## What the reviewer established, by demonstration

| Claim | Evidence |
| --- | --- |
| **Fail-closed across every row state, not just the absent one** | **13 row-states driven through the real route on a private database, 18/18 pass**: absent row, `""`, `"{}"`, `"null"`, `"[]"`, malformed JSON, truncated JSON, non-array actions, empty actions, non-string actions, wrong resource — **all 403**. The control (`{"task":["create"]}`) returns **200**, so the denials are not vacuous. Row deleted between two requests → 200 then 403, confirming the row is re-read every request |
| **The owner-only compiled fallback is sound, not a hole** | `owner` is excluded from `DEFAULT_ROLE_NAMES`, so it has **no editable row by construction**; better-auth blocks creating *or renaming* a role to `owner`, case-insensitively; and only a genuine owner can hand the name out (`update-member-role` and `create-invitation` both guard `creatorRole`). No other writer to `workspace_user.role` exists |
| **The compensating delete is correctly scoped** | The `SELECT` really is inside the `try`; the delete's `where` is the just-created primary key, so its blast radius is exactly that one cascade; `publishEvent` sits after the rethrow. Judged against the observable invariant — *failed role seeding must not leave a usable partial workspace* — and it holds |
| **Fail-closed cannot silently lock out an upgraded instance** | The boot backfill `throw`s into `process.exit(1)` rather than continuing, so a missing seed is loud rather than a silent denial |
| **Non-vacuity, three separate mutations, each red in the right place** | Restoring the pre-#80 `??` fallback → **5 failed / 59 passed**, and the five are exactly the #66 assertions including "delete-after-narrow escalation". Restoring `34e3cb9`'s auth.ts (seed READ *outside* the `try`) → **1 failed**, and it is **A2-P24** alone, independently confirming that a `BEFORE INSERT` trigger cannot observe a `SELECT`. `origin/main`'s auth.ts → **2 failed**: A2-P8 and A2-P24 |
| **`A2-P*` labels a requirement, not a test — checked against the corpus, not believed** | `A2-P17` labels exactly **4** `it()` blocks; `A2-P4`, `A2-P16` and `A2-P19` label 2 each; and `A2-P24` does **not** exist at `origin/main`, where `A2-P23` is the maximum. Both claims made in the pull request comment are true |
| **Real PostgreSQL** | The four changed files: **4 files / 70 tests passed**. The reviewer also ran the **whole** integration suite, because this file sits on every authenticated route's path: **41 files / 295 tests passed, exit 0** — independently reproducing the counts the commit message claims |

**Hygiene.** No `as any`, `as unknown as`, `@ts-*`, `eslint-disable`, `biome-ignore`, `.skip`
or `.only` in the added lines. **7 assertions removed and 22 added**, and all 7 removals are
defect-characterizations flipped to closed-behaviour assertions (200 → 403, plus dropping a
pinned `capabilities.createTasks === true` divergence). Test count 62 → 65.

---

## Findings

- **MEDIUM 1 — `require-workspace-permission.ts:106-116` still reads membership with
  `.limit(1)` and no `ORDER BY`, and this is the hand-off that must not be dropped.** The
  reviewer measured that insertion order decides the answer (owner-row-first → 200,
  viewer-first → 403, stable over 12 runs). It is **not a regression**: every case was
  enumerated and **there is no input where pre-#80 denied and this head grants**, so #80 is
  better-or-unchanged here. But **#77 deliberately skips this file because #80 merges first**,
  so on merge it becomes **the one uncovered read of seven**. **#77's scope must be extended to
  this file and its twin `require-workspace-role-authority.ts` on its post-#80 base update.**
  Rated MEDIUM rather than HIGH because better-auth is tighter than the issue text implies —
  `create-invitation` blocks existing members and duplicate pending invitations, and
  `accept-invitation` compare-and-sets — so producing the duplicate needs a stale invitation
  plus another insert path, a direct database write, or the still-unmerged S5 routes.
  **Independently found by #77's own reviewer as its H2; two reviewers converged on it.**
- **LOW 1** — `A2-P24`'s `ALTER TABLE … RENAME` can poison the **shared** `taskdesk_test`
  database if the process is killed mid-test. The reviewer observed another session on that
  database during the review. Operational, not a product defect.
- **LOW 2** — the evaluator's exact `=== "owner"` comparison versus comma-joined multi-role
  values. Fail-closed and not a regression; that is issue **#82**.
- **LOW 3** — a **hand-planted** `owner` row in `workspace_role` is now ignored where it
  previously would have been honoured. This is the change's **only strict widening**, it is
  unreachable through the API (see the owner-exception row above), and it matches the stated
  R5 intent. Worth one line in the pull-request body so it is not discovered later as a
  surprise.

## Method

Mutations applied to a scratch mirror with byte-identity verified on restore; the lane was
never written to. Full findings: `/home/ubuntu/.taskdesk-scratch/reviews/review-80.md`
(428 lines, written incrementally so a stall-watchdog death would have cost nothing).

---

## Delta review 1 — `0a147c3..7666139de`, verdict CLEAR

A **content** commit landed after the baseline clearance and voided it, exactly as the
stale-note rule requires. It closed the finding **three** reviewers had converged on from
opposite sides — this note's own MEDIUM 1, this pull request's correctness-lens Sonnet reviewer
(as a HIGH, flagged as an authorization-boundary defect), and the independent Opus review of
#77 (as its H2): `require-workspace-permission.ts` and `require-workspace-role-authority.ts`
both read membership with `.limit(1)` and no `ORDER BY`, so the evaluator could grant or deny by
scan order. Both now read all rows and refuse on ambiguity.

**A fresh independent Opus reviewer established, by measurement:**

- Fail-closed in **all four row-states at both call sites** — 0 rows, 1 row, 2 agreeing, 2
  disagreeing. **No input exists where the pre-delta code denied and this head grants.** Unlike
  #77's earlier attempt, this one is stricter in both directions rather than one.
- **The `owner` is not locked out** — a genuine owner with exactly one row still gets 200 on
  PATCH and DELETE, and #66's rule still denies after its `workspace_role` row is deleted.
- **Lockout, answered rather than reassured:** a duplicated row *does* lock that user out of the
  whole `requireWorkspacePermission` surface — but **no HTTP route on this head can create a
  duplicate row for another user.** `createInvitation` refuses an existing member, lowercases the
  email so no case-variant second invite, and refuses a second pending invitation; **8 concurrent
  invites from 8 distinct IPs produced exactly one pending invitation**; `acceptInvitation` is a
  compare-and-set. So one member cannot lock another out. The path opens when #77/S5's native
  member routes land, which makes **#88**'s `UNIQUE (workspace_id, user_id)` a must-land-with
  dependency at that point. Recovery needs no database surgery. **LOW.**
- The **byte-identity claim against #77** holds (md5-verified on both functions), and "keep
  #77's superset" is a safe conflict resolution.
- Both new probes discriminate what they claim: swapping cardinality for an *agreement* rule
  turns A2-P26 alone red.

**MEDIUM (closed by delta 2): half the fix was untested.** Removing **only** the twin's guard
left the whole 41-file suite green, because `requireWorkspacePermission` short-circuits to `true`
for an instance admin *before* reading membership and the twin early-returns for everyone else —
so probes using an ordinary invited `admin` never execute it. The commit had claimed both twins
were "fixed together"; its non-vacuity evidence covered one.

## Delta review 2 — `7666139de..a3e78f3ad`, verdict CLEAR

**No BLOCKING, no HIGH, no MEDIUM.** A third fresh independent Opus reviewer verified each claim
by measurement:

- **A2-P27 is exactly as targeted as claimed.** Middleware order traced statically
  (`requireWorkspaceMembership` branches on row *existence*, never role, so two rows admit
  deterministically), then mutated: removing only the twin's three-line guard gives
  **1 failed / 11 passed**, the single failure being A2-P27 with `expected 200 to be 403`. The
  same request returning **200** with the guard gone proves every earlier frame grants and the
  403 can only come from the twin.
- **The replaced JSDoc is accurate**, and no longer names controllers absent from this branch.
- **The `TS2345` report is true** — `noUncheckedIndexedAccess` lives in the shared base config,
  and removing both `if (role === undefined)` checks produces exactly two errors, one per site.
  So the earlier "dead optional chain" nit was half wrong, and applying it blindly broke the
  build.
- **And the one thing the rewrite could have widened, checked:** `!member?.role` also caught
  `null` and `""`, which `=== undefined` does not. **No widening** — `role` is
  `text().default("member").notNull()`, so `null` is unreachable, and `""` still denies one frame
  later because no `workspace_role` row is named `""` and both statement lookups return `null`.
  Fail-closed either way. *(This was not in the delta's own reasoning; the reviewer found it.)*
- Test file is **+65 / −0** — zero deletions, so nothing could have gone vacuous.

Measured, on private databases to avoid the shared-`taskdesk_test` flake this note already
records as LOW 1: integration **41 files / 298 tests**, `test:permissions` **74**,
`check:openapi` **122 operations**, `lint:ci` exit 0, `typecheck --force` **8/8, 0 cached**.

**Remaining LOW, neither blocking and both recorded rather than closed:** the file's merge advice
still says "byte-identical" while this delta rewrote one JSDoc block (the claim was scoped to the
function *bodies*, which are unchanged — but whoever rebases #77 should know keeping #77's
superset discards this delta's better wording); and the **mount-order dependency** — the twin is
correct only because both mounts place it after `requireWorkspacePermission`, and nothing
enforces that. A2-P27 now at least pins the composed behaviour at one mount.
