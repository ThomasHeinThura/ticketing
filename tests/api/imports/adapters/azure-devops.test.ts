import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createAzureDevOpsAdapter } from "../../../../apps/api/src/imports/adapters/azure-devops";
import {
  csvRecords,
  parseCsv,
} from "../../../../apps/api/src/imports/adapters/azure-devops/csv";
import {
  createGuardedTransport,
  htmlToText,
  SourceHttpError,
} from "../../../../apps/api/src/imports/adapters/azure-devops/http";
import {
  ADO_CSV_STATE_PROPOSALS,
  proposeStateGroup,
} from "../../../../apps/api/src/imports/adapters/azure-devops/mapping";
import type {
  AdapterConnection,
  ProposalContext,
  SourceRecord,
} from "../../../../apps/api/src/imports/engine/adapter";
import {
  applyMappingEdits,
  completeness,
  mergeDiscovery,
} from "../../../../apps/api/src/imports/engine/mapping";
import {
  ADO_FIXTURE_PAT,
  type AdoFixtureItem,
  adoCsvText,
  adoItems,
  createAdoReplay,
} from "../../../fixtures/imports/azure-devops/replay";

const connection = (
  config: Record<string, unknown> = { organization: "contoso" },
  credential: string | null = ADO_FIXTURE_PAT,
): AdapterConnection => ({
  pluginId: "import.azure-devops",
  config,
  credential,
  readOnly: true,
});
const context: ProposalContext = {
  workspaceId: "w",
  projectId: "p",
  peopleByEmail: new Map([["alice.nguyen@contoso.example", "person-alice"]]),
  typeIdsByKey: new Map([
    ["bug", "type-bug"],
    ["story", "type-story"],
    ["epic", "type-epic"],
  ]),
};
const LOSS = /^[a-z][a-z0-9_]{1,63}$/u;

async function readAll(
  adapter: ReturnType<typeof createAzureDevOpsAdapter>,
  conn: AdapterConnection,
  size: number,
) {
  const pages: Array<{ cursor: string | null; ids: string[] }> = [];
  const records: SourceRecord[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 100; guard += 1) {
    const page = await adapter.readPage(conn, cursor, size);
    pages.push({ cursor, ids: page.records.map((r) => r.sourceId) });
    records.push(...(page.records as SourceRecord[]));
    if (page.nextCursor === null) return { pages, records };
    cursor = page.nextCursor;
  }
  throw new Error("pagination did not terminate");
}

