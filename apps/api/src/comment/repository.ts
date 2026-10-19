import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import db from "../database";
import { currentProjectReachPredicate } from "../database/repositories/identity-scope.repository";
import {
  projectTable,
  taskActivityTable,
  taskTable,
  userTable,
} from "../database/schema";

/** Comment rows visible through the task's current project reach (issue #580). */
export async function listTaskCommentRows(
  identity: ResolvedIdentity,
  taskId: string,
) {
  return await db
    .select({
      id: taskActivityTable.id,
      taskId: taskActivityTable.taskId,
      userId: userTable.id,
      content: taskActivityTable.content,
      createdAt: taskActivityTable.createdAt,
      updatedAt: taskActivityTable.updatedAt,
      userName: userTable.name,
      userImage: userTable.image,
    })
    .from(taskActivityTable)
    .innerJoin(userTable, eq(taskActivityTable.userId, userTable.id))
    .innerJoin(taskTable, eq(taskActivityTable.taskId, taskTable.id))
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        eq(taskActivityTable.taskId, taskId),
        eq(taskActivityTable.type, "comment"),
        isNotNull(taskActivityTable.userId),
        isNotNull(taskActivityTable.content),
        isNull(projectTable.deletedAt),
        currentProjectReachPredicate(
          identity,
          projectTable.id,
          projectTable.workspaceId,
          projectTable.organisationId,
          db,
        ),
      ),
    )
    .orderBy(asc(taskActivityTable.createdAt));
}
