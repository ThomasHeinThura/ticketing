import type { JsonValue } from "@taskdesk/domain";
import {
  FEATURE_FLAG_DEFAULTS,
  FEATURE_FLAGS,
  type FeatureFlag,
  INSTANCE_ONLY_FEATURES,
  LOCKED_FEATURE_DEFAULTS,
  resolveFeatureFlag,
} from "@taskdesk/permissions";
import { and, eq, inArray, sql } from "drizzle-orm";
import { appendAuditLog } from "../audit/audit-writer";
import db, { schema } from "../database";
import type { Transaction } from "../database/executor";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "../instance/observability/runtime";
import { invalidateFeatureFlagCache } from "./enforce";

/** `ST-2`: a lower level may not override a locked instance flag. */
export class FeatureFlagConflictError extends Error {
  constructor(
    readonly code: "feature_locked" | "version_conflict",
    readonly key: FeatureFlag,
    readonly version?: number,
  ) {
    super(code);
  }
}

/**
 * P4R2-M2: an instance-only flag (`INSTANCE_ONLY_FEATURES`: SCIM, MCP) has no workspace or
 * project level; a lower-level write is refused 422 and nothing is stored.
 */
export class FeatureFlagScopeError extends Error {
  readonly code = "feature_instance_only" as const;
  constructor(readonly key: FeatureFlag) {
    super("feature_instance_only");
  }
}

function assertLowerLevelWritable(changes: LevelChange[]) {
  for (const change of changes)
    if (INSTANCE_ONLY_FEATURES.has(change.key))
      throw new FeatureFlagScopeError(change.key);
}

/** The flags a workspace or project settings screen may show (no instance-only flags). */
export function lowerLevelFeatures<T extends { key: FeatureFlag }>(
  features: T[],
): T[] {
  return features.filter((feature) => !INSTANCE_ONLY_FEATURES.has(feature.key));
}

export type FeatureActor = {
  userId: string;
  personId: string;
  impersonatorId?: string | null;
  traceId?: string | null;
};

type Level = "instance" | "workspace" | "project";

type InstanceRow = {
  enabled: boolean;
  locked: boolean;
  version: number;
  updatedAt: Date;
  updatedBy: string | null;
};
type LevelRow = {
  enabled: boolean;
  version: number;
  updatedAt: Date;
  updatedBy: string | null;
};

const FLAG_WRITE_LOCK = sql`SELECT pg_advisory_xact_lock(hashtext('feature_flag_write'))`;

async function readInstanceRows(executor: Pick<typeof db, "select">) {
  const rows = await executor
    .select({
      key: schema.instanceFeatureFlagTable.featureKey,
      enabled: schema.instanceFeatureFlagTable.enabled,
      locked: schema.instanceFeatureFlagTable.locked,
      version: schema.instanceFeatureFlagTable.version,
      updatedAt: schema.instanceFeatureFlagTable.updatedAt,
      updatedBy: schema.instanceFeatureFlagTable.updatedBy,
    })
    .from(schema.instanceFeatureFlagTable);
  return new Map<string, InstanceRow>(rows.map((r) => [r.key, r]));
}

async function readWorkspaceRows(
  executor: Pick<typeof db, "select">,
  workspaceId: string,
) {
  const rows = await executor
    .select({
      key: schema.workspaceFeatureFlagTable.featureKey,
      enabled: schema.workspaceFeatureFlagTable.enabled,
      version: schema.workspaceFeatureFlagTable.version,
      updatedAt: schema.workspaceFeatureFlagTable.updatedAt,
      updatedBy: schema.workspaceFeatureFlagTable.updatedBy,
    })
    .from(schema.workspaceFeatureFlagTable)
    .where(eq(schema.workspaceFeatureFlagTable.workspaceId, workspaceId));
  return new Map<string, LevelRow>(rows.map((r) => [r.key, r]));
}

async function readProjectRows(
  executor: Pick<typeof db, "select">,
  projectId: string,
) {
  const rows = await executor
    .select({
      key: schema.projectFeatureFlagTable.featureKey,
      enabled: schema.projectFeatureFlagTable.enabled,
      version: schema.projectFeatureFlagTable.version,
      updatedAt: schema.projectFeatureFlagTable.updatedAt,
      updatedBy: schema.projectFeatureFlagTable.updatedBy,
    })
    .from(schema.projectFeatureFlagTable)
    .where(eq(schema.projectFeatureFlagTable.projectId, projectId));
  return new Map<string, LevelRow>(rows.map((r) => [r.key, r]));
}

async function actorNames(
  executor: Pick<typeof db, "select">,
  ids: Array<string | null>,
) {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))];
  if (unique.length === 0) return new Map<string, string | null>();
  const rows = await executor
    .select({
      id: schema.personTable.id,
      name: schema.personTable.displayName,
    })
    .from(schema.personTable)
    .where(inArray(schema.personTable.id, unique));
  return new Map(rows.map((r) => [r.id, r.name]));
}

