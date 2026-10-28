import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildJql,
  createGuardedJiraTransport,
  createJiraAdapter,
  type JiraAdapterDeps,
} from "../../../../apps/api/src/imports/adapters/jira";
import { adfToText } from "../../../../apps/api/src/imports/adapters/jira/adf";
import { JiraClient } from "../../../../apps/api/src/imports/adapters/jira/client";
import {
  JiraSourceError,
  parseExport,
} from "../../../../apps/api/src/imports/adapters/jira/export-source";
import type {
  ImportSourceAdapter,
  SourceRecord,
} from "../../../../apps/api/src/imports/engine/adapter";
import {
  connection,
  loadFixture,
  noSleep,
  proposalContext,
  recordedTransport,
  TEST_CREDENTIAL,
  TEST_TOKEN,
} from "./jira-support";

const exportJson = loadFixture<{ issues: unknown[] }>("jira/export.json");
const exportConn = connection("import.jira", { export: exportJson });
const LOSS_CODE = /^[a-z][a-z0-9_]{1,63}$/u;

async function readAll(
  adapter: ImportSourceAdapter,
  conn: ReturnType<typeof connection>,
  pageSize: number,
) {
  const records: SourceRecord[] = [];
  const cursors: Array<string | null> = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 100; guard += 1) {
    cursors.push(cursor);
    const page = await adapter.readPage(conn, cursor, pageSize);
    records.push(...page.records);
    if (page.nextCursor === null) return { records, cursors };
    cursor = page.nextCursor;
  }
  throw new Error("pagination did not terminate");
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

