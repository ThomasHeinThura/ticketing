import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPersonalApiKey } from "../../../apps/api/src/api-key/service";
import db, { schema } from "../../../apps/api/src/database";
import { importReconciliationTable } from "../../../apps/api/src/database/schema-import-reconciliation";
import { unregisterImportAdapter } from "../../../apps/api/src/imports/engine/adapter";
import {
  runImportRun,
  setImportEngineAutoStart,
} from "../../../apps/api/src/imports/engine/runner";
import { clearFakeFixtures } from "../../../apps/api/src/imports/engine/test-adapter";
import { createApp } from "../../../apps/api/src/index";
import { resetTestDatabase } from "../helpers/database";
import { createWorkspaceMember } from "../helpers/fixtures";
import {
  call,
  confirmAll,
  dryRunAndExecuteBody,
  engineFixture,
  makeRecords,
  post,
  registerFake,
  req,
  setFakeFixture,
  startRun,
} from "./engine-helpers";

beforeEach(async () => {
  await resetTestDatabase();
  setImportEngineAutoStart(false);
  clearFakeFixtures();
  registerFake(10);
});
afterEach(() => unregisterImportAdapter("import.mcp"));

type F = Awaited<ReturnType<typeof engineFixture>>;
// biome-ignore lint/suspicious/noExplicitAny: loose JSON assertions
type Json = Record<string, any>;

/** The real app: the reconciliation routes are mounted by `createImportRouter`, caller set by API key. */
const { app: realApp } = createApp();
const get = (key: string, runId: string) =>
  req(realApp, key, `/api/imports/${runId}/reconciliation`);
const recompute = (key: string, runId: string, idempotencyKey = randomUUID()) =>
  req(realApp, key, `/api/imports/${runId}/reconciliation`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
  });
async function ok(response: Response | Promise<Response>) {
  const r = await response;
  const text = await r.clone().text();
  expect(r.status, text).toBe(200);
  return (await r.json()) as Json;
}

async function completedRun(
  f: F,
  fixtureId: string,
  records = makeRecords(f.type.key, 12),
  sourceRef = fixtureId,
) {
  setFakeFixture(fixtureId, { records });
  const { app } = createApp();
  const { run, mapping } = await startRun(app, f, fixtureId, sourceRef);
  await confirmAll(app, f.key, run.id, mapping.mappingVersion);
  const dry = await dryRunAndExecuteBody(app, f.key, run.id);
  await call(app, f.key, `/api/imports/${run.id}/execute`, post(dry.body), 202);
  expect(await runImportRun(run.id)).toMatchObject({ status: "completed" });
  return { app, run };
}

const itemFor = async (runId: string, sourceId: string) => {
  const [link] = await db
    .select()
    .from(schema.importRecordLinkTable)
    .where(
      and(
        eq(schema.importRecordLinkTable.importRunId, runId),
        eq(schema.importRecordLinkTable.sourceId, sourceId),
      ),
    );
  return link?.targetId as string;
};