function actor(
  names: Map<string, string | null>,
  id: string | null,
): { id: string; name: string | null } | null {
  return id === null ? null : { id, name: names.get(id) ?? null };
}

function instanceView(row: InstanceRow | undefined) {
  return row ? { enabled: row.enabled, locked: row.locked } : null;
}

export async function listInstanceFeatures(executor = db) {
  const rows = await readInstanceRows(executor);
  const names = await actorNames(
    executor,
    [...rows.values()].map((r) => r.updatedBy),
  );
  return FEATURE_FLAGS.map((key) => {
    const row = rows.get(key);
    const resolved = resolveFeatureFlag({
      feature: key,
      instance: instanceView(row),
    });
    return {
      key,
      enabled: resolved.enabled,
      source: resolved.source,
      locked: row?.locked ?? LOCKED_FEATURE_DEFAULTS.has(key),
      defaultEnabled: FEATURE_FLAG_DEFAULTS[key],
      version: row?.version ?? 0,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy: actor(names, row?.updatedBy ?? null),
    };
  });
}

function levelFeatureView(
  key: FeatureFlag,
  instanceRows: Map<string, InstanceRow>,
  workspaceRows: Map<string, LevelRow>,
  ownRow: LevelRow | undefined,
  level: "workspace" | "project",
  names: Map<string, string | null>,
) {
  const instance = instanceView(instanceRows.get(key));
  const inherited = resolveFeatureFlag({
    feature: key,
    instance,
    workspace:
      level === "project" ? (workspaceRows.get(key)?.enabled ?? null) : null,
  });
  const resolved = resolveFeatureFlag({
    feature: key,
    instance,
    workspace:
      level === "project"
        ? (workspaceRows.get(key)?.enabled ?? null)
        : (ownRow?.enabled ?? null),
    project: level === "project" ? (ownRow?.enabled ?? null) : null,
  });
  const locked =
    instanceRows.get(key)?.locked ??
    (instance === null && LOCKED_FEATURE_DEFAULTS.has(key));
  return {
    key,
    enabled: resolved.enabled,
    source: resolved.source,
    locked,
    defaultEnabled: FEATURE_FLAG_DEFAULTS[key],
    version: ownRow?.version ?? 0,
    updatedAt: ownRow?.updatedAt.toISOString() ?? null,
    updatedBy: actor(names, ownRow?.updatedBy ?? null),
    override: ownRow?.enabled ?? null,
    inherited: {
      enabled: inherited.enabled,
      source: inherited.source as "workspace" | "instance" | "default",
    },
  };
}

export async function listWorkspaceFeatures(
  workspaceId: string,
  executor: Pick<typeof db, "select"> = db,
) {
  const [instanceRows, rows] = await Promise.all([
    readInstanceRows(executor),
    readWorkspaceRows(executor, workspaceId),
  ]);
  const names = await actorNames(
    executor,
    [...rows.values()].map((r) => r.updatedBy),
  );
  return FEATURE_FLAGS.map((key) =>
    levelFeatureView(
      key,
      instanceRows,
      new Map(),
      rows.get(key),
      "workspace",
      names,
    ),
  );
}

export async function listProjectFeatures(
  projectId: string,
  workspaceId: string,
  executor = db,
) {
  const [instanceRows, workspaceRows, rows] = await Promise.all([
    readInstanceRows(executor),
    readWorkspaceRows(executor, workspaceId),
    readProjectRows(executor, projectId),
  ]);
  const names = await actorNames(
    executor,
    [...rows.values()].map((r) => r.updatedBy),
  );
  return FEATURE_FLAGS.map((key) =>
    levelFeatureView(
      key,
      instanceRows,
      workspaceRows,
      rows.get(key),
      "project",
      names,
    ),
  );
}

/** The fully resolved flag set for one project (`GET /features/resolved`). */
export async function resolveProjectFeatures(
  projectId: string,
  workspaceId: string,
  executor = db,
) {
  const features = await listProjectFeatures(projectId, workspaceId, executor);
  return features.map((f) => ({
    key: f.key,
    enabled: f.enabled,
    source: f.source,
    locked: f.locked,
  }));
}

/**
 * The effective on/off value of every flag at workspace level (instance, workspace override,
 * default). Values only: no lock, override or version metadata, so any workspace reader may see it.
 */