describe("azure devops adapter: discovery and mapping proposals (recorded fixtures)", () => {
  it("discovers the organisation: counts per type, process-scoped states, tags, areas, iterations", async () => {
    const replay = createAdoReplay();
    const adapter = createAzureDevOpsAdapter({ transport: replay.transport });
    expect(await adapter.connect(connection())).toMatchObject({ ok: true });
    const discovery = await adapter.discover(connection());
    const all = [
      "contoso-web",
      "platform-ops",
      "legacy-erp",
      "intranet",
    ].flatMap(adoItems);
    expect(discovery.totalRecords).toBe(all.length);
    expect(discovery.counts).toEqual({ work_item: all.length });
    const facet = (domain: string, value: string) =>
      discovery.facets.find((f) => f.domain === domain && f.value === value);
    // states are namespaced by process so each process maps separately
    expect(facet("state", "Agile/Resolved")?.count).toBe(3);
    expect(facet("state", "CMMI/Resolved")?.count).toBe(2);
    expect(facet("state", "Scrum/Open")).toBeDefined();
    expect(facet("state", "Basic/Doing")).toBeDefined();
    expect(facet("state", "Resolved")).toBeUndefined();
    expect(facet("type", "Product Backlog Item")).toBeDefined();
    expect(facet("label", "payments")).toBeDefined();
    expect(facet("module", "Contoso Web\\Frontend\\Checkout")).toBeDefined();
    expect(facet("cycle", "Contoso Web\\Sprint 12")).toBeDefined();
    expect(facet("custom_field", "Severity")).toBeDefined();
    expect(facet("custom_field", "Custom.CustomerImpact")).toBeDefined();
    expect(facet("person", "alice.nguyen@contoso.example")).toBeDefined();
  });

  it("proposes states per process; Resolved and unknown states get no proposal; Removed is cancelled", async () => {
    const adapter = createAzureDevOpsAdapter({
      transport: createAdoReplay().transport,
    });
    const discovery = await adapter.discover(connection());
    const proposals = await adapter.proposeMapping(discovery, context);
    const state = (value: string) =>
      proposals.find((p) => p.domain === "state" && p.value === value)?.target;
    const group = (g: string) => ({ kind: "group", group: g });
    expect(state("Agile/New")).toEqual(group("unstarted"));
    expect(state("Agile/Active")).toEqual(group("started"));
    expect(state("Agile/Closed")).toEqual(group("completed"));
    expect(state("Agile/Removed")).toEqual(group("cancelled"));
    expect(state("Scrum/Committed")).toEqual(group("started"));
    expect(state("Scrum/Done")).toEqual(group("completed"));
    expect(state("Scrum/To Do")).toEqual(group("unstarted"));
    expect(state("Scrum/Removed")).toEqual(group("cancelled"));
    expect(state("CMMI/Proposed")).toEqual(group("unstarted"));
    expect(state("CMMI/Active")).toEqual(group("started"));
    expect(state("CMMI/Closed")).toEqual(group("completed"));
    expect(state("CMMI/Removed")).toEqual(group("cancelled"));
    expect(state("Basic/To Do")).toEqual(group("unstarted"));
    expect(state("Basic/Doing")).toEqual(group("started"));
    expect(state("Basic/Done")).toEqual(group("completed"));
    // never guessed: Resolved is a human decision in every process; a Scrum impediment state
    // is not in any table
    expect(state("Agile/Resolved")).toBeUndefined();
    expect(state("CMMI/Resolved")).toBeUndefined();
    expect(state("Scrum/Open")).toBeUndefined();
    expect(proposeStateGroup("Agile/Resolved")).toBeNull();
    expect(proposeStateGroup("Custom Process/Active")).toBeNull();
    // Removed is never completed
    for (const proposal of proposals)
      if (proposal.domain === "state" && proposal.value.endsWith("/Removed"))
        expect(proposal.target).toEqual(group("cancelled"));
    // priority 1..4, people, types
    const prio = (value: string) =>
      proposals.find((p) => p.domain === "priority" && p.value === value)
        ?.target;
    expect(prio("1")).toEqual({ kind: "priority", value: "urgent" });
    expect(prio("2")).toEqual({ kind: "priority", value: "high" });
    expect(prio("3")).toEqual({ kind: "priority", value: "medium" });
    expect(prio("4")).toEqual({ kind: "priority", value: "low" });
    const person = (value: string) =>
      proposals.find((p) => p.domain === "person" && p.value === value)?.target;
    expect(person("alice.nguyen@contoso.example")).toEqual({
      kind: "target",
      id: "person-alice",
    });
    expect(person("bob.carter@contoso.example")).toEqual({
      kind: "placeholder",
    });
    expect(
      proposals.find((p) => p.domain === "type" && p.value === "User Story")
        ?.target,
    ).toEqual({ kind: "target", id: "type-story" });
    expect(
      proposals.find((p) => p.domain === "type" && p.value === "Task"),
    ).toBeUndefined();
    // area paths, iterations, labels and custom fields have no destination ids to propose
    expect(
      proposals.some((p) =>
        ["module", "cycle", "label", "custom_field"].includes(p.domain),
      ),
    ).toBe(false);
  });

  it("Resolved stays unconfirmed: a one-click confirm-all still blocks the run on it", async () => {
    const adapter = createAzureDevOpsAdapter({
      transport: createAdoReplay().transport,
    });
    const discovery = await adapter.discover(connection());
    const proposals = await adapter.proposeMapping(discovery, context);
    const merged = mergeDiscovery([], discovery.facets, proposals);
    const resolved = merged.find((e) => e.value === "Agile/Resolved");
    expect(resolved).toMatchObject({
      status: "unmapped",
      target: null,
      affected: 3,
    });
    const confirmed = applyMappingEdits(merged, [], true);
    if (!confirmed.ok) throw new Error("confirm failed");
    const state = completeness(confirmed.entries);
    expect(state.complete).toBe(false);
    expect(
      confirmed.entries.find((e) => e.value === "Agile/Resolved")?.status,
    ).not.toBe("confirmed");
    expect(
      state.blocking.some(
        (b) =>
          b.domain === "state" &&
          b.value === "Agile/Resolved" &&
          b.affected === 3,
      ),
    ).toBe(true);
    // only an explicit person choice resolves it, and Removed became cancelled on confirm-all
    const removed = confirmed.entries.find((e) => e.value === "Agile/Removed");
    expect(removed).toMatchObject({
      status: "confirmed",
      target: { kind: "group", group: "cancelled" },
    });
    const decided = applyMappingEdits(
      confirmed.entries,
      [
        {
          domain: "state",
          value: "Agile/Resolved",
          target: { kind: "group", group: "started" },
        },
      ],
      false,
    );
    if (!decided.ok) throw new Error("edit failed");
    expect(
      decided.entries.find((e) => e.value === "Agile/Resolved")?.status,
    ).toBe("confirmed");
  });
});