describe("import reconciliation", () => {
  it("reconciles a clean run: counts match, snapshot persists, GET is read-only", async () => {
    const f = await engineFixture();
    const { run } = await completedRun(f, "clean");
    const before = await ok(get(f.key, run.id));
    expect(before.reconciliation).toBeNull();
    expect(await db.select().from(importReconciliationTable)).toHaveLength(0);

    const first = (await ok(recompute(f.key, run.id))).reconciliation;
    expect(first).toMatchObject({
      runId: run.id,
      version: 1,
      sourceAvailable: true,
    });
    for (const row of first.rows) expect(row.source, row.key).toBe(row.target);
    expect(first.rows.map((r: Json) => r.key)).toEqual(
      expect.arrayContaining(["total", "linked", "source_type:issue"]),
    );
    expect(first.rows.find((r: Json) => r.key === "linked")).toMatchObject({
      source: 12,
      target: 12,
    });
    // Whatever the writer reports as lossy is a warning; no invariant may fail.
    expect(
      first.checks.filter((c: Json) => !c.ok && c.severity === "fail"),
    ).toEqual([]);
    expect(["pass", "attention"]).toContain(first.status);
    expect(first.spotCheck.items).toHaveLength(12);
    expect(first.spotCheck.items[0]).toMatchObject({
      sourceType: "issue",
      sourceUrl: expect.stringMatching(/^https:\/\/source\.example\.test\//u),
    });
    expect(first.spotCheck.items[0].targetKey).toEqual(expect.any(String));

    const stored = await ok(get(f.key, run.id));
    expect(stored.reconciliation).toMatchObject({
      version: 1,
      status: first.status,
    });
    const second = (await ok(recompute(f.key, run.id))).reconciliation;
    expect(second.version).toBe(2);
    expect(await db.select().from(importReconciliationTable)).toHaveLength(1);
  });

  it("requires an Idempotency-Key on recompute", async () => {
    const f = await engineFixture();
    const { run } = await completedRun(f, "idem");
    const response = await req(
      realApp,
      f.key,
      `/api/imports/${run.id}/reconciliation`,
      { method: "POST" },
    );
    expect(response.status).toBe(400);
  });

  it("shows a rejected row and a loss", async () => {
    const f = await engineFixture();
    const records = makeRecords(f.type.key, 6);
    records.push({ ...records[0], title: "Duplicate of SRC-1" } as never);
    records[1] = {
      ...records[1],
      losses: [{ code: "rich_text_lossy" }],
    } as never;
    const { run } = await completedRun(f, "rejects", records as never);
    const out = (await ok(recompute(f.key, run.id))).reconciliation;
    expect(out.run.stats).toMatchObject({
      created: 6,
      rejected: 1,
      processed: 7,
    });
    expect(out.rows.find((r: Json) => r.key === "rejected")).toMatchObject({
      source: 1,
      target: 1,
    });
    expect(out.rows.find((r: Json) => r.key === "linked")).toMatchObject({
      source: 6,
      target: 6,
    });
    expect(out.rejections).toEqual([
      { code: "duplicate_source_record", count: 1 },
    ]);
    const codes = out.losses.byCode.map((g: Json) => g.code);
    expect(codes).toEqual(
      expect.arrayContaining(["rich_text_lossy", "record_rejected"]),
    );
    expect(
      out.checks.find((c: Json) => c.code === "no_rejections"),
    ).toMatchObject({ ok: false });
    expect(out.status).toBe("attention");
  });

  it("reports a dangling parent and a dangling link, and fails", async () => {
    const f = await engineFixture();
    const { run } = await completedRun(f, "dangling");
    const parent = await itemFor(run.id, "SRC-1");
    const child = await itemFor(run.id, "SRC-2");
    const hardDeleted = await itemFor(run.id, "SRC-3");
    await db
      .update(schema.workItemTable)
      .set({ parentId: parent })
      .where(eq(schema.workItemTable.id, child));
    await db
      .update(schema.workItemTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.workItemTable.id, parent));
    await db
      .delete(schema.workItemTable)
      .where(eq(schema.workItemTable.id, hardDeleted));

    const out = (await ok(recompute(f.key, run.id))).reconciliation;
    expect(out.status).toBe("fail");
    expect(out.hierarchy.danglingParents.count).toBe(1);
    expect(out.hierarchy.danglingParents.sample[0]).toMatchObject({
      sourceId: "SRC-2",
      problem: "parent_deleted",
    });
    // SRC-1 (soft-deleted) and SRC-3 (hard-deleted) both lost their target.
    expect(out.danglingLinks.count).toBe(2);
    expect(
      out.danglingLinks.sample.map((s: Json) => s.sourceId).sort(),
    ).toEqual(["SRC-1", "SRC-3"]);
    expect(out.rows.find((r: Json) => r.key === "linked")).toMatchObject({
      source: 12,
      target: 10,
    });
    const failed = out.checks.filter(
      (c: Json) => !c.ok && c.severity === "fail",
    );
    expect(failed.map((c: Json) => c.code)).toEqual(
      expect.arrayContaining([
        "targets_linked",
        "no_dangling_links",
        "no_dangling_parents",
      ]),
    );
  });

  it("reports an unresolved deferred link and a relation to a deleted item", async () => {
    const f = await engineFixture();
    const { run } = await completedRun(f, "deferred");
    const a = await itemFor(run.id, "SRC-1");
    const b = await itemFor(run.id, "SRC-2");
    await db.insert(schema.workItemRelationTable).values({
      sourceId: a,
      targetId: b,
      type: "blocks",
    });
    await db
      .update(schema.workItemTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.workItemTable.id, b));
    await db
      .update(schema.importProvenanceTable)
      .set({
        deferredLinks: {
          self: { sourceType: "issue", sourceId: "SRC-4" },
          parent: { sourceType: "issue", sourceId: "MISSING" },
        },
      })
      .where(
        and(
          eq(
            schema.importProvenanceTable.workItemId,
            await itemFor(run.id, "SRC-4"),
          ),
          eq(schema.importProvenanceTable.entityType, "work_item"),
        ),
      );
    const out = (await ok(recompute(f.key, run.id))).reconciliation;
    expect(out.relations.danglingRelations.count).toBe(1);
    expect(out.relations.danglingRelations.sample[0]).toMatchObject({
      type: "blocks",
      problem: "other_end_deleted",
    });
    expect(out.hierarchy.unresolved.count).toBe(1);
    expect(out.hierarchy.unresolved.sample[0]).toMatchObject({
      sourceType: "issue",
      sourceId: "SRC-4",
    });
    expect(out.status).toBe("fail");
  });

  it("reports a stale link", async () => {
    const f = await engineFixture();
    const { run } = await completedRun(f, "stale");
    await db
      .update(schema.importRecordLinkTable)
      .set({ staleAt: new Date() })
      .where(
        and(
          eq(schema.importRecordLinkTable.importRunId, run.id),
          eq(schema.importRecordLinkTable.sourceId, "SRC-5"),
        ),
      );
    const out = (await ok(recompute(f.key, run.id))).reconciliation;
    expect(out.staleLinks.links).toBe(1);
    expect(out.staleLinks.sample[0]).toMatchObject({
      sourceId: "SRC-5",
      sourceUrl: "https://source.example.test/browse/SRC-5",
    });
    expect(
      out.checks.find((c: Json) => c.code === "no_stale_links"),
    ).toMatchObject({ ok: false, severity: "warn", actual: 1 });
  });

  it("draws at most 20 spot-check items, reproducible from the stored seed", async () => {
    const f = await engineFixture();
    const { run } = await completedRun(f, "spot", makeRecords(f.type.key, 30));
    const out = (await ok(recompute(f.key, run.id))).reconciliation;
    expect(out.spotCheck.items).toHaveLength(20);
    expect(new Set(out.spotCheck.items.map((i: Json) => i.sourceId)).size).toBe(
      20,
    );
    const [row] = await db.select().from(importReconciliationTable);
    expect(row?.seed).toBe(out.spotCheck.seed);
  });

  it("without a whole-run dry run the source side is unavailable and never passes", async () => {
    const f = await engineFixture();
    setFakeFixture("nosrc", { records: makeRecords(f.type.key, 3) });
    const { app } = createApp();
    const { run } = await startRun(app, f, "nosrc");
    const out = (await ok(recompute(f.key, run.id))).reconciliation;
    expect(out).toMatchObject({
      sourceAvailable: false,
      rows: [],
      status: "attention",
    });
  });

  it("denies a non-admin, hides another tenant's run and reports 404 for an unknown run", async () => {
    const f = await engineFixture();
    const { run } = await completedRun(f, "authz");
    const member = await createWorkspaceMember({ role: "member" });
    const memberKey = await createPersonalApiKey(
      { userId: member.user.id },
      { name: "member", capabilities: ["work_item:read"], isMcp: true },
    );
    expect((await get(memberKey.key, run.id)).status).toBe(403);
    expect((await recompute(memberKey.key, run.id)).status).toBe(403);
    expect((await get(f.key, "missing-run")).status).toBe(404);

    // Another workspace's instance administrator has no reach into this run's project.
    const other = await engineFixture();
    // Denied without leaking data (the engine routes answer the same way: reach or capability).
    expect([403, 404]).toContain((await get(other.key, run.id)).status);
    expect([403, 404]).toContain((await recompute(other.key, run.id)).status);
    expect(await db.select().from(importReconciliationTable)).toHaveLength(0);
  });

  it("scopes counts to the run's workspace when two tenants import the same source reference", async () => {
    const a = await engineFixture();
    const b = await engineFixture();
    const runA = (
      await completedRun(a, "tenant-a", makeRecords(a.type.key, 5), "SHARED")
    ).run;
    const runB = (
      await completedRun(b, "tenant-b", makeRecords(b.type.key, 3), "SHARED")
    ).run;
    const outA = (await ok(recompute(a.key, runA.id))).reconciliation;
    const outB = (await ok(recompute(b.key, runB.id))).reconciliation;
    expect(outA.rows.find((r: Json) => r.key === "linked")).toMatchObject({
      source: 5,
      target: 5,
    });
    expect(outB.rows.find((r: Json) => r.key === "linked")).toMatchObject({
      source: 3,
      target: 3,
    });
    expect(outA.spotCheck.items).toHaveLength(5);
    expect(outB.spotCheck.items).toHaveLength(3);
  });
});
