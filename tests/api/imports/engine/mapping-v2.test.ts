import { describe, expect, it } from "vitest";
import { sha256Canonical } from "../../../../apps/api/src/imports/content";
import type { SourceRecord } from "../../../../apps/api/src/imports/engine/adapter";
import {
  CANONICAL_WRITER_CAPABILITIES,
  indexMapping,
  type MappingEntry,
  type ResolveContext,
  resolveRecord,
  WRITER_V2_CAPABILITIES,
} from "../../../../apps/api/src/imports/engine/mapping";
import {
  canonicalRecords,
  importChunkDigest,
} from "../../../../apps/api/src/imports/service";

const entry = (
  domain: MappingEntry["domain"],
  value: string,
  target: NonNullable<MappingEntry["target"]>,
): MappingEntry => ({
  domain,
  value,
  target,
  status: "confirmed",
  affected: 1,
});

const mapping = (extra: MappingEntry[] = []) =>
  indexMapping([
    entry("type", "Bug", { kind: "target", id: "type-1" }),
    entry("state", "Done", { kind: "group", group: "completed" }),
    entry("custom_field", "sev", { kind: "target", id: "cf-1" }),
    entry("person", "ann@example.com", { kind: "target", id: "person-ann" }),
    entry("person", "bob@example.com", { kind: "ignore" }),
    ...extra,
  ]);

const context: ResolveContext = {
  customFieldKeyById: new Map([["cf-1", "dest-severity"]]),
  stateIdByGroup: new Map([["completed", "state-done"]]),
  personEmailById: new Map([["person-ann", "ann.real@example.com"]]),
};

const source = (over: Partial<SourceRecord> = {}): SourceRecord => ({
  sourceType: "issue",
  sourceId: "A-1",
  title: "Fix",
  facets: [
    { domain: "type", value: "Bug" },
    { domain: "state", value: "Done" },
  ],
  ...over,
});
const resolve = (record: SourceRecord, caps = WRITER_V2_CAPABILITIES) =>
  resolveRecord(mapping(), record, { capabilities: caps, context });