describe("azure devops adapter: reading (keyset cursor, content, losses)", () => {
  it("reads every item once, ascending, across projects, with a keyset cursor", async () => {
    const replay = createAdoReplay();
    const adapter = createAzureDevOpsAdapter({
      transport: replay.transport,
      chunkSize: 7,
    });
    expect(adapter.chunkSize).toBe(7);
    const { pages, records } = await readAll(adapter, connection(), 7);
    const expectedIds = [
      "contoso-web",
      "intranet",
      "legacy-erp",
      "platform-ops",
    ].flatMap((slug) => adoItems(slug).map((i) => String(i.id)));
    expect(records.map((r) => r.sourceId).sort()).toEqual(
      [...expectedIds].sort(),
    );
    expect(new Set(records.map((r) => r.sourceId)).size).toBe(47);
    // projects are read in name order; ids ascend inside a project
    expect(records[0]?.sourceUrl).toContain("/Contoso%20Web/_workitems/edit/");
    for (const page of pages) expect(page.ids.length).toBeLessThanOrEqual(7);
    expect(pages[0]?.cursor).toBeNull();
    for (const page of pages.slice(1))
      expect(page.cursor).toMatch(/^\d+:\d+$/u);
    // restart from the middle cursor returns exactly the tail (deterministic resume)
    const middle = pages[3]?.cursor ?? null;
    const resumed: string[] = [];
    let cursor = middle;
    for (let guard = 0; guard < 100; guard += 1) {
      const page = await adapter.readPage(connection(), cursor, 7);
      resumed.push(...page.records.map((r) => r.sourceId));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(resumed).toEqual(pages.slice(3).flatMap((p) => p.ids));
  });

  it("scopes a read to one project with config.project", async () => {
    const adapter = createAzureDevOpsAdapter({
      transport: createAdoReplay().transport,
    });
    const { records } = await readAll(
      adapter,
      connection({ organization: "contoso", project: "Intranet" }),
      200,
    );
    expect(records).toHaveLength(6);
    expect(
      records.every((r) => r.facets.some((f) => f.value.startsWith("Basic/"))),
    ).toBe(true);
  });

  it("maps fields: dates, assignee, parent, relations, attachments, comments, history", async () => {
    const adapter = createAzureDevOpsAdapter({
      transport: createAdoReplay().transport,
    });
    const { records } = await readAll(
      adapter,
      connection({ organization: "contoso", project: "Contoso Web" }),
      200,
    );
    const byTitle = (title: string) => {
      const found = records.find((r) => r.title === title);
      if (!found) throw new Error(title);
      return found;
    };
    const story = byTitle("As a shopper I can save a card");
    const parent = byTitle("Saved payment methods");
    expect(story.parentSourceId).toBe(parent.sourceId);
    expect(story.sourceType).toBe("work_item");
    expect(story.assigneeEmail).toBe("bob.carter@contoso.example");
    expect(story.sourceAuthorEmail).toBe("bob.carter@contoso.example");
    expect(story.sourceUrl).toBe(
      `https://dev.azure.com/contoso/Contoso%20Web/_workitems/edit/${story.sourceId}`,
    );
    expect(story.sourceCreatedAt).toMatch(/^2025-\d\d-\d\dT.*Z$/u);
    expect(story.facets).toEqual(
      expect.arrayContaining([
        { domain: "type", value: "User Story" },
        { domain: "state", value: "Agile/Active" },
        { domain: "priority", value: "2" },
        { domain: "label", value: "payments" },
        { domain: "label", value: "ux" },
        { domain: "custom_field", value: "Story Points" },
      ]),
    );
    // children are not relations (the child carries its own parent); related/dup/dep map by type
    const bug = byTitle("Card number field loses focus on iOS");
    const dupTarget = byTitle("Keyboard dismisses while typing card number");
    expect(bug.relations).toEqual([
      {
        type: "duplicates",
        target: { sourceType: "work_item", sourceId: dupTarget.sourceId },
      },
    ]);
    expect(story.relations).toEqual([
      {
        type: "relates",
        target: { sourceType: "work_item", sourceId: bug.sourceId },
      },
    ]);
    expect(
      byTitle("As a shopper I can remove a saved card").relations?.[0]?.type,
    ).toBe("precedes");
    // attachments: metadata only, with the source URL
    expect(story.attachments).toHaveLength(1);
    expect(story.attachments?.[0]).toMatchObject({
      filename: "checkout-flow.png",
      url: expect.stringMatching(
        /^https:\/\/dev\.azure\.com\/contoso\/_apis\/wit\/attachments\//u,
      ),
    });
    // comments: internal, authorship and timestamps preserved
    expect(story.comments).toHaveLength(3);
    for (const comment of story.comments ?? []) {
      expect(comment.visibility).toBe("internal");
      expect(comment.authorEmail).toMatch(/@contoso\.example$/u);
      expect(comment.createdAt).toBeDefined();
    }
    // history: state transitions with old and new values, never just the creation event
    const states = (story.history ?? []).filter((h) => h.field === "state");
    expect(states).toEqual([
      expect.objectContaining({
        from: "New",
        to: "Active",
        authorEmail: expect.any(String),
      }),
    ]);
    expect(story.history?.length).toBeGreaterThan(1);
    // closed/resolved dates feed the resolved timestamp
    expect(
      byTitle("Guest can check out with email only").sourceResolvedAt,
    ).toBeDefined();
    // effort fields and custom fields travel as custom fields
    expect(story.customFields).toEqual(
      expect.arrayContaining([{ key: "Story Points", value: 5 }]),
    );
  });

  it("reports losses with fixed codes: lossy rich text, unsupported links, unimported revisions, missing emails", async () => {
    const adapter = createAzureDevOpsAdapter({
      transport: createAdoReplay().transport,
    });
    const { records } = await readAll(adapter, connection(), 200);
    const codes = new Map<string, number>();
    for (const record of records)
      for (const loss of record.losses ?? []) {
        expect(loss.code).toMatch(LOSS);
        if (loss.detailCode) expect(loss.detailCode).toMatch(LOSS);
        codes.set(loss.code, (codes.get(loss.code) ?? 0) + 1);
      }
    expect(codes.get("rich_text_lossy")).toBeGreaterThan(0);
    expect(codes.get("relation_type_unsupported")).toBeGreaterThan(0);
    expect(codes.get("revision_not_imported")).toBeGreaterThan(0);
    expect(codes.get("author_email_unavailable")).toBeGreaterThan(0);
    const detail = records
      .flatMap((r) => r.losses ?? [])
      .filter((l) => l.code === "relation_type_unsupported")
      .map((l) => l.detailCode);
    expect(new Set(detail)).toEqual(new Set(["artifact_link", "hyperlink"]));
    // an item with a creation revision and one mapped change keeps its history rows
    expect(records.some((r) => (r.history?.length ?? 0) >= 3)).toBe(true);
  });

  it("never writes to the source and never leaks the credential", async () => {
    const replay = createAdoReplay();
    const adapter = createAzureDevOpsAdapter({
      transport: replay.transport,
      chunkSize: 50,
    });
    await adapter.connect(connection());
    const discovery = await adapter.discover(connection());
    const { records } = await readAll(adapter, connection(), 50);
    expect(replay.requests.length).toBeGreaterThan(100);
    for (const request of replay.requests) {
      expect(["GET", "POST"]).toContain(request.method);
      if (request.method === "POST")
        expect(request.path).toMatch(/\/_apis\/wit\/(?:wiql|workitemsbatch)$/u);
    }
    // the only credential header ever sent is the PAT as Basic auth
    expect([...replay.authorizations]).toHaveLength(1);
    const blob = JSON.stringify({ discovery, records });
    expect(blob).not.toContain(ADO_FIXTURE_PAT);
    expect(blob).not.toContain(
      Buffer.from(`:${ADO_FIXTURE_PAT}`).toString("base64"),
    );
    for (const record of records) {
      if (record.sourceUrl) {
        expect(record.sourceUrl).toMatch(/^https:\/\//u);
        expect(new URL(record.sourceUrl).username).toBe("");
      }
    }
  });

  it("fails closed on a bad PAT, a missing credential and a bad config, without echoing secrets", async () => {
    const adapter = createAzureDevOpsAdapter({
      transport: createAdoReplay().transport,
    });
    expect(
      await adapter.connect(connection(undefined, "wrong-pat")),
    ).toMatchObject({
      ok: false,
    });
    expect(await adapter.connect(connection(undefined, null))).toMatchObject({
      ok: false,
    });
    expect(
      await adapter.connect(connection({ organization: "bad org!" })),
    ).toMatchObject({ ok: false });
    expect(
      await adapter.connect(
        connection({ organization: "contoso", project: "Nope" }),
      ),
    ).toMatchObject({ ok: false });
    expect(
      await adapter.connect(
        connection({ baseUrl: "http://dev.azure.com/contoso" }),
      ),
    ).toMatchObject({ ok: false });
    const error = await adapter
      .readPage(connection(undefined, "wrong-pat"), null, 10)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SourceHttpError);
    expect(String((error as Error).message)).not.toContain("wrong-pat");
    expect((error as SourceHttpError).code).toBe("source_unauthorized");
  });
});

describe("azure devops adapter: items it cannot read are reported, never dropped", () => {
  const web = () => adoItems("contoso-web");

  /** The recorded replay, with the batch endpoint omitting one item and blanking another's title. */
  function lossy(omitId: number, blankTitleId: number) {
    const replay = createAdoReplay();
    const transport: typeof replay.transport = async (request) => {
      const response = await replay.transport(request);
      if (
        request.method === "POST" &&
        request.url.includes("/_apis/wit/workitemsbatch")
      ) {
        const json = response.json as { value: AdoFixtureItem[] };
        return {
          ...response,
          json: {
            ...json,
            value: json.value
              .filter((item) => item.id !== omitId)
              .map((item) =>
                item.id === blankTitleId
                  ? { ...item, fields: { ...item.fields, "System.Title": "" } }
                  : item,
              ),
          },
        };
      }
      return response;
    };
    return transport;
  }
  const project = { organization: "contoso", project: "Contoso Web" };

  it("returns an unreadable_item record for an id the batch left out and missing_title for an untitled item", async () => {
    const ids = web().map((item) => item.id);
    const omitId = ids[1] as number;
    const blankId = ids[2] as number;
    const adapter = createAzureDevOpsAdapter({
      transport: lossy(omitId, blankId),
    });
    const { records } = await readAll(adapter, connection(project), 5);
    expect(records.map((r) => r.sourceId)).toEqual(ids.map(String));
    const byId = new Map(records.map((r) => [r.sourceId, r]));
    expect(byId.get(String(omitId))).toMatchObject({
      sourceType: "work_item",
      rejectCode: "unreadable_item",
    });
    expect(byId.get(String(blankId))).toMatchObject({
      rejectCode: "missing_title",
    });
    expect(records.filter((r) => r.rejectCode)).toHaveLength(2);
  });

  it("counts them in discovery with their codes, without inventing facets", async () => {
    const ids = web().map((item) => item.id);
    const clean = await createAzureDevOpsAdapter({
      transport: createAdoReplay().transport,
    }).discover(connection(project));
    const adapter = createAzureDevOpsAdapter({
      transport: lossy(ids[1] as number, ids[2] as number),
    });
    const discovery = await adapter.discover(connection(project));
    expect(discovery.totalRecords).toBe(ids.length);
    expect(discovery.unreadable).toEqual({
      unreadable_item: 1,
      missing_title: 1,
    });
    expect(clean.unreadable).toBeUndefined();
    const people = (d: typeof discovery) =>
      d.facets.filter((f) => f.domain === "type");
    expect(people(discovery).reduce((sum, f) => sum + f.count, 0)).toBe(
      ids.length - 2,
    );
  });
});

describe("azure devops adapter: CSV export mode", () => {
  const csvConnection = (csvText: string) =>
    connection({ mode: "csv", organization: "contoso", csvText }, null);

  it("parses RFC 4180 CSV including quotes and embedded newlines", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\r\n"multi\nline",z\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["multi\nline", "z"],
    ]);
  });

  it("reads the export with explicit loss codes for what CSV cannot carry", async () => {
    const adapter = createAzureDevOpsAdapter();
    const conn = csvConnection(adoCsvText());
    expect(await adapter.connect(conn)).toMatchObject({ ok: true });
    const discovery = await adapter.discover(conn);
    expect(discovery.totalRecords).toBe(20);
    const { records } = await readAll(adapter, conn, 6);
    expect(records).toHaveLength(20);
    for (const record of records) {
      const codes = (record.losses ?? []).map((l) => l.code);
      expect(codes).toEqual(
        expect.arrayContaining([
          "csv_history_unavailable",
          "csv_comments_unavailable",
          "csv_attachments_unavailable",
          "csv_relations_unavailable",
        ]),
      );
      expect(record.comments).toBeUndefined();
      expect(record.history).toBeUndefined();
      expect(codes).not.toContain("csv_parent_unavailable"); // this export has a Parent column
      for (const code of codes) expect(code).toMatch(LOSS);
    }
    const first = records.find(
      (r) => r.title === "As a shopper I can save a card",
    );
    expect(first?.assigneeEmail).toBe("bob.carter@contoso.example");
    expect(first?.parentSourceId).toBeDefined();
    // the process is unknown in a CSV, so states are scoped CSV/ and Resolved is still undecided
    expect(first?.facets).toContainEqual({
      domain: "state",
      value: "CSV/Active",
    });
    const proposals = await adapter.proposeMapping(discovery, context);
    expect(proposals.find((p) => p.value === "CSV/Active")?.target).toEqual({
      kind: "group",
      group: "started",
    });
    expect(proposals.find((p) => p.value === "CSV/Resolved")).toBeUndefined();
    expect(ADO_CSV_STATE_PROPOSALS.Resolved).toBeUndefined();
  });

  it("flags a missing Parent column and skips malformed rows", () => {
    const text = [
      "ID,Work Item Type,Title,State",
      "1,Bug,First bug,Active",
      "x,Bug,Bad id,Active",
      "2,Bug,,Active",
      "3,Task,Third,Closed",
    ].join("\n");
    const { records, skippedRows } = csvRecords(
      text,
      "https://dev.azure.com/contoso",
    );
    expect(records.map((r) => r.sourceId)).toEqual(["1", "3"]);
    expect(skippedRows).toBe(2);
    expect(records[0]?.losses?.map((l) => l.code)).toContain(
      "csv_parent_unavailable",
    );
  });
});

