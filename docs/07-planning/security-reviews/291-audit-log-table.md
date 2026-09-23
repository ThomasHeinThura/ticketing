# Security review — `audit_log` tamper-evidence table and writer (migration 0067, issue #37 slice 1)

**Reviewer:** Opus 5.5, fresh independent context. Did not author, direct, or remediate this change.
**Reviewed head:** `ce11fe03370afbe2774152fb1b5ab1d6687f50eb`
**Reviewed SHA:** `ce11fe03370afbe2774152fb1b5ab1d6687f50eb` (confirmed via `gh pr view 291 --json headRefOid`)
**Pull request:** #291
**Date:** 2026-09-23

## Surfaces examined

- `apps/api/drizzle/0067_audit_log_table.sql`, `meta/_journal.json`, `meta/0067_snapshot.json`
- `apps/api/src/audit/{audit-writer.ts,verify-audit-chain.ts,actions.ts,lock.ts}`
- `packages/domain/src/audit/{audit.ts,types.ts}` (`canonicalRowHash`, `canonicalJson`) — unchanged, but load-bearing
- `apps/api/src/database/schema.ts` (`auditLogTable`)
- `tests/api-integration/helpers/database.ts` (`resetTestDatabase`), `tests/api-integration/audit-log.test.ts`
- `apps/api/package.json`, `pnpm-lock.yaml`, `vitest.integration.config.ts`, `tsconfig.tests.json`
- Every `pg_advisory_*` call site in `apps/`, `packages/`, `scripts/`
- `compose.yml`, `charts/taskdesk/templates/postgresql-deployment.yaml`, `deploy/.env.example` (role shape)
- Docs: `audit-trail.md` AU-2/AU-3/AU-15, `data-model.md` §11 + "The audit hash chain", `migrations.md` "Append-only tables", decision log 2026-09-23

## What I probed

Full integration suite on a private database (`pr291_opus_test`, td-lane-pg, Postgres 18.6):
**73 files, 978 tests, all passed** at this head. Then a throwaway probe file
(`tests/api-integration/zz-opus-probe.test.ts`, deleted afterwards, not committed) against
the same database, exercising the real `appendAuditLog` / `verifyAuditChain` and raw SQL:

