/**
 * P5 agile planning, modules: CRUD and lead rules (MO-1), one module per item and orthogonality
 * with cycles (MO-2, MO-3), progress and the range forecast (MO-4), deletion through the
 * pending-action flow, flag-off behaviour, permission and tenant denial.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { moduleTable } from "../../apps/api/src/database/schema-p5-agile";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  type AgileWorld,
  agileWorld,
  auditActionsFor,
  setAgileFlags,
} from "./helpers/p5-agile";
import {
  deleteThroughApproval,
  ensureAgentSession,
} from "./helpers/pending-deletion";

let w: AgileWorld;
beforeEach(async () => {
  await resetTestDatabase();
  w = await agileWorld();
});

type Mod = {
  id: string;
  name: string;
  state: string;
  version: number;
  targetDate: string | null;
  lead: { id: string; name: string | null } | null;
  progress: {
    total: number;
    completed: number;
    cancelled: number;
    remaining: number;
    percent: number;
  };
  forecast: { status: string; earliest?: string; latest?: string };
};

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

function createModule(
  body: Record<string, unknown>,
  user = w.manager.user,
  key = w.project.slug,
) {
  return w.call(user, `/api/projects/${key}/modules`, { method: "POST", body });
}
async function makeModule(
  body: Record<string, unknown> = { name: "Checkout" },
) {
  return w.json<Mod>(await createModule(body), 201);
}
function addItems(moduleId: string, keys: string[], user = w.manager.user) {
  return w.call(user, `/api/modules/${moduleId}/work-items`, {
    method: "POST",
    body: { workItemKeys: keys },
  });
}
const moduleIdOf = async (itemId: string) =>
  (
    await db
      .select({ moduleId: schema.workItemTable.moduleId })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, itemId))
  )[0]?.moduleId ?? null;

describe("module CRUD and the lead (MO-1)", () => {
  it("creates with a lead, state and target date, edits with a version, lists", async () => {
    const created = await makeModule({
      name: "Checkout",
      description: "Payments and basket",
      leadId: w.reader.personId,
      state: "in_progress",
      targetDate: day(30),
    });
    expect(created).toMatchObject({
      name: "Checkout",
      state: "in_progress",
      lead: { id: w.reader.personId },
    });
    expect(await auditActionsFor(created.id)).toContain("module.created");
    const edited = await w.json<Mod>(
      await w.call(w.manager.user, `/api/modules/${created.id}`, {
        method: "PATCH",
        body: { state: "paused", leadId: null, version: created.version },
      }),
    );
    expect(edited).toMatchObject({ state: "paused", lead: null });
    expect(
      (
        await w.call(w.manager.user, `/api/modules/${created.id}`, {
          method: "PATCH",
          body: { name: "Stale", version: created.version },
        })
      ).status,
    ).toBe(409);
    const list = await w.json<{
      data: Mod[];
      meta: { canManage: boolean; leadCandidates: unknown[] };
    }>(await w.call(w.manager.user, `/api/projects/${w.project.slug}/modules`));
    expect(list.data).toHaveLength(1);
    expect(list.meta.canManage).toBe(true);
    expect(list.meta.leadCandidates.length).toBeGreaterThan(0);
    const detail = await w.json<{ canManage: boolean; canEditItems: boolean }>(
      await w.call(w.manager.user, `/api/modules/${created.id}`),
    );
    expect(detail).toMatchObject({ canManage: true, canEditItems: true });
  });

  it("refuses a lead who is not staff of this workspace", async () => {
    const stranger = await createModule({
      name: "Bad",
      leadId: w.foreign.user.id,
    });
    expect(stranger.status).toBe(422);
    const [foreignPerson] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, w.foreign.user.id));
    const wrong = await createModule({
      name: "Bad",
      leadId: foreignPerson?.id,
    });
    expect(wrong.status).toBe(422);
    expect(await wrong.text()).toContain("module_lead_invalid");
  });
});

describe("membership (MO-2, MO-3)", () => {
  it("holds at most one module per item and is independent of cycles", async () => {
    const one = await makeModule({ name: "One" });
    const two = await makeModule({ name: "Two" });
    const item = await w.items.makeItem("Item");
    const foreign = await w.otherItems.makeItem("Elsewhere");
    const added = await w.json<{
      added: string[];
      refused: Array<{ key: string }>;
    }>(await addItems(one.id, [item.key, foreign.key]));
    expect(added.added).toEqual([item.key]);
    expect(added.refused.map((r) => r.key)).toEqual([foreign.key]);
    const moved = await w.json<{ movedFromOtherModule: string[] }>(
      await addItems(two.id, [item.key]),
    );
    expect(moved.movedFromOtherModule).toEqual([item.key]);
    expect(await moduleIdOf(item.id)).toBe(two.id);
    // orthogonal: the same item can be in a cycle at the same time
    const cycle = await w.json<{ id: string }>(
      await w.call(w.manager.user, `/api/projects/${w.project.slug}/cycles`, {
        method: "POST",
        body: { name: "Sprint", startDate: day(-2), endDate: day(5) },
      }),
      201,
    );
    await w.json(
      await w.call(w.manager.user, `/api/cycles/${cycle.id}/work-items`, {
        method: "POST",
        body: { workItemKeys: [item.key] },
      }),
    );
    const [row] = await db
      .select({
        cycleId: schema.workItemTable.cycleId,
        moduleId: schema.workItemTable.moduleId,
      })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, item.id));
    expect(row).toEqual({ cycleId: cycle.id, moduleId: two.id });
  });

  it("sets, clears and removes from the work item and the module", async () => {
    const m = await makeModule();
    const item = await w.items.makeItem("Item");
    const set = await w.call(
      w.manager.user,
      `/api/work-items/${item.key}/module`,
      {
        method: "PUT",
        body: { moduleId: m.id },
      },
    );
    expect(set.status, await set.clone().text()).toBe(200);
    expect(await moduleIdOf(item.id)).toBe(m.id);
    const removed = await w.call(
      w.manager.user,
      `/api/modules/${m.id}/work-items/${item.key}`,
      { method: "DELETE" },
    );
    expect(removed.status).toBe(200);
    expect(await moduleIdOf(item.id)).toBeNull();
    expect(
      (
        await w.call(
          w.manager.user,
          `/api/modules/${m.id}/work-items/${item.key}`,
          { method: "DELETE" },
        )
      ).status,
    ).toBe(404);
    const other = await w.json<Mod>(
      await createModule(
        { name: "Elsewhere" },
        w.manager.user,
        w.otherProject.slug,
      ),
      201,
    );
    expect(
      (
        await w.call(w.manager.user, `/api/work-items/${item.key}/module`, {
          method: "PUT",
          body: { moduleId: other.id },
        })
      ).status,
    ).toBe(404);
  });

  it("filters the project list by module", async () => {
    const m = await makeModule();
    const inside = await w.items.makeItem("Inside");
    await w.items.makeItem("Outside");
    await w.json(await addItems(m.id, [inside.key]));
    const list = await w.json<{
      data: Array<{ key: string; moduleId: string }>;
    }>(
      await w.call(
        w.manager.user,
        `/api/projects/${w.project.id}/work-items?module=${m.id}`,
      ),
    );
    expect(list.data.map((row) => row.key)).toEqual([inside.key]);
  });
});

describe("progress and forecast (MO-4)", () => {
  it("counts progress, treats cancelled as out of scope, and never extrapolates from little data", async () => {
    const m = await makeModule({ name: "Checkout", targetDate: day(30) });
    const done = await w.items.makeItem("Done", { group: "completed" });
    const open = await w.items.makeItem("Open", { group: "started" });
    const dropped = await w.items.makeItem("Dropped", { group: "cancelled" });
    await w.json(await addItems(m.id, [done.key, open.key, dropped.key]));
    const detail = await w.json<Mod>(
      await w.call(w.manager.user, `/api/modules/${m.id}`),
    );
    expect(detail.progress).toEqual({
      total: 3,
      completed: 1,
      cancelled: 1,
      remaining: 1,
      percent: 50,
    });
    expect(detail.forecast).toMatchObject({
      status: "insufficient_data",
    });
  });

  it("forecasts a range when the recent completion rate is known", async () => {
    const m = await makeModule({ name: "Checkout", targetDate: day(200) });
    const keys: string[] = [];
    for (let n = 0; n < 4; n++)
      keys.push((await w.items.makeItem(`d${n}`, { group: "completed" })).key);
    keys.push((await w.items.makeItem("left", { group: "started" })).key);
    await w.json(await addItems(m.id, keys));
    const detail = await w.json<Mod>(
      await w.call(w.manager.user, `/api/modules/${m.id}`),
    );
    expect(detail.forecast.status).toBe("on_track");
    expect(detail.forecast.earliest).toBeTruthy();
    expect(detail.forecast.latest).toBeTruthy();
    expect(
      (detail.forecast.earliest ?? "") <= (detail.forecast.latest ?? ""),
    ).toBe(true);
  });

  it("has no forecast without a target date", async () => {
    const m = await makeModule({ name: "Open ended" });
    expect(m.forecast).toEqual({ status: "no_target" });
  });
});

describe("deletion through the pending-action flow", () => {
  it("deletes after approval and keeps the items", async () => {
    await ensureAgentSession(w.manager.user.id);
    const m = await makeModule();
    const item = await w.items.makeItem("Survivor");
    await w.json(await addItems(m.id, [item.key]));
    mockAuthenticatedSession(w.manager.user);
    await deleteThroughApproval(w.app, w.manager.user, `/api/modules/${m.id}`, {
      afterRequest: async () => {
        const [still] = await db
          .select()
          .from(moduleTable)
          .where(eq(moduleTable.id, m.id));
        expect(still).toBeDefined();
      },
    });
    expect(
      await db.select().from(moduleTable).where(eq(moduleTable.id, m.id)),
    ).toHaveLength(0);
    expect(await moduleIdOf(item.id)).toBeNull();
    expect(await auditActionsFor(m.id)).toContain("module.deleted");
  });
});

describe("flag, permission and tenant behaviour", () => {
  it("hides modules while feature.modules is off (independent of cycles) and restores them", async () => {
    const m = await makeModule();
    await setAgileFlags(w.project.id, { modules: false });
    for (const path of [
      `/api/projects/${w.project.slug}/modules`,
      `/api/modules/${m.id}`,
    ]) {
      const response = await w.call(w.manager.user, path);
      expect(response.status, path).toBe(404);
      expect(await response.text()).toContain("feature_disabled");
    }
    expect((await createModule({ name: "New" })).status).toBe(404);
    // cycles are unaffected
    expect(
      (await w.call(w.manager.user, `/api/projects/${w.project.slug}/cycles`))
        .status,
    ).toBe(200);
    await setAgileFlags(w.project.id, { modules: true });
    expect((await w.call(w.manager.user, `/api/modules/${m.id}`)).status).toBe(
      200,
    );
  });

  it("lets a reader see but not change; an outsider gets 404", async () => {
    const m = await makeModule();
    const item = await w.items.makeItem("Item");
    expect((await w.call(w.reader.user, `/api/modules/${m.id}`)).status).toBe(
      200,
    );
    expect((await createModule({ name: "No" }, w.reader.user)).status).toBe(
      403,
    );
    expect(
      (
        await w.call(w.reader.user, `/api/modules/${m.id}`, {
          method: "PATCH",
          body: { name: "x", version: 1 },
        })
      ).status,
    ).toBe(403);
    expect((await addItems(m.id, [item.key], w.reader.user)).status).toBe(403);
    expect(
      (
        await w.call(w.reader.user, `/api/modules/${m.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(403);
    expect((await w.call(w.outsider.user, `/api/modules/${m.id}`)).status).toBe(
      404,
    );
  });

  it("never leaks across tenants", async () => {
    const m = await makeModule();
    const theirs = await w.json<Mod>(
      await createModule(
        { name: "Theirs" },
        w.foreign.user,
        w.foreignProject.slug,
      ),
      201,
    );
    expect((await w.call(w.foreign.user, `/api/modules/${m.id}`)).status).toBe(
      404,
    );
    expect(
      (await w.call(w.manager.user, `/api/modules/${theirs.id}`)).status,
    ).toBe(404);
    expect(
      (await w.call(w.foreign.user, `/api/projects/${w.project.slug}/modules`))
        .status,
    ).toBe(404);
    const item = await w.items.makeItem("Mine");
    expect((await addItems(theirs.id, [item.key])).status).toBe(404);
  });
});
