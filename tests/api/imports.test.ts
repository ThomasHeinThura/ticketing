import { describe, expect, it } from "vitest";
import {
  normalizeImportItem,
  sha256Canonical,
} from "../../apps/api/src/imports/content";
import {
  createImportRunBody,
  dryRunImportBody,
  importRecordsSchema,
  linkImportBody,
} from "../../apps/api/src/imports/schema";

const validRecord = {
  sourceType: "ticket",
  sourceId: "source-123",
  item: { typeId: "type-1", title: "Sample request" },
};

describe("MCP import wire schemas", () => {
  it("accepts only the registered MCP plugin and bounded source references", () => {
    expect(
      createImportRunBody.parse({
        workspaceId: "workspace-1",
        projectId: "project-1",
        pluginId: "import.mcp",
        sourceRef: "desk-a",
      }).pluginId,
    ).toBe("import.mcp");
    expect(
      createImportRunBody.safeParse({
        workspaceId: "workspace-1",
        projectId: "project-1",
        pluginId: "import.azure",
        sourceRef: "desk-a",
      }).success,
    ).toBe(false);
    expect(
      createImportRunBody.safeParse({
        workspaceId: "workspace-1",
        projectId: "project-1",
        pluginId: "import.mcp",
        sourceRef: "desk\nsecret",
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate identities in one chunk and unsupported extra fields", () => {
    expect(
      importRecordsSchema.safeParse([validRecord, validRecord]).success,
    ).toBe(false);
    expect(
      dryRunImportBody.safeParse({
        chunkId: "chunk-1",
        expectedVersion: 1,
        records: [{ ...validRecord, state: "Closed" }],
      }).success,
    ).toBe(false);
  });

  it("only accepts HTTPS source links without embedded credentials", () => {
    expect(
      importRecordsSchema.safeParse([
        {
          ...validRecord,
          sourceUrl: "https://tracker.example/items/123",
        },
      ]).success,
    ).toBe(true);
    expect(
      importRecordsSchema.safeParse([
        {
          ...validRecord,
          sourceUrl: "https://user:password@tracker.example/items/123",
        },
      ]).success,
    ).toBe(false);
    expect(
      importRecordsSchema.safeParse([
        {
          ...validRecord,
          sourceUrl: "http://tracker.example/items/123",
        },
      ]).success,
    ).toBe(false);
    expect(
      importRecordsSchema.safeParse([
        {
          ...validRecord,
          sourceUrl: "https://tracker.example/items/123?access_token=secret",
        },
      ]).success,
    ).toBe(false);
  });

  it("requires source identity links to target only work items", () => {
    expect(
      linkImportBody.safeParse({
        links: [
          {
            sourceType: "ticket",
            sourceId: "source-123",
            targetType: "work_item",
            targetId: "target-1",
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      linkImportBody.safeParse({
        links: [
          {
            sourceType: "ticket",
            sourceId: "source-123",
            targetType: "project",
            targetId: "target-1",
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("canonical import content fingerprints", () => {
  it("does not treat caller source hashes as canonical target content", () => {
    const content = { typeId: "type-1", title: "Request", priority: null };
    expect(sha256Canonical(content)).toBe(
      sha256Canonical({ priority: null, title: "Request", typeId: "type-1" }),
    );
    expect(sha256Canonical(content)).not.toBe(
      sha256Canonical({ ...content, sourceHash: "a".repeat(64) }),
    );
  });

  it("normalizes new target defaults deterministically", () => {
    expect(
      normalizeImportItem({ typeId: "type-1", title: "Request" }, "assignee-1"),
    ).toEqual({
      typeId: "type-1",
      title: "Request",
      description: null,
      priority: null,
      startDate: null,
      dueDate: null,
      labelIds: [],
      assigneeId: "assignee-1",
    });
  });
});