describe("jira adapter: export mode normalisation", () => {
  const adapter = createJiraAdapter("import.jira");
  let records: SourceRecord[] = [];
  beforeAll(async () => {
    records = (await readAll(adapter, exportConn, 100)).records;
  });

  it("reads every unique issue once, collapses duplicate rows and orders parents first", () => {
    expect(records).toHaveLength(32);
    expect(new Set(records.map((r) => r.sourceId)).size).toBe(32);
    const nine = byId(records, "ACME-9");
    expect(nine.title).toBe("Add rate limiting to reset endpoint");
    expect(lossKeys(nine)).toContain("duplicate_row_collapsed");
    const ids = records.map((r) => r.sourceId);
    // ACME-10 is listed first in the file but its parent comes before it.
    expect(ids.indexOf("ACME-4")).toBeLessThan(ids.indexOf("ACME-10"));
    expect(ids.indexOf("ACME-1")).toBeLessThan(ids.indexOf("ACME-4"));
    expect(records.every((r) => r.sourceType === "issue")).toBe(true);
  });

  it("builds a site browse URL from the export and keeps it https without credentials", () => {
    expect(byId(records, "ACME-4").sourceUrl).toBe(
      "https://acme-fixture.atlassian.net/browse/ACME-4",
    );
  });

  it("emits type, state, priority, label (labels and components), cycle and custom-field facets", () => {
    const four = byId(records, "ACME-4");
    expect(facet(four, "type")).toEqual(["Story"]);
    expect(facet(four, "state")).toEqual(["In Progress"]);
    expect(facet(four, "priority")).toEqual(["High"]);
    expect(facet(four, "label").sort()).toEqual([
      "Auth",
      "Web",
      "security",
      "ux",
    ]);
    // The active sprint wins; the earlier one is reported, not silently dropped.
    expect(facet(four, "cycle")).toEqual(["Sprint 3 — Überholung 🚀"]);
    expect(lossKeys(four)).toContain("sprint_history_not_imported");
    // Epic link, sprint, start date and rank are not plain custom fields.
    expect(facet(four, "custom_field").sort()).toEqual([
      "customfield_10016",
      "customfield_10031",
      "customfield_10033",
    ]);
  });

  it("splits completed from cancelled by resolution inside the Done category", () => {
    expect(facet(byId(records, "ACME-8"), "state")).toEqual(["Done / Done"]);
    expect(facet(byId(records, "ACME-14"), "state")).toEqual([
      "Closed / Won't Do",
    ]);
    expect(facet(byId(records, "ACME-15"), "state")).toEqual([
      "Closed / Duplicate",
    ]);
    expect(facet(byId(records, "ACME-17"), "state")).toEqual([
      "Canceled / Cancelled",
    ]);
    expect(facet(byId(records, "ACME-9"), "state")).toEqual([
      "Selected for Development",
    ]);
  });

  it("maps reporter and assignee to person fields and preserves the created timestamp", () => {
    const four = byId(records, "ACME-4");
    expect(four.assigneeEmail).toBe("bao.nguyen@acme.example.test");
    expect(four.sourceAuthorEmail).toBe("ana.ferreira@acme.example.test");
    expect(four.sourceCreatedAt).toBe("2025-01-06T08:15:30.123Z");
    expect(four.startDate).toBe("2025-01-13T00:00:00.000Z");
    expect(four.dueDate).toBe("2025-02-14T00:00:00.000Z");
  });

  it("reports deleted and hidden-email users as losses instead of dropping them", () => {
    const twenty = byId(records, "ACME-20");
    expect(twenty.sourceAuthorEmail).toBeUndefined();
    expect(lossKeys(twenty)).toContain("person_email_unavailable:author");
    const twentyOne = byId(records, "ACME-21");
    expect(twentyOne.assigneeEmail).toBeUndefined();
    expect(lossKeys(twentyOne)).toEqual(
      expect.arrayContaining([
        "person_email_unavailable:assignee",
        "person_email_unavailable:author",
      ]),
    );
  });

  it("keeps parent references (sub-tasks, epic link, parent outside the export)", () => {
    expect(byId(records, "ACME-10").parentSourceId).toBe("ACME-4");
    expect(byId(records, "ACME-4").parentSourceId).toBe("ACME-1");
    expect(byId(records, "ACME-32").parentSourceId).toBe("OTHER-77");
    expect(byId(records, "ACME-1").parentSourceId).toBeUndefined();
  });

  it("reports everything the record contract cannot carry as fixed loss codes", () => {
    const four = lossKeys(byId(records, "ACME-4"));
    expect(four).toEqual(
      expect.arrayContaining([
        "worklog_not_imported",
        "version_not_imported",
        "time_estimate_not_imported",
        "watcher_not_imported",
      ]),
    );
    // Record v2: comments, attachments, links, history and custom field values travel on the record.
    const rich = byId(records, "ACME-4");
    expect(rich.comments?.length).toBeGreaterThan(0);
    expect(rich.attachments?.length).toBeGreaterThan(0);
    expect(rich.relations?.length).toBeGreaterThan(0);
    expect(rich.history?.length).toBeGreaterThan(0);
    expect(rich.customFields?.length).toBeGreaterThan(0);
    for (const gone of [
      "comment_not_imported:public",
      "attachment_not_imported",
      "link_not_imported",
      "changelog_not_imported",
      "custom_field_value_not_carried",
    ])
      expect(four).not.toContain(gone);
    expect(lossKeys(byId(records, "ACME-22"))).toContain(
      "security_level_not_imported",
    );
    expect(lossKeys(byId(records, "ACME-23"))).toContain("comment_truncated");
    expect(lossKeys(byId(records, "ACME-5"))).toContain(
      "rich_text_lossy:description",
    );
    expect(lossKeys(byId(records, "ACME-6"))).toContain(
      "rich_text_lossy:description",
    );
    expect(lossKeys(byId(records, "ACME-25"))).toContain(
      "timestamp_invalid:created",
    );
    expect(byId(records, "ACME-25").sourceCreatedAt).toBeUndefined();
    expect(lossKeys(byId(records, "ACME-26"))).toContain("title_missing");
    expect(byId(records, "ACME-26").title).toBe("ACME-26");
    for (const record of records)
      for (const loss of record.losses ?? []) {
        expect(loss.code).toMatch(LOSS_CODE);
        if (loss.detailCode) expect(loss.detailCode).toMatch(LOSS_CODE);
      }
  });

  it("preserves unicode, emoji and right-to-left text", () => {
    const twenty = byId(records, "ACME-20");
    expect(twenty.title).toBe("Ünïcödé テスト — العربية \u{1F600} title");
    expect(twenty.description).toContain("مرحبا بالعالم");
    expect(twenty.description).toContain("SELECT * FROM straße;");
    expect(facet(twenty, "label")).toContain("ünï");
    expect(byId(records, "ACME-7").description).toContain("東京");
  });

  it("converts ADF structure to readable text", () => {
    expect(byId(records, "ACME-4").description).toBe(
      "Goal\n\nLet customers reset their own password. See the spec (https://docs.acme.example.test/spec)\n\n- Email link expires in 30 minutes\n- Rate limited",
    );
    expect(byId(records, "ACME-27").description).toBe(
      "Status [READY] and @Ana Ferreira",
    );
  });

  it("never carries a credential, token or private URL in any record", () => {
    const text = JSON.stringify(records);
    expect(text).not.toContain("ATATT");
    expect(text).not.toMatch(/authorization/iu);
  });
});

