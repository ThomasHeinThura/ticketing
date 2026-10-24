import type { JsonValue } from "@taskdesk/domain";
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import type { Executor } from "../database/executor";
import {
  automationRunTable,
  automationTable,
  projectTable,
  roleTable,
  stateTemplateTable,
} from "../database/schema";
import { appendAuditSavepoint } from "../events/audit-savepoint";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import type { AutomationAction } from "./actions";
import type { ValidRuleDefinition } from "./validation";

export type AutomationRow = typeof automationTable.$inferSelect;
export type AutomationRunRow = typeof automationRunTable.$inferSelect;

export type AutomationActor = {
  userId: string;
  personId: string;
  actorType: "person" | "api_key";
  apiKeyId: string | null;
  actorIp?: string | null;
  userAgent?: string | null;
};

export class AutomationVersionConflictError extends Error {
  constructor(readonly currentVersion: number) {
    super("automation_version_conflict");
  }
}

export async function findAutomationScope(id: string) {
  const [row] = await db
    .select({
      id: automationTable.id,
      workspaceId: automationTable.workspaceId,
      projectId: automationTable.projectId,
    })
    .from(automationTable)
    .where(eq(automationTable.id, id))
    .limit(1);
  return row;
}

export async function getAutomation(id: string) {
  const [row] = await db
    .select()
    .from(automationTable)
    .where(eq(automationTable.id, id))
    .limit(1);
  return row;
}

export async function listAutomations(scope: {
  workspaceId: string;
  projectId: string | null;
}) {
  return db
    .select({ row: automationTable, roleName: roleTable.name })
    .from(automationTable)
    .leftJoin(roleTable, eq(roleTable.id, automationTable.effectiveRoleId))
    .where(
      and(
        eq(automationTable.workspaceId, scope.workspaceId),
        scope.projectId
          ? eq(automationTable.projectId, scope.projectId)
          : isNull(automationTable.projectId),
      ),
    )
    .orderBy(asc(automationTable.position), asc(automationTable.id));
}

export async function roleNameFor(roleId: string): Promise<string | null> {
  const [row] = await db
    .select({ name: roleTable.name })
    .from(roleTable)
    .where(eq(roleTable.id, roleId))
    .limit(1);
  return row?.name ?? null;
}

/** Every id in a workspace rule's `projectFilter` must be a live project of the workspace. */
export async function assertProjectFilterValid(
  workspaceId: string,
  projectIds: readonly string[],
  executor: Executor = db,
): Promise<void> {
  const rows = await executor
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        inArray(projectTable.id, [...projectIds]),
        isNull(projectTable.deletedAt),
      ),
    );
  if (rows.length !== projectIds.length)
    throw new HTTPException(422, {
      message: "projectFilter names a project outside this workspace",
    });
}

/**
 * References inside actions that only the database can check: a `transition` names a state
 * template of THIS workspace (a foreign or unknown one is refused at save time with the action
 * named; a template deleted later fails the run with `no_matching_transition`).
 */
export async function assertActionReferencesValid(
  workspaceId: string,
  actions: readonly AutomationAction[],
  executor: Executor = db,
): Promise<void> {
  const templateIds = [
    ...new Set(
      actions.flatMap((action) =>
        action.type === "transition" ? [action.toStateTemplateId] : [],
      ),
    ),
  ];
  if (templateIds.length === 0) return;
  const rows = await executor
    .select({ id: stateTemplateTable.id })
    .from(stateTemplateTable)
    .where(
      and(
        eq(stateTemplateTable.workspaceId, workspaceId),
        inArray(stateTemplateTable.id, templateIds),
      ),
    );
  if (rows.length !== templateIds.length)
    throw new HTTPException(422, {
      message: "transition names a state outside this workspace",
    });
}

