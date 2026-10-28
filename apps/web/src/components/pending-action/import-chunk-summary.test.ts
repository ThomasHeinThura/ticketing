import { describe, expect, it } from "vitest";
import { parseImportChunkSummary } from "./import-chunk-summary";

const valid = {
  action: "mcp_destructive",
  targetType: "import_chunk",
  targetIds: ["chunk-1"],
  confirmation: "typed_count_step_up",
  summary: {
    kind: "mcp_import_chunk",
    operation: "records",
    recordCount: 3,
    pluginId: "import.mcp",
  },
};

describe("parseImportChunkSummary", () => {
  it("accepts the exact bounded metadata contract", () => {
    expect(parseImportChunkSummary(valid)).toEqual({
      operation: "records",
      recordCount: 3,
    });
  });

  it.each([
    { action: "bulk_delete" },
    { targetType: "work_item" },
    { targetIds: ["chunk-1", "chunk-2"] },
    { confirmation: "typed_count" },
    { summary: { ...valid.summary, operation: "unknown" } },
    { summary: { ...valid.summary, recordCount: 0 } },
    { summary: { ...valid.summary, recordCount: 501 } },
    { summary: { ...valid.summary, recordCount: 1.5 } },
    { summary: { ...valid.summary, sourceRef: "private-source" } },
  ])("fails closed for invalid or expanded metadata %#", (overrides) => {
    expect(parseImportChunkSummary({ ...valid, ...overrides })).toBeNull();
  });
});