describe("jira adapter: discovery and mapping proposals", () => {
  const adapter = createJiraAdapter("import.jira");
  it("counts records per facet once per record, lower-cases people and labels states with their category", async () => {
    const discovery = await adapter.discover(exportConn);
    expect(discovery.totalRecords).toBe(32);
    expect(discovery.counts).toEqual({ issue: 32 });
    const find = (domain: string, value: string) =>
      discovery.facets.find((f) => f.domain === domain && f.value === value);
    expect(find("state", "Closed / Won't Do")).toMatchObject({
      count: 1,
      label: "Done · Won't Do",
    });
    expect(find("state", "In Progress")?.label).toBe("In Progress");
    expect(
      find("person", "bao.nguyen@acme.example.test")?.count,
    ).toBeGreaterThan(1);
    expect(
      discovery.facets.filter(
        (f) => f.domain === "person" && f.value !== f.value.toLowerCase(),
      ),
    ).toEqual([]);
    expect(find("custom_field", "customfield_10031")?.label).toBe(
      "Customer impact",
    );
    expect(find("cycle", "ACME Sprint 2")?.count).toBeGreaterThan(0);
  });

  it("proposes state groups from category and resolution; cancelled is never completed", async () => {
    const discovery = await adapter.discover(exportConn);
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
    expect(group("Done / Done")).toBe("completed");
    expect(group("Closed / Won't Do")).toBe("cancelled");
    expect(group("Closed / Duplicate")).toBe("cancelled");
    expect(group("Canceled / Cancelled")).toBe("cancelled");
    expect(group("Done / Won't Do")).toBe("cancelled");
    expect(group("In Progress")).toBe("started");
    expect(group("In Review")).toBe("started");
    expect(group("To Do")).toBe("unstarted");
    expect(group("Selected for Development")).toBe("unstarted");
    expect(group("Backlog")).toBe("backlog");
    // A status whose category is unknown is never guessed.
    const unknown = await adapter.proposeMapping(
      {
        facets: [{ domain: "state", value: "Mystery", count: 1 }],
        counts: {},
        totalRecords: 1,
      },
      proposalContext(),
    );
    expect(unknown).toEqual([]);
  });

  it("proposes priorities, types by key and people by email (placeholder when unmatched)", async () => {
    const discovery = await adapter.discover(exportConn);
    const proposals = await adapter.proposeMapping(
      discovery,
      proposalContext({
        types: { story: "t-story", "sub-task": "t-sub", bug: "t-bug" },
        people: { "ana.ferreira@acme.example.test": "p-ana" },
      }),
    );
    const find = (domain: string, value: string) =>
      proposals.find((p) => p.domain === domain && p.value === value)?.target;
    expect(find("priority", "Highest")).toEqual({
      kind: "priority",
      value: "urgent",
    });
    expect(find("priority", "Lowest")).toEqual({
      kind: "priority",
      value: "low",
    });
    expect(find("priority", "Medium")).toEqual({
      kind: "priority",
      value: "medium",
    });
    expect(find("type", "Story")).toEqual({ kind: "target", id: "t-story" });
    expect(find("type", "Sub-task")).toEqual({ kind: "target", id: "t-sub" });
    expect(find("type", "Epic")).toBeUndefined();
    expect(find("person", "ana.ferreira@acme.example.test")).toEqual({
      kind: "target",
      id: "p-ana",
    });
    expect(find("person", "bao.nguyen@acme.example.test")).toEqual({
      kind: "placeholder",
    });
    // Labels, cycles and custom fields are the operator's call.
    expect(
      proposals.some((p) =>
        ["label", "cycle", "custom_field"].includes(p.domain),
      ),
    ).toBe(false);
  });
});