export async function createAutomation(input: {
  workspaceId: string;
  projectId: string | null;
  name: string;
  effectiveRoleId: string;
  stopProcessing: boolean;
  definition: ValidRuleDefinition;
  actor: AutomationActor;
}): Promise<AutomationRow> {
  const created = await db.transaction(async (tx) => {
    const [last] = await tx
      .select({
        value: sql<number>`COALESCE(MAX(${automationTable.position}), -1)`,
      })
      .from(automationTable)
      .where(eq(automationTable.workspaceId, input.workspaceId));
    const [row] = await tx
      .insert(automationTable)
      .values({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        projectFilter: input.definition.projectFilter,
        name: input.name,
        // AM-10: a new rule is created disabled; enabling is a deliberate act.
        enabled: false,
        trigger: input.definition.trigger,
        scheduleCron: input.definition.scheduleCron,
        conditions: input.definition.conditions,
        actions: input.definition.actions,
        effectiveRoleId: input.effectiveRoleId,
        position: Number(last?.value ?? -1) + 1,
        stopProcessing: input.stopProcessing,
        createdBy: input.actor.personId,
      })
      .returning();
    if (!row) throw new Error("Automation insert returned no row");
    const auditFailed = await appendAuditSavepoint(
      tx,
      auditFor(input.actor, row, "automation.created", ruleSnapshot(row)),
    );
    return { row, auditFailed };
  });
  if (created.auditFailed)
    await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
  return created.row;
}

export type AutomationPatch = {
  name?: string;
  effectiveRoleId?: string;
  stopProcessing?: boolean;
  position?: number;
  definition?: ValidRuleDefinition;
  expectedVersion?: number;
};

/**
 * Applies a validated patch under a row lock. A change to what the rule *does* (trigger,
 * conditions, actions, role, filter) disables an enabled rule and clears its flag: the new
 * definition needs the same deliberate enable `AM-10` demands of a new rule.
 */
export async function updateAutomation(
  id: string,
  patch: AutomationPatch,
  actor: AutomationActor,
): Promise<{ row: AutomationRow; disabled: boolean } | undefined> {
  const outcome = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(automationTable)
      .where(eq(automationTable.id, id))
      .for("update")
      .limit(1);
    if (!current) return undefined;
    if (
      patch.expectedVersion !== undefined &&
      patch.expectedVersion !== current.version
    )
      throw new AutomationVersionConflictError(current.version);
    const set: Partial<typeof automationTable.$inferInsert> = {
      version: current.version + 1,
      updatedAt: new Date(),
    };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.stopProcessing !== undefined)
      set.stopProcessing = patch.stopProcessing;
    if (patch.position !== undefined) set.position = patch.position;
    let behaviourChanged = false;
    if (patch.effectiveRoleId !== undefined) {
      set.effectiveRoleId = patch.effectiveRoleId;
      behaviourChanged ||= patch.effectiveRoleId !== current.effectiveRoleId;
    }
    if (patch.definition) {
      set.trigger = patch.definition.trigger;
      set.scheduleCron = patch.definition.scheduleCron;
      set.conditions = patch.definition.conditions;
      set.actions = patch.definition.actions;
      set.projectFilter = patch.definition.projectFilter;
      behaviourChanged = true;
    }
    let disabled = false;
    if (behaviourChanged) {
      set.flaggedReason = null;
      if (current.enabled) {
        set.enabled = false;
        disabled = true;
      }
    }
    const [row] = await tx
      .update(automationTable)
      .set(set)
      .where(eq(automationTable.id, id))
      .returning();
    if (!row) return undefined;
    let auditFailed = false;
    const beforeSnap = ruleSnapshot(current);
    const afterSnap = ruleSnapshot(row);
    const changed = Object.keys(afterSnap).filter(
      (key) =>
        JSON.stringify(beforeSnap[key]) !== JSON.stringify(afterSnap[key]),
    );
    if (changed.length > 0)
      auditFailed = await appendAuditSavepoint(tx, {
        ...auditFor(actor, row, "automation.updated", {}),
        before: pick(beforeSnap, changed),
        after: pick(afterSnap, changed),
      });
    if (disabled)
      auditFailed =
        (await appendAuditSavepoint(
          tx,
          auditFor(actor, row, "automation.disabled", {
            enabled: false,
            reason: "definition_changed",
          }),
        )) || auditFailed;
    return { row, disabled, auditFailed };
  });
  if (!outcome) return undefined;
  if (outcome.auditFailed)
    await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
  return { row: outcome.row, disabled: outcome.disabled };
}

