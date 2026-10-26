import { apiFetch } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";
import { getApiUrl } from "../get-api-url";

export const IMPORT_PLUGIN_IDS = [
  "import.csv",
  "import.jira",
  "import.jsm",
  "import.azure-devops",
  "import.plane",
  "import.planner",
  "import.power-apps",
  "import.mcp",
] as const;
export type ImportPluginId = (typeof IMPORT_PLUGIN_IDS)[number];

export type ImportRunState =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed";

export type ImportRunLogEntry = {
  code: string;
  at: string;
  chunkId?: string;
};

export type ImportRun = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  pluginId: ImportPluginId;
  sourceRef: string;
  profileId: string | null;
  state: ImportRunState;
  stats: Record<string, number>;
  log: ImportRunLogEntry[];
  version: number;
  nextCursor: string | null;
  lastCommittedChunk: number;
  createdAt: string;
  updatedAt: string;
};

export type ImportRunPage = {
  runs: ImportRun[];
  nextCursor: string | null;
};

export type ImportReport = {
  runId: string;
  counts: Record<string, number>;
  log: ImportRunLogEntry[];
  chunks: {
    sequence: number;
    chunkId: string;
    state: string;
    recordCount: number;
    counts: Record<string, number>;
    rejectionCodes: Record<string, number>;
    createdAt: string;
    committedAt: string | null;
  }[];
};

export type CreateImportRunInput = {
  workspaceId: string;
  projectId: string;
  pluginId: "import.mcp";
  sourceRef: string;
};

/** A refusal that carries a fixed reason code (for example a source that could not be connected). */
export class ImportReasonError extends HttpError {
  reason: string;
  constructor(status: number, message: string, reason: string) {
    super(status, message);
    this.name = "ImportReasonError";
    this.reason = reason;
  }
}

async function readReason(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { reason?: unknown };
    return typeof body.reason === "string" &&
      /^[a-z][a-z0-9_]{1,63}$/u.test(body.reason)
      ? body.reason
      : null;
  } catch {
    return null;
  }
}

async function readJson<T>(response: Response, message: string): Promise<T> {
  if (!response.ok) {
    const reason = response.status === 502 ? await readReason(response) : null;
    throw reason
      ? new ImportReasonError(response.status, message, reason)
      : new HttpError(response.status, message);
  }
  return (await response.json()) as T;
}

export async function listImportRuns(input: {
  workspaceId: string;
  projectId?: string;
  state?: ImportRunState;
  cursor?: string;
  limit?: number;
}): Promise<ImportRunPage> {
  const query = new URLSearchParams({
    workspaceId: input.workspaceId,
    limit: String(input.limit ?? 50),
  });
  if (input.projectId) query.set("projectId", input.projectId);
  if (input.state) query.set("state", input.state);
  if (input.cursor) query.set("cursor", input.cursor);
  return readJson(
    await apiFetch(getApiUrl(`imports?${query.toString()}`), {
      credentials: "include",
      cache: "no-store",
    }),
    "Import run history could not be loaded",
  );
}

export async function createImportRun(
  input: CreateImportRunInput,
  idempotencyKey: string,
): Promise<ImportRun> {
  return readJson(
    await apiFetch(getApiUrl("imports"), {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(input),
    }),
    "Import run could not be created",
  );
}

export async function getImportRun(id: string): Promise<ImportRun> {
  return readJson(
    await apiFetch(getApiUrl(`imports/${encodeURIComponent(id)}`), {
      credentials: "include",
      cache: "no-store",
    }),
    "Import run could not be loaded",
  );
}

export async function getImportReport(id: string): Promise<ImportReport> {
  return readJson(
    await apiFetch(getApiUrl(`imports/${encodeURIComponent(id)}/report`), {
      credentials: "include",
      cache: "no-store",
    }),
    "Import report could not be loaded",
  );
}

// --- import engine (P6 wizard) -----------------------------------------------------------------
// Mirrors `apps/api/src/imports/engine`. Every write sends an `Idempotency-Key`.

export const MAPPING_DOMAINS = [
  "type",
  "state",
  "priority",
  "person",
  "label",
  "module",
  "cycle",
  "custom_field",
  "project",
] as const;
export type MappingDomain = (typeof MAPPING_DOMAINS)[number];

export const STATE_GROUPS = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
] as const;
export type StateGroup = (typeof STATE_GROUPS)[number];

export const PRIORITY_VALUES = ["low", "medium", "high", "urgent"] as const;
export type PriorityValue = (typeof PRIORITY_VALUES)[number];

export type MappingTarget =
  | { kind: "target"; id: string }
  | { kind: "group"; group: StateGroup; stateId?: string }
  | { kind: "priority"; value: PriorityValue }
  | { kind: "placeholder" }
  | { kind: "ignore" };

export type MappingStatus = "unmapped" | "proposed" | "confirmed";