describe("jira adapter: export mode paging, limits and connect", () => {
  const adapter = createJiraAdapter("import.jira");

  it("pages with a stable cursor and the same pages every time", async () => {
    const first = await readAll(adapter, exportConn, 10);
    const second = await readAll(adapter, exportConn, 10);
    expect(first.cursors).toEqual([null, "10", "20", "30"]);
    expect(first.records.map((r) => r.sourceId)).toEqual(
      second.records.map((r) => r.sourceId),
    );
    const whole = await readAll(adapter, exportConn, 100);
    expect(first.records.map((r) => r.sourceId)).toEqual(
      whole.records.map((r) => r.sourceId),
    );
    expect(
      (await adapter.readPage(exportConn, "30", 10)).nextCursor,
    ).toBeNull();
  });

  it("rejects an invalid cursor", async () => {
    await expect(adapter.readPage(exportConn, "abc", 10)).rejects.toThrow(
      "jira_cursor_invalid",
    );
    await expect(adapter.readPage(exportConn, "9999", 10)).rejects.toThrow(
      "jira_cursor_invalid",
    );
  });

  it("connects to a valid export and refuses a malformed or oversized one", async () => {
    expect(await adapter.connect(exportConn)).toMatchObject({ ok: true });
    expect(
      await adapter.connect(
        connection("import.jira", { export: { issues: [{ fields: {} }] } }),
      ),
    ).toMatchObject({ ok: false });
    expect(
      await adapter.connect(connection("import.jira", { export: "nope" })),
    ).toMatchObject({ ok: false });
    expect(await adapter.connect(connection("import.jira", {}))).toMatchObject({
      ok: false,
    });
    const big = {
      issues: [{ key: "A-1", fields: { summary: "x".repeat(8_100_000) } }],
    };
    expect(
      await adapter.connect(connection("import.jira", { export: big })),
    ).toMatchObject({ ok: false });
    await expect(
      adapter.discover(connection("import.jira", { export: big })),
    ).rejects.toThrow("jira_export_too_large");
  });

  it("accepts a bare array and a projects wrapper, and a stored file through the loader", async () => {
    const issues = exportJson.issues;
    expect(parseExport(issues).issues).toHaveLength(32);
    expect(parseExport({ projects: [{ issues }] }).issues).toHaveLength(32);
    expect(() => parseExport({ nothing: true })).toThrow(JiraSourceError);
    const loaded: string[] = [];
    const stored = createJiraAdapter("import.jira", {
      loadExportFile: async (ref) => {
        loaded.push(ref);
        return ref === "file-1" ? exportJson : null;
      },
    });
    const ok = connection("import.jira", { exportFile: "file-1" });
    expect(await stored.connect(ok)).toMatchObject({ ok: true });
    expect((await stored.readPage(ok, null, 5)).records).toHaveLength(5);
    expect(loaded).toContain("file-1");
    expect(
      await stored.connect(connection("import.jira", { exportFile: "gone" })),
    ).toMatchObject({ ok: false });
    // No loader configured: a stored file is unavailable, never a silent empty import.
    expect(await adapter.connect(ok)).toMatchObject({ ok: false });
  });
});

describe("jira adapter: ADF conversion", () => {
  it("renders lists, ordered lists, code, quotes and breaks; flags tables, media and unknown nodes", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { order: 3 },
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "three" }],
                },
              ],
            },
          ],
        },
        {
          type: "blockquote",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "quoted" }] },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a" },
            { type: "hardBreak" },
            { type: "text", text: "b" },
          ],
        },
      ],
    };
    expect(adfToText(doc)).toEqual({
      text: "3. three\n\n> quoted\n\na\nb",
      lossy: false,
    });
    expect(
      adfToText({
        type: "doc",
        content: [
          { type: "fancyWidget", content: [{ type: "text", text: "kept" }] },
        ],
      }),
    ).toEqual({ text: "kept", lossy: true });
    expect(
      adfToText({
        type: "doc",
        content: [{ type: "mediaSingle", content: [] }],
      }).lossy,
    ).toBe(true);
    expect(adfToText(null)).toEqual({ text: "", lossy: false });
  });
});

