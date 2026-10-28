export type ImportRunSummary = {
  runId: string;
  pluginId: string;
  totalCount: number;
  writes: number;
  mappingVersion: number;
};

/** Parse the closed run-level import pending-action summary (API: `kind: "import_run"`). */
export function parseImportRunSummary(action: {
  action: string;
  targetType: string;
  targetIds: string[];
  confirmation: string;
  summary: Record<string, unknown> | undefined;
}): ImportRunSummary | null {
  const summary = action.summary;
  const [runId] = action.targetIds;
  if (
    action.action !== "mcp_destructive" ||
    action.targetType !== "import_run" ||
    action.targetIds.length !== 1 ||
    !runId ||
    action.confirmation !== "typed_count_step_up" ||
    !summary
  )
    return null;

  const keys = Object.keys(summary).sort().join(",");
  if (
    keys !== "kind,mappingVersion,pluginId,totalCount,writes" ||
    summary.kind !== "import_run" ||
    typeof summary.pluginId !== "string" ||
    summary.pluginId.length < 1 ||
    typeof summary.totalCount !== "number" ||
    !Number.isSafeInteger(summary.totalCount) ||
    summary.totalCount < 1 ||
    typeof summary.writes !== "number" ||
    !Number.isSafeInteger(summary.writes) ||
    summary.writes < 1 ||
    summary.writes > summary.totalCount ||
    typeof summary.mappingVersion !== "number" ||
    !Number.isSafeInteger(summary.mappingVersion) ||
    summary.mappingVersion < 1
  )
    return null;

  return {
    runId,
    pluginId: summary.pluginId,
    totalCount: summary.totalCount,
    writes: summary.writes,
    mappingVersion: summary.mappingVersion,
  };
}
