import { isPostgresDeadlockError } from "./controllers/transition-work-item";

/**
 * Issue #295 -- migration 0056's own documented obligation (issue #196, OS3): the
 * `work_item_claim_key` and `work_item_reject_parent_cycle` triggers (both `BEFORE
 * INSERT`/`UPDATE` on `work_item`) can deadlock EACH OTHER (`40P01`) when one transaction
 * hits a real key collision while another concurrently runs a cycle check that locks the
 * same rows in the opposite order -- reproduced live during PR #195's review. The
 * migration comment's own words: "whichever code builds #23's actual write path must
 * retry on `40P01` regardless of which trigger raised it." `set-work-item-parent.ts` and
 * `detach-work-item-parent.ts` (#432) are that write path today -- this is that retry,
 * shared by both.
 *
 * Retries the ENTIRE `run` callback, not just one statement inside it: a deadlock aborts
 * the whole transaction, so `db.transaction`'s own rollback already discarded every read
 * this attempt made. Re-invoking `run` from scratch is what re-reads current state on the
 * next attempt -- never a replay of a decision made against data that is now stale. Reuses
 * `transition-work-item.ts`'s own `isPostgresDeadlockError` (added for the identical
 * `40P01` condition between this same trigger pair and that route's own locks, Opus
 * security review of PR #457 D2/D3) rather than a second copy of that cause-chain walk.
 *
 * A bounded retry count, not an unbounded loop: a `40P01` that recurs past this many
 * attempts is no longer the narrow, transient collision migration 0056 describes, and
 * should surface rather than retry forever.
 */
const MAX_ATTEMPTS = 4; // one first try, plus up to 3 retries on a genuine 40P01.

export async function runWithParentWriteDeadlockRetry<T>(
  run: () => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (!isPostgresDeadlockError(error) || attempt === MAX_ATTEMPTS) {
        throw error;
      }
    }
  }
  // Unreachable -- the loop above always either returns or throws.
  throw new Error(
    "unreachable: runWithParentWriteDeadlockRetry exhausted its own loop",
  );
}