describe("record v2 resolution", () => {
  it("maps state, parent, timestamps, custom field keys and members into the writer record", () => {
    const result = resolve(
      source({
        parentSourceId: "A-0",
        sourceCreatedAt: "2020-01-02T03:04:05.000Z",
        sourceUpdatedAt: "2020-02-02T03:04:05.000Z",
        sourceResolvedAt: "2020-03-02T03:04:05.000Z",
        sourceAuthorName: "Ann",
        customFields: [{ key: "sev", value: "high" }],
        comments: [
          { sourceId: "c1", body: "hi", authorEmail: "ann@example.com" },
        ],
        relations: [
          { type: "blocks", target: { sourceType: "issue", sourceId: "A-2" } },
        ],
        history: [
          {
            sourceId: "h1",
            at: "2020-01-03T03:04:05.000Z",
            field: "state",
            to: "Done",
          },
        ],
      }),
    );
    expect(result.rejects).toEqual([]);
    expect(result.record).toMatchObject({
      stateId: "state-done",
      parent: { sourceType: "issue", sourceId: "A-0" },
      sourceCreatedAt: "2020-01-02T03:04:05.000Z",
      sourceResolvedAt: "2020-03-02T03:04:05.000Z",
      sourceAuthorName: "Ann",
      // The destination field KEY, not the id the mapping holds.
      customFields: [{ key: "dest-severity", value: "high" }],
      // A confirmed target person substitutes their email for a nested author.
      comments: [{ sourceId: "c1", authorEmail: "ann.real@example.com" }],
      relations: [{ type: "blocks" }],
      history: [{ sourceId: "h1" }],
    });
    expect(result.losses).toEqual([]);
  });

  it("drops one bad member with a loss instead of rejecting the record, and truncates over the caps", () => {
    const result = resolve(
      source({
        comments: [
          { sourceId: "ok", body: "fine" },
          { sourceId: "bad", body: "" },
        ],
        attachments: [
          {
            sourceId: "sig",
            url: "https://f.test/a.png?sig=1",
            filename: "a.png",
          },
          { sourceId: "ok", url: "https://f.test/a.png", filename: "a.png" },
        ],
        relations: Array.from({ length: 201 }, (_, i) => ({
          type: "relates" as const,
          target: { sourceType: "issue", sourceId: `R-${i}` },
        })),
        sourceUpdatedAt: "not a date",
      }),
    );
    expect(result.record?.comments).toHaveLength(1);
    expect(result.record?.attachments).toHaveLength(1);
    expect(result.record?.relations).toHaveLength(200);
    expect(result.record?.sourceUpdatedAt).toBeUndefined();
    expect(result.losses).toEqual(
      expect.arrayContaining([
        { code: "comment_invalid" },
        { code: "attachment_invalid" },
        { code: "members_truncated", detailCode: "relation" },
        { code: "timestamp_invalid", detailCode: "updated" },
      ]),
    );
  });

  it("applies only confirmed person entries to nested authors and never rejects for an unmapped one", () => {
    const result = resolve(
      source({
        comments: [
          { sourceId: "1", body: "a", authorEmail: "bob@example.com" },
          { sourceId: "2", body: "b", authorEmail: "stranger@example.com" },
        ],
      }),
    );
    expect(result.rejects).toEqual([]);
    const [ignored, unmapped] = result.record?.comments ?? [];
    expect(ignored?.authorEmail).toBeUndefined(); // ignore strips the address
    expect(unmapped?.authorEmail).toBe("stranger@example.com"); // the writer matches or makes a placeholder
  });

  it("reports what the writer cannot take: requester, modules and an unknown destination field", () => {
    const result = resolve(
      source({
        requester: { email: "r@example.com" },
        facets: [...source().facets, { domain: "custom_field", value: "gone" }],
        customFields: [{ key: "gone", value: "x" }],
      }),
    );
    expect(result.losses).toEqual(
      expect.arrayContaining([
        { code: "writer_unavailable", detailCode: "requester" },
        { code: "custom_field_unmapped" },
      ]),
    );
    const none = resolve(
      source({ comments: [{ sourceId: "1", body: "a" }], parentSourceId: "P" }),
      CANONICAL_WRITER_CAPABILITIES,
    );
    expect(none.record?.comments).toBeUndefined();
    expect(none.losses).toEqual(
      expect.arrayContaining([
        { code: "writer_unavailable", detailCode: "comment" },
        { code: "writer_unavailable", detailCode: "parent" },
      ]),
    );
  });

  it("rejects with exactly the adapter's own code", () => {
    const result = resolve(source({ rejectCode: "duplicate_source_id" }));
    expect(result.record).toBeNull();
    expect(result.rejects).toEqual(["duplicate_source_id"]);
    expect(resolve(source({ rejectCode: "Not A Code" })).rejects).toEqual([
      "invalid_reject_code",
    ]);
  });

  it("reports a mapped state group the project has no state for", () => {
    const result = resolveRecord(mapping(), source(), {
      capabilities: WRITER_V2_CAPABILITIES,
      context: { ...context, stateIdByGroup: new Map() },
    });
    expect(result.record?.stateId).toBeUndefined();
    expect(result.losses).toContainEqual({
      code: "state_unresolved",
      detailCode: "completed",
    });
  });
});

describe("chunk digest", () => {
  const run = {
    id: "run-1",
    workspaceId: "ws-1",
    projectId: "p-1",
    pluginId: "import.mcp",
    sourceRef: "ref",
    profileId: null,
    stats: {},
  };
  const records = [
    {
      sourceType: "issue",
      sourceId: "1",
      item: { typeId: "t", title: "x" },
    },
  ];

  it("is unchanged for retained MCP runs (golden) and differs by plugin", () => {
    const mcp = importChunkDigest(run, "chunk-1", records as never);
    expect(mcp).toMatch(/^[a-f0-9]{64}$/u);
    expect(mcp).toBe(GOLDEN_MCP_DIGEST);
    // The formula the retained dry run used before the engine existed (plugin id was a literal).
    expect(mcp).toBe(
      sha256Canonical({
        runId: "run-1",
        workspaceId: "ws-1",
        projectId: "p-1",
        pluginId: "import.mcp",
        sourceRef: "ref",
        profileId: null,
        profileVersion: null,
        mappingVersion: null,
        chunkId: "chunk-1",
        records: canonicalRecords(records as never),
      }),
    );
    expect(
      importChunkDigest(
        { ...run, pluginId: "import.csv" },
        "chunk-1",
        records as never,
      ),
    ).not.toBe(mcp);
  });
});

const GOLDEN_MCP_DIGEST =
  "71efdb036a9b29832b12b5c568945bddc365e2dd3272ba3931aa0961806bfbe5";
