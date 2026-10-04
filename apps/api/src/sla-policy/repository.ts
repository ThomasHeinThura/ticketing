import { createId } from "@paralleldrive/cuid2";
import type { JsonValue } from "@taskdesk/domain";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { AppendAuditLogInput } from "../audit/audit-writer";
import { appendAuditLog } from "../audit/audit-writer";
import db from "../database";
import {
  serviceCalendarTable,
  slaGoalTable,
  slaPolicyTable,
  slaPolicyVersionTable,
  workItemTypeTable,
} from "../database/schema";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "../instance/observability/runtime";
import {
  type PolicyGoalCandidate,
  type PolicyGoalInput,
  validatePolicyGoals,
} from "./schema";

export type PolicyActor = {
  actorId: string;
  actorType: "person" | "api_key";
  apiKeyId: string | null;
  actorIp?: string | null;
  userAgent?: string | null;
  traceId?: string | null;
};

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type PolicyRow = typeof slaPolicyTable.$inferSelect;
type PolicyVersionRow = typeof slaPolicyVersionTable.$inferSelect;
type PolicyGoalRow = typeof slaGoalTable.$inferSelect;
type PolicyResult = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  activeVersion: PolicyVersionResult | null;
  draftVersion: PolicyVersionResult | null;
};
type PolicyVersionResult = {
  id: string;
  number: number;
  calendarId: string;
  atRiskThresholdPct: number;
  effectiveFrom: Date | null;
  goals: Array<{
    metric: "first_response" | "resolution";
    workItemTypeId: string;
    priority: "low" | "medium" | "high" | "urgent";
    targetMinutes: number;
  }>;
};

function goalResults(rows: PolicyGoalRow[]) {
  return rows.map(({ metric, workItemTypeId, priority, targetMinutes }) => ({
    metric,
    workItemTypeId,
    priority,
    targetMinutes,
  }));
}

function versionResult(
  version: PolicyVersionRow,
  goals: PolicyGoalRow[],
): PolicyVersionResult {
  return {
    id: version.id,
    number: version.number,
    calendarId: version.calendarId,
    atRiskThresholdPct: version.atRiskThresholdPct,
    effectiveFrom: version.effectiveFrom,
    goals: goalResults(goals),
  };
}

async function appendPolicyAudit(tx: Transaction, input: AppendAuditLogInput) {
  try {
    await tx.transaction(async (auditTx) => appendAuditLog(auditTx, input));
    return false;
  } catch {
    recordAuditWriteFailure("mutation");
    return true;
  }
}

async function notifyIfAuditFailed(failed: boolean) {
  if (failed) await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
}

function auditInput(
  actor: PolicyActor,
  workspaceId: string,
  policyId: string,
  action: "sla_policy.created" | "sla_policy.updated" | "sla_policy.published",
  before?: JsonValue,
  after?: JsonValue,
): AppendAuditLogInput {
  return {
    actorId: actor.actorId,
    actorType: actor.actorType,
    apiKeyId: actor.apiKeyId,
    actorIp: actor.actorIp,
    userAgent: actor.userAgent,
    traceId: actor.traceId,
    workspaceId,
    action,
    entityType: "sla_policy",
    entityId: policyId,
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
  };
}

