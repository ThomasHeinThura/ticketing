ALTER TABLE "work_item" ADD CONSTRAINT "work_item_parent_not_self" CHECK ("work_item"."parent_id" is distinct from "work_item"."id");
--> statement-breakpoint
-- #188 -- closes the SECOND of two `work_item.parent_id` integrity gaps found by the
-- mandatory Opus security review of PR #185 (the first, direct self-parenting, is the
-- `work_item_parent_not_self` CHECK constraint just above). A CHECK constraint cannot
-- express "no cycle exists in this graph" -- it can only compare columns on the ONE row
-- being written -- so a multi-row cycle (A's parent is B, B's parent is A; or any longer
-- loop) needs something that can walk the chain. This trigger does that walk.
--
-- RACE ANALYSIS, done to the rigor #191 O2 required after a superficially similar
-- hand-written trigger (`work_item_key_alias_reject_live_collision`, #186 S5) turned out
-- to have a genuine, live-reproduced TOCTOU race that survived even SERIALIZABLE
-- isolation. That trigger's race came from checking ANOTHER table's data with a plain,
-- unlocked SELECT -- a classic check-then-act gap no amount of care in the SELECT's
-- WHERE clause can close, because nothing stops the checked table's own row from
-- changing between the check and the caller's commit.
--
-- A naive version of THIS trigger (walk the parent chain with plain, unlocked SELECTs)
-- would have an ANALOGOUS but distinct race: not "another table changes underneath me"
-- but "another concurrent transaction is changing a DIFFERENT row of THIS SAME table,
-- and my walk reads its pre-change value." Concretely: T1 sets A.parent_id := B: T2,
-- concurrently, sets B.parent_id := A. T1's walk (starting at B) would read B's OLD
-- parent_id under plain MVCC snapshot semantics -- T1 never locks B, only A (the row its
-- own UPDATE targets) -- and T2's walk (starting at A) would symmetrically read A's OLD
-- parent_id. Neither walk can see the other's uncommitted write; both conclude "no
-- cycle;" both commit -- producing the 2-cycle A<->B that NEITHER transaction, examined
-- alone, created. (This is the classic "write skew" pattern: SERIALIZABLE's SSI WOULD
-- catch this specific two-transaction pivot -- each transaction both reads a row the
-- other writes and writes a row the other reads, a full rw-antidependency CYCLE, exactly
-- the "dangerous structure" SSI exists to detect and abort, unlike #191 O2's single-edge
-- case where SSI had nothing to catch. But #191 already established this codebase does
-- not lean on the application choosing a specific isolation level for an integrity
-- guarantee that must also hold under the READ COMMITTED default, and a longer, 3+-row
-- concurrent cycle attempt is not obviously reducible to that same two-transaction pivot
-- -- so isolation level is deliberately NOT what this fix relies on.)
--
-- FIX: every ancestor visited during the walk is read with `SELECT ... FOR NO KEY
-- UPDATE`, not a plain SELECT -- a real row lock, held until the visiting transaction's
-- own commit or rollback. A concurrent transaction that is itself changing that
-- ancestor's own `parent_id` already holds that row's lock for the duration of its own
-- UPDATE, so this walk BLOCKS on it instead of reading a stale, about-to-change value: it
-- can only proceed once that other transaction has either committed (seeing its real,
-- final result) or rolled back (seeing the true, unchanged value) -- never a value
-- mid-flight. Applied to the 2-row race above: whichever of T1/T2 reaches the other's row
-- first (via this locking read) blocks the second until the first resolves, so the second
-- transaction's walk sees the FIRST transaction's real committed edge and correctly
-- detects the cycle it would complete. An n-way concurrent attempt to close a longer
-- cycle this way (each of n transactions locking the "next" row in an attempted ring) is
-- closed the same way at each pairwise step -- and, on the interleavings where every leg
-- ends up mutually waiting on the next before any of them can commit, becomes a genuine
-- wait-for cycle among the TRANSACTIONS themselves, which Postgres's own deadlock
-- detector resolves by aborting exactly one of them, breaking the attempted cycle by
-- construction, not by chance. Both outcomes -- an explicit cycle rejection once a leg
-- observes a real committed edge, and a deadlock-detector abort when a full mutual wait
-- forms -- are exercised live by a real concurrent reproduction under plain READ
-- COMMITTED (no isolation-level elevation) in `work-item-parent-cycle-guard.test.ts`,
-- covering both the 2-row swap and a longer ring.
--
-- #195 OS1 (mandatory Opus review of this PR) -- the walk originally used `FOR UPDATE`
-- (`LockTupleExclusive`), which is strictly stronger than the invariant above needs.
-- Everything the race analysis relies on only requires that a concurrent transaction
-- writing to one of these SAME rows' `parent_id` be blocked -- that is `FOR NO KEY
-- UPDATE` (`LockTupleNoKeyExclusive`), because `parent_id` is not part of any key this
-- table is looked up by (the PK is `id`; the unique indexes are on `key`,
-- `(project_id, id)`, `(project_id, number)` -- none include `parent_id`). `FOR UPDATE`
-- additionally conflicts with `FOR KEY SHARE`, the lock Postgres takes on a referenced
-- row to satisfy an UNRELATED foreign key check (e.g. inserting a new `watcher` or
-- `work_item_key_alias` row that references one of these ancestors) -- so the stronger
-- lock was blocking work that has nothing to do with this walk or its cycle-safety
-- invariant. `FOR NO KEY UPDATE` does not conflict with `FOR KEY SHARE`, so that
-- unrelated work now proceeds immediately, while every interleaving the FIX paragraph
-- above depends on (two transactions each wanting to CHANGE one of the SAME rows'
-- `parent_id`) is completely unaffected: `FOR NO KEY UPDATE` still conflicts with itself
-- and with `FOR UPDATE`, which is all the cycle-safety argument ever used. Verified live,
-- side by side: the two-transaction swap and three-transaction ring reproductions in
-- `work-item-parent-cycle-guard.test.ts` still block/deadlock and resolve identically
-- under `FOR NO KEY UPDATE`, and a new regression test proves a concurrent FK-referencing
-- insert under a locked ancestor no longer blocks.
--
-- #195 OS2 (same review) -- `BEFORE INSERT OR UPDATE OF parent_id` fires whenever a
-- statement's SET list MENTIONS `parent_id`, not when its value actually changes --
-- the same Postgres behavior #191 N2 found on the sibling `work_item_claim_key` trigger.
-- An entirely ordinary whole-row ORM update (`.set({ ...item, title: newTitle })`, which
-- naturally re-sends every column including an unchanged `parent_id`) would otherwise
-- re-run this entire locking walk -- taking `FOR NO KEY UPDATE` on the whole ancestor
-- chain -- for a write that has nothing to do with reparenting. Combined with OS1's
-- lock strength, an uncorrected version of this would mean an ordinary title edit blocks
-- child creation under every one of the item's ancestors for the life of the transaction,
-- which #23's future write path (wrapping this update together with its own `activity`/
-- `audit_log` writes) would hit routinely. Fixed the same way N2 was: bail out
-- immediately, before the walk, when `TG_OP = 'UPDATE'` and `NEW.parent_id IS NOT
-- DISTINCT FROM OLD.parent_id`. `OLD` is only defined for `UPDATE` -- referencing it on
-- `INSERT` raises "record 'old' is not assigned yet" -- so the `TG_OP` check is written
-- as its own `IF`, not the left half of an `AND`, to avoid depending on AND
-- short-circuit evaluation to keep `OLD` unreferenced on INSERT. Regression tests in
-- `work-item-parent-cycle-guard.test.ts` prove both directions: a whole-row update that
-- re-sends `parent_id` unchanged takes no ancestor lock at all, and one that genuinely
-- changes `parent_id` still walks and still rejects a cycle.
--
-- BOUND: `docs/03-features/relations-and-hierarchy.md` RH-7 caps legitimate parent
-- chains at depth 5, so a real chain never walks more than a handful of hops. `max_hops`
-- below (1000) is pure defense-in-depth against a chain that is ALREADY corrupt for some
-- unrelated reason (e.g. rows inserted before this trigger existed, or a future
-- direct-SQL bulk load) -- it is never expected to trip in ordinary operation, and
-- tripping it fails the write closed rather than hanging the transaction on a runaway
-- walk.
--
-- `SET search_path = pg_catalog, public` plus the fully-qualified `public.work_item`
-- reference below follow #191 O3/N3's own corrected lesson: schema-qualifying the table
-- reference, not the search_path pin, is what actually stops a session-local
-- `CREATE TEMP TABLE work_item (...)` from shadowing the real table on an unqualified
-- reference (pg_temp is searched first regardless, unless explicitly excluded, which
-- this pin does not do). The pin is kept anyway as defense-in-depth against any OTHER
-- unqualified identifier a future edit to this function might add. `SECURITY INVOKER`
-- (the default) is correct here -- this is an integrity bypass concern, not a
-- privilege-escalation one.
--
-- FIRING ORDER: this trigger and `work_item_claim_key` (#191) both fire on
-- `BEFORE INSERT` on `work_item` and are ordered alphabetically by Postgres
-- ("work_item_claim_key" < "work_item_reject_parent_cycle", so the claim trigger runs
-- first) -- but neither reads nor writes anything the other touches (this trigger never
-- reads or writes `key`; the claim trigger never reads or writes `parent_id` and does
-- not modify `NEW` at all, only inserts into a side table), so which one runs first has
-- no effect on either's correctness. Confirmed with `SELECT tgname FROM pg_trigger WHERE
-- tgrelid = 'work_item'::regclass ORDER BY tgname;` against the migrated schema, per
-- `docs/04-engineering/migrations.md`'s own instruction to verify trigger order live
-- rather than assume it.
CREATE OR REPLACE FUNCTION work_item_reject_parent_cycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_id text;
  next_parent_id text;
  hops integer := 0;
  max_hops constant integer := 1000;
BEGIN
  -- #195 OS2 -- see this function's header comment. Deliberately two nested IFs, not one
  -- `TG_OP = 'UPDATE' AND ...`, so `OLD` is never referenced when `TG_OP = 'INSERT'`.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Direct self-parent is rejected by the `work_item_parent_not_self` CHECK constraint;
  -- skip the walk entirely rather than taking a lock only to have the CHECK reject the
  -- row anyway.
  IF NEW.parent_id = NEW.id THEN
    RETURN NEW;
  END IF;

  current_id := NEW.parent_id;

  LOOP
    hops := hops + 1;
    IF hops > max_hops THEN
      RAISE EXCEPTION
        'work_item %: parent chain from % exceeds % hops -- refusing to walk further (data already inconsistent, or max depth badly violated)',
        NEW.id, NEW.parent_id, max_hops;
    END IF;

    IF current_id = NEW.id THEN
      RAISE EXCEPTION
        'work_item % cannot be its own ancestor (cycle detected through parent %)',
        NEW.id, NEW.parent_id;
    END IF;

    -- Row lock, not a plain read -- see this function's header comment for why, and
    -- #195 OS1 for why `FOR NO KEY UPDATE` (not `FOR UPDATE`) is the right strength.
    -- Every ancestor actually on the FK-guaranteed chain exists, so `NOT FOUND` here
    -- would mean a dangling reference; fail closed rather than loop.
    SELECT parent_id INTO next_parent_id
      FROM public.work_item
      WHERE id = current_id
      FOR NO KEY UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'work_item %: parent chain references missing work_item % -- refusing to walk further',
        NEW.id, current_id;
    END IF;

    EXIT WHEN next_parent_id IS NULL;
    current_id := next_parent_id;
  END LOOP;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER work_item_reject_parent_cycle
  BEFORE INSERT OR UPDATE OF parent_id ON work_item
  FOR EACH ROW
  EXECUTE FUNCTION work_item_reject_parent_cycle();