import { describe, expect, it } from "vitest";
import type {
  DiscoveredFacet,
  ProposedMapping,
  SourceRecord,
} from "../../../../apps/api/src/imports/engine/adapter";
import {
  applyMappingEdits,
  CANONICAL_WRITER_CAPABILITIES,
  completeness,
  entryKey,
  indexMapping,
  type MappingEntry,
  mappingDigest,
  mergeDiscovery,
  resolveRecord,
} from "../../../../apps/api/src/imports/engine/mapping";

const facets: DiscoveredFacet[] = [
  { domain: "type", value: "Bug", count: 3 },
  { domain: "state", value: "Done", count: 5 },
  { domain: "state", value: "Won't Do", count: 2 },
  { domain: "state", value: "Weird", count: 1 },
  { domain: "priority", value: "P1", count: 4 },
  { domain: "person", value: "Ann@Example.com", count: 2 },
];
const proposals: ProposedMapping[] = [
  {
    domain: "type",
    value: "Bug",
    target: { kind: "target", id: "t1" },
    confidence: "exact",
  },
  {
    domain: "state",
    value: "Done",
    target: { kind: "group", group: "completed" },
    confidence: "heuristic",
  },
  {
    domain: "state",
    value: "Won't Do",
    target: { kind: "group", group: "cancelled" },
    confidence: "heuristic",
  },
  // Invalid for the domain: must be discarded, not stored.
  {
    domain: "priority",
    value: "P1",
    target: { kind: "group", group: "started" },
    confidence: "heuristic",
  },
];

describe("mapping completeness", () => {
  it("leaves unproposed and invalid-proposal values unmapped and blocks until confirmed", () => {
    const entries = mergeDiscovery([], facets, proposals);
    const state = completeness(entries);
    expect(state.complete).toBe(false);
    expect(state.unmapped).toBe(3); // Weird, P1 (invalid proposal), person
    expect(state.proposed).toBe(3);
    expect(entries.find((e) => e.value === "Weird")?.target).toBeNull();
    // Person values are case-insensitive.
    expect(
      entries.some(
        (e) => e.domain === "person" && e.value === "ann@example.com",
      ),
    ).toBe(true);
  });

  it("confirming proposals alone does not complete a mapping with unmapped values", () => {
    const entries = mergeDiscovery([], facets, proposals);
    const confirmed = applyMappingEdits(entries, [], true);
    expect(confirmed.ok && completeness(confirmed.entries).complete).toBe(
      false,
    );
    if (!confirmed.ok) throw new Error("unexpected");
    const done = applyMappingEdits(
      confirmed.entries,
      [
        {
          domain: "state",
          value: "Weird",
          target: { kind: "group", group: "started" },
        },
        {
          domain: "priority",
          value: "P1",
          target: { kind: "priority", value: "high" },
        },
        {
          domain: "person",
          value: "ann@example.com",
          target: { kind: "placeholder" },
        },
      ],
      false,
    );
    if (!done.ok) throw new Error("unexpected");
    const state = completeness(done.entries);
    expect(state.complete).toBe(true);
    expect(state.stateGroups).toEqual({
      backlog: 0,
      unstarted: 0,
      started: 1,
      completed: 5,
      cancelled: 2,
    });
  });

  it("always reports all five state groups and rejects invalid targets", () => {
    expect(Object.keys(completeness([]).stateGroups)).toEqual([
      "backlog",
      "unstarted",
      "started",
      "completed",
      "cancelled",
    ]);
    const entries = mergeDiscovery([], facets, []);
    expect(
      applyMappingEdits(
        entries,
        [{ domain: "state", value: "Done", target: { kind: "ignore" } }],
        false,
      ),
    ).toEqual({ ok: false, code: "invalid_mapping_target" });
    expect(
      applyMappingEdits(
        entries,
        [
          {
            domain: "state",
            value: "Nope",
            target: { kind: "group", group: "started" },
          },
        ],
        false,
      ),
    ).toEqual({ ok: false, code: "unknown_mapping_value" });
  });

  it("keeps confirmed entries across rediscovery and drops values that vanished", () => {
    const first = mergeDiscovery([], facets, proposals);
    const confirmed = applyMappingEdits(first, [], true);
    if (!confirmed.ok) throw new Error("unexpected");
    const again = mergeDiscovery(
      confirmed.entries,
      facets.filter((f) => f.value !== "Weird"),
      [],
    );
    expect(again.find((e) => e.value === "Done")?.status).toBe("confirmed");
    expect(again.some((e) => e.value === "Weird")).toBe(false);
  });

  it("changes the digest when any entry changes", () => {
    const entries = mergeDiscovery([], facets, proposals);
    const edited = applyMappingEdits(
      entries,
      [
        {
          domain: "state",
          value: "Done",
          target: { kind: "group", group: "started" },
        },
      ],
      false,
    );
    if (!edited.ok) throw new Error("unexpected");
    expect(mappingDigest(edited.entries)).not.toBe(mappingDigest(entries));
  });
});