export async function resolveWorkspaceFeatureValues(
  workspaceId: string,
  executor = db,
) {
  const [instanceRows, workspaceRows] = await Promise.all([
    readInstanceRows(executor),
    readWorkspaceRows(executor, workspaceId),
  ]);
  return FEATURE_FLAGS.map((key) => ({
    key,
    enabled: resolveFeatureFlag({
      feature: key,
      instance: instanceView(instanceRows.get(key)),
      workspace: workspaceRows.get(key)?.enabled ?? null,
    }).enabled,
  }));
}

/**
 * The subset of `projectIds` for which `feature` resolves on (project, workspace, instance,
 * default). Fails closed: an unreadable flag set returns no projects.
 */
export async function projectsWithFeature(
  feature: FeatureFlag,
  workspaceId: string,
  projectIds: string[],
  executor = db,
): Promise<string[]> {
  if (projectIds.length === 0) return [];
  try {
    const [instanceRows, workspaceRows, projectRows] = await Promise.all([
      readInstanceRows(executor),
      readWorkspaceRows(executor, workspaceId),
      executor
        .select({
          projectId: schema.projectFeatureFlagTable.projectId,
          enabled: schema.projectFeatureFlagTable.enabled,
        })
        .from(schema.projectFeatureFlagTable)
        .where(
          and(
            eq(schema.projectFeatureFlagTable.featureKey, feature),
            inArray(schema.projectFeatureFlagTable.projectId, projectIds),
          ),
        ),
    ]);
    const own = new Map(projectRows.map((r) => [r.projectId, r.enabled]));
    return projectIds.filter(
      (projectId) =>
        resolveFeatureFlag({
          feature,
          instance: instanceView(instanceRows.get(feature)),
          workspace: workspaceRows.get(feature)?.enabled ?? null,
          project: own.get(projectId) ?? null,
        }).enabled,
    );
  } catch {
    return [];
  }
}

async function auditAfterCommit(
  entries: Array<Parameters<typeof appendAuditLog>[1]>,
) {
  let failed = false;
  for (const entry of entries) {
    try {
      await db.transaction(async (tx) => appendAuditLog(tx, entry));
    } catch {
      failed = true;
      recordAuditWriteFailure("mutation");
    }
  }
  if (failed) await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
}

function auditBase(
  actorInfo: FeatureActor,
  level: Level,
  scope: { workspaceId?: string; projectId?: string },
) {
  return {
    actorId: actorInfo.userId,
    actorType: "person" as const,
    impersonatorId: actorInfo.impersonatorId ?? null,
    traceId: actorInfo.traceId ?? null,
    workspaceId: scope.workspaceId ?? null,
    projectId: scope.projectId ?? null,
    action: "feature_flag.changed",
    entityType:
      level === "instance"
        ? "instance"
        : level === "workspace"
          ? "workspace"
          : "project",
    entityId:
      level === "instance"
        ? "singleton"
        : level === "workspace"
          ? (scope.workspaceId as string)
          : (scope.projectId as string),
  };
}

export type InstanceChange = {
  key: FeatureFlag;
  enabled?: boolean;
  locked?: boolean;
  expectedVersion?: number;
};

export async function patchInstanceFeatures(
  changes: InstanceChange[],
  actorInfo: FeatureActor,
) {
  const audits: Array<Parameters<typeof appendAuditLog>[1]> = [];
  await db.transaction(async (tx: Transaction) => {
    await tx.execute(FLAG_WRITE_LOCK);
    const rows = await readInstanceRows(tx);
    for (const change of changes) {
      const row = rows.get(change.key);
      if (
        change.expectedVersion !== undefined &&
        change.expectedVersion !== (row?.version ?? 0)
      ) {
        throw new FeatureFlagConflictError(
          "version_conflict",
          change.key,
          row?.version ?? 0,
        );
      }
      const enabled =
        change.enabled ?? row?.enabled ?? FEATURE_FLAG_DEFAULTS[change.key];
      const locked =
        change.locked ?? row?.locked ?? LOCKED_FEATURE_DEFAULTS.has(change.key);
      if (row && row.enabled === enabled && row.locked === locked) continue;
      await tx
        .insert(schema.instanceFeatureFlagTable)
        .values({
          featureKey: change.key,
          enabled,
          locked,
          updatedBy: actorInfo.personId,
        })
        .onConflictDoUpdate({
          target: schema.instanceFeatureFlagTable.featureKey,
          set: {
            enabled,
            locked,
            version: sql`${schema.instanceFeatureFlagTable.version} + 1`,
            updatedBy: actorInfo.personId,
            updatedAt: sql`now()`,
          },
        });
      audits.push({
        ...auditBase(actorInfo, "instance", {}),
        before: (row
          ? { feature: change.key, enabled: row.enabled, locked: row.locked }
          : null) as JsonValue,
        after: { feature: change.key, enabled, locked } as JsonValue,
      });
    }
  });
  invalidateFeatureFlagCache();
  await auditAfterCommit(audits);
}

