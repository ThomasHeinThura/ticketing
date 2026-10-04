import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../../database";
import { evaluatePinnedWorkItemSla } from "../../sla-policy/evaluation";

export async function getWorkItemSla(key: string, workspaceId: string) {
  const [item] = await db
    .select({
      id: schema.workItemTable.id,
      key: schema.workItemTable.key,
      workspaceId: schema.workItemTable.workspaceId,
      typeId: schema.workItemTable.typeId,
      priority: schema.workItemTable.priority,
      slaStartedAt: schema.workItemTable.slaStartedAt,
      slaPolicyVersionId: schema.workItemTable.slaPolicyVersionId,
      firstResponseAt: schema.workItemTable.firstResponseAt,
      resolvedAt: schema.workItemTable.resolvedAt,
      createdAt: schema.workItemTable.createdAt,
    })
    .from(schema.workItemTable)
    .where(
      and(
        eq(schema.workItemTable.key, key),
        eq(schema.workItemTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!item) throw new HTTPException(404, { message: "Work item not found" });

  const now = new Date();
  const startedAt = item.slaStartedAt ?? item.createdAt;
  const metrics = await evaluatePinnedWorkItemSla({
    policyVersionId: item.slaPolicyVersionId,
    workspaceId: item.workspaceId,
    workItemTypeId: item.typeId,
    priority: item.priority,
    facts: {
      startedAt,
      firstResponseAt: item.firstResponseAt,
      resolvedAt: item.resolvedAt,
      pauses: [],
    },
    now,
  });

  return { key: item.key, startedAt, evaluatedAt: now, metrics };
}
