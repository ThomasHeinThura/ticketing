import { apiFetch } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";
import { getApiUrl } from "../get-api-url";

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
  pluginId: "import.mcp";
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

async function readJson<T>(response: Response, message: string): Promise<T> {
  if (!response.ok) throw new HttpError(response.status, message);
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
