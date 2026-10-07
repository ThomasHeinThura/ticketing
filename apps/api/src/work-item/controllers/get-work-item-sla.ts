import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { evaluatePinnedWorkItemSla } from "../../sla-policy/evaluation";
import { getWorkItemSlaSourceQuery } from "../repository";

export async function getWorkItemSla(key: string, workspaceId: string) {
  const [item] = await getWorkItemSlaSourceQuery(db, key, workspaceId);

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
