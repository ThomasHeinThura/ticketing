import { describe, expect, it } from "vitest";
import { parseImportRunSummary } from "./import-run-summary";

const valid = {
  action: "mcp_destructive",
  targetType: "import_run",
  targetIds: ["run-1"],
  confirmation: "typed_count_step_up",
  summary: {
    kind: "import_run",
    pluginId: "import.jira",
    totalCount: 120,
    writes: 80,
    mappingVersion: 2,
  },
};

describe("parseImportRunSummary", () => {
  it("accepts the exact run-level contract", () => {
    expect(parseImportRunSummary(valid)).toEqual({
      runId: "run-1",
      pluginId: "import.jira",
      totalCount: 120,
      writes: 80,
      mappingVersion: 2,
    });
  });

  it.each([
    { action: "bulk_delete" },
    { targetType: "import_chunk" },
    { targetIds: ["run-1", "run-2"] },
    { confirmation: "typed_count" },
    { summary: undefined },
    { summary: { ...valid.summary, kind: "mcp_import_chunk" } },
    { summary: { ...valid.summary, totalCount: 0 } },
    { summary: { ...valid.summary, writes: 121 } },
    { summary: { ...valid.summary, totalCount: 1.5 } },
    { summary: { ...valid.summary, mappingVersion: 0 } },
    { summary: { ...valid.summary, sourceRef: "private" } },
  ])("fails closed for invalid or expanded metadata %#", (overrides) => {
    expect(parseImportRunSummary({ ...valid, ...overrides })).toBeNull();
  });
});