export type MappingEntry = {
  domain: MappingDomain;
  value: string;
  target: MappingTarget | null;
  status: MappingStatus;
  affected: number;
};

export type MappingEdit = {
  domain: MappingDomain;
  value: string;
  target: MappingTarget | null;
};

export type MappingCompleteness = {
  complete: boolean;
  total: number;
  unmapped: number;
  proposed: number;
  confirmed: number;
  ignored: number;
  blocking: {
    domain: MappingDomain;
    value: string;
    status: MappingStatus;
    affected: number;
  }[];
  stateGroups: Record<StateGroup, number>;
};

export type ImportDiscovery = {
  facets: {
    domain: MappingDomain;
    value: string;
    label?: string;
    count: number;
  }[];
  counts: Record<string, number>;
  totalRecords: number;
};

export type ImportMapping = {
  runId: string;
  mappingVersion: number;
  entries: MappingEntry[];
  completeness: MappingCompleteness;
  discovery: ImportDiscovery | null;
};

export type ImportEnginePhase =
  | "created"
  | "discovered"
  | "dry_run_ready"
  | "executing"
  | "completed";

export type ImportPausedReason =
  | "operator"
  | "authority_lost"
  | "project_reach_lost"
  | "mapping_changed"
  | "approval_invalid"
  | "approved_count_exceeded"
  | "source_error"
  | "chunk_failed"
  | "conflict";

export type EngineRun = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  pluginId: ImportPluginId;
  sourceRef: string;
  sourceConnectionId: string | null;
  state: ImportRunState;
  phase: ImportEnginePhase;
  pausedReason: ImportPausedReason | null;
  version: number;
  mappingVersion: number | null;
  stats: Record<string, number>;
  cursor: { exhausted: boolean } | null;
  dryRun: {
    digest: string;
    mappingVersion: number | null;
    total: number;
    writes: number;
    at: string | null;
  } | null;
  approval: {
    required: boolean;
    approved: boolean;
    digest: string | null;
    totalCount: number | null;
    mappingVersion: number | null;
    pendingActionId: string | null;
  };
  createdAt: string;
  updatedAt: string;
};

export type ImportSource = {
  id: string;
  workspaceId: string;
  pluginId: ImportPluginId;
  name: string;
  /** Without credentials and without inline file contents (`inline` says what is stored). */
  config: Record<string, unknown>;
  inline?: Record<string, { bytes: number }>;
  hasCredential: boolean;
  readOnly: true;
  createdAt: string;
};

export type CreateImportSourceInput = {
  workspaceId: string;
  pluginId: ImportPluginId;
  name: string;
  /** Non-secret settings only. The server rejects secret-looking keys. */
  config?: Record<string, string>;
  /** Secret. Sent once, never returned (`hasCredential` only). */
  credential?: string;
};

export type DryRunCounts = {
  created: number;
  updated: number;
  skipped: number;
  rejected: number;
  processed: number;
};

export type ImportDryRunReport = {
  digest: string;
  mappingVersion: number;
  complete: boolean;
  generatedAt: string;
  counts: DryRunCounts;
  writes: number;
  byType: Record<string, DryRunCounts>;
  rejectionCodes: Record<string, number>;
  losses: {
    sourceType: string;
    code: string;
    detailCode: string;
    count: number;
  }[];
  lossRecords: number;
  cycleBreaks: number;
  samples: {
    rejects: { sourceType: string; sourceId: string; code: string }[];
    losses: {
      sourceType: string;
      sourceId: string;
      code: string;
      detailCode: string;
    }[];
  };
  completeness: MappingCompleteness;
  approvalRequired: boolean;
};

export type ExecuteInput = {
  dryRunDigest: string;
  mappingVersion: number;
  totalCount: number;
};

export type ExecuteResult =
  | { status: "started"; run: EngineRun }
  | { status: "pending_approval"; pendingActionId: string; run: EngineRun };

export type ImportLossPage = {
  runId: string;
  summary: {
    sourceType: string;
    code: string;
    detailCode: string;
    count: number;
  }[];
  losses: {
    id: string;
    sourceType: string;
    sourceId: string;
    code: string;
    detailCode: string;
    sourceUrl: string | null;
    createdAt: string;
  }[];
  nextCursor: string | null;
};

export function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

function runPath(id: string, suffix: string) {
  return getApiUrl(`imports/${encodeURIComponent(id)}/${suffix}`);
}

