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