async function getReferencedConfiguration(
  workspaceId: string,
  calendarId: string,
  goals: PolicyGoalInput[],
) {
  const [calendar] = await db
    .select({ id: serviceCalendarTable.id })
    .from(serviceCalendarTable)
    .where(
      and(
        eq(serviceCalendarTable.id, calendarId),
        eq(serviceCalendarTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!calendar) {
    throw new HTTPException(422, { message: "Invalid policy configuration" });
  }
  const typeIds = [...new Set(goals.map((item) => item.workItemTypeId))];
  if (typeIds.length === 0) return;
  const types = await db
    .select({ id: workItemTypeTable.id })
    .from(workItemTypeTable)
    .where(
      and(
        eq(workItemTypeTable.workspaceId, workspaceId),
        inArray(workItemTypeTable.id, typeIds),
      ),
    );
  if (types.length !== typeIds.length) {
    throw new HTTPException(422, { message: "Invalid policy configuration" });
  }
}

async function replaceDraftGoals(
  tx: Transaction,
  workspaceId: string,
  versionId: string,
  goals: PolicyGoalInput[],
) {
  await tx.delete(slaGoalTable).where(eq(slaGoalTable.versionId, versionId));
  if (goals.length > 0) {
    await tx.insert(slaGoalTable).values(
      goals.map((goal) => ({
        id: `slg_${createId()}`,
        workspaceId,
        versionId,
        ...goal,
      })),
    );
  }
}

async function loadPolicyResult(
  workspaceId: string,
  policy: PolicyRow,
  executor: typeof db | Transaction = db,
): Promise<PolicyResult> {
  const versions = await executor
    .select()
    .from(slaPolicyVersionTable)
    .where(eq(slaPolicyVersionTable.policyId, policy.id));
  const active = versions.find(
    (version) => version.id === policy.activeVersionId,
  );
  const draft = versions.find((version) => version.effectiveFrom === null);
  const versionIds = [active?.id, draft?.id].filter(
    (id): id is string => id !== undefined,
  );
  const goals = versionIds.length
    ? await executor
        .select()
        .from(slaGoalTable)
        .where(
          and(
            eq(slaGoalTable.workspaceId, workspaceId),
            inArray(slaGoalTable.versionId, versionIds),
          ),
        )
    : [];
  const goalsFor = (versionId: string | undefined) =>
    goals.filter((goal) => goal.versionId === versionId);
  return {
    id: policy.id,
    workspaceId: policy.workspaceId,
    name: policy.name,
    description: policy.description,
    version: policy.version,
    createdAt: policy.createdAt,
    updatedAt: policy.updatedAt,
    activeVersion: active ? versionResult(active, goalsFor(active.id)) : null,
    draftVersion: draft ? versionResult(draft, goalsFor(draft.id)) : null,
  };
}

export async function getPolicy(id: string, workspaceId: string) {
  const [policy] = await db
    .select()
    .from(slaPolicyTable)
    .where(
      and(
        eq(slaPolicyTable.id, id),
        eq(slaPolicyTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return policy ? loadPolicyResult(workspaceId, policy) : undefined;
}

export class PolicyVersionConflictError extends Error {
  constructor(
    public readonly assertedVersion: number,
    public readonly currentVersion: number,
  ) {
    super("SLA policy version conflict");
    this.name = "PolicyVersionConflictError";
  }
}

function decodeCursor(cursor: string, workspaceId: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new HTTPException(400, { message: "cursor: malformed" });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new HTTPException(400, { message: "cursor: malformed" });
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as Record<string, unknown>).v !== 1 ||
    (parsed as Record<string, unknown>).workspaceId !== workspaceId ||
    typeof (parsed as Record<string, unknown>).name !== "string" ||
    typeof (parsed as Record<string, unknown>).id !== "string" ||
    ((parsed as Record<string, unknown>).direction !== "after" &&
      (parsed as Record<string, unknown>).direction !== "before") ||
    Object.keys(parsed).sort().join(",") !== "direction,id,name,v,workspaceId"
  ) {
    throw new HTTPException(400, {
      message: "cursor: malformed or belongs to another workspace",
    });
  }
  return parsed as {
    v: 1;
    workspaceId: string;
    name: string;
    id: string;
    direction: "after" | "before";
  };
}

function encodeCursor(
  row: { name: string; id: string },
  workspaceId: string,
  direction: "after" | "before",
) {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      workspaceId,
      name: row.name,
      id: row.id,
      direction,
    }),
    "utf8",
  ).toString("base64url");
}