function confirmedMapping(extra: MappingEntry[] = []) {
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
  return indexMapping([
    entry("type", "Bug", { kind: "target", id: "type-1" }),
    entry("state", "Done", { kind: "group", group: "completed" }),
    entry("priority", "P1", { kind: "priority", value: "high" }),
    entry("label", "ui", { kind: "target", id: "label-1" }),
    entry("label", "legacy", { kind: "ignore" }),
    entry("person", "ann@example.com", { kind: "placeholder" }),
    ...extra,
  ]);
}

const source = (over: Partial<SourceRecord> = {}): SourceRecord => ({
  sourceType: "issue",
  sourceId: "A-1",
  title: "  Fix it ",
  facets: [
    { domain: "type", value: "Bug" },
    { domain: "state", value: "Done" },
    { domain: "priority", value: "P1" },
    { domain: "label", value: "ui" },
    { domain: "label", value: "legacy" },
  ],
  assigneeEmail: "Ann@Example.com",
  ...over,
});

describe("record resolution", () => {
  it("resolves through the mapping and reports what it ignores or cannot write", () => {
    const result = resolveRecord(confirmedMapping(), source(), {
      capabilities: CANONICAL_WRITER_CAPABILITIES,
    });
    expect(result.rejects).toEqual([]);
    expect(result.record?.item).toMatchObject({
      typeId: "type-1",
      title: "Fix it",
      priority: "high",
      labelIds: ["label-1"],
    });
    expect(result.extras.stateGroup).toBe("completed");
    expect(result.extras.placeholderEmails).toEqual(["ann@example.com"]);
    expect(result.losses).toEqual(
      expect.arrayContaining([
        { code: "writer_unavailable", detailCode: "state" },
        { code: "facet_ignored", detailCode: "label" },
        { code: "person_placeholder", detailCode: "assignee" },
      ]),
    );
  });

  it("rejects instead of guessing when a value is unmapped or unconfirmed", () => {
    const unconfirmed = confirmedMapping([
      {
        domain: "label",
        value: "new",
        target: { kind: "target", id: "l" },
        status: "proposed",
        affected: 1,
      },
    ]);
    const result = resolveRecord(
      unconfirmed,
      source({
        facets: [...source().facets, { domain: "label", value: "new" }],
      }),
      { capabilities: CANONICAL_WRITER_CAPABILITIES },
    );
    expect(result.record).toBeNull();
    expect(result.rejects).toContain("unmapped_value");
    const noType = resolveRecord(confirmedMapping(), source({ facets: [] }), {
      capabilities: CANONICAL_WRITER_CAPABILITIES,
    });
    expect(noType.rejects).toEqual(
      expect.arrayContaining(["missing_type", "missing_state"]),
    );
  });

  it("drops unsafe source urls with a reported loss and flags a broken parent edge", () => {
    const result = resolveRecord(
      confirmedMapping(),
      source({
        sourceUrl: "https://user:pw@example.com/x",
        parentSourceId: "A-0",
        sourceCreatedAt: "2026-01-01T00:00:00.000Z",
      }),
      {
        capabilities: CANONICAL_WRITER_CAPABILITIES,
        brokenParents: new Set([JSON.stringify(["issue", "A-1"])]),
      },
    );
    expect(result.sourceUrl).toBeUndefined();
    expect(result.losses).toEqual(
      expect.arrayContaining([
        { code: "source_url_dropped" },
        { code: "parent_cycle_broken" },
        { code: "writer_unavailable", detailCode: "timestamps" },
      ]),
    );
    expect(result.extras.parentSourceId).toBeUndefined();
  });

  it("keys person entries case-insensitively", () => {
    expect(entryKey("person", "A@B.C")).toBe(entryKey("person", "a@b.c"));
    expect(entryKey("label", "A")).not.toBe(entryKey("label", "a"));
  });
});
