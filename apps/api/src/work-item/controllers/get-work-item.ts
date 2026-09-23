import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { workItemTable } from "../../database/schema";

/**
 * `GET /api/work-items/{key}` (`work_item:read`, plus reach on the project --
 * `work-items.md` § Permissions). `workspaceId` is the value the route's own middleware
 * (`requireWorkItemReach()`, `../require-work-item-reach.ts`) already resolved by looking
 * this same key up --
 * re-checked here, the same "controller re-loads the row itself" pattern
 * `workspace/policy.ts` documents for `GET /api/workspace/{id}`, rather than trusting the
 * middleware's lookup as the only read.
 */
export async function getWorkItemByKey(key: string, workspaceId: string) {
  const workItem = await db.query.workItemTable.findFirst({
    where: eq(workItemTable.key, key),
  });

  if (!workItem || workItem.workspaceId !== workspaceId) {
    throw new HTTPException(404, { message: "Work item not found" });
  }

  return workItem;
}

export default getWorkItemByKey;