export type LevelChange = {
  key: FeatureFlag;
  enabled: boolean | null;
  expectedVersion?: number;
};

async function assertNotLocked(
  executor: Pick<typeof db, "select">,
  changes: LevelChange[],
) {
  const instanceRows = await readInstanceRows(executor);
  for (const change of changes) {
    const row = instanceRows.get(change.key);
    const locked = row?.locked ?? LOCKED_FEATURE_DEFAULTS.has(change.key);
    if (locked)
      throw new FeatureFlagConflictError("feature_locked", change.key);
  }
}

export async function patchWorkspaceFeatures(
  workspaceId: string,
  changes: LevelChange[],
  actorInfo: FeatureActor,
) {
  assertLowerLevelWritable(changes);
  const audits: Array<Parameters<typeof appendAuditLog>[1]> = [];
  await db.transaction(async (tx: Transaction) => {
    await tx.execute(FLAG_WRITE_LOCK);
    await assertNotLocked(tx, changes);
    const rows = await readWorkspaceRows(tx, workspaceId);
    for (const change of changes) {
      const row = rows.get(change.key);
      if (
        change.expectedVersion !== undefined &&
        change.expectedVersion !== (row?.version ?? 0)
      ) {
        throw new FeatureFlagConflictError(
          "version_conflict",
          change.key,
          row?.version ?? 0,
        );
      }
      if (change.enabled === null) {
        if (!row) continue;
        await tx
          .delete(schema.workspaceFeatureFlagTable)
          .where(
            and(
              eq(schema.workspaceFeatureFlagTable.workspaceId, workspaceId),
              eq(schema.workspaceFeatureFlagTable.featureKey, change.key),
            ),
          );
      } else {
        if (row && row.enabled === change.enabled) continue;
        await tx
          .insert(schema.workspaceFeatureFlagTable)
          .values({
            workspaceId,
            featureKey: change.key,
            enabled: change.enabled,
            updatedBy: actorInfo.personId,
          })
          .onConflictDoUpdate({
            target: [
              schema.workspaceFeatureFlagTable.workspaceId,
              schema.workspaceFeatureFlagTable.featureKey,
            ],
            set: {
              enabled: change.enabled,
              version: sql`${schema.workspaceFeatureFlagTable.version} + 1`,
              updatedBy: actorInfo.personId,
              updatedAt: sql`now()`,
            },
          });
      }
      audits.push({
        ...auditBase(actorInfo, "workspace", { workspaceId }),
        before: { feature: change.key, enabled: row?.enabled ?? null },
        after: { feature: change.key, enabled: change.enabled },
      });
    }
  });
  invalidateFeatureFlagCache();
  await auditAfterCommit(audits);
}

export async function patchProjectFeatures(
  projectId: string,
  workspaceId: string,
  changes: LevelChange[],
  actorInfo: FeatureActor,
) {
  assertLowerLevelWritable(changes);
  const audits: Array<Parameters<typeof appendAuditLog>[1]> = [];
  await db.transaction(async (tx: Transaction) => {
    await tx.execute(FLAG_WRITE_LOCK);
    await assertNotLocked(tx, changes);
    const rows = await readProjectRows(tx, projectId);
    for (const change of changes) {
      const row = rows.get(change.key);
      if (
        change.expectedVersion !== undefined &&
        change.expectedVersion !== (row?.version ?? 0)
      ) {
        throw new FeatureFlagConflictError(
          "version_conflict",
          change.key,
          row?.version ?? 0,
        );
      }
      if (change.enabled === null) {
        if (!row) continue;
        await tx
          .delete(schema.projectFeatureFlagTable)
          .where(
            and(
              eq(schema.projectFeatureFlagTable.projectId, projectId),
              eq(schema.projectFeatureFlagTable.featureKey, change.key),
            ),
          );
      } else {
        if (row && row.enabled === change.enabled) continue;
        await tx
          .insert(schema.projectFeatureFlagTable)
          .values({
            projectId,
            featureKey: change.key,
            enabled: change.enabled,
            updatedBy: actorInfo.personId,
          })
          .onConflictDoUpdate({
            target: [
              schema.projectFeatureFlagTable.projectId,
              schema.projectFeatureFlagTable.featureKey,
            ],
            set: {
              enabled: change.enabled,
              version: sql`${schema.projectFeatureFlagTable.version} + 1`,
              updatedBy: actorInfo.personId,
              updatedAt: sql`now()`,
            },
          });
      }
      audits.push({
        ...auditBase(actorInfo, "project", { workspaceId, projectId }),
        before: { feature: change.key, enabled: row?.enabled ?? null },
        after: { feature: change.key, enabled: change.enabled },
      });
    }
  });
  invalidateFeatureFlagCache();
  await auditAfterCommit(audits);
}