describe("jira adapter: REST mode (recorded fixture responses only)", () => {
  const config = {
    mode: "rest",
    baseUrl: "https://acme-fixture.atlassian.net",
    projectKey: "ACME",
  };
  const rest = (deps: JiraAdapterDeps) =>
    createJiraAdapter("import.jira", deps);

  it("connects with the credential and returns only safe facts", async () => {
    const { transport, calls } = recordedTransport();
    const adapter = rest({ transport, sleep: noSleep });
    const result = await adapter.connect(
      connection("import.jira", config, TEST_CREDENTIAL),
    );
    expect(result).toEqual({ ok: true, label: "acme-fixture.atlassian.net" });
    expect(JSON.stringify(result)).not.toContain(TEST_TOKEN);
    expect(calls.map((c) => c.url.pathname)).toEqual(["/rest/api/3/myself"]);
    expect(calls[0]?.authorized).toBe(true);
  });

  it("refuses a missing, malformed or wrong credential", async () => {
    const { transport } = recordedTransport();
    const adapter = rest({ transport, sleep: noSleep });
    expect(
      await adapter.connect(connection("import.jira", config, null)),
    ).toMatchObject({ ok: false });
    expect(
      await adapter.connect(connection("import.jira", config, "no-email-here")),
    ).toMatchObject({ ok: false });
    expect(
      await adapter.connect(
        connection("import.jira", config, `${TEST_CREDENTIAL}x`),
      ),
    ).toMatchObject({ ok: false });
    // Bare token plus config email, and the JSON form, are both accepted.
    expect(
      await adapter.connect(
        connection(
          "import.jira",
          { ...config, email: "migration.bot@acme.example.test" },
          TEST_TOKEN,
        ),
      ),
    ).toMatchObject({ ok: true });
    expect(
      await adapter.connect(
        connection(
          "import.jira",
          config,
          JSON.stringify({
            email: "migration.bot@acme.example.test",
            apiToken: TEST_TOKEN,
          }),
        ),
      ),
    ).toMatchObject({ ok: true });
  });

  it("pages through search/jql with the cursor and never issues anything but GET", async () => {
    const { transport, calls } = recordedTransport();
    const adapter = rest({ transport, sleep: noSleep });
    const conn = connection("import.jira", config, TEST_CREDENTIAL);
    const { records, cursors } = await readAll(adapter, conn, 100);
    expect(cursors).toEqual([null, "tok-page-2", "tok-page-3"]);
    expect(records).toHaveLength(32);
    const searches = calls.filter(
      (c) => c.url.pathname === "/rest/api/3/search/jql",
    );
    expect(
      searches.map((c) => c.url.searchParams.get("nextPageToken")),
    ).toEqual([null, "tok-page-2", "tok-page-3"]);
    for (const call of searches) {
      expect(call.url.searchParams.get("jql")).toBe(
        'project = "ACME" ORDER BY created ASC, key ASC',
      );
      expect(call.url.searchParams.get("maxResults")).toBe("100");
      expect(call.url.searchParams.get("expand")).toBe("names,changelog");
      expect(call.url.protocol).toBe("https:");
      expect(call.authorized).toBe(true);
    }
    // The transport type exposes no method: reads are GET by construction.
    expect(calls.every((c) => c.keys.every((k) => k !== "content-type"))).toBe(
      true,
    );
  });

  it("produces the same records and facets as the export of the same issues", async () => {
    const { transport } = recordedTransport();
    const adapter = rest({ transport, sleep: noSleep });
    const conn = connection("import.jira", config, TEST_CREDENTIAL);
    const viaRest = (await readAll(adapter, conn, 100)).records;
    const viaExport = (
      await readAll(createJiraAdapter("import.jira"), exportConn, 100)
    ).records;
    const strip = (r: SourceRecord) => ({
      ...r,
      losses: undefined,
      sourceUrl: undefined,
    });
    const sorted = (list: SourceRecord[]) =>
      [...list].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
    expect(sorted(viaRest).map(strip)).toEqual(sorted(viaExport).map(strip));
    const discoveryRest = await adapter.discover(conn);
    const discoveryExport =
      await createJiraAdapter("import.jira").discover(exportConn);
    const key = (d: typeof discoveryRest) =>
      d.facets.map((f) => `${f.domain}|${f.value}|${f.count}`).sort();
    expect(key(discoveryRest)).toEqual(key(discoveryExport));
    expect(discoveryRest.totalRecords).toBe(32);
  });

  it("honours Retry-After on 429, bounded, then recovers", async () => {
    const sleeps: number[] = [];
    const { transport, calls } = recordedTransport({
      rateLimit: { token: "tok-page-2", times: 2, retryAfter: "3" },
    });
    const adapter = rest({
      transport,
      sleep: async (ms) => void sleeps.push(ms),
    });
    const conn = connection("import.jira", config, TEST_CREDENTIAL);
    const page = await adapter.readPage(conn, "tok-page-2", 100);
    expect(page.nextCursor).toBe("tok-page-3");
    expect(sleeps).toEqual([3000, 3000]);
    expect(
      calls.filter(
        (c) => c.url.searchParams.get("nextPageToken") === "tok-page-2",
      ),
    ).toHaveLength(3);
  });

  it("gives up with a fixed code when the source keeps limiting, or asks for too long a wait", async () => {
    const sleeps: number[] = [];
    const { transport } = recordedTransport({
      rateLimit: { token: "first", times: 99, retryAfter: "1" },
    });
    const adapter = rest({
      transport,
      sleep: async (ms) => void sleeps.push(ms),
    });
    const conn = connection("import.jira", config, TEST_CREDENTIAL);
    await expect(adapter.readPage(conn, null, 100)).rejects.toThrow(
      "jira_rate_limited",
    );
    expect(sleeps).toHaveLength(4);
    const tooLong = recordedTransport({
      rateLimit: { token: "first", times: 99, retryAfter: "86400" },
    });
    const waiting = rest({ transport: tooLong.transport, sleep: noSleep });
    await expect(waiting.readPage(conn, null, 100)).rejects.toThrow(
      "jira_rate_limited",
    );
  });

  it("eases off when the source signals a nearly exhausted budget", async () => {
    const sleeps: number[] = [];
    const { transport } = recordedTransport({ nearLimit: true });
    const adapter = rest({
      transport,
      sleep: async (ms) => void sleeps.push(ms),
    });
    await adapter.readPage(
      connection("import.jira", config, TEST_CREDENTIAL),
      null,
      100,
    );
    expect(sleeps).toEqual([1000]);
  });

  it("maps source failures to fixed codes without leaking the credential", async () => {
    const conn = connection("import.jira", config, TEST_CREDENTIAL);
    for (const [status, code] of [
      [401, "jira_unauthorized"],
      [403, "jira_forbidden"],
      [404, "jira_not_found"],
      [500, "jira_http_error"],
      [302, "jira_redirect_refused"],
    ] as const) {
      const { transport } = recordedTransport({ searchStatus: status });
      const adapter = rest({ transport, sleep: noSleep });
      const error = await adapter
        .readPage(conn, null, 100)
        .catch((e: Error) => e);
      expect(error).toBeInstanceOf(JiraSourceError);
      expect((error as Error).message).toBe(code);
      expect(JSON.stringify(error)).not.toContain(TEST_TOKEN);
    }
    const garbage = rest({
      transport: async () => ({ status: 200, headers: {}, body: "<html>" }),
      sleep: noSleep,
    });
    await expect(garbage.readPage(conn, null, 100)).rejects.toThrow(
      "jira_invalid_response",
    );
  });

  it("validates the connection config: https base URL without credentials, project key, JQL filter", async () => {
    const { transport } = recordedTransport();
    const adapter = rest({ transport, sleep: noSleep });
    const bad = [
      { ...config, baseUrl: "http://acme-fixture.atlassian.net" },
      { ...config, baseUrl: "https://user:pw@acme-fixture.atlassian.net" },
      { ...config, baseUrl: "https://acme-fixture.atlassian.net/?x=1" },
      { ...config, baseUrl: "not a url" },
      { ...config, projectKey: 'ACME" OR 1=1' },
      { ...config, projectKey: undefined },
      { ...config, jqlFilter: "status = Done ORDER BY created" },
    ];
    for (const entry of bad)
      expect(
        await adapter.connect(
          connection("import.jira", entry, TEST_CREDENTIAL),
        ),
      ).toMatchObject({ ok: false });
    expect(
      buildJql({
        kind: "rest",
        baseUrl: new URL("https://x.test"),
        siteUrl: "https://x.test",
        projectKey: "ACME",
        jqlFilter: "labels = a",
      }),
    ).toBe('project = "ACME" AND (labels = a) ORDER BY created ASC, key ASC');
  });

  it("supports a gateway base path", async () => {
    const urls: string[] = [];
    const client = new JiraClient({
      baseUrl: new URL("https://api.atlassian.com/ex/jira/cloud-id-1/"),
      credentials: { email: "a@b.test", token: "t" },
      transport: async (request) => {
        urls.push(request.url);
        return { status: 200, headers: {}, body: "{}" };
      },
    });
    await client.getJson("/rest/api/3/myself");
    expect(urls).toEqual([
      "https://api.atlassian.com/ex/jira/cloud-id-1/rest/api/3/myself",
    ]);
  });
});

