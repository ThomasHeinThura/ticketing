# Pre-merge security review — PR #112 (S6a, native invitation surface)

**Reviewed head:** `614b73fe4e0e4364415962286c3ba52a5aee16c3`

**Verdict: CLEAR WITH FINDINGS.** No HIGH, no MEDIUM, **zero blocking**. Eight non-blocking
findings, all recorded below and none of them a weakening.

**Status of the gate:** this review ran **before** merge and closes the mandatory independent
Opus security review for the head named above, **and for that head only.** A later commit
touching anything outside `docs/07-planning/security-reviews/` voids it. No waiver was sought
or used; none is authorized.

**Reviewer independence.** A fresh Opus context that authored no part of the change, made no
edit, commit, push or comment, and used its own database
(`taskdesk_rev112_test`) so that concurrent lanes could not corrupt its measurements.

**Classification, self-confirmed rather than accepted.** `await readSecurityReviewScope()` at
base `origin/main@3e78450` — union 23 globs, `removed: []`, `added: []`; non-vacuity probe
`apps/api/src/auth.ts` MATCH, negative probe `README.md` NO-MATCH. **39 changed files, 9 in
scope.** `docs/04-engineering/ci-cd.md` untouched, so no scope narrowing.

**Effect on the programme metric: 31 → 19 live callers**, re-derived by the reviewer with every
grep hit inspected individually. Six families eliminated: `inviteMember`, `acceptInvitation`,
`rejectInvitation`, `cancelInvitation`, `getInvitation`, `listUserInvitations`.

---

## What was established, by demonstration

| Claim | Evidence |
| --- | --- |
| **The #88 fix is genuinely atomic** | `accept-invitation.ts` pre-reads only `workspaceId` to derive the key, then inside the transaction takes `pg_advisory_xact_lock(4002, hashtext(workspaceId))` — the same namespace every S5 membership write uses — and re-reads **both** the invitation and the `workspace_member` row **inside** the lock. Raced four ways on a private database: 8 concurrent accepts of one invitation → `[200, 400×7]`, **1 membership**; 6 concurrent accepts of six *distinct* pending invitations for the same user+workspace → `[200, 409×5]`, **1 membership**; concurrent native accept + native add-member → 200/409, **1 membership**; mixed-case-email path → create 200, accept 409, **1 membership** |
| **…and the race test is non-vacuous** | Neutering the existing-member check made race B produce **six** membership rows and race D a duplicate. File restored byte-for-byte, sha256 `493805da…` identical before and after |
| **Both moved guards are enforced AND tested** | The `auth.ts` diff **adds only comments** — nothing removed — so the still-mounted plugin route keeps its protection until S10. Native side has `requireInviteRateLimit()` (60s/5) with a 5×200-then-429 test, and `requireInviteAbuseGate()` with four cases. The anonymous half is **stronger** than the plugin's: it reads the `user.is_anonymous` column rather than the dead serialized field. `isDisposableEmail` lowercases the host, so no case bypass |
| **Vocabulary is byte-identical** | The invite link literal is moved into one shared helper that `auth.ts` now delegates to, unchanged. `"rejected"` appears nowhere as a status value in `apps/`, `tests/` or `packages/` — every hit is prose, an identifier, or `Promise.allSettled`'s own `result.status`. Reject writing `"canceled"` is **required**: `check-registration-allowed.ts:158-159` and `members-table.tsx:128` branch only on `"accepted"`/`"canceled"`, so a `"rejected"` row would report a declined invitation as still valid |
| **The three deleted client files were genuinely dead** | Each exported symbol appears only in its own definition; no barrel `index.ts` in either directory; no dynamic `import()`; none is a route file. The two apparent `use-get-invitation` hits are `use-get-invitation-DETAILS`, a different module that still exists |

---

## Findings — eight, none blocking

**The one to act on before S10, and it is the most valuable output of this review:**

- **NB-1 — the plugin's `invitationLimit` is not reproduced.** better-auth enforces a default
  **100 pending invitations per organization** (`crud-invites.mjs`), never overridden in
  `auth.ts`. The native `POST /api/workspace/{id}/invitations` has **no per-workspace pending
  ceiling**. Not blocking, because the plugin path still carries the cap today — but **at S10,
  when `organization()` is unmounted, the invite surface would be left with no ceiling at
  all.** This is the same abuse class as the 2026-05-28 phishing incident. Disclosed by the
  author in "Not done"; it must be closed as part of S10 rather than discovered there.

The rest, recorded and tracked:

- **NB-2** — `require-invite-rate-limit.ts` documents itself as a "sliding bucket" that
  "reproduces exactly" better-auth's limiter. It is a **fixed** window (`windowStart` never
  refreshes) where better-auth refreshes `lastRequest` on every allowed request. Burst
  behaviour matches; a *paced* caller diverges — better-auth locks a 1-per-20s caller out
  permanently, the native limiter grants ~3/min indefinitely. Prose precision plus a modest
  strength difference on a brand-new route.
- **NB-3** — **issue #88 is not actually closed by this PR.** The identical unguarded
  `adapter.createMember` path stays reachable through the still-mounted
  `POST /api/auth/organization/accept-invitation`. The PR says so plainly and it is the
  retrofit's declared boundary — but **#88 must not be marked closed on merge; it closes at
  S10.**
- **NB-4** — the create route returns the raw drizzle `.returning()` row (nine columns) where
  `workspaceInvitationSchema` declares seven. Nothing sensitive leaks — the caller is a
  workspace admin who supplied `workspaceId` in the URL, and `teamId` is always null — but the
  "no ORM row reaches the wire" tick is overstated and the OpenAPI contract disagrees with the
  wire body. S5's `add-workspace-member.ts` projects explicitly; this should match it.
- **NB-5** — the resend path also rewrites the pending invitation's `role`; better-auth's
  resend updates `expiresAt` only. Not an escalation (the actor already holds
  `invitation:create` and `invitation:cancel`), but an untested behavioural drift.
- **NB-6** — the rate limit is mounted **after** the authorization chain, where better-auth
  applies its limiter before authentication, so unauthorized floods never consume the native
  bucket. Arguably the better placement; recorded as a deliberate difference. Related:
  `pruneExpired` only runs above 10,000 entries and only deletes expired buckets.
- **NB-7** — the permission-matrix fixture grants the new routes to `manager` and `lead` while
  the runtime check admits only admin/owner. **Runtime is stricter than the declaration**, i.e.
  fail-closed, and both policy files already record this as a #7 re-keying gap matching the
  existing `workspace:update` precedent. No action.
- **NB-8** — `requireInvitationWorkspaceAccess` answers 404 before authorization and 403 after,
  so an authenticated caller can distinguish "this invitation id exists". Ids are 24-character
  opaque values and the pre-existing `GET /api/invitation/{id}` already answers on any id, so
  no practical exposure is added.

## Gates

`typecheck --force` 8/8 (0 cached) · `lint:ci` 1086 files, 0 errors (57 pre-existing warnings
in untouched files) · `test` api 270/270, web 228/228, permissions 236 · integration green on a
private database. Run by the reviewer, not taken from the author.