export async function listPolicies(
  workspaceId: string,
  options: { cursor?: string; limit: number },
) {
  const cursor = options.cursor
    ? decodeCursor(options.cursor, workspaceId)
    : undefined;
  const after = cursor
    ? cursor.direction === "after"
      ? sql`(${slaPolicyTable.name}, ${slaPolicyTable.id}) > (${cursor.name}, ${cursor.id})`
      : sql`(${slaPolicyTable.name}, ${slaPolicyTable.id}) < (${cursor.name}, ${cursor.id})`
    : undefined;
  const [total] = await db
    .select({ total: count() })
    .from(slaPolicyTable)
    .where(eq(slaPolicyTable.workspaceId, workspaceId));
  const fetched = await db
    .select()
    .from(slaPolicyTable)
    .where(
      after
        ? and(eq(slaPolicyTable.workspaceId, workspaceId), after)
        : eq(slaPolicyTable.workspaceId, workspaceId),
    )
    .orderBy(
      cursor?.direction === "before"
        ? desc(slaPolicyTable.name)
        : asc(slaPolicyTable.name),
      cursor?.direction === "before"
        ? desc(slaPolicyTable.id)
        : asc(slaPolicyTable.id),
    )
    .limit(options.limit + 1);
  const pageRows = fetched.slice(0, options.limit);
  if (cursor?.direction === "before") pageRows.reverse();
  const first = pageRows[0];
  const last = pageRows.at(-1);
  const [hasPrevious, hasNext] = await Promise.all([
    first
      ? db
          .select({ value: count() })
          .from(slaPolicyTable)
          .where(
            and(
              eq(slaPolicyTable.workspaceId, workspaceId),
              sql`(${slaPolicyTable.name}, ${slaPolicyTable.id}) < (${first.name}, ${first.id})`,
            ),
          )
          .then(([row]) => (row?.value ?? 0) > 0)
      : Promise.resolve(false),
    last
      ? db
          .select({ value: count() })
          .from(slaPolicyTable)
          .where(
            and(
              eq(slaPolicyTable.workspaceId, workspaceId),
              sql`(${slaPolicyTable.name}, ${slaPolicyTable.id}) > (${last.name}, ${last.id})`,
            ),
          )
          .then(([row]) => (row?.value ?? 0) > 0)
      : Promise.resolve(false),
  ]);
  const policyIds = pageRows.map((policy) => policy.id);
  const versions = policyIds.length
    ? await db
        .select()
        .from(slaPolicyVersionTable)
        .where(inArray(slaPolicyVersionTable.policyId, policyIds))
    : [];
  const activeVersions = new Map(
    pageRows.flatMap((policy) => {
      const active = versions.find(
        (version) => version.id === policy.activeVersionId,
      );
      return active ? [[policy.id, active] as const] : [];
    }),
  );
  const draftPolicyIds = new Set(
    versions
      .filter((version) => version.effectiveFrom === null)
      .map((version) => version.policyId),
  );
  const activeIds = [...activeVersions.values()].map((version) => version.id);
  const goalCounts = activeIds.length
    ? await db
        .select({ versionId: slaGoalTable.versionId, goalCount: count() })
        .from(slaGoalTable)
        .where(inArray(slaGoalTable.versionId, activeIds))
        .groupBy(slaGoalTable.versionId)
    : [];
  const countByVersion = new Map(
    goalCounts.map((row) => [row.versionId, Number(row.goalCount)]),
  );
  const rows = pageRows.map((policy) => {
    const active = activeVersions.get(policy.id);
    if (active?.effectiveFrom === null) {
      throw new Error("Active SLA policy version is not published");
    }
    return {
      id: policy.id,
      workspaceId: policy.workspaceId,
      name: policy.name,
      description: policy.description,
      version: policy.version,
      createdAt: policy.createdAt,
      updatedAt: policy.updatedAt,
      activeVersion: active
        ? {
            id: active.id,
            number: active.number,
            calendarId: active.calendarId,
            atRiskThresholdPct: active.atRiskThresholdPct,
            effectiveFrom: active.effectiveFrom as Date,
            goalCount: countByVersion.get(active.id) ?? 0,
          }
        : null,
      hasDraft: draftPolicyIds.has(policy.id),
    };
  });
  return {
    data: rows,
    page: {
      previousCursor:
        hasPrevious && first
          ? encodeCursor(first, workspaceId, "before")
          : null,
      nextCursor:
        hasNext && last ? encodeCursor(last, workspaceId, "after") : null,
      hasMore: hasNext,
    },
    meta: { total: Number(total?.total ?? 0) },
  };
}

