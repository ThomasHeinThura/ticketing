/**
 * P5 agile review round 4 (R4-07..R4-09): legal-hold fence on cycle deletion, the item -> cycle
 * lock order (concurrent adds, add vs a move's removal), and the estimate write against a
 * concurrent estimate change.
 */
import { and, asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { recordCycleRemovalsOnMove } from "../../apps/api/src/agile/cycle.repository";
import db, { schema } from "../../apps/api/src/database";
import {
  cycleScopeEventTable,
  cycleTable,
} from "../../apps/api/src/database/schema-p5-agile";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { type AgileWorld, agileWorld } from "./helpers/p5-agile";
import {
  approvePendingDeletion,
  ensureAgentSession,
  requestDeletion,
} from "./helpers/pending-deletion";

let w: AgileWorld;
beforeEach(async () => {
  await resetTestDatabase();
  w = await agileWorld();
});

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function makeCycle(name: string, startOffset: number, endOffset: number) {
  return w.json<{ id: string; version: number }>(
    await w.call(w.manager.user, `/api/projects/${w.project.slug}/cycles`, {
      method: "POST",
      body: { name, startDate: day(startOffset), endDate: day(endOffset) },
    }),
    201,
  );
}
const addItems = (cycleId: string, keys: string[]) =>
  w.call(w.manager.user, `/api/cycles/${cycleId}/work-items`, {
    method: "POST",
    body: { workItemKeys: keys },
  });

async function holdersOf(itemId: string) {
  const rows = await db
    .select({ cycleId: schema.workItemTable.cycleId })
    .from(schema.workItemTable)
    .where(eq(schema.workItemTable.id, itemId));
  return rows[0]?.cycleId ?? null;
}
async function events(cycleId: string, itemId: string) {
  return (
    await db
      .select({ kind: cycleScopeEventTable.kind })
      .from(cycleScopeEventTable)
      .where(
        and(
          eq(cycleScopeEventTable.cycleId, cycleId),
          eq(cycleScopeEventTable.workItemId, itemId),
        ),
      )
      .orderBy(asc(cycleScopeEventTable.at), asc(cycleScopeEventTable.id))
  ).map((row) => row.kind);
}

describe("legal-hold fence on cycle deletion (R4-07)", () => {
  async function personOf(userId: string) {
    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, userId));
    return person?.id as string;
  }

  for (const scope of ["person", "organisation"] as const) {
    it(`an open ${scope} hold refuses the deletion up front and at approval, and lifts cleanly`, async () => {
      await ensureAgentSession(w.manager.user.id);
      const c = await makeCycle("Held", -3, 4);
      const item = await w.items.makeItem("Scoped");
      await w.json(await addItems(c.id, [item.key]));
      mockAuthenticatedSession(w.manager.user);
      const pending = await requestDeletion(w.app, `/api/cycles/${c.id}`);
      const scopeId =
        scope === "person"
          ? await personOf(w.manager.user.id)
          : ((
              await db
                .select({ id: schema.workspaceTable.organisationId })
                .from(schema.workspaceTable)
                .where(eq(schema.workspaceTable.id, w.workspaceId))
            )[0]?.id as string);
      const [hold] = await db
        .insert(schema.legalHoldTable)
        .values({
          scope,
          scopeId,
          placedBy: "compliance-officer",
          reason: "litigation",
        })
        .returning();
      const refused = await approvePendingDeletion(
        w.app,
        w.manager.user.id,
        pending,
      );
      expect(refused.status, await refused.clone().text()).toBe(409);
      expect(await refused.text()).toContain("legal_hold");
      const [stillThere] = await db
        .select({ id: cycleTable.id })
        .from(cycleTable)
        .where(eq(cycleTable.id, c.id));
      expect(stillThere).toBeDefined();
      expect(await events(c.id, item.id)).toEqual(["added"]);
      const upFront = await w.call(w.manager.user, `/api/cycles/${c.id}`, {
        method: "DELETE",
      });
      expect(upFront.status).toBe(409);
      expect(await upFront.text()).toContain("legal_hold");
      await db
        .update(schema.legalHoldTable)
        .set({ liftedAt: new Date(), liftedBy: "compliance-officer" })
        .where(eq(schema.legalHoldTable.id, hold?.id ?? ""));
      const approved = await approvePendingDeletion(
        w.app,
        w.manager.user.id,
        pending,
      );
      expect(approved.status, await approved.clone().text()).toBe(200);
      expect(await events(c.id, item.id)).toEqual([]);
    });
  }

  it("a hold on an unrelated person does not block", async () => {
    await ensureAgentSession(w.manager.user.id);
    const c = await makeCycle("Free", -3, 4);
    const item = await w.items.makeItem("Scoped");
    await w.json(await addItems(c.id, [item.key]));
    await db.insert(schema.legalHoldTable).values({
      scope: "person",
      scopeId: await personOf(w.reader.user.id),
      placedBy: "compliance-officer",
      reason: "litigation",
    });
    mockAuthenticatedSession(w.manager.user);
    const pending = await requestDeletion(w.app, `/api/cycles/${c.id}`);
    const approved = await approvePendingDeletion(
      w.app,
      w.manager.user.id,
      pending,
    );
    expect(approved.status, await approved.clone().text()).toBe(200);
  });
});

