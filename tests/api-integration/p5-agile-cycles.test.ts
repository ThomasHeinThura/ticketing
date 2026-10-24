/**
 * P5 agile planning, cycles: CRUD and the no-overlap refusal (CY-1, CY-2), derived status (CY-3),
 * one cycle per item and bulk add (CY-4, CY-5), completion with the project policy (CY-6), scope
 * change and the burndown (CY-7, CY-8), velocity (CY-9), deletion through the pending-action
 * flow, flag-off behaviour, permission and tenant denial.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  cycleScopeEventTable,
  cycleTable,
} from "../../apps/api/src/database/schema-p5-agile";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  grantProjectRole,
  WORK_ITEM_PROJECT_CAPABILITIES,
} from "./helpers/fixtures";
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

type Cycle = {
  id: string;
  name: string;
  status: string;
  version: number;
  startDate: string;
  endDate: string;
  completedAt: string | null;
  summary: {
    total: { count: number; points: number };
    completed: { count: number };
    unestimated: { count: number; share: number };
  };
};

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function createCycle(
  name: string,
  startOffset: number,
  endOffset: number,
  user = w.manager.user,
  projectKey = w.project.slug,
) {
  return w.call(user, `/api/projects/${projectKey}/cycles`, {
    method: "POST",
    body: { name, startDate: day(startOffset), endDate: day(endOffset) },
  });
}
async function makeCycle(name: string, startOffset: number, endOffset: number) {
  return w.json<Cycle>(await createCycle(name, startOffset, endOffset), 201);
}
function addItems(cycleId: string, keys: string[], user = w.manager.user) {
  return w.call(user, `/api/cycles/${cycleId}/work-items`, {
    method: "POST",
    body: { workItemKeys: keys },
  });
}

describe("cycle CRUD, status and overlap (CY-1..CY-3)", () => {
  it("creates by project key or id, derives status, lists newest first", async () => {
    const past = await makeCycle("Past", -20, -7);
    const active = await makeCycle("Active", -3, 4);
    const next = await makeCycle("Next", 5, 12);
    expect([past.status, active.status, next.status]).toEqual([
      "completed",
      "active",
      "upcoming",
    ]);
    const list = await w.json<{
      data: Cycle[];
      meta: { velocity: { status: string }; canManage: boolean; unit: string };
    }>(await w.call(w.manager.user, `/api/projects/${w.project.id}/cycles`));
    expect(list.data.map((c) => c.name)).toEqual(["Next", "Active", "Past"]);
    expect(list.meta).toMatchObject({
      canManage: true,
      unit: "count",
      velocity: { status: "insufficient_data" },
    });
    expect(await auditActionsFor(active.id)).toContain("cycle.created");
  });

  it("cannot set status by hand and refuses invalid dates", async () => {
    const created = await makeCycle("Sprint", -2, 5);
    const status = await w.call(w.manager.user, `/api/cycles/${created.id}`, {
      method: "PATCH",
      body: { status: "completed" },
    });
    expect(status.status).toBe(400);
    const backwards = await w.call(
      w.manager.user,
      `/api/projects/${w.project.slug}/cycles`,
      {
        method: "POST",
        body: { name: "Bad", startDate: day(9), endDate: day(2) },
      },
    );
    expect(backwards.status).toBe(422);
    const rubbish = await w.call(
      w.manager.user,
      `/api/projects/${w.project.slug}/cycles`,
      {
        method: "POST",
        body: { name: "Bad", startDate: "2026-02-30", endDate: "2026-03-02" },
      },
    );
    expect(rubbish.status).toBe(422);
  });

  it("refuses an overlapping cycle and names the conflicting one (CY-2)", async () => {
    const first = await makeCycle("Sprint 1", 0, 13);
    const overlap = await createCycle("Sprint 1b", 13, 20);
    const body = await w.json<{
      message: string;
      conflictingCycle: { id: string; name: string };
    }>(overlap, 409);
    expect(body.message).toBe("cycle_overlap");
    expect(body.conflictingCycle).toMatchObject({
      id: first.id,
      name: "Sprint 1",
    });
    // back to back is fine
    expect((await createCycle("Sprint 2", 14, 27)).status).toBe(201);
    // moving dates into another cycle is refused the same way
    const second = await w.json<{ data: Cycle[] }>(
      await w.call(w.manager.user, `/api/projects/${w.project.slug}/cycles`),
    );
    const sprint2 = second.data.find((c) => c.name === "Sprint 2") as Cycle;
    const move = await w.call(w.manager.user, `/api/cycles/${sprint2.id}`, {
      method: "PATCH",
      body: { startDate: day(10), version: sprint2.version },
    });
    expect(move.status).toBe(409);
    expect(await move.text()).toContain("Sprint 1");
  });

  it("refuses two concurrent overlapping creates (one wins)", async () => {
    const results = await Promise.all([
      createCycle("Race A", 40, 50),
      createCycle("Race B", 45, 55),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it("renames with optimistic concurrency", async () => {
    const created = await makeCycle("Sprint", 0, 6);
    const renamed = await w.json<Cycle>(
      await w.call(w.manager.user, `/api/cycles/${created.id}`, {
        method: "PATCH",
        body: { name: "Sprint renamed", version: created.version },
      }),
    );
    expect(renamed.name).toBe("Sprint renamed");
    expect(renamed.version).toBe(created.version + 1);
    const stale = await w.call(w.manager.user, `/api/cycles/${created.id}`, {
      method: "PATCH",
      body: { name: "Stale", version: created.version },
    });
    expect(stale.status).toBe(409);
  });
});

describe("adding items (CY-4, CY-5, CY-8)", () => {
  it("adds in bulk, moves an item out of another cycle, refuses foreign keys", async () => {
    const one = await makeCycle("One", -5, 4);
    const two = await makeCycle("Two", 5, 12);
    const a = await w.items.makeItem("A");
    const b = await w.items.makeItem("B");
    const foreign = await w.otherItems.makeItem("Other project");
    const result = await w.json<{
      added: string[];
      refused: Array<{ key: string; reason: string }>;
    }>(await addItems(one.id, [a.key, b.key, foreign.key, "NOPE-1"]));
    expect(result.added.sort()).toEqual([a.key, b.key].sort());
    expect(result.refused.map((r) => r.key).sort()).toEqual(
      [foreign.key, "NOPE-1"].sort(),
    );
    expect(result.refused.every((r) => r.reason === "not_found")).toBe(true);

    const moved = await w.json<{
      added: string[];
      movedFromOtherCycle: string[];
      alreadyInCycle: string[];
    }>(await addItems(two.id, [a.key]));
    expect(moved.movedFromOtherCycle).toEqual([a.key]);
    const [row] = await db
      .select({ cycleId: schema.workItemTable.cycleId })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, a.id));
    expect(row?.cycleId).toBe(two.id);
    const again = await w.json<{ alreadyInCycle: string[] }>(
      await addItems(two.id, [a.key]),
    );
    expect(again.alreadyInCycle).toEqual([a.key]);
    // one cycle at most: the old cycle logged a removal
    const events = await db
      .select()
      .from(cycleScopeEventTable)
      .where(
        and(
          eq(cycleScopeEventTable.cycleId, one.id),
          eq(cycleScopeEventTable.workItemId, a.id),
        ),
      );
    expect(events.map((e) => e.kind).sort()).toEqual(["added", "removed"]);
  });

  it("marks items added after the start as scope change and after the end as retrospective", async () => {
    const active = await makeCycle("Active", -3, 4);
    const ended = await makeCycle("Ended", -30, -20);
    const late = await w.items.makeItem("Late");
    const backfill = await w.items.makeItem("Backfill");
    await w.json(await addItems(active.id, [late.key]));
    await w.json(await addItems(ended.id, [backfill.key]));
    const detail = await w.json<{
      scopeChanges: Array<{
        workItemKey: string;
        kind: string;
        retrospective: boolean;
      }>;
    }>(await w.call(w.manager.user, `/api/cycles/${active.id}`));
    expect(detail.scopeChanges).toEqual([
      expect.objectContaining({
        workItemKey: late.key,
        kind: "added",
        retrospective: false,
      }),
    ]);
    const endedDetail = await w.json<{
      scopeChanges: Array<{ workItemKey: string; retrospective: boolean }>;
    }>(await w.call(w.manager.user, `/api/cycles/${ended.id}`));
    expect(endedDetail.scopeChanges[0]).toMatchObject({
      workItemKey: backfill.key,
      retrospective: true,
    });
  });

  it("removes an item and logs it", async () => {
    const cycle = await makeCycle("Active", -3, 4);
    const item = await w.items.makeItem("Item");
    await w.json(await addItems(cycle.id, [item.key]));
    const removed = await w.call(
      w.manager.user,
      `/api/cycles/${cycle.id}/work-items/${item.key}`,
      { method: "DELETE" },
    );
    expect(removed.status, await removed.clone().text()).toBe(200);
    const again = await w.call(
      w.manager.user,
      `/api/cycles/${cycle.id}/work-items/${item.key}`,
      { method: "DELETE" },
    );
    expect(again.status).toBe(404);
    const detail = await w.json<{
      scopeChanges: Array<{ kind: string }>;
    }>(await w.call(w.manager.user, `/api/cycles/${cycle.id}`));
    expect(detail.scopeChanges.map((c) => c.kind)).toEqual([
      "added",
      "removed",
    ]);
  });

  it("sets and clears an item's cycle from the work item (PUT)", async () => {
    const cycle = await makeCycle("Active", -3, 4);
    const item = await w.items.makeItem("Item");
    const set = await w.call(
      w.manager.user,
      `/api/work-items/${item.key}/cycle`,
      {
        method: "PUT",
        body: { cycleId: cycle.id },
      },
    );
    expect(set.status, await set.clone().text()).toBe(200);
    const [row] = await db
      .select({ cycleId: schema.workItemTable.cycleId })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, item.id));
    expect(row?.cycleId).toBe(cycle.id);
    const clear = await w.call(
      w.manager.user,
      `/api/work-items/${item.key}/cycle`,
      { method: "PUT", body: { cycleId: null } },
    );
    expect(clear.status).toBe(200);
    // a cycle of another project is refused
    const otherCycle = await w.json<Cycle>(
      await createCycle("Other", -3, 4, w.manager.user, w.otherProject.slug),
      201,
    );
    const wrong = await w.call(
      w.manager.user,
      `/api/work-items/${item.key}/cycle`,
      { method: "PUT", body: { cycleId: otherCycle.id } },
    );
    expect(wrong.status).toBe(404);
  });

  it("lists a cycle's items through the project work-item list", async () => {
    const cycle = await makeCycle("Active", -3, 4);
    const inCycle = await w.items.makeItem("In");
    await w.items.makeItem("Out");
    await w.json(await addItems(cycle.id, [inCycle.key]));
    const list = await w.json<{
      data: Array<{ key: string; cycleId: string }>;
    }>(
      await w.call(
        w.manager.user,
        `/api/projects/${w.project.id}/work-items?cycle=${cycle.id}`,
      ),
    );
    expect(list.data.map((row) => row.key)).toEqual([inCycle.key]);
    expect(list.data[0]?.cycleId).toBe(cycle.id);
  });
});

describe("completion (CY-6) and velocity (CY-9)", () => {
  async function seeded() {
    const done = await makeCycle("Done soon", -10, -1);
    const next = await makeCycle("Next", 0, 7);
    const finished = await w.items.makeItem("Finished", { group: "completed" });
    const open = await w.items.makeItem("Open", { group: "started" });
    const queued = await w.items.makeItem("Queued", { group: "backlog" });
    await w.json(await addItems(done.id, [finished.key, open.key, queued.key]));
    return { done, next, finished, open, queued };
  }
  const complete = (id: string, body: unknown) =>
    w.call(w.manager.user, `/api/cycles/${id}/complete`, {
      method: "POST",
      body,
    });
  const cycleOf = async (id: string) =>
    (
      await db
        .select({ cycleId: schema.workItemTable.cycleId })
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, id))
    )[0]?.cycleId ?? null;

  it("previews with a dry run without changing anything, then moves per the chosen policy", async () => {
    const s = await seeded();
    const detail = await w.json<{
      completionPreview: {
        defaultPolicy: string;
        incompleteCount: number;
        nextCycle: { id: string } | null;
      };
    }>(await w.call(w.manager.user, `/api/cycles/${s.done.id}`));
    expect(detail.completionPreview).toMatchObject({
      defaultPolicy: "backlog",
      incompleteCount: 2,
      nextCycle: { id: s.next.id },
    });
    const dry = await w.json<{ movedCount: number; dryRun: boolean }>(
      await complete(s.done.id, {
        incompletePolicy: "next_cycle",
        dryRun: true,
      }),
    );
    expect(dry).toMatchObject({ dryRun: true, movedCount: 2 });
    expect(await cycleOf(s.open.id)).toBe(s.done.id);
    const real = await w.json<{
      policy: string;
      movedCount: number;
      destinationCycle: { id: string } | null;
    }>(await complete(s.done.id, { incompletePolicy: "next_cycle" }));
    expect(real).toMatchObject({
      policy: "next_cycle",
      movedCount: 2,
      destinationCycle: { id: s.next.id },
    });
    expect(await cycleOf(s.open.id)).toBe(s.next.id);
    expect(await cycleOf(s.queued.id)).toBe(s.next.id);
    expect(await cycleOf(s.finished.id)).toBe(s.done.id);
    expect(await auditActionsFor(s.done.id)).toContain("cycle.completed");
    // the completed cycle keeps what it delivered
    const frozen = await w.json<Cycle>(
      await w.call(w.manager.user, `/api/cycles/${s.done.id}`),
    );
    expect(frozen.status).toBe("completed");
    expect(frozen.summary.total.count).toBe(3);
    expect(frozen.summary.completed.count).toBe(1);
    // and cannot be completed twice
    expect((await complete(s.done.id, {})).status).toBe(409);
  });

  it("uses the project default when no policy is chosen, and honours backlog and leave", async () => {
    const s = await seeded();
    const settings = await w.json<{
      incompletePolicy: string;
      version: number;
    }>(
      await w.call(
        w.manager.user,
        `/api/projects/${w.project.slug}/agile-settings`,
        { method: "PATCH", body: { incompletePolicy: "leave" } },
      ),
    );
    expect(settings.incompletePolicy).toBe("leave");
    const result = await w.json<{ policy: string; leftCount: number }>(
      await complete(s.done.id, {}),
    );
    expect(result).toMatchObject({ policy: "leave", leftCount: 2 });
    expect(await cycleOf(s.open.id)).toBe(s.done.id);
  });

  it("sends incomplete items to the backlog", async () => {
    const s = await seeded();
    await w.json(await complete(s.done.id, { incompletePolicy: "backlog" }));
    expect(await cycleOf(s.open.id)).toBeNull();
    expect(await cycleOf(s.finished.id)).toBe(s.done.id);
  });

  it("refuses next_cycle without a next cycle (nothing is dropped)", async () => {
    const lonely = await makeCycle("Lonely", -10, -1);
    const open = await w.items.makeItem("Open", { group: "started" });
    await w.json(await addItems(lonely.id, [open.key]));
    const refused = await complete(lonely.id, {
      incompletePolicy: "next_cycle",
    });
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain("no_next_cycle");
    expect(await cycleOf(open.id)).toBe(lonely.id);
  });

  it("allows completing a cycle where everything is incomplete", async () => {
    const c = await makeCycle("Hopeless", -5, 5);
    const open = await w.items.makeItem("Open", { group: "started" });
    await w.json(await addItems(c.id, [open.key]));
    const ok = await w.json<{ movedCount: number }>(
      await complete(c.id, { incompletePolicy: "backlog" }),
    );
    expect(ok.movedCount).toBe(1);
    const burndown = await w.json<{
      points: Array<{ remaining: number; scope: number }>;
    }>(await w.call(w.manager.user, `/api/cycles/${c.id}/burndown`));
    // honest: the unfinished scope is still the completed cycle's remaining work
    expect(burndown.points.at(-1)).toMatchObject({ scope: 1, remaining: 1 });
  });

  it("shows insufficient data until three completed cycles, then the mean of the last three", async () => {
    const velocity = async () =>
      (
        await w.json<{
          meta: {
            velocity: { status: string; value?: number; cycles: number };
          };
        }>(
          await w.call(
            w.manager.user,
            `/api/projects/${w.project.slug}/cycles`,
          ),
        )
      ).meta.velocity;
    const sizes = [2, 4, 6];
    for (const [index, size] of sizes.entries()) {
      const start = -90 + index * 20;
      const c = await makeCycle(`Done ${index}`, start, start + 9);
      const items = [];
      for (let n = 0; n < size; n++)
        items.push(
          (await w.items.makeItem(`d${index}-${n}`, { group: "completed" }))
            .key,
        );
      await w.json(await addItems(c.id, items));
      await w.json(await complete(c.id, { incompletePolicy: "leave" }));
      const v = await velocity();
      if (index < 2) expect(v.status).toBe("insufficient_data");
    }
    expect(await velocity()).toMatchObject({
      status: "ok",
      value: 4,
      cycles: 3,
    });
  });
});

describe("burndown and summary (CY-7, ES-5)", () => {
  it("reports no scope for an empty cycle", async () => {
    const c = await makeCycle("Empty", -3, 4);
    const burndown = await w.json<{ noScope: boolean; points: unknown[] }>(
      await w.call(w.manager.user, `/api/cycles/${c.id}/burndown`),
    );
    expect(burndown.noScope).toBe(true);
  });

  it("replays scope with scope added after the start and reports the unestimated share", async () => {
    const c = await makeCycle("Active", -3, 4);
    const a = await w.items.makeItem("A", { group: "completed" });
    const b = await w.items.makeItem("B", { group: "started" });
    await w.json(await addItems(c.id, [a.key, b.key]));
    const burndown = await w.json<{
      unit: string;
      noScope: boolean;
      unestimated: { count: number; share: number };
      points: Array<{ date: string; scope: number; completed: number }>;
    }>(await w.call(w.manager.user, `/api/cycles/${c.id}/burndown`));
    expect(burndown).toMatchObject({
      unit: "count",
      noScope: false,
      unestimated: { count: 2, share: 1 },
    });
    expect(burndown.points[0]?.date).toBe(day(-3));
    expect(burndown.points.at(-1)?.date).toBe(day(0));
    const last = burndown.points.at(-1);
    expect(last?.scope).toBe(2);
    expect(last?.completed).toBe(1);
  });
});

describe("deletion through the pending-action flow", () => {
  it("deletes only after approval, keeps the items and clears their cycle", async () => {
    await ensureAgentSession(w.manager.user.id);
    const c = await makeCycle("Doomed", -3, 4);
    const item = await w.items.makeItem("Survivor");
    await w.json(await addItems(c.id, [item.key]));
    mockAuthenticatedSession(w.manager.user);
    const { pending } = await deleteThroughApproval(
      w.app,
      w.manager.user,
      `/api/cycles/${c.id}`,
      {
        afterRequest: async () => {
          const [still] = await db
            .select()
            .from(cycleTable)
            .where(eq(cycleTable.id, c.id));
          expect(still).toBeDefined();
        },
      },
    );
    expect(pending.pendingActionId).toBeTruthy();
    const [gone] = await db
      .select()
      .from(cycleTable)
      .where(eq(cycleTable.id, c.id));
    expect(gone).toBeUndefined();
    const [survivor] = await db
      .select({ cycleId: schema.workItemTable.cycleId })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, item.id));
    expect(survivor?.cycleId).toBeNull();
    expect(await auditActionsFor(c.id)).toContain("cycle.deleted");
  });
});

describe("flag, permission and tenant behaviour", () => {
  it("hides cycles while feature.cycles is off, keeps the data, restores on re-enable", async () => {
    const c = await makeCycle("Kept", -3, 4);
    await setAgileFlags(w.project.id, { cycles: false });
    for (const [path, method] of [
      [`/api/projects/${w.project.slug}/cycles`, "GET"],
      [`/api/cycles/${c.id}`, "GET"],
      [`/api/cycles/${c.id}/burndown`, "GET"],
    ] as const) {
      const response = await w.call(w.manager.user, path, { method });
      expect(response.status, path).toBe(404);
      expect(await response.text()).toContain("feature_disabled");
    }
    const create = await createCycle("New", 20, 25);
    expect(create.status).toBe(404);
    const [row] = await db
      .select()
      .from(cycleTable)
      .where(eq(cycleTable.id, c.id));
    expect(row).toBeDefined();
    await setAgileFlags(w.project.id, { cycles: true });
    expect((await w.call(w.manager.user, `/api/cycles/${c.id}`)).status).toBe(
      200,
    );
  });

  it("is off by default (no flag row)", async () => {
    await db
      .delete(schema.projectFeatureFlagTable)
      .where(eq(schema.projectFeatureFlagTable.projectId, w.project.id));
    const response = await w.call(
      w.manager.user,
      `/api/projects/${w.project.slug}/cycles`,
    );
    expect(response.status).toBe(404);
  });

  it("lets a reader see but not change; an outsider reaches nothing", async () => {
    const c = await makeCycle("Visible", -3, 4);
    const item = await w.items.makeItem("Item");
    expect((await w.call(w.reader.user, `/api/cycles/${c.id}`)).status).toBe(
      200,
    );
    const readerList = await w.json<{ meta: { canManage: boolean } }>(
      await w.call(w.reader.user, `/api/projects/${w.project.slug}/cycles`),
    );
    expect(readerList.meta.canManage).toBe(false);
    expect((await createCycle("Nope", 30, 35, w.reader.user)).status).toBe(403);
    expect(
      (
        await w.call(w.reader.user, `/api/cycles/${c.id}`, {
          method: "PATCH",
          body: { name: "x", version: 1 },
        })
      ).status,
    ).toBe(403);
    expect((await addItems(c.id, [item.key], w.reader.user)).status).toBe(403);
    expect(
      (
        await w.call(w.reader.user, `/api/cycles/${c.id}/complete`, {
          method: "POST",
          body: {},
        })
      ).status,
    ).toBe(403);
    expect(
      (await w.call(w.reader.user, `/api/cycles/${c.id}`, { method: "DELETE" }))
        .status,
    ).toBe(403);
    // an outsider (workspace member without project reach) gets 404, like a missing cycle
    expect((await w.call(w.outsider.user, `/api/cycles/${c.id}`)).status).toBe(
      404,
    );
    expect(
      (await w.call(w.outsider.user, `/api/projects/${w.project.slug}/cycles`))
        .status,
    ).toBe(404);
  });

  it("never leaks across tenants", async () => {
    const c = await makeCycle("Mine", -3, 4);
    const foreignCycle = await w.json<Cycle>(
      await createCycle("Theirs", -3, 4, w.foreign.user, w.foreignProject.slug),
      201,
    );
    expect((await w.call(w.foreign.user, `/api/cycles/${c.id}`)).status).toBe(
      404,
    );
    expect(
      (await w.call(w.manager.user, `/api/cycles/${foreignCycle.id}`)).status,
    ).toBe(404);
    expect(
      (await w.call(w.foreign.user, `/api/projects/${w.project.slug}/cycles`))
        .status,
    ).toBe(404);
    const item = await w.items.makeItem("Mine");
    expect(
      (await addItems(foreignCycle.id, [item.key], w.manager.user)).status,
    ).toBe(404);
    expect((await addItems(c.id, [item.key], w.foreign.user)).status).toBe(404);
  });

  it("answers an unauthenticated caller with 401", async () => {
    mockAnonymousSession();
    const response = await w.app.request(
      `/api/projects/${w.project.slug}/cycles`,
    );
    expect(response.status).toBe(401);
  });
});

describe("moving an item to another project while it is in a cycle", () => {
  it("clears the cycle, module and estimate for the item and its children (the composite foreign keys allow it)", async () => {
    const cycle = await makeCycle("Active", -3, 4);
    const mod = await w.json<{ id: string }>(
      await w.call(w.manager.user, `/api/projects/${w.project.slug}/modules`, {
        method: "POST",
        body: { name: "Module" },
      }),
      201,
    );
    const estimate = await w.json<{
      estimate: { points: Array<{ id: string }> };
    }>(
      await w.call(
        w.manager.user,
        `/api/projects/${w.project.slug}/estimates`,
        {
          method: "PATCH",
          body: { system: "points" },
        },
      ),
    );
    const pointId = estimate.estimate.points[0]?.id as string;
    const parent = await w.items.makeItem("Parent", {
      estimatePointId: pointId,
    });
    const child = await w.items.makeItem("Child", {
      parentId: parent.id,
      estimatePointId: pointId,
    });
    await w.json(await addItems(cycle.id, [parent.key, child.key]));
    await w.json(
      await w.call(w.manager.user, `/api/modules/${mod.id}/work-items`, {
        method: "POST",
        body: { workItemKeys: [parent.key, child.key] },
      }),
    );
    // a target project that has the item's state template
    const [state] = await db
      .select({ templateId: schema.stateTable.stateTemplateId })
      .from(schema.stateTable)
      .where(eq(schema.stateTable.id, parent.stateId));
    const { project: target } = await createProjectFixture({
      workspaceId: w.workspaceId,
    });
    await db.insert(schema.stateTable).values({
      projectId: target.id,
      stateTemplateId: state?.templateId as string,
      isDefault: true,
    });
    await grantProjectRole(w.manager.user.id, target.id, [
      ...WORK_ITEM_PROJECT_CAPABILITIES,
    ]);
    type BurndownBody = { points: Array<{ scope: number }> };
    const before = await w.json<BurndownBody>(
      await w.call(w.manager.user, `/api/cycles/${cycle.id}/burndown`),
    );
    expect(before.points.at(-1)?.scope).toBeGreaterThan(0);
    mockAuthenticatedSession(w.manager.user);
    const moved = await w.app.request(`/api/v2/work-items/${parent.key}/move`, {
      method: "POST",
      headers: { "content-type": "application/json", "if-match": '"1"' },
      body: JSON.stringify({ targetProjectId: target.id, moveChildren: true }),
    });
    expect(moved.status, await moved.clone().text()).toBe(200);
    const rows = await db
      .select({
        projectId: schema.workItemTable.projectId,
        cycleId: schema.workItemTable.cycleId,
        moduleId: schema.workItemTable.moduleId,
        estimatePointId: schema.workItemTable.estimatePointId,
      })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.workspaceId, w.workspaceId));
    const movedRows = rows.filter((row) => row.projectId === target.id);
    expect(movedRows).toHaveLength(2);
    for (const row of movedRows)
      expect(row).toMatchObject({
        cycleId: null,
        moduleId: null,
        estimatePointId: null,
      });
    // the old cycle's scope drops: a `removed` event per moved item, so the burndown stops counting them
    const removedEvents = await db
      .select({ workItemId: cycleScopeEventTable.workItemId })
      .from(cycleScopeEventTable)
      .where(
        and(
          eq(cycleScopeEventTable.cycleId, cycle.id),
          eq(cycleScopeEventTable.kind, "removed"),
        ),
      );
    expect(removedEvents.map((event) => event.workItemId).sort()).toEqual(
      [parent.id, child.id].sort(),
    );
    const after = await w.json<BurndownBody>(
      await w.call(w.manager.user, `/api/cycles/${cycle.id}/burndown`),
    );
    expect(after.points.at(-1)?.scope ?? 0).toBe(0);
  });
});
