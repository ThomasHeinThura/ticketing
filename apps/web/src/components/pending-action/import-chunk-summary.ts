export type ImportChunkSummary = {
  operation: "records" | "links";
  recordCount: number;
};

/** Parse the deliberately minimal, closed MCP import pending-action summary. */
export function parseImportChunkSummary(action: {
  action: string;
  targetType: string;
  targetIds: string[];
  confirmation: string;
  summary: Record<string, unknown> | undefined;
}): ImportChunkSummary | null {
  const summary = action.summary;
  if (
    action.action !== "mcp_destructive" ||
    action.targetType !== "import_chunk" ||
    action.targetIds.length !== 1 ||
    action.confirmation !== "typed_count_step_up" ||
    !summary
  )
    return null;

  const keys = Object.keys(summary).sort();
  if (
    keys.length !== 4 ||
    keys[0] !== "kind" ||
    keys[1] !== "operation" ||
    keys[2] !== "pluginId" ||
    keys[3] !== "recordCount" ||
    summary.kind !== "mcp_import_chunk" ||
    (summary.operation !== "records" && summary.operation !== "links") ||
    summary.pluginId !== "import.mcp" ||
    typeof summary.recordCount !== "number" ||
    !Number.isSafeInteger(summary.recordCount) ||
    summary.recordCount < 1 ||
    summary.recordCount > 500
  )
    return null;

  return {
    operation: summary.operation,
    recordCount: summary.recordCount,
  };
}
