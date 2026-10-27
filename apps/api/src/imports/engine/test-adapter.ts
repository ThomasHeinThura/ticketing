/**
 * In-memory fake adapter for tests. Records come from a fixture keyed by the connection's
 * `config.fixture`. Never registered outside tests; real adapters belong to other lanes.
 */
import type { ImportPluginId } from "../../database/schema-imports";
import type {
  AdapterConnection,
  DiscoveredFacet,
  DiscoveryResult,
  ImportSourceAdapter,
  MappingDomain,
  ProposalContext,
  ProposedMapping,
  SourcePage,
  SourceRecord,
  StateGroup,
} from "./adapter";
import { isUnreadableRecord } from "./adapter";

export type FakeFixture = {
  records: SourceRecord[];
  /** Reads that start at this cursor throw (simulates a source outage). */
  failAtCursor?: string | null;
  /** A read that starts at this cursor waits for `until` (holds a background job mid-read). */
  holdAtCursor?: { cursor: string | null; until: Promise<void> };
};

const fixtures = new Map<string, FakeFixture>();
export const fakeReads: Array<string | null> = [];
/** How many times discovery scanned the fixture (a duplicate request must not scan twice). */
export const fakeDiscovers = { count: 0 };

export function setFakeFixture(id: string, fixture: FakeFixture) {
  fixtures.set(id, fixture);
}
export function clearFakeFixtures() {
  fixtures.clear();
  fakeReads.length = 0;
  fakeDiscovers.count = 0;
}

function fixtureFor(connection: AdapterConnection): FakeFixture {
  const id = connection.config.fixture;
  const fixture = typeof id === "string" ? fixtures.get(id) : undefined;
  if (!fixture) throw new Error("fixture missing");
  return fixture;
}

const STATE_GUESS: Record<string, StateGroup> = {
  backlog: "backlog",
  todo: "unstarted",
  "in progress": "started",
  done: "completed",
  "won't do": "cancelled",
};

export function createFakeAdapter(
  pluginId: ImportPluginId = "import.mcp",
  chunkSize = 200,
): ImportSourceAdapter {
  return {
    pluginId,
    chunkSize,
    async connect() {
      return { ok: true };
    },
    async discover(connection, hooks): Promise<DiscoveryResult> {
      const { records } = fixtureFor(connection);
      fakeDiscovers.count += 1;
      const counts: Record<string, number> = {};
      const facets = new Map<string, DiscoveredFacet>();
      const add = (domain: MappingDomain, value: string) => {
        const key = JSON.stringify([domain, value]);
        const current = facets.get(key);
        if (current) current.count += 1;
        else facets.set(key, { domain, value, count: 1 });
      };
      let seen = 0;
      const unreadable: Record<string, number> = {};
      for (const record of records) {
        seen += 1;
        if (seen % 10 === 0)
          await hooks?.onProgress?.({ pages: seen / 10, records: seen });
        counts[record.sourceType] = (counts[record.sourceType] ?? 0) + 1;
        if (isUnreadableRecord(record)) {
          const code = record.rejectCode as string;
          unreadable[code] = (unreadable[code] ?? 0) + 1;
          continue;
        }
        for (const facet of record.facets) add(facet.domain, facet.value);
        if (record.assigneeEmail)
          add("person", record.assigneeEmail.toLowerCase());
        if (record.sourceAuthorEmail)
          add("person", record.sourceAuthorEmail.toLowerCase());
      }
      return {
        facets: [...facets.values()],
        counts,
        totalRecords: records.length,
        ...(Object.keys(unreadable).length ? { unreadable } : {}),
      };
    },
    async proposeMapping(
      discovery: DiscoveryResult,
      context: ProposalContext,
    ): Promise<ProposedMapping[]> {
      const proposals: ProposedMapping[] = [];
      for (const facet of discovery.facets) {
        if (facet.domain === "state") {
          const group = STATE_GUESS[facet.value.toLowerCase()];
          if (group)
            proposals.push({
              domain: "state",
              value: facet.value,
              target: { kind: "group", group },
              confidence: "heuristic",
            });
        } else if (facet.domain === "type") {
          const id = context.typeIdsByKey.get(facet.value);
          if (id)
            proposals.push({
              domain: "type",
              value: facet.value,
              target: { kind: "target", id },
              confidence: "exact",
            });
        } else if (facet.domain === "person") {
          const id = context.peopleByEmail.get(facet.value.toLowerCase());
          proposals.push({
            domain: "person",
            value: facet.value,
            target: id ? { kind: "target", id } : { kind: "placeholder" },
            confidence: id ? "exact" : "heuristic",
          });
        }
      }
      return proposals;
    },
    async readPage(connection, cursor, pageSize): Promise<SourcePage> {
      const fixture = fixtureFor(connection);
      fakeReads.push(cursor);
      if (fixture.holdAtCursor && fixture.holdAtCursor.cursor === cursor)
        await fixture.holdAtCursor.until;
      if (fixture.failAtCursor !== undefined && fixture.failAtCursor === cursor)
        throw new Error("source outage");
      const start = cursor === null ? 0 : Number(cursor);
      const end = Math.min(start + pageSize, fixture.records.length);
      return {
        records: fixture.records.slice(start, end),
        nextCursor: end < fixture.records.length ? String(end) : null,
      };
    },
  };
}
