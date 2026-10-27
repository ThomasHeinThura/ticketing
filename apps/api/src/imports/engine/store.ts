/** Persistence helpers shared by the engine service, dry run and runner. */
import { and, eq, inArray, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { schema } from "../../database";
import type { Transaction } from "../../database/executor";
import {
  importMappingProfileTable,
  importRunTable,
  importSourceConnectionTable,
} from "../../database/schema-imports";
import { decryptSecret } from "../../notification-preferences/secrets";
import type { ImportActor } from "../access";
import type { AdapterConnection } from "./adapter";
import type { MappingDocument, MappingEntry } from "./mapping";

export const RUN = importRunTable;
export const PROFILE = importMappingProfileTable;
export const CONNECTION = importSourceConnectionTable;
export const MAPPING_PROFILE_NAME = "engine";
/** Runs whose total writes exceed this need one run-level approval (D2). */
export const RUN_APPROVAL_THRESHOLD = 50;

export type EngineRun = typeof RUN.$inferSelect & {
  projectId: string;
  sourceConnectionId: string;
};

export function asEngineRun(
  run: typeof RUN.$inferSelect | undefined,
): EngineRun {
  if (!run?.projectId || !run.sourceConnectionId)
    throw new HTTPException(404, { message: "Import run not found" });
  return run as EngineRun;
}

export async function loadEngineRun(
  tx: Transaction,
  runId: string,
  lock: "share" | "update",
): Promise<EngineRun> {
  const query = tx.select().from(RUN).where(eq(RUN.id, runId));
  const [run] = await (lock === "update"
    ? query.for("update")
    : query.for("share")
  ).limit(1);
  return asEngineRun(run);
}

export async function loadConnection(
  tx: Transaction,
  workspaceId: string,
  id: string,
) {
  const [connection] = await tx
    .select()
    .from(CONNECTION)
    .where(and(eq(CONNECTION.id, id), eq(CONNECTION.workspaceId, workspaceId)))
    .limit(1);
  if (!connection)
    throw new HTTPException(404, { message: "Import source not found" });
  return connection;
}

/** Decrypts the credential in memory only; it is never logged, returned or persisted again. */
export function toAdapterConnection(
  connection: typeof CONNECTION.$inferSelect,
): AdapterConnection {
  return {
    pluginId: connection.pluginId,
    config: connection.config,
    credential: connection.credentialCiphertext
      ? (decryptSecret(connection.credentialCiphertext) ?? null)
      : null,
    readOnly: true,
  };
}

export type LoadedMapping = {
  profileId: string | null;
  version: number;
  entries: MappingEntry[];
};

export async function loadMapping(
  tx: Transaction,
  run: Pick<EngineRun, "workspaceId" | "pluginId" | "sourceRef">,
  lock: "share" | "update" = "share",
): Promise<LoadedMapping> {
  const query = tx
    .select()
    .from(PROFILE)
    .where(
      and(
        eq(PROFILE.workspaceId, run.workspaceId),
        eq(PROFILE.pluginId, run.pluginId),
        eq(PROFILE.sourceRef, run.sourceRef),
        eq(PROFILE.name, MAPPING_PROFILE_NAME),
      ),
    );
  const [profile] = await (lock === "update"
    ? query.for("update")
    : query.for("share")
  ).limit(1);
  if (!profile) return { profileId: null, version: 0, entries: [] };
  const doc = profile.mapping as Partial<MappingDocument>;
  return {
    profileId: profile.id,
    version: profile.version,
    entries: Array.isArray(doc.entries) ? doc.entries : [],
  };
}

/** Upserts the engine mapping. `bump` raises the version (a change invalidates dry run + approval). */
export async function saveMapping(
  tx: Transaction,
  run: Pick<EngineRun, "workspaceId" | "pluginId" | "sourceRef">,
  entries: MappingEntry[],
  options: { bump: boolean; createdBy: string | null },
): Promise<LoadedMapping> {
  const document: MappingDocument = { version: 2, mode: "engine", entries };
  const current = await loadMapping(tx, run, "update");
  if (!current.profileId) {
    const [created] = await tx
      .insert(PROFILE)
      .values({
        workspaceId: run.workspaceId,
        pluginId: run.pluginId,
        sourceRef: run.sourceRef,
        name: MAPPING_PROFILE_NAME,
        mapping: document as unknown as Record<string, unknown>,
        createdBy: options.createdBy,
      })
      .returning();
    return { profileId: created?.id ?? null, version: 1, entries };
  }
  const version = current.version + (options.bump ? 1 : 0);
  await tx
    .update(PROFILE)
    .set({
      mapping: document as unknown as Record<string, unknown>,
      version,
      updatedAt: new Date(),
    })
    .where(eq(PROFILE.id, current.profileId));
  return { profileId: current.profileId, version, entries };
}

export async function activeStaffPerson(tx: Transaction, userId: string) {
  const [person] = await tx
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(
      and(
        eq(schema.personTable.userId, userId),
        eq(schema.personTable.active, true),
        eq(schema.personTable.side, "staff"),
      ),
    )
    .limit(1);
  if (!person) throw new HTTPException(403, { message: "Forbidden" });
  return person;
}

/** The identity a run executes as: its starter (and starting key), never the system actor. */
export async function loadRunActor(
  tx: Transaction,
  run: Pick<EngineRun, "startedBy" | "startedByApiKeyId">,
): Promise<ImportActor | null> {
  if (!run.startedBy) return null;
  const [person] = await tx
    .select({
      userId: schema.personTable.userId,
      active: schema.personTable.active,
      side: schema.personTable.side,
    })
    .from(schema.personTable)
    .where(eq(schema.personTable.id, run.startedBy))
    .limit(1);
  if (!person?.userId || !person.active || person.side !== "staff") return null;
  return {
    userId: person.userId,
    actorType: run.startedByApiKeyId ? "api_key" : "person",
    apiKeyId: run.startedByApiKeyId,
    ...(run.startedByApiKeyId ? { apiKey: { id: run.startedByApiKeyId } } : {}),
    impersonatedBy: null,
  };
}

/** Active staff people by lower-cased email within the workspace's organisation. */
export async function peopleByEmail(
  tx: Transaction,
  workspaceId: string,
  emails: readonly string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const wanted = [...new Set(emails.map((e) => e.toLowerCase()))];
  if (wanted.length === 0) return result;
  const [workspace] = await tx
    .select({ organisationId: schema.workspaceTable.organisationId })
    .from(schema.workspaceTable)
    .where(eq(schema.workspaceTable.id, workspaceId))
    .limit(1);
  if (!workspace) return result;
  const rows = await tx
    .select({ id: schema.personTable.id, email: schema.userTable.email })
    .from(schema.personTable)
    .innerJoin(
      schema.userTable,
      eq(schema.userTable.id, schema.personTable.userId),
    )
    .where(
      and(
        eq(schema.personTable.organisationId, workspace.organisationId),
        eq(schema.personTable.active, true),
        eq(schema.personTable.side, "staff"),
        inArray(sql`lower(${schema.userTable.email})`, wanted),
      ),
    );
  for (const row of rows) result.set(row.email.toLowerCase(), row.id);
  return result;
}

/**
 * Which of `personIds` are staff people of the workspace's own organisation (a placeholder of that
 * organisation counts). A person of another organisation, a customer and an unknown id are absent,
 * so a mapping edit cannot point an import at someone outside the tenant.
 */
export async function staffPeopleInWorkspaceOrganisation(
  tx: Transaction,
  workspaceId: string,
  personIds: readonly string[],
): Promise<Set<string>> {
  const wanted = [...new Set(personIds)];
  if (wanted.length === 0) return new Set();
  const [workspace] = await tx
    .select({ organisationId: schema.workspaceTable.organisationId })
    .from(schema.workspaceTable)
    .where(eq(schema.workspaceTable.id, workspaceId))
    .limit(1);
  if (!workspace) return new Set();
  const rows = await tx
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(
      and(
        eq(schema.personTable.organisationId, workspace.organisationId),
        eq(schema.personTable.side, "staff"),
        inArray(schema.personTable.id, wanted),
      ),
    );
  return new Set(rows.map((row) => row.id));
}

export async function typeIdsByKey(tx: Transaction, workspaceId: string) {
  const rows = await tx
    .select({
      id: schema.workItemTypeTable.id,
      key: schema.workItemTypeTable.key,
    })
    .from(schema.workItemTypeTable)
    .where(eq(schema.workItemTypeTable.workspaceId, workspaceId));
  return new Map(rows.map((row) => [row.key, row.id]));
}

export type SafeCounts = Record<string, number>;
export function safeStats(stats: Record<string, number>): SafeCounts {
  const out: SafeCounts = {};
  for (const key of [
    "created",
    "updated",
    "skipped",
    "rejected",
    "processed",
  ]) {
    const value = stats[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
      out[key] = value;
  }
  return out;
}

// --- background setup job (discovery, whole-run dry run) ---------------------------------------

export type SetupJobKind = "discover" | "dry_run";
export type SetupJobStatus = "running" | "completed" | "failed";

/**
 * Persisted state of the run's background setup step, kept under `engine_discovery.job`. `id` is a
 * fencing token: every progress write names it, so a superseded or cancelled worker finds nothing to
 * update and stops. `actor` is the administrator who asked for the step: the job re-checks that
 * identity's authority before every page, and nothing runs as the system.
 */
export type SetupJob = {
  id: string;
  kind: SetupJobKind;
  status: SetupJobStatus;
  startedAt: string;
  updatedAt: string;
  actor: { userId: string; apiKeyId: string | null };
  /** `import_run.version` the job started against; a different version at the end means it is stale. */
  runVersion: number;
  /** Mapping version a dry run computes for (`null` for discovery). */
  mappingVersion: number | null;
  pagesRead: number;
  /** Dry run: records classified so far. Discovery: records the adapter has read so far. */
  recordsProcessed: number;
  /** Fixed code (`auth_failed`, `source_error`, `mapping_changed`, ...) when `status` is `failed`. */
  failure?: string;
  /** Dry-run accumulators and the cursor of the next page (a `DryRunState`); absent on discovery. */
  checkpoint?: unknown;
};

export function readSetupJob(
  run: Pick<EngineRun, "engineDiscovery">,
): SetupJob | null {
  const raw = run.engineDiscovery?.job;
  if (typeof raw !== "object" || raw === null) return null;
  const job = raw as Partial<SetupJob>;
  if (
    typeof job.id !== "string" ||
    (job.kind !== "discover" && job.kind !== "dry_run") ||
    (job.status !== "running" &&
      job.status !== "completed" &&
      job.status !== "failed") ||
    !job.actor
  )
    return null;
  return job as SetupJob;
}

/** What a client may see of the job: progress and a fixed failure code, never the checkpoint. */
export function setupJobDto(run: EngineRun) {
  const job = readSetupJob(run);
  if (!job) return null;
  const known = run.engineDiscovery?.totalRecords;
  return {
    kind: job.kind,
    status: job.status,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    pagesRead: job.pagesRead,
    recordsProcessed: job.recordsProcessed,
    /** Records the source holds, once discovery has counted them (drives a percentage). */
    totalRecords:
      job.kind === "dry_run" && typeof known === "number" ? known : null,
    failure: job.failure ?? null,
  };
}

/** The discovery summary a client sees: no job state, facets as the list the mapping step shows. */
export function discoveryDto(
  run: Pick<EngineRun, "engineDiscovery">,
  entries: readonly MappingEntry[],
) {
  const stored = run.engineDiscovery;
  if (!stored || typeof stored.totalRecords !== "number") return null;
  return {
    counts: (stored.counts ?? {}) as Record<string, number>,
    totalRecords: stored.totalRecords,
    unreadable: (stored.unreadable ?? {}) as Record<string, number>,
    at: typeof stored.at === "string" ? stored.at : null,
    facets: entries.map((entry) => ({
      domain: entry.domain,
      value: entry.value,
      count: entry.affected,
    })),
  };
}

export type EngineRunDto = ReturnType<typeof engineRunDto>;

export function engineRunDto(run: EngineRun, mappingVersion: number | null) {
  const report = run.engineDryRunReport as {
    counts?: { created?: number; updated?: number; processed?: number };
  } | null;
  const writes =
    (report?.counts?.created ?? 0) + (report?.counts?.updated ?? 0);
  return {
    id: run.id,
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    pluginId: run.pluginId,
    sourceRef: run.sourceRef,
    sourceConnectionId: run.sourceConnectionId,
    state: run.state,
    phase: run.enginePhase ?? "created",
    pausedReason: run.pausedReason ?? null,
    version: run.version,
    mappingVersion,
    stats: safeStats(run.stats),
    cursor: run.sourceCursor ? { exhausted: run.sourceCursor.exhausted } : null,
    job: setupJobDto(run),
    dryRun: run.engineDryRunDigest
      ? {
          digest: run.engineDryRunDigest,
          mappingVersion: run.engineDryRunMappingVersion,
          total: report?.counts?.processed ?? 0,
          writes,
          at: run.engineDryRunAt?.toISOString() ?? null,
        }
      : null,
    approval: {
      required: run.engineDryRunDigest
        ? writes > RUN_APPROVAL_THRESHOLD
        : false,
      approved:
        run.approvedDigest !== null &&
        run.approvedDigest === run.engineDryRunDigest,
      digest: run.approvedDigest,
      totalCount: run.approvedCount,
      mappingVersion: run.approvedMappingVersion,
      pendingActionId: run.approvalPendingActionId,
    },
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}
