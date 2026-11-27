import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPersonalApiKey } from "../../../apps/api/src/api-key/service";
import db, { schema } from "../../../apps/api/src/database";
import { importSourceConnectionTable } from "../../../apps/api/src/database/schema-imports";
import { createBundleAdapter } from "../../../apps/api/src/imports/adapters/bundle";
import {
  registerImportAdapter,
  unregisterImportAdapter,
} from "../../../apps/api/src/imports/engine/adapter";
import {
  runImportRun,
  setImportEngineAutoStart,
} from "../../../apps/api/src/imports/engine/runner";
import { createApp } from "../../../apps/api/src/index";
import { resetTestDatabase } from "../helpers/database";
import { createWorkspaceMember } from "../helpers/fixtures";
import {
  type App,
  call,
  discoverAndWait,
  dryRunAndExecuteBody,
  engineFixture,
  post,
  req,
  seedProject,
} from "./engine-helpers";

type F = Awaited<ReturnType<typeof engineFixture>>;

beforeEach(async () => {
  await resetTestDatabase();
  setImportEngineAutoStart(false);
  registerImportAdapter("import.bundle", () => createBundleAdapter());
});
afterEach(() => unregisterImportAdapter("import.bundle"));

const fixtureText = readFileSync(
  resolve(__dirname, "../../fixtures/imports/bundle/two-projects.ndjson"),
  "utf8",
);

/**
 * The shared two-project fixture with Ana pointed at the fixture's real staff user (so her email
 * matches by IM-7) and without attachments (their download needs the network; the writer's own
 * tests cover attachments).
 */
function bundleFor(f: F) {
  return fixtureText
    .trim()
    .split("\n")
    .map((line) => {
      const row = JSON.parse(line) as Record<string, unknown>;
      if (row.email === "ana.lopez@example.test") row.email = f.user.email;
      if (row.t === "item") row.attachments = undefined;
      return JSON.stringify(row);
    })
    .join("\n");
}

/** `count` unassigned items in one project: enough writes to need approval. */
function manyItems(count: number) {
  const rows: unknown[] = [
    {
      t: "header",
      bundleVersion: 1,
      source: { system: "plane", instance: "plane.lan", workspace: "acme" },
    },
    { t: "project", id: "p1", key: "WEB", name: "Web" },
    { t: "state", project: "p1", id: "s1", name: "Todo", group: "unstarted" },
    ...Array.from({ length: count }, (_, i) => ({
      t: "item",
      project: "p1",
      id: `bulk-${i + 1}`,
      title: `Bulk item ${i + 1}`,
      state: "s1",
    })),
  ];
  return rows.map((r) => JSON.stringify(r)).join("\n");
}

async function startBundleRun(
  app: App,
  f: F,
  input: {
    bundleText: string;
    projectKey?: string;
    projectId: string;
    sourceRef?: string;
  },
) {
  const source = await call(
    app,
    f.key,
    "/api/import-sources",
    post({
      workspaceId: f.workspace.id,
      pluginId: "import.bundle",
      name: `bundle-${randomUUID()}`,
      config: {
        bundleText: input.bundleText,
        ...(input.projectKey ? { projectKey: input.projectKey } : {}),
      },
    }),
    200,
  );
  const run = await call(
    app,
    f.key,
    `/api/import-sources/${source.id}/runs`,
    post({
      projectId: input.projectId,
      sourceRef: input.sourceRef ?? "plane:plane.lan:acme",
    }),
    200,
  );
  const mapping = (await discoverAndWait(app, f.key, run.id)) as Mapping;
  return { source, run, mapping };
}

type Entry = { domain: string; value: string; status: string; target: unknown };
type Mapping = {
  mappingVersion: number;
  entries: Entry[];
  completeness: { complete: boolean };
  discovery: { counts: Record<string, number> };
};