export async function createPolicy(
  input: {
    workspaceId: string;
    name: string;
    description?: string | null;
    calendarId: string;
    atRiskThresholdPct: number;
    goals: PolicyGoalCandidate[];
  },
  actor: PolicyActor,
) {
  const goals = validatePolicyGoals(input.goals);
  await getReferencedConfiguration(input.workspaceId, input.calendarId, goals);
  const outcome = await db.transaction(async (tx) => {
    const [policy] = await tx
      .insert(slaPolicyTable)
      .values({
        workspaceId: input.workspaceId,
        name: input.name,
        description: input.description ?? null,
      })
      .returning();
    if (!policy) throw new Error("SLA policy insert returned no row");
    const [draft] = await tx
      .insert(slaPolicyVersionTable)
      .values({
        workspaceId: policy.workspaceId,
        policyId: policy.id,
        number: 1,
        calendarId: input.calendarId,
        atRiskThresholdPct: input.atRiskThresholdPct,
      })
      .returning();
    if (!draft) throw new Error("SLA policy draft insert returned no row");
    await replaceDraftGoals(tx, policy.workspaceId, draft.id, goals);
    const after = await loadPolicyResult(input.workspaceId, policy, tx);
    if (!after.draftVersion)
      throw new Error("Created SLA policy draft could not be read");
    const auditFailed = await appendPolicyAudit(
      tx,
      auditInput(
        actor,
        input.workspaceId,
        policy.id,
        "sla_policy.created",
        undefined,
        {
          policyId: policy.id,
          versionId: after.draftVersion.id,
        },
      ),
    );
    return { policy, auditFailed };
  });
  await notifyIfAuditFailed(outcome.auditFailed);
  return getPolicy(outcome.policy.id, input.workspaceId);
}