/** What a rule does, as recorded in audit: definition, effective role, enabled, ordering. */
function ruleSnapshot(row: AutomationRow): Record<string, JsonValue> {
  return {
    name: row.name,
    enabled: row.enabled,
    trigger: row.trigger,
    scheduleCron: row.scheduleCron ?? null,
    conditions: (row.conditions ?? null) as JsonValue,
    actions: (row.actions ?? null) as JsonValue,
    projectFilter: (row.projectFilter ?? null) as JsonValue,
    effectiveRoleId: row.effectiveRoleId,
    stopProcessing: row.stopProcessing,
    position: row.position,
  };
}

function pick(
  source: Record<string, JsonValue>,
  keys: string[],
): Record<string, JsonValue> {
  return Object.fromEntries(
    keys.map((key) => [key, source[key] ?? null]),
  ) as Record<string, JsonValue>;
}

function auditFor(
  actor: AutomationActor,
  row: Pick<AutomationRow, "id" | "workspaceId" | "projectId">,
  action:
    | "automation.created"
    | "automation.updated"
    | "automation.enabled"
    | "automation.disabled",
  after: Record<string, JsonValue>,
) {
  return {
    actorId: actor.userId,
    actorType: actor.actorType,
    apiKeyId: actor.apiKeyId,
    actorIp: actor.actorIp ?? null,
    userAgent: actor.userAgent ?? null,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    action,
    entityType: "automation",
    entityId: row.id,
    after,
  };
}

export async function setAutomationEnabled(
  id: string,
  enabled: boolean,
  actor: AutomationActor,
  expectedVersion?: number,
  /** Runs against the locked row before an enable, so a racing role change cannot slip past. */
  assertEnable?: (current: AutomationRow, tx: Executor) => Promise<void>,
): Promise<AutomationRow | undefined> {
  const outcome = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(automationTable)
      .where(eq(automationTable.id, id))
      .for("update")
      .limit(1);
    if (!current) return undefined;
    if (expectedVersion !== undefined && expectedVersion !== current.version)
      throw new AutomationVersionConflictError(current.version);
    if (enabled && !current.enabled && assertEnable)
      await assertEnable(current, tx);
    if (current.enabled === enabled)
      return { row: current, auditFailed: false };
    const [row] = await tx
      .update(automationTable)
      .set({
        enabled,
        // Enabling is the deliberate act that lifts a previous flag.
        ...(enabled ? { flaggedReason: null } : {}),
        version: current.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(automationTable.id, id))
      .returning();
    if (!row) return undefined;
    const auditFailed = await appendAuditSavepoint(
      tx,
      auditFor(
        actor,
        row,
        enabled ? "automation.enabled" : "automation.disabled",
        { enabled },
      ),
    );
    return { row, auditFailed };
  });
  if (!outcome) return undefined;
  if (outcome.auditFailed)
    await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
  return outcome.row;
}

export async function listRuns(
  automationId: string,
  options: { limit: number; before?: Date },
) {
  return db
    .select()
    .from(automationRunTable)
    .where(
      and(
        eq(automationRunTable.automationId, automationId),
        options.before
          ? lt(automationRunTable.triggeredAt, options.before)
          : undefined,
      ),
    )
    .orderBy(desc(automationRunTable.triggeredAt), desc(automationRunTable.id))
    .limit(options.limit + 1);
}