/** The operator's (agent's) decisions: types to the project's type, labels ignored, the rest as proposed. */
async function decide(
  app: App,
  f: F,
  runId: string,
  mapping: Mapping,
  typeId: string,
  options: { unmappedTypes?: boolean; persons?: "placeholder" } = {},
) {
  const edits = mapping.entries
    .filter((e) => e.status !== "confirmed")
    .flatMap((e) => {
      if (e.domain === "type")
        return options.unmappedTypes
          ? []
          : [
              {
                domain: e.domain,
                value: e.value,
                target: { kind: "target", id: typeId },
              },
            ];
      if (e.domain === "person" && e.target === null && options.persons)
        return [
          { domain: e.domain, value: e.value, target: { kind: "placeholder" } },
        ];
      if (
        ["label", "module", "cycle", "custom_field", "project"].includes(
          e.domain,
        )
      )
        return [
          { domain: e.domain, value: e.value, target: { kind: "ignore" } },
        ];
      return [];
    });
  return call(
    app,
    f.key,
    `/api/imports/${runId}/mapping`,
    post({
      expectedMappingVersion: mapping.mappingVersion,
      entries: edits,
      confirmProposals: !options.unmappedTypes,
    }),
    200,
  );
}

async function execute(app: App, f: F, runId: string) {
  const dry = await dryRunAndExecuteBody(app, f.key, runId);
  await call(app, f.key, `/api/imports/${runId}/execute`, post(dry.body), 202);
  expect(await runImportRun(runId)).toMatchObject({ status: "completed" });
  return dry;
}

const itemsOf = (projectId: string) =>
  db
    .select()
    .from(schema.workItemTable)
    .where(eq(schema.workItemTable.projectId, projectId));
const counts = async () => ({
  projects: (await db.select().from(schema.projectTable)).length,
  memberships: (await db.select().from(schema.membershipTable)).length,
  users: (await db.select().from(schema.userTable)).length,
});

