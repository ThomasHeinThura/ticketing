import { and, asc, eq } from "drizzle-orm";
import db from "../database";
import { stateTable } from "../database/schema";
import { stateWipLimitTable } from "../database/schema-p5-agile";
import type { AgileActor } from "./audit";
import { auditAgile } from "./audit";

export async function listWipLimits(projectId: string) {
  const rows = await db
    .select({
      stateId: stateWipLimitTable.stateId,
      limit: stateWipLimitTable.wipLimit,
    })
    .from(stateWipLimitTable)
    .where(eq(stateWipLimitTable.projectId, projectId))
    .orderBy(asc(stateWipLimitTable.stateId));
  return rows;
}

/** Set (or, with `null`, clear) a board column's limit. `undefined` when the state is not this project's. */
export async function setWipLimit(
  scope: { workspaceId: string; projectId: string },
  stateId: string,
  limit: number | null,
  actor: AgileActor,
): Promise<{ stateId: string; limit: number | null } | undefined> {
  return db.transaction(async (tx) => {
    const [state] = await tx
      .select({ id: stateTable.id })
      .from(stateTable)
      .where(
        and(
          eq(stateTable.id, stateId),
          eq(stateTable.projectId, scope.projectId),
        ),
      )
      .for("update")
      .limit(1);
    if (!state) return undefined;
    const [existing] = await tx
      .select({ limit: stateWipLimitTable.wipLimit })
      .from(stateWipLimitTable)
      .where(eq(stateWipLimitTable.stateId, stateId))
      .limit(1);
    if (limit === null) {
      await tx
        .delete(stateWipLimitTable)
        .where(eq(stateWipLimitTable.stateId, stateId));
    } else {
      await tx
        .insert(stateWipLimitTable)
        .values({ stateId, projectId: scope.projectId, wipLimit: limit })
        .onConflictDoUpdate({
          target: stateWipLimitTable.stateId,
          set: { wipLimit: limit, updatedAt: new Date() },
        });
    }
    if ((existing?.limit ?? null) !== limit)
      await auditAgile(tx, {
        action: "state.wip_limit_changed",
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        entityType: "state",
        entityId: stateId,
        actor,
        before: { wipLimit: existing?.limit ?? null },
        after: { wipLimit: limit },
      });
    return { stateId, limit };
  });
}