describe("jira adapter: guarded egress", () => {
  it("never reaches private, loopback, metadata or non-https destinations, whatever NODE_ENV says", async () => {
    const transport = createGuardedJiraTransport({
      resolver: async (host) =>
        host === "rebind.example.test"
          ? [{ address: "10.0.0.5", family: 4 }]
          : [{ address: "93.184.216.34", family: 4 }],
    });
    const request = (url: string) =>
      transport({ url, headers: {}, timeoutMs: 1000 });
    for (const url of [
      "http://acme.atlassian.net/",
      "https://127.0.0.1/",
      "https://localhost/",
      "https://169.254.169.254/latest/meta-data/",
      "https://10.1.2.3/",
      "https://[::1]/",
      "https://rebind.example.test/",
      "https://user:pw@acme.atlassian.net/",
    ])
      await expect(request(url)).rejects.toMatchObject({
        code: "jira_destination_refused",
      });
  });

  describe("against a local test server (guard relaxed for the test only)", () => {
    let server: http.Server;
    let base = "";
    const seen: Array<{ method?: string; auth?: string }> = [];
    beforeAll(async () => {
      server = http.createServer((request, response) => {
        seen.push({
          method: request.method,
          auth: request.headers.authorization,
        });
        if (request.url === "/ok") {
          response.setHeader("content-type", "application/json");
          response.end('{"ok":true}');
        } else if (request.url === "/redirect") {
          response.statusCode = 302;
          response.setHeader("location", "/ok");
          response.end();
        } else if (request.url === "/big") {
          response.end("x".repeat(5000));
        } else if (request.url === "/hang") {
          response.write("x");
        }
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    });
    const dev = { NODE_ENV: "development" };

    it("issues GET only, sends the authorization header and does not follow redirects", async () => {
      const transport = createGuardedJiraTransport({
        guardEnv: dev,
        maxBytes: 100,
      });
      const ok = await transport({
        url: `${base}/ok`,
        headers: { authorization: "Basic abc" },
        timeoutMs: 2000,
      });
      expect(ok).toMatchObject({ status: 200, body: '{"ok":true}' });
      const redirect = await transport({
        url: `${base}/redirect`,
        headers: {},
        timeoutMs: 2000,
      });
      expect(redirect.status).toBe(302);
      expect(seen.every((s) => s.method === "GET")).toBe(true);
      expect(seen[0]?.auth).toBe("Basic abc");
      // The client turns a redirect into a fixed code rather than following it.
      const client = new JiraClient({
        baseUrl: new URL("https://placeholder.test"),
        credentials: { email: "a@b.test", token: "t" },
        transport: async (r) =>
          transport({
            ...r,
            url: r.url
              .replace("https://placeholder.test", base)
              .replace("/rest/api/3/myself", "/redirect"),
          }),
      });
      await expect(client.getJson("/rest/api/3/myself")).rejects.toThrow(
        "jira_redirect_refused",
      );
    });

    it("caps the response size and enforces the timeout", async () => {
      const transport = createGuardedJiraTransport({
        guardEnv: dev,
        maxBytes: 100,
      });
      await expect(
        transport({ url: `${base}/big`, headers: {}, timeoutMs: 2000 }),
      ).rejects.toMatchObject({ code: "jira_response_too_large" });
      await expect(
        transport({ url: `${base}/hang`, headers: {}, timeoutMs: 150 }),
      ).rejects.toMatchObject({ code: "jira_timeout" });
    });
  });
});
