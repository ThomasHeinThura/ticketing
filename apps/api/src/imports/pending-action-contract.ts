export const IMPORT_CHUNK_TARGET = "import_chunk" as const;
export const IMPORT_CHUNK_ROUTE = "POST /api/imports/{id}/records" as const;
export const IMPORT_LINK_CHUNK_ROUTE = "POST /api/imports/{id}/links" as const;

export type ImportChunkOperation = "records" | "links";

export type ImportChunkBinding = {
  runId: string;
  digest: string;
  expectedRunVersion: number;
  recordCount: number;
  operation: ImportChunkOperation;
};

export function readImportChunkBinding(
  targetVersions: unknown,
  targetIds: readonly string[],
  routeKey?: string,
): { chunkId: string; binding: ImportChunkBinding } | undefined {
  if (targetIds.length !== 1) return undefined;
  const [chunkId] = targetIds;
  if (
    !chunkId ||
    !targetVersions ||
    typeof targetVersions !== "object" ||
    Array.isArray(targetVersions)
  )
    return undefined;
  const versions = targetVersions as Record<string, unknown>;
  if (Object.keys(versions).length !== 1 || !(chunkId in versions))
    return undefined;
  const value = versions[chunkId];
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !==
      "digest,expectedRunVersion,operation,recordCount,runId" ||
    typeof record.runId !== "string" ||
    record.runId.length < 1 ||
    record.runId.length > 128 ||
    typeof record.digest !== "string" ||
    !/^[a-f0-9]{64}$/u.test(record.digest) ||
    !Number.isSafeInteger(record.expectedRunVersion) ||
    (record.expectedRunVersion as number) < 2 ||
    !Number.isSafeInteger(record.recordCount) ||
    (record.recordCount as number) <= 50 ||
    (record.recordCount as number) > 500 ||
    (record.operation !== "records" && record.operation !== "links")
  )
    return undefined;
  if (
    (routeKey === IMPORT_CHUNK_ROUTE && record.operation !== "records") ||
    (routeKey === IMPORT_LINK_CHUNK_ROUTE && record.operation !== "links") ||
    (routeKey !== undefined &&
      routeKey !== IMPORT_CHUNK_ROUTE &&
      routeKey !== IMPORT_LINK_CHUNK_ROUTE)
  )
    return undefined;
  return {
    chunkId,
    binding: {
      runId: record.runId,
      digest: record.digest,
      expectedRunVersion: record.expectedRunVersion as number,
      recordCount: record.recordCount as number,
      operation: record.operation,
    },
  };
}

// --- Run-level approval (P6 D2) ----------------------------------------------------------------
// One pending action approves a whole engine run that would write more than 50 records. It is bound
// to exactly what the operator reviewed: the whole-run dry-run digest, the total record count and the
// mapping version. The run id is the single target id; the binding lives in `target_versions`.

export const IMPORT_RUN_TARGET = "import_run" as const;
export const IMPORT_RUN_ROUTE = "POST /api/imports/{id}/execute" as const;

export type ImportRunBinding = {
  runId: string;
  digest: string;
  totalCount: number;
  mappingVersion: number;
  /** created + updated: what makes the run need approval. Shown, and re-checked at request time. */
  writes: number;
};

export function readImportRunBinding(
  targetVersions: unknown,
  targetIds: readonly string[],
  routeKey?: string,
): ImportRunBinding | undefined {
  if (targetIds.length !== 1) return undefined;
  const [runId] = targetIds;
  if (
    !runId ||
    !targetVersions ||
    typeof targetVersions !== "object" ||
    Array.isArray(targetVersions)
  )
    return undefined;
  const versions = targetVersions as Record<string, unknown>;
  if (Object.keys(versions).length !== 1 || !(runId in versions))
    return undefined;
  const value = versions[runId];
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !==
      "digest,mappingVersion,totalCount,writes" ||
    typeof record.digest !== "string" ||
    !/^[a-f0-9]{64}$/u.test(record.digest) ||
    !Number.isSafeInteger(record.mappingVersion) ||
    (record.mappingVersion as number) < 1 ||
    !Number.isSafeInteger(record.totalCount) ||
    (record.totalCount as number) < 1 ||
    !Number.isSafeInteger(record.writes) ||
    (record.writes as number) <= 50 ||
    (record.writes as number) > (record.totalCount as number) ||
    (routeKey !== undefined && routeKey !== IMPORT_RUN_ROUTE)
  )
    return undefined;
  return {
    runId,
    digest: record.digest,
    totalCount: record.totalCount as number,
    mappingVersion: record.mappingVersion as number,
    writes: record.writes as number,
  };
}
