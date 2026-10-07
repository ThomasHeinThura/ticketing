import { eq, inArray } from "drizzle-orm";
import type db from "../database";
import {
  userAvatarTable,
  workspaceTable,
  workspaceUserTable,
} from "../database/schema";

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export function getAvatar(executor: Executor, id: string) {
  return executor
    .select({
      id: userAvatarTable.id,
      mimeType: userAvatarTable.mimeType,
      size: userAvatarTable.size,
      data: userAvatarTable.data,
      updatedAt: userAvatarTable.updatedAt,
    })
    .from(userAvatarTable)
    .where(eq(userAvatarTable.id, id))
    .limit(1);
}

export function listWorkspaceMemberships(executor: Executor, userId: string) {
  return executor
    .select({
      workspaceId: workspaceUserTable.workspaceId,
      role: workspaceUserTable.role,
    })
    .from(workspaceUserTable)
    .where(eq(workspaceUserTable.userId, userId));
}

export function listWorkspaceMemberNames(
  executor: Executor,
  workspaceIds: string[],
) {
  return executor
    .select({
      workspaceId: workspaceUserTable.workspaceId,
      workspaceName: workspaceTable.name,
      role: workspaceUserTable.role,
    })
    .from(workspaceUserTable)
    .innerJoin(
      workspaceTable,
      eq(workspaceUserTable.workspaceId, workspaceTable.id),
    )
    .where(inArray(workspaceUserTable.workspaceId, workspaceIds));
}
