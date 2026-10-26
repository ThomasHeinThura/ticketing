import { afterEach, describe, expect, it } from "vitest";
import {
  createJiraAdapter,
  registerJiraAdapters,
} from "../../../../apps/api/src/imports/adapters/jira";
import {
  type FieldMap,
  normalizeIssue,
  type Raw,
} from "../../../../apps/api/src/imports/adapters/jira/normalize";
import { jsmFlavor } from "../../../../apps/api/src/imports/adapters/jsm";
import {
  getImportAdapter,
  type SourceRecord,
  unregisterImportAdapter,
} from "../../../../apps/api/src/imports/engine/adapter";
import { connection, loadFixture, proposalContext } from "./jira-support";

type Export = { issues: Raw[]; names: Record<string, string> };
const exportJson = loadFixture<Export>("jsm/export.json");
const conn = connection("import.jsm", { export: exportJson });
const adapter = createJiraAdapter("import.jsm");

async function readAll(c = conn, a = adapter) {
  const records: SourceRecord[] = [];
  let cursor: string | null = null;
  do {
    const page = await a.readPage(c, cursor, 7);
    records.push(...page.records);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return records;
}
const byId = (records: SourceRecord[], id: string) => {
  const found = records.find((r) => r.sourceId === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
};
const facet = (record: SourceRecord, domain: string) =>
  record.facets.filter((f) => f.domain === domain).map((f) => f.value);
const lossKeys = (record: SourceRecord) =>
  (record.losses ?? []).map((l) =>
    l.detailCode ? `${l.code}:${l.detailCode}` : l.code,
  );

afterEach(() => {
  unregisterImportAdapter("import.jira");
  unregisterImportAdapter("import.jsm");
});

describe("jsm adapter", () => {
  it("registers both plugin ids", () => {
    registerJiraAdapters();
    expect(getImportAdapter("import.jira")?.pluginId).toBe("import.jira");
    expect(getImportAdapter("import.jsm")?.pluginId).toBe("import.jsm");
  });

  it("reads every unique request once (a duplicate export row is collapsed)", async () => {
    const records = await readAll();
    expect(records).toHaveLength(32);
    expect(new Set(records.map((r) => r.sourceId)).size).toBe(32);
    const three = byId(records, "HELP-3");
    expect(three.title).toBe("Shared drive is read-only");
    expect(lossKeys(three)).toContain("duplicate_row_collapsed");
    expect(three.sourceUrl).toBe(
      "https://acme-desk-fixture.atlassian.net/browse/HELP-3",
    );
  });

  it("uses the request type as the type facet and keeps request-type fields out of custom fields", async () => {
    const records = await readAll();
    expect(facet(byId(records, "HELP-1"), "type")).toEqual(["Get IT help"]);
    expect(facet(byId(records, "HELP-2"), "type")).toEqual([
      "Request new hardware",
    ]);
    expect(facet(byId(records, "HELP-4"), "type")).toEqual([
      "Report an incident",
    ]);
    for (const record of records)
      for (const value of facet(record, "custom_field"))
        expect([
          "customfield_10010",
          "customfield_10040",
          "customfield_10041",
          "customfield_10042",
          "customfield_10043",
          "customfield_10044",
        ]).not.toContain(value);
    // The plain Jira flavour keeps the issue type instead.
    const jira = createJiraAdapter("import.jira");
    const plain = await readAll(
      connection("import.jira", { export: exportJson }),
      jira,
    );
    expect(facet(byId(plain, "HELP-1"), "type")).toEqual(["Service Request"]);
    expect(lossKeys(byId(plain, "HELP-1"))).not.toContain("queue_not_imported");
    expect(lossKeys(byId(plain, "HELP-1"))).not.toContain("sla_not_imported");
  });

  it("reports SLAs, approvals, organisations, participants and queues as fixed loss codes", async () => {
    const records = await readAll();
    const one = lossKeys(byId(records, "HELP-1"));
    expect(one).toEqual(
      expect.arrayContaining([
        "sla_not_imported",
        "queue_not_imported",
        "request_participant_not_imported",
      ]),
    );
    const two = lossKeys(byId(records, "HELP-2"));
    expect(two).toEqual(
      expect.arrayContaining([
        "approval_not_imported",
        "organization_not_imported",
        "sla_not_imported",
      ]),
    );
    expect(lossKeys(byId(records, "HELP-3"))).not.toContain(
      "approval_not_imported",
    );
    for (const record of records) {
      expect(lossKeys(record)).toContain("queue_not_imported");
      for (const loss of record.losses ?? [])
        expect(loss.code).toMatch(/^[a-z][a-z0-9_]{1,63}$/u);
    }
  });

  it("keeps internal comments internal, reported apart from public ones", async () => {
    const records = await readAll();
    const visibilities = (key: string) =>
      (byId(records, key).comments ?? []).map((c) => c.visibility);
    expect(visibilities("HELP-1")).toEqual(
      expect.arrayContaining(["public", "internal"]),
    );
    // A request with only an internal note never carries a public comment.
    expect(visibilities("HELP-2")).toContain("internal");
    expect(visibilities("HELP-2")).not.toContain("public");
    const raw = exportJson.issues.find((i) => i.key === "HELP-1") as Raw;
    const normalized = normalizeIssue(raw, {
      fieldMap: {
        names: new Map(Object.entries(exportJson.names)),
      } satisfies FieldMap,
      flavor: jsmFlavor,
    });
    expect(normalized.comments.map((c) => [c.id, c.visibility])).toEqual([
      ["1", "public"],
      ["2", "internal"],
      ["3", "public"],
    ]);
    // Restricted-visibility Jira comments are internal as well.
    const restricted = normalizeIssue(
      {
        key: "X-1",
        fields: {
          summary: "s",
          comment: {
            comments: [
              {
                id: "9",
                body: "b",
                visibility: { type: "role", value: "Administrators" },
              },
            ],
            total: 1,
          },
        },
      },
      { fieldMap: { names: new Map() } },
    );
    expect(restricted.comments[0]?.visibility).toBe("internal");
  });

  it("proposes cancelled for Declined, Duplicate, Cancelled and Won't Do; completed for Done", async () => {
    const discovery = await adapter.discover(conn);
    const proposals = await adapter.proposeMapping(
      discovery,
      proposalContext(),
    );
    const group = (value: string) => {
      const entry = proposals.find(
        (p) => p.domain === "state" && p.value === value,
      );
      return entry?.target.kind === "group" ? entry.target.group : undefined;
    };
    expect(group("Closed / Declined")).toBe("cancelled");
    expect(group("Closed / Duplicate")).toBe("cancelled");
    expect(group("Canceled / Cancelled")).toBe("cancelled");
    expect(group("Closed / Won't Do")).toBe("cancelled");
    expect(group("Resolved / Done")).toBe("completed");
    expect(group("Closed / Done")).toBe("completed");
    expect(group("Open")).toBe("unstarted");
    expect(group("Waiting for support")).toBe("started");
    expect(group("Waiting for customer")).toBe("started");
    // Every state in the service desk export is covered by a proposal.
    const states = discovery.facets.filter((f) => f.domain === "state");
    expect(states.every((s) => group(s.value) !== undefined)).toBe(true);
  });

  it("covers deleted customers, hidden emails and unicode without dropping anything silently", async () => {
    const records = await readAll();
    const four = byId(records, "HELP-4");
    expect(four.sourceAuthorEmail).toBeUndefined();
    expect(lossKeys(four)).toContain("person_email_unavailable:author");
    expect(lossKeys(byId(records, "HELP-12"))).toContain(
      "person_email_unavailable:author",
    );
    expect(byId(records, "HELP-10").title).toBe(
      "Wi-Fi drops in meeting room Müller-Straße",
    );
    expect(byId(records, "HELP-10").description).toContain("会議室");
    expect(
      records.some((r) => r.title === "Réinitialisation du mot de passe"),
    ).toBe(true);
    // Wiki-markup description on a problem record is flagged, text preserved.
    expect(lossKeys(byId(records, "HELP-5"))).toContain(
      "rich_text_lossy:description",
    );
    expect(byId(records, "HELP-5").description).toContain("nightly report job");
  });

  it("discovers a bounded, consistent set of facets", async () => {
    const discovery = await adapter.discover(conn);
    expect(discovery.totalRecords).toBe(32);
    expect(
      discovery.facets.filter((f) => f.domain === "type").length,
    ).toBeGreaterThanOrEqual(6);
    const total = discovery.facets
      .filter((f) => f.domain === "state")
      .reduce((sum, f) => sum + f.count, 0);
    expect(total).toBe(32);
  });
});
