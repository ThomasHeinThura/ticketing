import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { columnTable, workflowRuleTable } from "../../database/schema";
import { getProjectWorkspaceId } from "../../utils/assert-assignable-user";
import { rejectNulByte } from "../../utils/reject-nul-byte";

async function upsertWorkflowRule({
  projectId,
  integrationType,
  eventType,
  columnId,
}: {
  projectId: string;
  integrationType: string;
  eventType: string;
  columnId: string;
}) {
  // #290 S4 sweep: `columnId` is a body field, not covered by any
  // `workspaceAccess.*` lookup (`upsertWorkflowRuleRoute` scopes from `projectId`,
  // not `columnId`) -- a NUL byte here reached `eq(columnTable.id, columnId)`
  // unvalidated and 500'd, the same class #281 fixed for path/query ids.
  rejectNulByte(columnId, "Column id");

  // #202: this route's subject IS a project (`workspaceAccess.fromProject`), so a
  // soft-deleted project's automation must be frozen for its 30-day recovery window
  // (#187, PR-16) -- without this, a new rule could still be created against a
  // project that every read path already treats as gone. Deliberately checked before
  // the column lookup below, so a caller cannot use this route to probe whether a
  // given column id belongs to a soft-deleted project: that request gets 404, not the
  // 400 the column check would otherwise produce.
  await getProjectWorkspaceId(projectId);

  const targetColumn = await db.query.columnTable.findFirst({
    where: and(
      eq(columnTable.id, columnId),
      eq(columnTable.projectId, projectId),
    ),
  });

  if (!targetColumn) {
    throw new HTTPException(400, {
      message: "Column does not belong to the provided project",
    });
  }

  const existing = await db.query.workflowRuleTable.findFirst({
    where: and(
      eq(workflowRuleTable.projectId, projectId),
      eq(workflowRuleTable.integrationType, integrationType),
      eq(workflowRuleTable.eventType, eventType),
    ),
  });

  if (existing) {
    const [updated] = await db
      .update(workflowRuleTable)
      .set({ columnId })
      .where(eq(workflowRuleTable.id, existing.id))
      .returning();

    if (!updated) {
      throw new HTTPException(500, {
        message: "Failed to update workflow rule",
      });
    }

    return updated;
  }

  const [created] = await db
    .insert(workflowRuleTable)
    .values({
      projectId,
      integrationType,
      eventType,
      columnId,
    })
    .returning();

  if (!created) {
    throw new HTTPException(500, {
      message: "Failed to create workflow rule",
    });
  }

  return created;
}

export default upsertWorkflowRule;
