import { and, eq, inArray, isNull } from "drizzle-orm";
import db from "../database";
import { slaPauseTable } from "../database/migration-schema";

/**
 * The work items among `workItemIds` with an open `waiting_customer` SLA pause. `CP-5`: the
 * customer status of such an open item is `need_more_info` (see `portalCustomerStatus`).
 */
export async function workItemsWaitingOnCustomer(
  workItemIds: readonly string[],
): Promise<Set<string>> {
  if (workItemIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ workItemId: slaPauseTable.workItemId })
    .from(slaPauseTable)
    .where(
      and(
        inArray(slaPauseTable.workItemId, [...workItemIds]),
        eq(slaPauseTable.reason, "waiting_customer"),
        isNull(slaPauseTable.endedAt),
      ),
    );
  return new Set(rows.map((row) => row.workItemId));
}
