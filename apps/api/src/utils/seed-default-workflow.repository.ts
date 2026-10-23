import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import db, { schema } from "../database";
import type { Transaction } from "../database/executor";

/** Workspaces holding a builtin type that is still bound to no workflow. */
export async function listWorkspacesWithUnboundBuiltinTypes(
  builtinKeys: string[],
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ workspaceId: schema.workItemTypeTable.workspaceId })
    .from(schema.workItemTypeTable)
    .where(
      and(
        inArray(schema.workItemTypeTable.key, builtinKeys),
        isNull(schema.workItemTypeTable.workflowId),
      ),
    )
    .orderBy(schema.workItemTypeTable.workspaceId);
  return rows.map((row) => row.workspaceId);
}

export async function lockWorkspaceDefaults(
  tx: Transaction,
  workspaceId: string,
): Promise<void> {
  const rows = await tx
    .select({ id: schema.workspaceTable.id })
    .from(schema.workspaceTable)
    .where(eq(schema.workspaceTable.id, workspaceId))
    .for("update");
  if (!rows[0]) throw new Error("Default workflow workspace not found");
}
export async function readDefaultWorkflowContext(
  tx: Transaction,
  workspaceId: string,
  workflowId: string,
) {
  const templates = await tx
    .select()
    .from(schema.stateTemplateTable)
    .where(eq(schema.stateTemplateTable.workspaceId, workspaceId));
  const workflows = await tx
    .select()
    .from(schema.workflowTable)
    .where(
      or(
        eq(schema.workflowTable.id, workflowId),
        and(
          eq(schema.workflowTable.workspaceId, workspaceId),
          eq(schema.workflowTable.key, "default"),
        ),
      ),
    );
  return { templates, workflows };
}
export async function insertDefaultWorkflowDraft(
  tx: Transaction,
  workspaceId: string,
  workflowId: string,
  versionId: string,
) {
  await tx.insert(schema.workflowTable).values({
    id: workflowId,
    workspaceId,
    key: "default",
    name: "Default workflow",
  });
  await tx.insert(schema.workflowVersionTable).values({
    id: versionId,
    workflowId,
    number: 1,
    publishedAt: null,
    publishedBy: null,
  });
}
export async function insertDefaultWorkflowEdges(
  tx: Transaction,
  rows: Array<typeof schema.workflowTransitionTable.$inferInsert>,
) {
  await tx.insert(schema.workflowTransitionTable).values(rows);
}
export async function readSeedWorkflowVersion(
  tx: Transaction,
  workflowId: string,
  versionId: string,
) {
  const [version] = await tx
    .select()
    .from(schema.workflowVersionTable)
    .where(
      and(
        eq(schema.workflowVersionTable.id, versionId),
        eq(schema.workflowVersionTable.workflowId, workflowId),
      ),
    );
  const transitions = await tx
    .select()
    .from(schema.workflowTransitionTable)
    .where(eq(schema.workflowTransitionTable.versionId, versionId));
  return { version, transitions };
}
export async function publishDefaultWorkflow(
  tx: Transaction,
  workflowId: string,
  versionId: string,
) {
  await tx
    .update(schema.workflowVersionTable)
    .set({ publishedAt: sql`clock_timestamp() AT TIME ZONE 'UTC'` })
    .where(
      and(
        eq(schema.workflowVersionTable.id, versionId),
        isNull(schema.workflowVersionTable.publishedAt),
      ),
    );
  await tx
    .update(schema.workflowTable)
    .set({ activeVersionId: versionId })
    .where(eq(schema.workflowTable.id, workflowId));
}
export async function attachDefaultWorkflow(
  tx: Transaction,
  workspaceId: string,
  workflowId: string,
  builtinKeys: string[],
): Promise<number> {
  const rows = await tx
    .update(schema.workItemTypeTable)
    .set({ workflowId })
    .where(
      and(
        eq(schema.workItemTypeTable.workspaceId, workspaceId),
        inArray(schema.workItemTypeTable.key, builtinKeys),
        isNull(schema.workItemTypeTable.workflowId),
      ),
    )
    .returning({ id: schema.workItemTypeTable.id });
  return rows.length;
}
