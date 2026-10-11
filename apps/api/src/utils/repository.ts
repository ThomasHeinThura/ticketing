import { and, inArray } from "drizzle-orm";
import type db from "../database";
import { schema } from "../database";

type SelectExecutor = Pick<typeof db, "select">;

export function listAllWorkspaceIds(executor: SelectExecutor) {
  return executor
    .select({ id: schema.workspaceTable.id })
    .from(schema.workspaceTable);
}

export function listWorkspaceRoleKeys(
  executor: SelectExecutor,
  workspaceIds: string[],
  roles: string[],
) {
  return executor
    .select({
      workspaceId: schema.workspaceRoleTable.workspaceId,
      role: schema.workspaceRoleTable.role,
    })
    .from(schema.workspaceRoleTable)
    .where(
      and(
        inArray(schema.workspaceRoleTable.workspaceId, workspaceIds),
        inArray(schema.workspaceRoleTable.role, roles),
      ),
    );
}