describe("html conversion", () => {
  it("flags formatting plain text cannot carry", () => {
    expect(htmlToText("<p>a &amp; b</p>")).toEqual({
      text: "a & b",
      lossy: false,
    });
    expect(
      htmlToText("<div><b>x</b></div><ul><li>one</li></ul>"),
    ).toMatchObject({
      text: "x\n- one",
      lossy: true,
    });
  });
});

describe("guarded transport (SSRF guard, no redirects, JSON only)", () => {
  let server: http.Server;
  let base = "";
  const seen: Array<{ method?: string; auth?: string; body: string }> = [];
  beforeAll(async () => {
    server = http.createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        seen.push({
          ...(request.method ? { method: request.method } : {}),
          ...(typeof request.headers.authorization === "string"
            ? { auth: request.headers.authorization }
            : {}),
          body,
        });
        if (request.url === "/redirect") {
          response.statusCode = 302;
          response.setHeader("location", "/ok");
          response.end();
        } else if (request.url === "/big") response.end("x".repeat(5000));
        else response.end(JSON.stringify({ ok: true }));
      });
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

  it("refuses private and plain-http destinations outside development", async () => {
    const transport = createGuardedTransport({
      env: { NODE_ENV: "production" },
    });
    await expect(
      transport({ method: "GET", url: `${base}/ok`, headers: {} }),
    ).rejects.toMatchObject({ code: "destination_not_allowed" });
    await expect(
      transport({ method: "GET", url: "https://127.0.0.1/ok", headers: {} }),
    ).rejects.toMatchObject({ code: "destination_not_allowed" });
    await expect(
      transport({
        method: "GET",
        url: "https://169.254.169.254/latest",
        headers: {},
      }),
    ).rejects.toMatchObject({ code: "destination_not_allowed" });
  });

  it("stays strict by default even when the process runs with NODE_ENV=development", async () => {
    const previous = process.env.NODE_ENV;
    vi.stubEnv("NODE_ENV", "development");
    try {
      const transport = createGuardedTransport();
      await expect(
        transport({ method: "GET", url: `${base}/ok`, headers: {} }),
      ).rejects.toMatchObject({ code: "destination_not_allowed" });
    } finally {
      vi.unstubAllEnvs();
      expect(process.env.NODE_ENV).toBe(previous);
    }
  });

  it("sends headers and JSON, parses JSON, refuses redirects and oversized bodies", async () => {
    const transport = createGuardedTransport({
      env: { NODE_ENV: "development" },
      maxBytes: 1000,
    });
    const ok = await transport({
      method: "POST",
      url: `${base}/ok`,
      headers: { authorization: "Basic abc" },
      body: { query: "q" },
    });
    expect(ok).toEqual({ status: 200, json: { ok: true } });
    expect(seen.at(-1)).toEqual({
      method: "POST",
      auth: "Basic abc",
      body: '{"query":"q"}',
    });
    await expect(
      transport({ method: "GET", url: `${base}/redirect`, headers: {} }),
    ).rejects.toMatchObject({ code: "redirect_not_followed" });
    await expect(
      transport({ method: "GET", url: `${base}/big`, headers: {} }),
    ).rejects.toMatchObject({ code: "response_too_large" });
  });
});