describe("item -> cycle lock order (R4-08)", () => {
  it("two concurrent adds of one item to different cycles leave exactly one holder and a consistent log", async () => {
    for (let round = 0; round < 3; round += 1) {
      const a = await makeCycle(
        `A${round}`,
        100 + round * 40,
        110 + round * 40,
      );
      const b = await makeCycle(
        `B${round}`,
        115 + round * 40,
        125 + round * 40,
      );
      const item = await w.items.makeItem(`Raced ${round}`);
      const responses = await Promise.all([
        addItems(a.id, [item.key]),
        addItems(b.id, [item.key]),
      ]);
      expect(responses.map((r) => r.status)).toEqual([200, 200]);
      const holder = await holdersOf(item.id);
      expect([a.id, b.id]).toContain(holder);
      const loser = holder === a.id ? b.id : a.id;
      const winnerEvents = await events(holder as string, item.id);
      const loserEvents = await events(loser, item.id);
      // The last writer holds the item; the first one's cycle logged the removal.
      expect(winnerEvents).toEqual(["added"]);
      // Timestamps come from each request's own clock, so compare the pair, not its order.
      expect([...loserEvents].sort()).toEqual(["added", "removed"]);
    }
  });

  it("an add racing a cross-project move's removal never deadlocks and stays consistent", async () => {
    const a = await makeCycle("Source", 100, 110);
    const b = await makeCycle("Target", 115, 125);
    const item = await w.items.makeItem("Mover");
    await w.json(await addItems(a.id, [item.key]));
    const mover = db.transaction(async (tx) => {
      // The move controller's order: the item row, then the cycles of the items it clears.
      await tx
        .select({ id: schema.workItemTable.id })
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, item.id))
        .for("update");
      await recordCycleRemovalsOnMove(
        tx,
        [{ id: item.id, cycleId: a.id }],
        w.manager.user.id,
        new Date(),
      );
      await tx
        .update(schema.workItemTable)
        .set({ cycleId: null })
        .where(eq(schema.workItemTable.id, item.id));
    });
    const results = await Promise.allSettled([
      mover,
      addItems(b.id, [item.key]),
    ]);
    expect(results[0]?.status).toBe("fulfilled");
    expect(results[1]?.status).toBe("fulfilled");
    const response = (results[1] as PromiseFulfilledResult<Response>).value;
    expect(response.status, await response.clone().text()).toBe(200);
    const holder = await holdersOf(item.id);
    const inA = (await events(a.id, item.id)).reduce(
      (n, kind) => n + (kind === "added" ? 1 : kind === "removed" ? -1 : 0),
      0,
    );
    expect(inA).toBe(0);
    expect(holder === b.id || holder === null).toBe(true);
    const inB = (await events(b.id, item.id)).reduce(
      (n, kind) => n + (kind === "added" ? 1 : kind === "removed" ? -1 : 0),
      0,
    );
    expect(inB).toBe(holder === b.id ? 1 : 0);
  });
});

describe("estimate write vs a concurrent estimate change (R4-09)", () => {
  it("an item never ends up on a point the change archived", async () => {
    const path = `/api/projects/${w.project.slug}/estimates`;
    const config = await w.json<{
      estimate: { points: Array<{ id: string; value: string }> };
    }>(
      await w.call(w.manager.user, path, {
        method: "PATCH",
        body: { system: "points" },
      }),
    );
    const points = config.estimate.points;
    const item = await w.items.makeItem("Estimated");
    for (let round = 0; round < 4; round += 1) {
      const current = await w.json<{
        points: Array<{ id: string; value: string }>;
        system: string;
      }>(await w.call(w.manager.user, path));
      const target = current.points[0];
      const next = current.system === "points" ? "categories" : "points";
      const results = await Promise.all([
        w.call(w.manager.user, `/api/work-items/${item.key}/estimate`, {
          method: "PUT",
          body: { estimatePointId: target?.id },
        }),
        w.call(w.manager.user, path, {
          method: "PATCH",
          body: { system: next, confirmClear: true },
        }),
      ]);
      for (const response of results)
        expect(response.status, await response.clone().text()).not.toBe(500);
      const active = await w.json<{ points: Array<{ id: string }> }>(
        await w.call(w.manager.user, path),
      );
      const [row] = await db
        .select({ id: schema.workItemTable.estimatePointId })
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, item.id));
      if (row?.id) expect(active.points.map((p) => p.id)).toContain(row.id);
    }
    expect(points.length).toBeGreaterThan(0);
  });
});