describe("import.bundle end to end", () => {
  it("imports a two-project bundle as one run per project and writes no projects, members or users", async () => {
    const f = await engineFixture();
    const { app } = createApp();
    const text = bundleFor(f);
    const before = await counts();

    // WEB
    const web = await startBundleRun(app, f, {
      bundleText: text,
      projectKey: "WEB",
      projectId: f.project.id,
    });
    expect(web.source).toMatchObject({
      pluginId: "import.bundle",
      hasCredential: false,
    });
    // The file contents are never echoed back, only their size.
    expect(JSON.stringify(web.source)).not.toContain("Fix the login redirect");
    expect(web.source.inline.bundleText.bytes).toBeGreaterThan(1000);
    const byKey = (e: Entry[]) =>
      new Map(e.map((x) => [`${x.domain}|${x.value}`, x]));
    const entries = byKey(web.mapping.entries as Entry[]);
    // Exact matches are proposed; labels have no destination ids and the other person is not matched.
    expect(entries.get("state|In Review (started)")).toMatchObject({
      status: "proposed",
      target: { kind: "group", group: "started" },
    });
    expect(entries.get("priority|high")).toMatchObject({ status: "proposed" });
    expect(entries.get(`person|${f.user.email}`)).toMatchObject({
      status: "proposed",
      target: { kind: "target" },
    });
    expect(entries.get("person|ben.ito@example.test")?.target).toBeNull();
    expect(entries.get("label|bug")?.target).toBeNull();
    expect(web.mapping.discovery.counts).toMatchObject({
      issue: 4,
      membership_not_written: 2,
    });
    // Unmapped types block: nothing is guessed.
    expect(web.mapping.completeness.complete).toBe(false);

    const decided = await decide(app, f, web.run.id, web.mapping, f.type.id, {
      persons: "placeholder",
    });
    expect(decided.completeness.complete).toBe(true);
    const webDry = await execute(app, f, web.run.id);
    expect(webDry.report.counts).toMatchObject({
      created: 4,
      rejected: 0,
      processed: 4,
    });

    const webItems = await itemsOf(f.project.id);
    expect(webItems).toHaveLength(4);
    const w1 = webItems.find((i) => i.title === "Fix the login redirect");
    expect(w1).toBeDefined();
    const ana = (
      await db
        .select()
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, f.user.id))
    )[0];
    expect(w1?.assigneeId).toBe(ana?.id);

    // OPS: its own run (one run per project key), here into the same destination project
    const ops = await startBundleRun(app, f, {
      bundleText: text,
      projectKey: "OPS",
      projectId: f.project.id,
    });
    await decide(app, f, ops.run.id, ops.mapping, f.type.id, {
      persons: "placeholder",
    });
    await execute(app, f, ops.run.id);
    expect((await itemsOf(f.project.id)).map((i) => i.title).sort()).toEqual([
      "Child task of the redirect fix",
      "Fix the login redirect",
      "Release notes",
      "Retire the old VPN",
      "Rotate the TLS certificates",
      "Typo on the pricing page",
    ]);

    // Slice 1 never creates projects, memberships or users, and never writes the bundle's own.
    expect(await counts()).toEqual(before);

    // Comment authorship and source timestamps survive (IM-6).
    const comments = await db
      .select()
      .from(schema.commentTable)
      .where(eq(schema.commentTable.workItemId, w1?.id as string));
    expect(comments).toHaveLength(2);
    // Ana wrote the first comment: it carries her person id and the source time.
    const first = comments.find((c) => c.authorId === ana?.id);
    expect(first?.createdAt.toISOString()).toBe("2026-01-06T11:30:00.000Z");

    // The fields TaskDesk cannot store are reported, not dropped silently.
    const losses = await call(
      app,
      f.key,
      `/api/imports/${web.run.id}/losses?limit=200`,
      undefined,
      200,
    );
    const lossCodes = new Set(
      losses.summary.map((s: { code: string }) => s.code),
    );
    for (const code of [
      "estimate_not_carried",
      "cycle_not_carried",
      "module_not_carried",
      "links_not_carried",
      "person_email_missing",
      "person_placeholder",
      "writer_unavailable",
    ])
      expect(lossCodes.has(code), code).toBe(true);
    expect(
      losses.summary.some(
        (s: { code: string; detailCode?: string }) =>
          s.code === "writer_unavailable" && s.detailCode === "requester",
      ),
    ).toBe(true);
  });

  it("one source identity for every project: OPS resolves its relation to WEB and never stales WEB", async () => {
    const f = await engineFixture();
    const { app } = createApp();
    const text = bundleFor(f);
    const sourceRef = "plane:plane.lan:acme";
    const run = async (key: string, bundleText = text) => {
      const r = await startBundleRun(app, f, {
        bundleText,
        projectKey: key,
        projectId: f.project.id,
        sourceRef,
      });
      await decide(app, f, r.run.id, r.mapping, f.type.id, {
        persons: "placeholder",
      });
      await execute(app, f, r.run.id);
    };
    const links = () => db.select().from(schema.importRecordLinkTable);
    await run("WEB");
    await run("OPS");
    expect(
      (await links()).map((l) => [l.sourceId, l.staleAt !== null]).sort(),
    ).toEqual(["o1", "o2", "w1", "w2", "w3", "w4"].map((id) => [id, false]));
    // OPS o2 relates to WEB w1: it resolved across projects instead of becoming a loss.
    const byId = new Map((await links()).map((l) => [l.sourceId, l.targetId]));
    const relations = await db.select().from(schema.workItemRelationTable);
    expect(
      relations.some(
        (r) =>
          [r.sourceId, r.targetId].includes(byId.get("o2") as string) &&
          [r.sourceId, r.targetId].includes(byId.get("w1") as string),
      ),
    ).toBe(true);

    // A record dropped from a project's own file still goes stale on that project's next run.
    const without = text
      .split("\n")
      .filter((l) => !l.includes('"id":"w4"'))
      .join("\n");
    await run("WEB", without);
    const stale = (await links())
      .filter((l) => l.staleAt !== null)
      .map((l) => l.sourceId);
    expect(stale).toEqual(["w4"]);
  });

  it("the stale scope is the file's canonical project: omitted key, other case and omitted-then-explicit all agree", async () => {
    const f = await engineFixture();
    const { app } = createApp();
    const full = bundleFor(f);
    const sourceRef = "plane:plane.lan:acme";
    const without = (text: string, id: string) =>
      text
        .split("\n")
        .filter((l) => !l.includes(`"id":"${id}"`))
        .join("\n");
    // A file holding only WEB, so the project key can be omitted.
    const webOnly = full
      .split("\n")
      .filter((l) => !/"(p2|s4|s5|l3|o1|o2)"/.test(l))
      .join("\n");
    const run = async (bundleText: string, projectKey?: string) => {
      const r = await startBundleRun(app, f, {
        bundleText,
        ...(projectKey ? { projectKey } : {}),
        projectId: f.project.id,
        sourceRef,
      });
      await decide(app, f, r.run.id, r.mapping, f.type.id, {
        persons: "placeholder",
      });
      await execute(app, f, r.run.id);
    };
    const staleIds = async () =>
      (await db.select().from(schema.importRecordLinkTable))
        .filter((l) => l.staleAt !== null)
        .map((l) => l.sourceId)
        .sort();

    // (a) Omitted key on a single-project file, then OPS: WEB stays fresh.
    await run(webOnly);
    await run(full, "OPS");
    expect(await staleIds()).toEqual([]);

    // (b) "WEB" then "web" with a dropped item: only that item goes stale.
    await run(full, "WEB");
    await run(without(full, "w4"), "web");
    expect(await staleIds()).toEqual(["w4"]);
    await db.update(schema.importRecordLinkTable).set({ staleAt: null });

    // (c) The omitted-key run above and an explicit one agree: dropping w3 stales only w3.
    await run(without(webOnly, "w3"), "WEB");
    expect(await staleIds()).toEqual(["w3"]);
  });

  it("a placeholder person has no login, no membership and is not assignable", async () => {
    const f = await engineFixture();
    const { app } = createApp();
    const { run, mapping } = await startBundleRun(app, f, {
      bundleText: bundleFor(f),
      projectKey: "WEB",
      projectId: f.project.id,
    });
    await decide(app, f, run.id, mapping, f.type.id, {
      persons: "placeholder",
    });
    await execute(app, f, run.id);

    const placeholders = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.isPlaceholder, true));
    expect(placeholders.length).toBeGreaterThan(0);
    for (const person of placeholders) {
      expect(person.userId).toBeNull();
      const memberships = await db
        .select()
        .from(schema.membershipTable)
        .where(eq(schema.membershipTable.personId, person.id));
      expect(memberships).toHaveLength(0);
    }
    const claims = await db.select().from(schema.importPlaceholderClaimTable);
    expect(claims.map((c) => c.normalizedEmail)).toContain(
      "ben.ito@example.test",
    );
    // Ben was the assignee of Release notes: the assignee is not written for a placeholder.
    const release = (await itemsOf(f.project.id)).find(
      (i) => i.title === "Release notes",
    );
    expect(release?.assigneeId).toBeNull();
    const users = await db
      .select()
      .from(schema.userTable)
      .where(inArray(schema.userTable.email, ["ben.ito@example.test"]));
    expect(users).toHaveLength(0);
  });

  it("a re-run of the same bundle creates nothing new (IM-1)", async () => {
    const f = await engineFixture();
    const { app } = createApp();
    const text = bundleFor(f);
    const first = await startBundleRun(app, f, {
      bundleText: text,
      projectKey: "WEB",
      projectId: f.project.id,
    });
    await decide(app, f, first.run.id, first.mapping, f.type.id, {
      persons: "placeholder",
    });
    await execute(app, f, first.run.id);
    const before = (await itemsOf(f.project.id)).length;
    const links = async () =>
      (await db.select().from(schema.importRecordLinkTable)).length;
    const linkCount = await links();
    expect(before).toBe(4);

    const second = await startBundleRun(app, f, {
      bundleText: text,
      projectKey: "WEB",
      projectId: f.project.id,
    });
    await decide(app, f, second.run.id, second.mapping, f.type.id, {
      persons: "placeholder",
    });
    const dry = await execute(app, f, second.run.id);
    expect(dry.report.counts).toMatchObject({
      created: 0,
      updated: 0,
      skipped: 4,
    });
    expect((await itemsOf(f.project.id)).length).toBe(before);
    expect(await links()).toBe(linkCount);
    const comments = await db.select().from(schema.commentTable);
    expect(comments).toHaveLength(2);
  });

  it("an unmapped value blocks execute", async () => {
    const f = await engineFixture();
    const { app } = createApp();
    const { run, mapping } = await startBundleRun(app, f, {
      bundleText: bundleFor(f),
      projectKey: "WEB",
      projectId: f.project.id,
    });
    // Everything decided except the types (and the proposals stay unconfirmed).
    await decide(app, f, run.id, mapping, f.type.id, { unmappedTypes: true });
    const dry = await dryRunAndExecuteBody(app, f.key, run.id);
    const response = await req(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
    );
    expect(response.status).toBe(409);
    expect(await response.text()).toContain("Mapping is incomplete");
    expect(await itemsOf(f.project.id)).toHaveLength(0);
  });

  it("more than 50 writes ask for approval and write nothing until it is granted", async () => {
    const f = await engineFixture();
    const { app } = createApp();
    const { run, mapping } = await startBundleRun(app, f, {
      bundleText: manyItems(60),
      projectId: f.project.id,
    });
    await decide(app, f, run.id, mapping, f.type.id);
    const dry = await dryRunAndExecuteBody(app, f.key, run.id);
    expect(dry.report.counts.created).toBe(60);
    expect(dry.report.approvalRequired).toBe(true);
    const requested = await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );
    expect(requested).toMatchObject({ status: "pending_approval" });
    expect(requested.pendingActionId).toBeTruthy();
    expect(await itemsOf(f.project.id)).toHaveLength(0);
    const pending = await db
      .select()
      .from(schema.pendingActionTable)
      .where(
        and(
          eq(schema.pendingActionTable.id, requested.pendingActionId),
          eq(schema.pendingActionTable.state, "pending"),
        ),
      );
    expect(pending).toHaveLength(1);
  });

  it("a key whose owner is not an instance admin is denied, and a project of another workspace is refused", async () => {
    const f = await engineFixture();
    const { app } = createApp();
    const { user: member, workspace } = await createWorkspaceMember({
      role: "owner",
    });
    const memberKey = await createPersonalApiKey(
      { userId: member.id },
      { name: "not admin", capabilities: ["instance:admin"], isMcp: true },
    );
    const denied = await req(
      app,
      memberKey.key,
      "/api/import-sources",
      post({
        workspaceId: workspace.id,
        pluginId: "import.bundle",
        name: `bundle-${randomUUID()}`,
        config: { bundleText: bundleFor(f), projectKey: "WEB" },
      }),
    );
    expect(denied.status).toBe(403);
    expect(await db.select().from(importSourceConnectionTable)).toHaveLength(0);

    // A project of another workspace is "not found", never an accepted mismatch.
    const foreign = await seedProject(workspace.id, member.id);
    const source = await call(
      app,
      f.key,
      "/api/import-sources",
      post({
        workspaceId: f.workspace.id,
        pluginId: "import.bundle",
        name: `bundle-${randomUUID()}`,
        config: { bundleText: bundleFor(f), projectKey: "WEB" },
      }),
      200,
    );
    const run = await req(
      app,
      f.key,
      `/api/import-sources/${source.id}/runs`,
      post({ projectId: foreign.project.id, sourceRef: "x" }),
    );
    expect([403, 404]).toContain(run.status);
  });

  it("refuses an invalid or oversize bundle at connect with a fixed reason", async () => {
    const f = await engineFixture();
    const { app } = createApp();
    const bad = await req(
      app,
      f.key,
      "/api/import-sources",
      post({
        workspaceId: f.workspace.id,
        pluginId: "import.bundle",
        name: `bundle-${randomUUID()}`,
        config: { bundleText: `${bundleFor(f)}\nnot json`, projectKey: "WEB" },
      }),
    );
    expect(bad.status).toBe(502);
    expect(await bad.json()).toMatchObject({ reason: "invalid_export" });
  });
});
