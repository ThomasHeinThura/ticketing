import { describe, expect, it } from "vitest";
import { createPlaneAdapter } from "../../../../apps/api/src/imports/adapters/plane";
import { proposePlaneRoles } from "../../../../apps/api/src/imports/adapters/plane/normalize";
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
  createPlaneReplay,
  PLANE_FIXTURE_KEY,
  PLANE_PROJECTS,
  planeIssues,
  planeMembers,
  planeStates,
} from "../../../fixtures/imports/plane/replay";

const connection = (
  config: Record<string, unknown> = { workspace: "acme" },
  credential: string | null = PLANE_FIXTURE_KEY,
): AdapterConnection => ({
  pluginId: "import.plane",
  config,
  credential,
  readOnly: true,
});
const context: ProposalContext = {
  workspaceId: "w",
  projectId: "p",
  peopleByEmail: new Map([["priya.shah@acme.example", "person-priya"]]),
  typeIdsByKey: new Map([["bug", "type-bug"]]),
};
const LOSS = /^[a-z][a-z0-9_]{1,63}$/u;
const allIssues = () =>
  PLANE_PROJECTS.flatMap((p) => planeIssues(p.identifier));

async function readAll(
  adapter: ReturnType<typeof createPlaneAdapter>,
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

describe("plane adapter: discovery and proposals (recorded fixtures)", () => {
  it("discovers projects, state groups, priorities, labels, cycles, modules, estimates", async () => {
    const adapter = createPlaneAdapter({
      transport: createPlaneReplay().transport,
    });
    expect(await adapter.connect(connection())).toEqual({
      ok: true,
      label: "acme",
    });
    const discovery = await adapter.discover(connection());
    expect(discovery.totalRecords).toBe(allIssues().length);
    expect(discovery.counts).toEqual({ issue: allIssues().length });
    const facet = (domain: string, value: string) =>
      discovery.facets.find((f) => f.domain === domain && f.value === value);
    expect(facet("state", "ENG/In Progress (started)")).toBeDefined();
    expect(facet("state", "ENG/Won't Fix (cancelled)")).toBeDefined();
    expect(facet("state", "OPS/Doing (started)")).toBeDefined();
    expect(facet("state", "MKT/Published (completed)")).toBeDefined();
    expect(facet("priority", "none")).toBeDefined();
    expect(facet("label", "security")).toBeDefined();
    expect(facet("cycle", "ENG/Cycle 7")).toBeDefined();
    expect(facet("module", "ENG/API")).toBeDefined();
    expect(facet("custom_field", "estimate_point")).toBeDefined();
    expect(facet("type", "Issue")).toBeUndefined(); // every fixture issue has a type
    expect(facet("person", "marcus.lee@acme.example")).toBeDefined();
    // totals per source group equal the fixture's own state distribution
    const groups = new Map<string, number>();
    for (const f of discovery.facets)
      if (f.domain === "state") {
        const group = /\((\w+)\)$/u.exec(f.value)?.[1] ?? "?";
        groups.set(group, (groups.get(group) ?? 0) + f.count);
      }
    const expected = new Map<string, number>();
    for (const project of PLANE_PROJECTS) {
      const states = new Map(
        planeStates(project.identifier).map((s) => [s.id, s.group as string]),
      );
      for (const issue of planeIssues(project.identifier)) {
        const group = states.get(issue.state as string) as string;
        expected.set(group, (expected.get(group) ?? 0) + 1);
      }
    }
    expect(groups).toEqual(expected);
  });

  it("proposes the source group exactly; none -> Medium is a heuristic; triage stays unmapped", async () => {
    const adapter = createPlaneAdapter({
      transport: createPlaneReplay().transport,
    });
    const discovery = await adapter.discover(connection());
    const proposals = await adapter.proposeMapping(discovery, context);
    const state = (value: string) =>
      proposals.find((p) => p.domain === "state" && p.value === value);
    expect(state("ENG/Backlog (backlog)")).toMatchObject({
      target: { kind: "group", group: "backlog" },
      confidence: "exact",
    });
    expect(state("ENG/Todo (unstarted)")?.target).toEqual({
      kind: "group",
      group: "unstarted",
    });
    expect(state("ENG/In Review (started)")?.target).toEqual({
      kind: "group",
      group: "started",
    });
    expect(state("MKT/Published (completed)")?.target).toEqual({
      kind: "group",
      group: "completed",
    });
    // a cancelled state is cancelled, never completed
    expect(state("ENG/Won't Fix (cancelled)")?.target).toEqual({
      kind: "group",
      group: "cancelled",
    });
    expect(state("OPS/Cancelled (cancelled)")?.target).toEqual({
      kind: "group",
      group: "cancelled",
    });
    expect(state("ENG/Intake (triage)")).toBeUndefined();
    const prio = (value: string) =>
      proposals.find((p) => p.domain === "priority" && p.value === value);
    expect(prio("urgent")?.target).toEqual({
      kind: "priority",
      value: "urgent",
    });
    expect(prio("low")?.target).toEqual({ kind: "priority", value: "low" });
    expect(prio("none")).toMatchObject({
      target: { kind: "priority", value: "medium" },
      confidence: "heuristic",
    });
    expect(
      proposals.find(
        (p) => p.domain === "person" && p.value === "priya.shah@acme.example",
      )?.target,
    ).toEqual({ kind: "target", id: "person-priya" });
    expect(
      proposals.find(
        (p) => p.domain === "person" && p.value === "marcus.lee@acme.example",
      )?.target,
    ).toEqual({ kind: "placeholder" });
    expect(
      proposals.find((p) => p.domain === "type" && p.value === "Bug")?.target,
    ).toEqual({ kind: "target", id: "type-bug" });
    // proposals are never confirmed by the adapter; the triage state blocks a confirm-all
    const merged = mergeDiscovery([], discovery.facets, proposals);
    expect(merged.find((e) => e.value === "ENG/Intake (triage)")).toMatchObject(
      { status: "unmapped" },
    );
    const confirmed = applyMappingEdits(merged, [], true);
    if (!confirmed.ok) throw new Error("confirm failed");
    expect(completeness(confirmed.entries).complete).toBe(false);
  });
});

describe("plane adapter: reading (cursor pagination, content, losses)", () => {
  it("paginates with a stable cursor across API pages and projects; resume returns the tail", async () => {
    const replay = createPlaneReplay();
    const adapter = createPlaneAdapter({
      transport: replay.transport,
      chunkSize: 8,
    });
    const { pages, records } = await readAll(adapter, connection(), 8);
    expect(records).toHaveLength(35);
    expect(new Set(records.map((r) => r.sourceId)).size).toBe(35);
    expect(records.map((r) => r.sourceId).sort()).toEqual(
      allIssues()
        .map((i) => i.id as string)
        .sort(),
    );
    for (const page of pages) expect(page.ids.length).toBeLessThanOrEqual(8);
    for (const page of pages.slice(1)) expect(page.cursor).toMatch(/^\d+\|/u);
    const middle = pages[2]?.cursor ?? null;
    const resumed: string[] = [];
    let cursor = middle;
    for (let guard = 0; guard < 100; guard += 1) {
      const page = await adapter.readPage(connection(), cursor, 8);
      resumed.push(...page.records.map((r) => r.sourceId));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(resumed).toEqual(pages.slice(2).flatMap((p) => p.ids));
    // a page larger than Plane's 100-item API page is assembled from several API pages
    const big = createPlaneAdapter({
      transport: createPlaneReplay().transport,
    });
    const first = await big.readPage(
      connection({ workspace: "acme", project: "ENG" }),
      null,
      500,
    );
    expect(first.records).toHaveLength(18);
    expect(first.nextCursor).toBeNull();
  });

  it("maps fields: parent, estimate, type, relations, cycle/module facets, comments, attachments, history", async () => {
    const adapter = createPlaneAdapter({
      transport: createPlaneReplay().transport,
    });
    const { records } = await readAll(adapter, connection(), 500);
    const byTitle = (title: string) => {
      const found = records.find((r) => r.title === title);
      if (!found) throw new Error(title);
      return found;
    };
    const epic = byTitle("Rate limit public API");
    const task = byTitle("Token bucket middleware");
    expect(task.parentSourceId).toBe(epic.sourceId);
    expect(task.sourceType).toBe("issue");
    expect(task.sourceUrl).toMatch(
      /^https:\/\/app\.plane\.so\/acme\/projects\/[^/]+\/issues\/[^/]+$/u,
    );
    expect(task.facets).toEqual(
      expect.arrayContaining([
        { domain: "type", value: "Task" },
        { domain: "state", value: "ENG/In Review (started)" },
        { domain: "priority", value: "high" },
        { domain: "label", value: "feature" },
        { domain: "cycle", value: "ENG/Cycle 7" },
        { domain: "module", value: "ENG/API" },
        { domain: "custom_field", value: "estimate_point" },
      ]),
    );
    expect(task.customFields).toEqual([{ key: "estimate_point", value: "5" }]);
    expect(task.assigneeEmail).toBe("marcus.lee@acme.example");
    // relations: blocking / blocked_by / duplicate / relates_to
    expect(task.relations).toEqual([
      {
        type: "blocks",
        target: {
          sourceType: "issue",
          sourceId: byTitle("Expose limits in response headers").sourceId,
        },
      },
    ]);
    expect(
      byTitle("Expose limits in response headers").relations?.[0]?.type,
    ).toBe("requires");
    expect(
      byTitle("Flaky integration test in billing").relations?.[0]?.type,
    ).toBe("duplicates");
    expect(
      byTitle("Dashboard widgets crash on empty data").relations?.[0]?.type,
    ).toBe("relates");
    // comments are internal with authorship and timestamps
    expect(task.comments).toHaveLength(3);
    for (const comment of task.comments ?? []) {
      expect(comment.visibility).toBe("internal");
      expect(comment.authorEmail).toMatch(/@acme\.example$/u);
      expect(comment.createdAt).toBeDefined();
    }
    // attachments: metadata and an https URL
    expect(task.attachments?.[0]).toMatchObject({
      filename: "screenshot.png",
      mimeType: "image/png",
      url: expect.stringMatching(/^https:\/\/app\.plane\.so\/api\/assets\//u),
    });
    expect(task.history?.length).toBeGreaterThan(0);
    // second assignee dropped, reported; no assignee for unassigned
    const audit = byTitle("Audit log retention setting");
    expect(audit.losses).toContainEqual({ code: "assignee_extra_dropped" });
    expect(byTitle("Upgrade to Node 22").assigneeEmail).toBeUndefined();
    // empty HTML description yields no description; lossy rich text is flagged
    expect(
      records.some((r) => r.losses?.some((l) => l.code === "rich_text_lossy")),
    ).toBe(true);
    expect(
      records.every(
        (r) => r.facets.filter((f) => f.domain === "type").length === 1,
      ),
    ).toBe(true);
  });

  it("reports only fixed loss codes, including unimported activity", async () => {
    const adapter = createPlaneAdapter({
      transport: createPlaneReplay().transport,
    });
    const { records } = await readAll(adapter, connection(), 500);
    const codes = new Set<string>();
    for (const record of records)
      for (const loss of record.losses ?? []) {
        expect(loss.code).toMatch(LOSS);
        if (loss.detailCode) expect(loss.detailCode).toMatch(LOSS);
        codes.add(loss.code);
      }
    expect(codes).toEqual(
      new Set([
        "revision_not_imported",
        "rich_text_lossy",
        "assignee_extra_dropped",
      ]),
    );
  });

  it("is read-only (GET only), never leaks the key, fails closed", async () => {
    const replay = createPlaneReplay();
    const adapter = createPlaneAdapter({ transport: replay.transport });
    await adapter.connect(connection());
    const discovery = await adapter.discover(connection());
    const { records } = await readAll(adapter, connection(), 500);
    await adapter.readPages(connection());
    await adapter.proposeRoles(connection());
    expect(replay.requests.length).toBeGreaterThan(200);
    expect(new Set(replay.requests.map((r) => r.method))).toEqual(
      new Set(["GET"]),
    );
    expect(JSON.stringify({ discovery, records })).not.toContain(
      PLANE_FIXTURE_KEY,
    );
    expect(await adapter.connect(connection(undefined, "wrong"))).toMatchObject(
      {
        ok: false,
      },
    );
    expect(await adapter.connect(connection(undefined, null))).toMatchObject({
      ok: false,
    });
    expect(
      await adapter.connect(connection({ workspace: "../x" })),
    ).toMatchObject({
      ok: false,
    });
    expect(
      await adapter.connect(
        connection({ workspace: "acme", baseUrl: "http://plane.example" }),
      ),
    ).toMatchObject({ ok: false });
    expect(
      await adapter.connect(connection({ workspace: "acme", project: "NOPE" })),
    ).toMatchObject({ ok: false });
    const error = await adapter
      .readPage(connection(undefined, "wrong"), null, 10)
      .catch((e: unknown) => e);
    expect(String((error as Error).message)).not.toContain("wrong");
  });
});

describe("plane adapter: issues it cannot read are reported, never dropped", () => {
  /** The recorded replay with the first issue untitled and the second without an id. */
  function lossy() {
    const replay = createPlaneReplay();
    const transport: typeof replay.transport = async (request) => {
      const response = await replay.transport(request);
      const url = new URL(request.url);
      const body = response.json as {
        results?: Array<Record<string, unknown>>;
      };
      if (/\/projects\/[^/]+\/issues\/$/u.test(url.pathname) && body?.results) {
        return {
          ...response,
          json: {
            ...body,
            results: body.results.map((issue, index) =>
              index === 0
                ? { ...issue, name: "" }
                : index === 1
                  ? { ...issue, id: undefined }
                  : issue,
            ),
          },
        };
      }
      return response;
    };
    return transport;
  }

  it("returns missing_title and missing_id records with stable ids and counts them in discovery", async () => {
    const clean = allIssues().length;
    const adapter = createPlaneAdapter({ transport: lossy() });
    const { records } = await readAll(adapter, connection(), 50);
    const unreadable = records.filter((r) => r.rejectCode);
    expect(records).toHaveLength(clean);
    const codes = unreadable.map((r) => r.rejectCode);
    expect(codes).toContain("missing_title");
    expect(codes).toContain("missing_id");
    for (const record of unreadable) expect(record.sourceType).toBe("issue");
    const again = await readAll(adapter, connection(), 50);
    expect(again.records.map((r) => r.sourceId)).toEqual(
      records.map((r) => r.sourceId),
    );
    const discovery = await adapter.discover(connection());
    expect(discovery.totalRecords).toBe(clean);
    expect(
      (discovery.unreadable?.missing_title ?? 0) +
        (discovery.unreadable?.missing_id ?? 0),
    ).toBe(unreadable.length);
  });
});

describe("plane roles and pages", () => {
  it("proposes roles for review only: Guest -> Viewer is never confirmed", () => {
    const proposals = proposePlaneRoles(
      planeMembers().map((m) => ({
        id: m.id as string,
        email: m.email as string,
        role: m.role as number,
      })),
    );
    expect(proposals).toHaveLength(6);
    expect(proposals.find((p) => p.sourceRole === 20)?.proposedRole).toBe(
      "admin",
    );
    expect(proposals.find((p) => p.sourceRole === 15)?.proposedRole).toBe(
      "member",
    );
    const guest = proposals.find((p) => p.sourceRole === 5);
    expect(guest).toMatchObject({
      proposedRole: "viewer",
      note: "guest_can_comment_in_plane",
    });
    for (const proposal of proposals) {
      expect(proposal.requiresReview).toBe(true);
      expect(proposal.confirmed).toBe(false);
    }
    expect(
      proposePlaneRoles([{ id: "x", email: "x@y.zz", role: 7 }])[0]
        ?.proposedRole,
    ).toBeNull();
  });

  it("reads pages unpublished and staff-only whatever their Plane access was", async () => {
    const adapter = createPlaneAdapter({
      transport: createPlaneReplay().transport,
    });
    const pages = await adapter.readPages(connection());
    expect(pages).toHaveLength(4);
    expect(new Set(pages.map((p) => p.sourceAccess))).toEqual(
      new Set(["public", "private"]),
    );
    for (const page of pages) {
      expect(page.published).toBe(false);
      expect(page.visibility).toBe("staff");
    }
    expect(
      pages.find((p) => p.title === "Engineering handbook")?.lossyRichText,
    ).toBe(true);
  });

  it("returns role proposals through the adapter", async () => {
    const adapter = createPlaneAdapter({
      transport: createPlaneReplay().transport,
    });
    const proposals = await adapter.proposeRoles(connection());
    expect(proposals.filter((p) => p.proposedRole === "viewer")).toHaveLength(
      2,
    );
    expect(proposals.every((p) => p.confirmed === false)).toBe(true);
  });
});
