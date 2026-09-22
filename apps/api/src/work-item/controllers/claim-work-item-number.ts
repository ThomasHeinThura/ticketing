import { eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type db from "../../database";
import { projectTable } from "../../database/schema";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * `WI-2`: "The key is `{project.key}-{number}`, where `number` comes from
 * `project.last_work_item_number` incremented in the same transaction [as the insert].
 * Never reused, even after deletion."
 *
 * JUDGMENT CALL, flagged explicitly (per this task's own instruction to flag rather than
 * guess): `project.last_work_item_number` does not exist as a physical column.
 * `data-model.md` §2 already documents it under that name, but the live schema still
 * carries kaneo's original `project.last_task_number` (`lastTaskNumber`,
 * `apps/api/src/database/schema.ts`'s own comment on `work_item.number` says so directly:
 * "#23 owns introducing the v2 name and the assignment"). Renaming that column is a
 * migration on `project` -- a shared table other in-flight lanes also touch -- which is
 * beyond this slice's authorized scope ("do not touch ... any other table beyond
 * work_item and reading project/state/work_item_type for validation"). This function
 * therefore claims a number from the EXISTING `last_task_number` column, using the exact
 * atomic idiom this codebase already established for the identical problem on the `task`
 * table (`apps/api/src/task/controllers/claim-task-numbers.ts`): a single
 * `UPDATE ... SET last_task_number = last_task_number + 1 WHERE id = $1 RETURNING
 * last_task_number`, executed inside the caller's own transaction.
 *
 * WHY THIS IS RACE-FREE UNDER PLAIN READ COMMITTED, the same reasoning
 * `claim-task-numbers.ts` relies on: an `UPDATE` takes a row-level lock on the target
 * `project` row for the duration of the transaction. A second, concurrent `UPDATE` of the
 * same row blocks until the first transaction commits or rolls back, then reads the
 * POST-commit value -- so two concurrent creates in the same project can never observe or
 * claim the same number, and numbers are handed out in commit order, never reused (no
 * other path decrements or otherwise reuses this column).
 *
 * NOT RENAMED to `lastWorkItemNumber` in TypeScript either, deliberately: the physical
 * column name and the Drizzle property name are already tied together
 * (`lastTaskNumber: integer("last_task_number")` in `schema.ts`), and renaming just the
 * TS-side accessor here while every other reader/writer of that column (`project/response.ts`,
 * `claim-task-numbers.ts`) keeps the old name would make the same column answer to two
 * different names depending which file you read, which is worse than the current
 * single, honestly-labelled name. The real fix -- renaming the physical column to match
 * `data-model.md` -- is flagged in this PR's body as follow-up work, not done here.
 */
export async function claimWorkItemNumber(
  projectId: string,
  dbOrTx: DbOrTx,
): Promise<number> {
  const [updated] = await dbOrTx
    .update(projectTable)
    .set({
      lastTaskNumber: sql`${projectTable.lastTaskNumber} + 1`,
    })
    .where(eq(projectTable.id, projectId))
    .returning({ lastTaskNumber: projectTable.lastTaskNumber });

  if (!updated) {
    throw new HTTPException(404, { message: "Project not found" });
  }

  return updated.lastTaskNumber;
}
