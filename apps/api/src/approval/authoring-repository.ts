import {
  and,
  asc,
  eq,
  gt,
  ilike,
  isNotNull,
  isNull,
  ne,
  or,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import db, { schema } from "../database";
import type { ApprovalTarget } from "./repository";

const sourceTemplate = alias(
  schema.stateTemplateTable,
  "approval_source_template",
);
const targetTemplate = alias(
  schema.stateTemplateTable,
  "approval_target_template",
);

/** Called only after the source item's current identity/reach checks. */
export async function loadApprovalAuthoringFacts(target: ApprovalTarget) {
  const [item] = await db
    .select({ isChange: schema.workItemTypeTable.isChange })
    .from(schema.workItemTable)
    .innerJoin(
      schema.workItemTypeTable,
      eq(schema.workItemTypeTable.id, schema.workItemTable.typeId),
    )
    .where(
      and(
        eq(schema.workItemTable.id, target.workItemId),
        eq(schema.workItemTable.workspaceId, target.workspaceId),
        eq(schema.workItemTable.projectId, target.projectId),
        isNull(schema.workItemTable.deletedAt),
        isNull(schema.workItemTable.archivedAt),
      ),
    )
    .limit(1);
  const [settings] = await db
    .select({
      expiryDays: schema.instanceSettingTable.approvalDefaultExpiryDays,
    })
    .from(schema.instanceSettingTable)
    .where(eq(schema.instanceSettingTable.id, "singleton"))
    .limit(1);
  const transitions = await db
    .select({
      id: schema.workflowTransitionTable.id,
      fromStateName: sourceTemplate.name,
      toStateName: targetTemplate.name,
      requiresApproval: schema.workflowTransitionTable.requiresApproval,
      requiresCab: schema.workflowTransitionTable.requiresCab,
    })
    .from(schema.workItemTable)
    .innerJoin(
      schema.workItemTypeTable,
      and(
        eq(schema.workItemTypeTable.id, schema.workItemTable.typeId),
        eq(schema.workItemTypeTable.workspaceId, target.workspaceId),
      ),
    )
    .innerJoin(
      schema.workflowTable,
      and(
        eq(schema.workflowTable.id, schema.workItemTypeTable.workflowId),
        eq(schema.workflowTable.workspaceId, target.workspaceId),
      ),
    )
    .innerJoin(
      schema.workflowVersionTable,
      and(
        eq(
          schema.workflowVersionTable.id,
          schema.workflowTable.activeVersionId,
        ),
        eq(schema.workflowVersionTable.workflowId, schema.workflowTable.id),
      ),
    )
    .innerJoin(
      schema.workflowTransitionTable,
      eq(
        schema.workflowTransitionTable.versionId,
        schema.workflowTable.activeVersionId,
      ),
    )
    .innerJoin(
      targetTemplate,
      and(
        eq(targetTemplate.id, schema.workflowTransitionTable.toStateTemplateId),
        eq(targetTemplate.workspaceId, target.workspaceId),
      ),
    )
    .innerJoin(
      schema.stateTable,
      and(
        eq(schema.stateTable.projectId, target.projectId),
        eq(schema.stateTable.stateTemplateId, targetTemplate.id),
        isNull(schema.stateTable.archivedAt),
      ),
    )
    .leftJoin(
      sourceTemplate,
      and(
        eq(
          sourceTemplate.id,
          schema.workflowTransitionTable.fromStateTemplateId,
        ),
        eq(sourceTemplate.workspaceId, target.workspaceId),
      ),
    )
    .where(
      and(
        eq(schema.workItemTable.id, target.workItemId),
        eq(schema.workItemTable.workspaceId, target.workspaceId),
        eq(schema.workItemTable.projectId, target.projectId),
        isNull(schema.workItemTable.deletedAt),
        isNull(schema.workItemTable.archivedAt),
        or(
          eq(schema.workflowTransitionTable.requiresApproval, true),
          eq(schema.workflowTransitionTable.requiresCab, true),
        ),
      ),
    )
    .orderBy(asc(targetTemplate.name), asc(schema.workflowTransitionTable.id));
  return {
    isChange: item?.isChange === true,
    defaultExpiryDays: settings?.expiryDays ?? 7,
    transitions,
  };
}

/** Bounded private scan; only the service's reach-checked DTOs leave the server. */
export async function scanApprovalCandidatePeople(input: {
  kind: "customer" | "cab";
  requesterId: string;
  q: string;
  after?: string;
  limit: number;
}) {
  const literal = input.q.replace(/[\\%_]/gu, "\\$&");
  return db
    .select({
      id: schema.personTable.id,
      userId: schema.personTable.userId,
      displayName: schema.personTable.displayName,
    })
    .from(schema.personTable)
    .where(
      and(
        eq(schema.personTable.active, true),
        eq(schema.personTable.isPlaceholder, false),
        isNotNull(schema.personTable.userId),
        ne(schema.personTable.id, input.requesterId),
        eq(
          schema.personTable.side,
          input.kind === "cab" ? "staff" : "customer",
        ),
        ...(input.after ? [gt(schema.personTable.id, input.after)] : []),
        ...(input.q
          ? [ilike(schema.personTable.displayName, `%${literal}%`)]
          : []),
      ),
    )
    .orderBy(asc(schema.personTable.id))
    .limit(input.limit);
}