export async function updatePolicy(
  id: string,
  workspaceId: string,
  input: {
    name?: string;
    description?: string | null;
    calendarId?: string;
    atRiskThresholdPct?: number;
    goals?: PolicyGoalCandidate[];
  },
  assertedVersion: number | undefined,
  actor: PolicyActor,
) {
  const outcome = await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(slaPolicyTable)
      .where(
        and(
          eq(slaPolicyTable.id, id),
          eq(slaPolicyTable.workspaceId, workspaceId),
        ),
      )
      .limit(1)
      .for("update");
    if (!before) return undefined;
    if (assertedVersion !== undefined && before.version !== assertedVersion) {
      throw new PolicyVersionConflictError(assertedVersion, before.version);
    }
    const versions = await tx
      .select()
      .from(slaPolicyVersionTable)
      .where(eq(slaPolicyVersionTable.policyId, id))
      .for("update");
    const currentDraft = versions.find(
      (version) => version.effectiveFrom === null,
    );
    const active = versions.find(
      (version) => version.id === before.activeVersionId,
    );
    if (!currentDraft && !active) {
      throw new HTTPException(409, {
        message: "SLA policy has no editable version",
      });
    }
    const seed = currentDraft ?? active;
    if (!seed) throw new Error("SLA policy version invariant failed");
    const existingGoals = await tx
      .select()
      .from(slaGoalTable)
      .where(eq(slaGoalTable.versionId, seed.id));
    const nextGoals = validatePolicyGoals(
      input.goals ?? goalResults(existingGoals),
    );
    const nextCalendarId = input.calendarId ?? seed.calendarId;
    const nextThreshold = input.atRiskThresholdPct ?? seed.atRiskThresholdPct;
    await getReferencedConfiguration(workspaceId, nextCalendarId, nextGoals);

    let draft = currentDraft;
    if (!draft) {
      const [row] = await tx
        .insert(slaPolicyVersionTable)
        .values({
          workspaceId,
          policyId: id,
          number: Math.max(...versions.map((version) => version.number), 0) + 1,
          calendarId: nextCalendarId,
          atRiskThresholdPct: nextThreshold,
        })
        .returning();
      if (!row) throw new Error("SLA policy draft insert returned no row");
      draft = row;
    } else {
      await tx
        .update(slaPolicyVersionTable)
        .set({
          calendarId: nextCalendarId,
          atRiskThresholdPct: nextThreshold,
        })
        .where(eq(slaPolicyVersionTable.id, draft.id));
    }
    await replaceDraftGoals(tx, workspaceId, draft.id, nextGoals);
    const [policy] = await tx
      .update(slaPolicyTable)
      .set({
        name: input.name ?? before.name,
        description:
          input.description === undefined
            ? before.description
            : input.description,
        version: sql`${slaPolicyTable.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(slaPolicyTable.id, id))
      .returning();
    if (!policy) return undefined;
    const after = await loadPolicyResult(workspaceId, policy, tx);
    const changedFields = [
      ...(input.name !== undefined ? (["name"] as const) : []),
      ...(input.description !== undefined ? (["description"] as const) : []),
      ...(input.calendarId !== undefined ? (["calendarId"] as const) : []),
      ...(input.atRiskThresholdPct !== undefined
        ? (["atRiskThresholdPct"] as const)
        : []),
      ...(input.goals !== undefined ? (["goals"] as const) : []),
    ];
    const oldDraft = currentDraft ?? active;
    if (!after.draftVersion)
      throw new Error("Updated SLA policy draft could not be read");
    const auditFailed = await appendPolicyAudit(
      tx,
      auditInput(
        actor,
        workspaceId,
        policy.id,
        "sla_policy.updated",
        {
          policyId: policy.id,
          ...(oldDraft ? { versionId: oldDraft.id } : {}),
          changedFields,
        },
        {
          policyId: policy.id,
          versionId: after.draftVersion.id,
          changedFields,
          ...(input.calendarId !== undefined
            ? { calendarId: nextCalendarId }
            : {}),
          ...(input.atRiskThresholdPct !== undefined
            ? { atRiskThresholdPct: nextThreshold }
            : {}),
        },
      ),
    );
    return { policy, auditFailed };
  });
  if (!outcome) return undefined;
  await notifyIfAuditFailed(outcome.auditFailed);
  return getPolicy(outcome.policy.id, workspaceId);
}

export async function publishPolicy(
  id: string,
  workspaceId: string,
  assertedVersion: number | undefined,
  actor: PolicyActor,
) {
  const outcome = await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(slaPolicyTable)
      .where(
        and(
          eq(slaPolicyTable.id, id),
          eq(slaPolicyTable.workspaceId, workspaceId),
        ),
      )
      .limit(1)
      .for("update");
    if (!before) return undefined;
    if (assertedVersion !== undefined && before.version !== assertedVersion) {
      throw new PolicyVersionConflictError(assertedVersion, before.version);
    }
    const [draft] = await tx
      .select()
      .from(slaPolicyVersionTable)
      .where(
        and(
          eq(slaPolicyVersionTable.policyId, id),
          sql`${slaPolicyVersionTable.effectiveFrom} is null`,
        ),
      )
      .limit(1)
      .for("update");
    if (!draft)
      throw new HTTPException(409, { message: "No draft to publish" });
    const goals = await tx
      .select()
      .from(slaGoalTable)
      .where(eq(slaGoalTable.versionId, draft.id));
    const typeIds = [...new Set(goals.map((goal) => goal.workItemTypeId))];
    if (typeIds.length === 0) {
      throw new HTTPException(422, {
        message: "Published policy needs at least one work-item type",
      });
    }
    const required = new Set(
      ["first_response", "resolution"].flatMap((metric) =>
        ["low", "medium", "high", "urgent"].map(
          (priority) => `${metric}\u0000${priority}`,
        ),
      ),
    );
    for (const typeId of typeIds) {
      const tuples = goals
        .filter((goal) => goal.workItemTypeId === typeId)
        .map((goal) => `${goal.metric}\u0000${goal.priority}`);
      if (
        tuples.length !== required.size ||
        tuples.some((tuple) => !required.has(tuple))
      ) {
        throw new HTTPException(422, {
          message: "Each included work-item type needs all eight SLA goals",
        });
      }
    }
    validatePolicyGoals(goalResults(goals));
    await getReferencedConfiguration(
      workspaceId,
      draft.calendarId,
      goalResults(goals),
    );
    await tx
      .update(slaPolicyVersionTable)
      .set({ effectiveFrom: sql`now()` })
      .where(eq(slaPolicyVersionTable.id, draft.id));
    const [policy] = await tx
      .update(slaPolicyTable)
      .set({
        activeVersionId: draft.id,
        version: sql`${slaPolicyTable.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(slaPolicyTable.id, id))
      .returning();
    if (!policy) return undefined;
    const after = await loadPolicyResult(workspaceId, policy, tx);
    if (!after.activeVersion?.effectiveFrom) {
      throw new Error("Published SLA policy version could not be read");
    }
    const auditFailed = await appendPolicyAudit(
      tx,
      auditInput(
        actor,
        workspaceId,
        policy.id,
        "sla_policy.published",
        {
          policyId: policy.id,
          ...(before.activeVersionId
            ? { versionId: before.activeVersionId }
            : {}),
        },
        {
          policyId: policy.id,
          versionId: after.activeVersion.id,
          ...(before.activeVersionId
            ? { priorActiveVersionId: before.activeVersionId }
            : {}),
          effectiveFrom: after.activeVersion.effectiveFrom.toISOString(),
        },
      ),
    );
    return { policy, auditFailed };
  });
  if (!outcome) return undefined;
  await notifyIfAuditFailed(outcome.auditFailed);
  return getPolicy(outcome.policy.id, workspaceId);
}