1. **Trigger bypasses (raw SQL, as the owning role).** `UPDATE … SET organisation_id = NULL,
   after = …` / `action = (SELECT …)` / `created_at = DEFAULT` → all raise.
   `SET organisation_id = '<other>'` → raises. `UPDATE … SET seq = DEFAULT` → raises.
   `INSERT … ON CONFLICT (id) DO UPDATE` → raises (row trigger fires on the conflict update).
   `INSERT … OVERRIDING SYSTEM VALUE (seq = 1)` → rejected by `audit_log_seq_unique`.
   `WITH d AS (DELETE …)` and `MERGE … WHEN MATCHED THEN DELETE` → raise. `TRUNCATE` → raises
   (covered by the PR's own test). The table has no view, rule, partition or generated
   column other than the identity `seq`. `COPY FROM` can only insert, which is the
   forged-insert limit `data-model.md` already states. **The carve-out holds against every
   combined-rewrite form I tried.**
2. **DDL-level bypasses (owner privilege).** `CREATE RULE … ON INSERT TO audit_log DO INSTEAD
   NOTHING` succeeds, and so do `SET session_replication_role = replica` and (by
   definition) `ALTER TABLE … DISABLE TRIGGER` / `DROP TRIGGER`. None of these is reachable
   from application code: I grepped `apps/`, `packages/`, `scripts/`, `deploy/`, `charts/`
   and `compose*.yml`. The only `session_replication_role` use is the test helper, plus a
   comment in `0056`. There is no `DISABLE TRIGGER`, no `CREATE RULE` and no dynamic DDL
   against `audit_log`. All of this is owner-tier residual risk. See S5 for whether the docs
   describe it honestly.
3. **Chain integrity.** I ran the three cases below. There is no advisory-key collision.
   `4010` is used only in its one-argument (bigint) form. Every other one-argument key is
   different (`2026`). Every two-argument `(int4,int4)` key sits in a separate lock-tag
   space.
   - Caller transaction rolled back after `appendAuditLog`: no fork.
   - Nested savepoint rolled back while the outer transaction commits: no fork.
   - `REPEATABLE READ` caller: **forks** (S3).
4. **Hash/canonical form.** Every §11 field is in the input. Excluded: `id`, `seq` and
   `organisation_id`. Of these, only `organisation_id` is security-relevant; see S4. I round-
   tripped these values through write→jsonb→verify, and all verified:
   - `-0` (stored as `0`, consistent);
   - `1e21`;
   - `5e-324`;
   - NFD `e\u0301` (jsonb does not normalise, so it is consistent);
   - own-key `__proto__`;
   - nested `[]`.

   These fail closed: `\u0000`, a lone surrogate, and an `undefined` member. **Top-level
   string values do not round-trip (S2).** I found no collision between two distinct
   object/array payloads. Key order is sorted, jsonb de-duplication is irrelevant because JS
   objects cannot carry duplicate keys, and numbers are the same double on both sides.
5. **Secrets (AU-2).** I tried eleven payloads (S6).
6. **Test helper.** `SET LOCAL session_replication_role = replica` is scoped to one
   transaction in `resetTestDatabase`, and nothing in production imports it. Correct. It
   needs a superuser, which the test database has.

## Findings

### S1 — BLOCKING — `verifyAuditChain` reports a break on every legitimate `seq` gap, so one rolled-back audit write permanently blinds `audit-verify`

`apps/api/src/audit/verify-audit-chain.ts:95-107` treats any non-contiguous `seq` as
`sequence_gap`. `seq` is `GENERATED ALWAYS AS IDENTITY` (`0067_audit_log_table.sql:47`), and
identity values are non-transactional. Any `appendAuditLog` whose enclosing transaction or
savepoint rolls back therefore consumes a value and leaves a hole. This happens under
AU-14's own design, where the caller decides whether a later failure aborts the mutation.
The chain itself is intact, because the rolled-back row never existed.

Reproduction:

```ts
await appendAuditLog(db, base());
await db.transaction(async (tx) => { await appendAuditLog(tx, base()); throw new Error(); }).catch(() => {});
await appendAuditLog(db, base());
await verifyAuditChain(db);
// seqs 1,3 -> { ok: false, reason: "sequence_gap", expectedPrevHash === actualPrevHash }
```

A rolled-back savepoint inside a committed outer transaction gives the same result (seqs 1,3).

Why this matters for security, not only as a false alarm:

- `verifyAuditChain` returns at the **first** break.
- The table is append-only, so the offending row can never be repaired.
- After the first ordinary rollback, every later run reports the same benign break at the
  same row. Any **real** tampering later in the chain is never reported.
- An actor who can make a mutation fail after its audit write, which is routine, can do this
  on purpose.

The deleted-row case the check claims to cover is already caught by the `prev_hash`
pointer. The PR's own "detects a deleted middle row" test passes on `prev_hash_mismatch`
alone.

**Fix:** drop the `seq`-contiguity check. Order by `seq` and rely on `prev_hash`. Add a
regression test that rolls back one append and still expects `ok: true`.

### S2 — BLOCKING — a top-level JSON string in `before`/`after` is stored as something other than what was hashed, poisoning the chain on an untampered row

`apps/api/src/audit/audit-writer.ts:269` binds `${before}::jsonb, ${after}::jsonb` as raw
driver parameters. `node-postgres` JSON-encodes only objects. It sends a JS **string**
verbatim as text, which Postgres then *parses* as JSON. Drizzle's `sql` template expands a JS
**array** into a `($1, $2)` row list. The hash, by contrast, is computed over
`canonicalJson(value)`, where a string is a JSON *string*. `JsonValue` (and so
`AppendAuditLogInput.before/after`) explicitly admits both.

Reproduction: write `appendAuditLog(db, base({ after: X }))` with each value of `X`, then
run `verifyAuditChain`.

| `after` | stored | result |
| --- | --- | --- |
| `"123"` | jsonb number `123` | `row_hash_mismatch` |
| `"null"` | jsonb `null` | `row_hash_mismatch` |
| `'{"a":1}'` | jsonb object `{"a":1}` | `row_hash_mismatch` |
| `"hello"` | none | throws (invalid json) |
| `[]` | none | throws (syntax error at ")") |
| `[1,2]` | none | throws (cannot cast record to jsonb) |

Only the object, number and boolean top-level shapes round-trip.

The three mismatches write an untampered row that `audit-verify` flags forever. The table
is append-only, so it cannot be repaired, and with S1's first-break semantics it masks every
later real break. If a future caller records a user-controlled scalar, say a title, as
`after`, a user can poison the chain at will. The stored value also misrepresents what was
recorded: the string `'{"role":"admin"}'` lands as an object. The array cases fail closed,
but they reject a shape the type promises.

**Fix:** bind `JSON.stringify(value)` (or `null`) explicitly, i.e.
`${before === null ? null : JSON.stringify(before)}::jsonb`. Add a regression test per
top-level shape (string, numeric-looking string, `"null"`, array, empty array) that
asserts `verifyAuditChain(...).ok`.

### S3 — NON-BLOCKING — a `REPEATABLE READ`/`SERIALIZABLE` caller forks the chain silently

`audit-writer.ts:199-211` reads the head after taking the lock. Under READ COMMITTED each
statement takes a fresh snapshot, so this is correct. Inside a caller transaction whose
snapshot predates the previous holder's commit, the head read is stale.

Reproduction:
1. T1 appends and holds the lock.
2. T2 (`isolationLevel: "repeatable read"`) runs one `SELECT`, then calls `appendAuditLog`.
3. T2 blocks on the lock.
4. T1 commits.
5. T2 proceeds, and both commit.

Result: seqs 2 and 3 both have `prev_hash = 322ee7cc…`, and `verifyAuditChain` →
`prev_hash_mismatch` at seq 3.

Nothing in the codebase uses RR/SERIALIZABLE today (`project/controllers/delete-project.ts:18`
says so), so this is latent. **Recommended fix, structural and cheap:** add
`UNIQUE (prev_hash)` to `audit_log`, which turns any fork into a hard insert failure. The
chain is strictly linear, and an anchor-after-purge does not change that. Alternatively, or
as well, assert `current_setting('transaction_isolation') = 'read committed'` inside the
writer.

### S4 — NON-BLOCKING — the AU-7 carve-out admits a *direct* `UPDATE … SET organisation_id = NULL` on a living organisation's rows, and that column is not hashed

`0067_audit_log_table.sql:73-98` allows any UPDATE whose only change is `organisation_id` →
NULL. It cannot tell the FK's `ON DELETE SET NULL` apart from an ordinary statement. The
migration comment (lines 66-68) claims "EXACTLY that one system-generated update".

Reproduction (probe P6):
1. Create organisation `org-p6` and append a row with `organisationId: 'org-p6'`.
2. Run `UPDATE audit_log SET organisation_id = NULL` while `org-p6` still exists → succeeds.
3. `verifyAuditChain` → `ok: true`, because `organisation_id` is excluded from the hash by
   design.

Rows can be detached from a live organisation's scoped audit view (AU-10/AU-11 reach),
undetectably. This needs arbitrary SQL as the owner, which is the same tier as S5, so it is
not blocking. **Hardening:** in the carve-out branch, also require
`NOT EXISTS (SELECT 1 FROM organisation WHERE id = OLD.organisation_id)`. The referenced row
is already gone when the RI action fires. Update the comment to match.

Related, and harmless: `ON UPDATE CASCADE` on the same FK (line 53) means any change to
`organisation.id` now raises through the "never reassigned" branch once audit rows exist.
It fails closed, but it is worth a sentence in the comment.

### S5 — NON-BLOCKING (docs must be corrected) — AU-3 / AU-15 / the decision log overstate what the trigger and the chain protect against

- **AU-3 is overstated.** It still says the trigger is "the deeper control, surviving even a
  compromised … API process" (`docs/03-features/audit-trail.md`, AU-3). The API connects as
  the table's **owner**. `compose.yml:67-71` and `charts/taskdesk/templates/postgresql-deployment.yaml:25-35`
  both run the official `postgres` image with `POSTGRES_USER`, which that image creates as a
  **superuser**. A compromised API process can therefore run any of these:
  - `ALTER TABLE audit_log DISABLE TRIGGER ALL`;
  - `DROP TRIGGER`;
  - `SET session_replication_role = replica`;
  - `CREATE RULE … ON INSERT … DO INSTEAD NOTHING`, which silently suppresses all future
    audit writes (verified live).

  The trigger survives a *buggy* API process, not a *compromised* one.
- **AU-15 and the decision log overstate the chain.** Both say AU-15's chain "already
  exist[s] to catch exactly that after the fact". The chain is an unkeyed SHA-256 with no
  head anchored outside the database. An actor who can disable the trigger can alter row *k*
  and recompute rows *k…n*, or delete the newest rows. `audit-verify` will report `ok`
  either way.
- **`data-model.md`'s "known limit" is incomplete.** The new paragraph names only the
  forged-insert case. Alter-and-recompute and tail-truncation are the same limit and are not
  named.

The docs must say plainly that, in this single-superuser-role deployment:
- the trigger stops accidental and buggy writes;
- the chain detects naive edits;
- neither stops or reveals a privileged actor, until the role split lands and a chain head
  is anchored externally (for example periodically exported, or signed with a key the DB
  role does not hold).

This is a correction to the wording of risk the decision already accepts, not a request to
reopen the decision.

### S6 — NON-BLOCKING — the AU-2 secret backstop is both bypassable and prone to false positives that will break legitimate audit rows

`audit-writer.ts:92-134`. The PR itself documents that it is a heuristic. The probe (P4)
shows how it behaves:

- **Correctly refused:** `{password: "hunter2"}`.
- **Written (bypasses):**
  - `{password: ["hunter2"]}`, because array members are never checked against the parent
    key;
  - `{token: 123456}`, a numeric OTP;
  - `{credentials: {value: "s3cr3t"}}`;
  - `{pwd: …}`;
  - `{passphrase: …}`.
- **Refused (false positives):**
  - `{apiKeyId: "key_123"}`;
  - `{secretRotatedAt: "…"}`;
  - `{tokenExpiresAt: "…"}`.

The false positives are the natural `after` shapes for the catalogue's own `api_key.created`
and `webhook.secret_rotated` actions (`actions.ts:69-73`). Once wiring lands, under AU-14's
"mutation still succeeds" rule, those audit rows would be dropped.

Before wiring, change the rule so that:
- a matching key with **any** non-null value, including an array or a number, is refused,
  and nested matching keys are covered too;
- `*Id`, `*At` and `*Count` suffixes are exempt.

Or, better, give each call site an explicit per-action allowlist of `after` keys, since
AU-2's real contract is "record which keys changed".

(An oversized payload that contains a secret is replaced wholesale by the truncation marker
before the check, so nothing leaks. That is fine.)

### Nit (no finding number)

`appendAuditLog`'s doc comment (`audit-writer.ts:155`) says "inside the caller's own
transaction -- never opens its own". Line 199 opens a real transaction when given the root
`db`, and does so deliberately, per its own later comment. Fix the first comment.

## Verdict

**CHANGES NEEDED — two BLOCKING findings (S1, S2).**

The append-only enforcement itself is sound against every DML route I could find, the
carve-out cannot be abused to rewrite hashed columns, the chain does not fork under the
READ COMMITTED isolation the codebase uses, and the canonical form round-trips every
object-shaped edge case. What blocks is the verifier and the writer disagreeing with the
database about what an intact chain looks like:

- S1: a legitimate rollback reads as tampering.
- S2: a top-level string payload is stored as something other than what was hashed.

Both permanently break `audit-verify` on an append-only table that cannot be repaired, and
because the verifier stops at the first break, both hide any real tampering after it. Both
fixes are a few lines, each with a regression test. S3–S6 should be addressed or tracked.
S5 is a docs correction and should land with this PR.

Test evidence at this head: integration suite 73 files / 978 tests passed on `pr291_opus_test`.
The database was dropped afterwards.

---

## Delta-confirmation round (a800c08)

**Reviewer:** Opus 5.5. This is the same context as the review above, confirming a
remediation round it did not author.
**Reviewed head:** `a800c08e968b6d98356138542744fcfa4c30eb03`
(confirmed via `gh pr view 291 --json headRefOid`).

**Delta reviewed:** `git diff ce11fe0 22ab598` (the non-merge commits `6a056a5`, `4f20080`
and `22ab598`).

**The merge.** The merge `a800c08` changes exactly the files that `main` changed since the
merge base. That is #293's 8 files: `packages/ui/**` and `docs/02-design/design-system.md`.
It changes nothing under `apps/api`, `tests`, `scripts`, or any other `docs/` path.

**Test evidence.** The full integration suite ran on the private database `pr291_opus_test`,
td-lane-pg, Postgres 18.6: **73 files and 1006 tests, all passed**. After that I ran a
throwaway probe file against the same database. I deleted it afterwards and did not commit
it. Then I dropped the database.

**Migration metadata.** The migration snapshot `id` was regenerated. The old id is not
referenced by anything. `0067` is still the newest journal entry, and `main` has nothing
after `0066`.

### Per-finding verdicts

**S1 — CLOSED.** The `seq`-contiguity check is gone (`verify-audit-chain.ts`). Rows are
still ordered by `seq`. The PR's new tests cover both rollback shapes. The PR's existing
deleted-middle-row test still catches a deleted row via `prev_hash_mismatch`. In my own
probes, every rollback that consumed a `seq` value still verified `ok`.

**S2 — CLOSED for the reported shapes, with one residual in the same class. See S7.**
`JSON.stringify` is now bound explicitly. These top-level values all round-trip and verify
`ok`: the string `"hello"`, the string `"null"`, `[1,"2",null]`, `[]`, and `undefined`
(which is treated as `null`).

These `JSON.stringify`-mangling inputs now fail closed, because the writer throws before
any SQL runs:

| Input | Where it fails |
| --- | --- |
| `BigInt` | at the 64 KB size check |
| `Date` (member or top-level) | `canonicalJson` rejects the non-plain object |
| a `toJSON` function member | `canonicalJson` rejects it as a `Function` |
| a class instance with `toJSON` | `canonicalJson` rejects the non-plain object |
| `NaN` | `canonicalJson` rejects the non-finite number |
| a function | `canonicalJson` rejects it |
| a symbol | `canonicalJson` rejects it |
| an `undefined` member | `canonicalJson` throws before any SQL |
| an `undefined` array element | `canonicalJson` throws before any SQL |

An `Object.create(null)` object round-trips correctly.

**S3 — CLOSED.** `UNIQUE (prev_hash)` is in both the migration and the snapshot. I probed it
three ways:

- **Empty table, two concurrent first inserts, one caller in `REPEATABLE READ`.** The
  second insert failed with `23505 audit_log_prev_hash_unique`. It did not create a second
  `ZERO_HASH` root.
- **Empty table, eight parallel READ COMMITTED appends.** All 8 succeeded. They produced 8
  distinct `prev_hash` values, exactly one of them `ZERO_HASH`, and the chain verified `ok`.
- **Non-empty table, `REPEATABLE READ` fork (my original repro).** It now fails with
  `23505`, and the chain still verifies `ok`.

The claim "`ZERO_HASH` can never be read a second time" holds while no rows are ever
deleted. It stops holding once `audit-purge` exists: a purge that empties the table would
make the writer chain from `ZERO_HASH` rather than from the anchor. That is `audit-purge`'s
design problem, not this PR's.

**S4 — CLOSED.** I checked the timing live. Postgres runs `ON DELETE SET NULL` as an AFTER
trigger on `organisation`. By the time it updates `audit_log`, the deleted organisation row
is no longer visible to the same transaction, so `NOT EXISTS` is true for a real tombstone.

| Probe | Result |
| --- | --- |
| Direct `UPDATE audit_log SET organisation_id = NULL` on a live organisation | refused |
| Real `DELETE FROM organisation` | succeeded; both rows were tombstoned |
| The same direct update, inside a transaction that had just deleted a *different* organisation | refused |
| `UPDATE organisation SET id = …` (the `ON UPDATE CASCADE` path) | refused; fails closed, as noted before |

The chain verified `ok` after all of these.

**S5 — CLOSED.** These now state the risk accurately, and in the same terms:

- AU-3;
- AU-15;
- the `data-model.md` "known limit" paragraph;
- the migration header;
- the `schema.ts` comment.

All five say the controls stop buggy queries and non-owner roles, and do not stop an owner
or superuser. They say the unkeyed, unanchored chain does not catch alter-and-recompute or
deleting the newest rows. #296 exists and is open.

One wording nit remains in the decision-log entry. Its second closing bullet reads "an
external chain anchor (`audit_chain_anchor` / `audit-purge`)". `data-model.md`'s own
paragraph, correctly, says `audit_chain_anchor` "does not by itself anchor outside the
database". Suggested wording: "an anchor held outside the database (for example an exported
or witnessed `audit_chain_anchor` head) or a keyed hash". Apart from that the entry is now
accurate. This is NON-BLOCKING.

**S6 — CLOSED as specified. Residual gaps are NON-BLOCKING and acceptable under AU-2.**

What the probes caught:
- `accessToken` inside an array of objects;
- `refresh_token` four levels deep;
- `PASSWORD`;
- `API_KEY`;
- a numeric or array value under a matching key;
- `{password: false}` and `{password: ""}`.

Legitimate keys the old check wrongly refused, and which now pass: `apiKeyId`,
`secretRotatedAt`, `tokenExpiresAt`, and `changedKeys: ["password","token"]`.

Still written (bypasses):

| Bypass | Example keys |
| --- | --- |
| Unicode lookalikes | Cyrillic `pаssword`, full-width `ｐassword`, a zero-width joiner inside |
| Single-word compounds | `accesstoken`, `apikey` |
| Digit suffixes | `password2` |
| Dotted paths | `auth.password` |
| Unlisted names | `bearer`, `cookie`, `otp` |
| A secret hidden under an exempt key | `{passwordId: "hunter2"}`, `{secretId: {value: "s3cr3t"}}` |

The exempt-key bypass is **acceptable per AU-2**. AU-2 now says outright that the backstop
is "not a substitute for this rule". The rule is a caller contract: record which keys
changed, never their values. Any list of names can be defeated by picking a different name.

One gap is worth fixing when mutations are wired: **dotted paths**. They are the natural
shape of a plugin-configuration diff, such as `smtp.password`, which is exactly AU-2's own
example. Adding `.` and digit boundaries to `keySegments` would close it.

There is also one new false positive: `{hasPassword: true}` is refused. Under AU-14 that
would drop a legitimate `user.updated` row. Consider exempting boolean values, or an
`is`/`has` first segment.

**Nit (doc comment) — CLOSED.**

### S7 — BLOCKING — a sparse array in `before`/`after` is still hashed differently from what is stored (a residual of S2)

`canonicalJson` (`packages/domain/src/audit/audit.ts:150`) renders arrays with
`value.map(...).join(",")`. `Array.prototype.map` skips holes and `join` renders a hole as
the empty string, so `[ , 1]` is hashed as `[,1]`. `JSON.stringify`, which the writer now
binds (`audit-writer.ts`, `afterJson`), renders the same array as `[null,1]`. The row
therefore stores something other than what was hashed.

Reproduction:

```ts
const a: unknown[] = []; a[1] = 1;
await appendAuditLog(db, base({ after: a as never }));      // written, stored [null, 1]
await verifyAuditChain(db);                                  // { ok: false, reason: "row_hash_mismatch" }
// Same for a nested hole: { list: a } -> stored {"list": [null, 1]} -> row_hash_mismatch
```

The consequence is the same as S1 and S2. An untampered row fails verification
permanently. The table is append-only, so the row cannot be repaired. The verifier stops
at the first break, so every real break later in the chain is hidden.

**How it could happen.** Not through user input: `JSON.parse` never produces holes, and
neither does `pg`'s JSON decoding. It would take a programmer error such as `new Array(n)`,
`arr[i] = x` past the end of an array, or `delete arr[i]`. It is still BLOCKING because it
is the only programmer error the writer lets through *silently and irreversibly*. Every
other malformed input I tried throws before the insert.

**Fix, either of these, with a regression test for a top-level hole and a nested hole:**

- **(a)** In `appendAuditLog`, normalise once and use the same value for both the hash and
  the insert:
  ```ts
  const normalised = before === null ? null : JSON.parse(beforeJson)
  ```
  The same goes for `after`. That makes what is stored and what is hashed identical by
  construction.
- **(b)** Have `canonicalJson` throw on a hole. `canonicalJson` is `packages/domain` code,
  so this is a small change to that package.

Option (a) is simpler, stays inside this PR's files, and also removes the whole class of
mismatches between what is hashed and what is stored.

### Overall verdict (a800c08)

**CHANGES NEEDED — one BLOCKING finding (S7).**

- S1 through S6 and the nit are closed.
- The decision-log wording (S5) and the S6 gaps are NON-BLOCKING suggestions.
- S7 is a narrower instance of S2's class. Its fix is a few lines plus one regression test.
- A delta check of that fix alone is enough to close this review; a full Opus round is not
  needed.

---

## Closing check (a43cca0)

**Reviewer:** Opus 5.5, the same context as the two rounds above. I did not author, direct
or remediate the fix.

**Reviewed head:** `a43cca0e1679fdd2753d8837ed0943c311d4ada4`

I confirmed the head with `gh pr view 291 --json headRefOid`.

**Delta reviewed:**
- `84fd35d`: the note, plus the decision-log anchor wording.
- `3403640`: the S7 fix and S6's split on `.`.
- The merge `a43cca0`, which brought in #292.

**Test evidence at this head:**
- Full integration suite on the private database `pr291_opus_test` (td-lane-pg): **74 files,
  1025 tests, all passed.**
- `node --test 'scripts/ci/**/*.test.mjs'`: **495 tests in 88 suites, all passed.**
- A throwaway probe file, deleted afterwards and not committed.
- The database was dropped afterwards.

### S7: CLOSED, structurally

`appendAuditLog` now normalises `before` and `after` exactly once, as
`JSON.parse(JSON.stringify(value))`. That one normalised value then goes to all three places:
- the secret check,
- `canonicalRowHash`,
- the INSERT (`JSON.stringify(normalized)`).

So nothing reaches the hash that does not also reach the stored bytes. The only remaining
transformation is Postgres's own jsonb parse, and `verifyAuditChain` re-canonicalises after it
reads the row back. Key order, whitespace and number formatting therefore cannot diverge.

Each of the following inputs was written, read back and verified `ok`:

| Input | Stored as | Result |
| --- | --- | --- |
| Sparse array at top level | `[null,null,"x"]` | `ok` |
| Sparse array nested in an object | nulls in place of holes | `ok` |
| Sparse array nested in an array | nulls in place of holes | `ok` |
| `undefined` member | member dropped | `ok` |
| `undefined` array element | `null` | `ok` |
| `-0`, including inside an array | `0` | `ok` |
| NFC key and value | unchanged | `ok` |
| NFD key and value | unchanged | `ok` |
| NFC and NFD forms as sibling keys | kept as two distinct keys | `ok` |
| Astral characters | unchanged | `ok` |
| U+2028 and U+2029 | unchanged | `ok` |
| `0.1`, `1e-7`, `1e21`, `5e-324`, `MAX_VALUE` | unchanged | `ok` |
| `9007199254740993` | the same double on both sides | `ok` |
| `__proto__` as an own key | unchanged | `ok` |
| Keys `""`, `"2"`, `"10"` | unchanged | `ok` |
| Nesting 100 objects deep | unchanged | `ok` |
| Nesting 1000 arrays deep | unchanged | `ok` |

These fail closed, with nothing written and the chain healthy afterwards:
- 5000-deep and 100000-deep nesting (`RangeError`);
- `\u0000` and a lone surrogate (Postgres rejects them);
- `BigInt`.

A `toJSON` that returns `{password: …}` is now caught by the secret check, because the check
runs on the normalised value.

One side effect, NON-BLOCKING and not an integrity issue. `NaN`, `Infinity` and `Date` values
are now coerced to `null` or an ISO string instead of throwing, so what is stored is still
exactly what is hashed. The cost is fidelity: a caller's `NaN` is now recorded as `null`.

### S6 dot split: CLOSED, with no new false positive on catalogue shapes

`smtp.password` and `auth.password` are now refused.

These all still pass:
- `api_key.created`, in both camelCase and snake_case, with keys taken from `data-model.md`'s
  `api_key` columns: `apikeyId`/`apikey_id`, `prefix`, `capabilities: ["api_key:manage", …]`,
  `ipAllowlist`, `rateLimitPerMinute`, `expiresAt`, `lastUsedAt`, `lastUsedIp`, `isMcp`;
- `api_key.revoked` (`disabledAt`, `disabledReason`, `apiKeyId`);
- `webhook.created` (`url`, `events`, `active`, `createdBy`);
- `webhook.secret_rotated` (`secretRotatedAt`, `secret_rotated_at`);
- `webhook.deleted`;
- `plugin.changed`, whether the changes are recorded as `changedKeys: ["smtp.password", …]` or
  as `{"smtp.host": …, "smtp.port": …}`.

Capability ids use `:` (`api_key:manage`) and are array values, so the split does not touch
them.

`{"smtp.password": true}` is refused. This is the documented fail-closed near-miss behaviour
AU-2 now describes, and `changedKeys` is the recording shape to use instead.

### #292 merge: no interaction

The merge's changes relative to its first parent are exactly `main`'s delta, 9 files:
- `apps/api/src/work-item/**`;
- `docs/01-architecture/events.md`;
- #292's own security note;
- `scripts/ci/probes/check-events.test.mjs`;
- two work-item integration tests.

**No file is touched by both #291 and #292.** Nothing under `apps/api/src/work-item/**`
references `appendAuditLog` or `audit_log`, apart from one doc comment.

### Other checks

**Decision-log wording (S5 nit): CLOSED.** The entry now says the anchor must be stored
outside this database.

### Per-finding verdicts

| Finding | Verdict |
| --- | --- |
| S1 | CLOSED |
| S2 | CLOSED |
| S3 | CLOSED |
| S4 | CLOSED |
| S5 | CLOSED |
| S6 | CLOSED; residual gaps documented and accepted in AU-2 |
| S7 | CLOSED |
| Nit | CLOSED |

### Overall verdict (a43cca0)

**CLEAR.** No blocking findings remain at `a43cca0e1679fdd2753d8837ed0943c311d4ada4`.

The residuals are documented, owned, and not this PR's to close:
- the owner/superuser risk, tracked in #296;
- the need for an anchor outside the database;
- the `audit-purge` empty-table restart.

The `NaN`/`Date` coercion is a NON-BLOCKING fidelity note.

---

## Delta (a3b879b)

**Reviewer:** Opus 5.5, the same context as above.

**Reviewed head:** `a3b879b7dc17a8f86b24a1d59674f9ef02cbd559`

I confirmed the head with `gh pr view 291 --json headRefOid`. The delta is
`git diff 903bd51 a3b879b`: the gitleaks false-positive suppression.

### Checks

- **Scope.** The delta touches exactly three files:
  - `.gitleaksignore` (new);
  - `docs/07-planning/decision-log.md` (+25 lines, one new entry);
  - `tests/api-integration/audit-log.test.ts`.

  In the test file, only two string literals change, at lines 188 and 545, from
  `"sk_live_abc123"` to `"fake-api-key-for-test"`. No test logic, name or assertion changes.

  `audit-log.test.ts` ran on the private database `pr291_opus_test`. **49 of 49 tests
  passed.** The database was dropped afterwards.

- **`.gitleaksignore`.** It holds three comment lines and exactly two entries. Each entry is
  a full `commit-sha:file:rule-id:line` fingerprint, which is the only form gitleaks'
  `.gitleaksignore` supports. A fingerprint matches one finding, at one line, in one commit.
  There is no path, glob, rule-wide or allowlist entry, and the repo has no `.gitleaks.toml`
  that could widen it.

  Both fingerprints point at real lines:
  - `git show dc63e85:…:188` is the `sk_live_abc123` fixture;
  - `git show 4f20080:…:545` is the same fixture.

  Other commits in the range also contain the string. In git mode gitleaks reports only the
  commit that *adds* a line, so these two fingerprints are the complete set.

- **Live gitleaks run.** I ran `ghcr.io/gitleaks/gitleaks:v8.24.3` in `git` mode on a
  throwaway clone. The clone was deleted afterwards.

  | Run | Result |
  | --- | --- |
  | `--no-merges --first-parent 63b011d^..a3b879b` | no leaks found |
  | Same range, merges included | no leaks found |
  | `.gitleaksignore` removed | exactly the 2 findings, with fingerprints byte-identical to the file's entries |
  | Canary commit adding `sk_live_abc123` again, plus an AWS-style key, in **the same file**, ignore file present | both flagged (`generic-api-key`, `aws-access-token`) |

  The ignore file cannot blind the scanner to anything else, including a later secret in
  this same file.

- **S6 is still exercised.** `assertNoObviousSecret` refuses the write whenever
  `isSecretShapedKey(key)` matches and the value is not `null`. The decision depends on the
  key name, `apiKey`, which matches the `api`+`key` pair, and never on the value.

  Both tests still assert the `looks like a secret value` rejection, and both pass with the
  fake value. The new value also no longer matches gitleaks' `generic-api-key` pattern at
  the head. The live run confirms this.

- **Decision log.** The new entry correctly records:
  - the rule;
  - the file, both commits and both lines;
  - that suppression is by exact fingerprint only;
  - why fixing only the head cannot clear a scan over the whole PR history;
  - the rejected alternatives: a fresh PR, and path- or rule-wide ignores.

  It attributes the decision to **Thomas**, via `AskUserQuestion`, on 2026-09-23. The
  2026-09-17 CodeQL alert #2 precedent it cites exists in the log. It is accurate.

### Verdict (a3b879b)

**CLEAR.** The suppression is minimal and exact, the fixture change keeps S6's coverage, and
nothing else changed. Every earlier finding verdict stands: S1 to S7 and the nit are all
CLOSED.
