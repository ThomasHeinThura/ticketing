/**
 * VW-12: optional work-in-progress limits on board columns (project states): set, change, clear,
 * validation, permission and tenant denial. VW-28: the dependency edges the timeline draws. Neither
 * is behind a feature flag.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import {
  type AgileWorld,
  agileWorld,
  auditActionsFor,
} from "./helpers/p5-agile";

let w: AgileWorld;
beforeEach(async () => {
  await resetTestDatabase();
  w = await agileWorld({});
});

async function stateIds(projectId: string) {
  return (
    await db
      .select({ id: schema.stateTable.id })
      .from(schema.stateTable)
      .where(eq(schema.stateTable.projectId, projectId))
  ).map((row) => row.id);
}
const put = (
  stateId: string,
  limit: unknown,
  user = w.manager.user,
  key = w.project.slug,
) =>
  w.call(user, `/api/projects/${key}/wip-limits/${stateId}`, {
    method: "PUT",
    body: { limit },
  });
const list = (user = w.manager.user, key = w.project.slug) =>
  w.call(user, `/api/projects/${key}/wip-limits`);

describe("column WIP limits (VW-12)", () => {
  it("sets, changes and clears a limit, and audits each change", async () => {
    const [stateId] = await stateIds(w.project.id);
    expect(await w.json(await list())).toEqual({ data: [], canManage: true });
    expect(await w.json(await put(stateId as string, 3))).toEqual({
      stateId,
      limit: 3,
    });
    expect(await w.json(await put(stateId as string, 5))).toMatchObject({
      limit: 5,
    });
    const after = await w.json<{
      data: Array<{ stateId: string; limit: number }>;
    }>(await list());
    expect(after.data).toEqual([{ stateId, limit: 5 }]);
    expect(await w.json(await put(stateId as string, null))).toEqual({
      stateId,
      limit: null,
    });
    expect((await w.json<{ data: unknown[] }>(await list())).data).toEqual([]);
    expect(
      (await auditActionsFor(stateId as string)).filter(
        (action) => action === "state.wip_limit_changed",
      ),
    ).toHaveLength(3);
  });

  it("validates the limit", async () => {
    const [stateId] = await stateIds(w.project.id);
    for (const bad of [0, -1, 1.5, 1001, "3"])
      expect((await put(stateId as string, bad)).status, String(bad)).toBe(400);
  });

  it("refuses a state of another project or workspace (404)", async () => {
    const [otherState] = await stateIds(w.otherProject.id);
    expect((await put(otherState as string, 2)).status).toBe(404);
    const [foreignState] = await stateIds(w.foreignProject.id);
    expect((await put(foreignState as string, 2)).status).toBe(404);
  });

  it("lets a reader see but not set; an outsider and another tenant get 404", async () => {
    const [stateId] = await stateIds(w.project.id);
    await w.json(await put(stateId as string, 2));
    expect(
      (await w.json<{ canManage: boolean }>(await list(w.reader.user)))
        .canManage,
    ).toBe(false);
    expect((await put(stateId as string, 4, w.reader.user)).status).toBe(403);
    expect((await list(w.outsider.user)).status).toBe(404);
    expect((await put(stateId as string, 4, w.outsider.user)).status).toBe(404);
    expect((await list(w.foreign.user)).status).toBe(404);
    expect((await put(stateId as string, 4, w.foreign.user)).status).toBe(404);
  });
});

describe("dependency edges (VW-28)", () => {
  it("returns blocks and precedes edges inside the project only, filterable by type", async () => {
    const a = await w.items.makeItem("A");
    const b = await w.items.makeItem("B");
    const c = await w.items.makeItem("C");
    const elsewhere = await w.otherItems.makeItem("Elsewhere");
    const gone = await w.items.makeItem("Gone");
    await db.insert(schema.workItemRelationTable).values([
      { sourceId: a.id, targetId: b.id, type: "blocks" },
      { sourceId: b.id, targetId: c.id, type: "precedes" },
      { sourceId: a.id, targetId: c.id, type: "relates" },
      { sourceId: a.id, targetId: elsewhere.id, type: "blocks" },
      { sourceId: gone.id, targetId: a.id, type: "blocks" },
    ]);
    await db
      .update(schema.workItemTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.workItemTable.id, gone.id));
    const all = await w.json<{
      data: Array<{ type: string; sourceKey: string; targetKey: string }>;
    }>(
      await w.call(
        w.manager.user,
        `/api/projects/${w.project.slug}/dependencies`,
      ),
    );
    expect(
      all.data.map((e) => `${e.sourceKey}>${e.targetKey}:${e.type}`).sort(),
    ).toEqual(
      [`${a.key}>${b.key}:blocks`, `${b.key}>${c.key}:precedes`].sort(),
    );
    const onlyBlocks = await w.json<{ data: unknown[] }>(
      await w.call(
        w.manager.user,
        `/api/projects/${w.project.slug}/dependencies?types=blocks`,
      ),
    );
    expect(onlyBlocks.data).toHaveLength(1);
    expect(
      (
        await w.call(
          w.manager.user,
          `/api/projects/${w.project.slug}/dependencies?types=relates`,
        )
      ).status,
    ).toBe(400);
  });

  it("is visible to a reader and denied to an outsider and another tenant", async () => {
    const path = `/api/projects/${w.project.slug}/dependencies`;
    expect((await w.call(w.reader.user, path)).status).toBe(200);
    expect((await w.call(w.outsider.user, path)).status).toBe(404);
    expect((await w.call(w.foreign.user, path)).status).toBe(404);
  });
});