async function write<T>(
  url: string,
  body: unknown,
  idempotencyKey: string,
  message: string,
): Promise<T> {
  const headers: Record<string, string> = { "Idempotency-Key": idempotencyKey };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return readJson(
    await apiFetch(url, {
      method: "POST",
      credentials: "include",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    message,
  );
}

async function read<T>(url: string, message: string): Promise<T> {
  return readJson(
    await apiFetch(url, { credentials: "include", cache: "no-store" }),
    message,
  );
}

export async function listImportSources(
  workspaceId: string,
): Promise<ImportSource[]> {
  const result = await read<{ sources: ImportSource[] }>(
    getApiUrl(
      `import-sources?${new URLSearchParams({ workspaceId }).toString()}`,
    ),
    "Import sources could not be loaded",
  );
  return result.sources;
}

export function createImportSource(
  input: CreateImportSourceInput,
  idempotencyKey: string,
): Promise<ImportSource> {
  return write(
    getApiUrl("import-sources"),
    input,
    idempotencyKey,
    "Import source could not be created",
  );
}

export function createEngineImportRun(
  sourceId: string,
  input: { projectId: string; sourceRef: string },
  idempotencyKey: string,
): Promise<EngineRun> {
  return write(
    getApiUrl(`import-sources/${encodeURIComponent(sourceId)}/runs`),
    input,
    idempotencyKey,
    "Import run could not be created",
  );
}

export function getEngineImportRun(id: string): Promise<EngineRun> {
  return read(runPath(id, "engine"), "Import run could not be loaded");
}

export function discoverImportRun(
  id: string,
  idempotencyKey: string,
): Promise<ImportMapping> {
  return write(
    runPath(id, "discover"),
    undefined,
    idempotencyKey,
    "Discovery failed",
  );
}

export function getImportMapping(id: string): Promise<ImportMapping> {
  return read(runPath(id, "mapping"), "Mapping could not be loaded");
}

export function saveImportMapping(
  id: string,
  input: {
    expectedMappingVersion: number;
    entries: MappingEdit[];
    confirmProposals?: boolean;
  },
  idempotencyKey: string,
): Promise<ImportMapping> {
  return write(
    runPath(id, "mapping"),
    input,
    idempotencyKey,
    "Mapping could not be saved",
  );
}

export function runImportDryRun(
  id: string,
  idempotencyKey: string,
): Promise<ImportDryRunReport> {
  return write(
    runPath(id, "dry-run-all"),
    undefined,
    idempotencyKey,
    "Dry run failed",
  );
}

/** `null` when no dry run exists yet (the API answers 404). */
export async function getImportDryRun(
  id: string,
): Promise<ImportDryRunReport | null> {
  const response = await apiFetch(runPath(id, "dry-run-all"), {
    credentials: "include",
    cache: "no-store",
  });
  if (response.status === 404) return null;
  return readJson(response, "Dry-run report could not be loaded");
}

export function executeImportRun(
  id: string,
  input: ExecuteInput,
  idempotencyKey: string,
): Promise<ExecuteResult> {
  return write(
    runPath(id, "execute"),
    input,
    idempotencyKey,
    "Import could not be started",
  );
}

export function pauseImportRun(
  id: string,
  idempotencyKey: string,
): Promise<EngineRun> {
  return write(
    runPath(id, "pause"),
    undefined,
    idempotencyKey,
    "Import could not be paused",
  );
}

export function resumeImportRun(
  id: string,
  idempotencyKey: string,
): Promise<EngineRun> {
  return write(
    runPath(id, "resume"),
    undefined,
    idempotencyKey,
    "Import could not be resumed",
  );
}

export function getImportLosses(
  id: string,
  query: {
    code?: string;
    sourceType?: string;
    cursor?: string;
    limit?: number;
  },
): Promise<ImportLossPage> {
  const params = new URLSearchParams({ limit: String(query.limit ?? 100) });
  if (query.code) params.set("code", query.code);
  if (query.sourceType) params.set("sourceType", query.sourceType);
  if (query.cursor) params.set("cursor", query.cursor);
  return read(
    runPath(id, `losses?${params.toString()}`),
    "Import losses could not be loaded",
  );
}

// --- reconciliation (read-only snapshot; recompute is explicit) ---------------------------------

export type ReconciliationRow = {
  key: string;
  label: string;
  source: number;
  target: number;
};

export type ImportReconciliation = {
  runId?: string;
  version?: number;
  status?: string;
  rows: ReconciliationRow[];
  checks?: unknown;
  losses?: { byCode?: Record<string, number> };
  rejections?: unknown;
  staleLinks?: unknown;
  hierarchy?: unknown;
  relations?: unknown;
  danglingLinks?: unknown;
  spotCheck?: unknown;
};

export type ImportReconciliationResult = {
  runId: string;
  reconciliation: ImportReconciliation | null;
};

export function getImportReconciliation(
  id: string,
): Promise<ImportReconciliationResult> {
  return read(
    runPath(id, "reconciliation"),
    "Reconciliation could not be loaded",
  );
}

export function recomputeImportReconciliation(
  id: string,
  idempotencyKey: string,
): Promise<ImportReconciliationResult> {
  return write(
    runPath(id, "reconciliation"),
    undefined,
    idempotencyKey,
    "Reconciliation could not be recomputed",
  );
}
