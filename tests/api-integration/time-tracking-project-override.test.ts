/**
 * A-10: the project level decides time tracking (features.md). The work item Time section reads
 * the item's entries, the caller's review notices, the timer and the activity catalogue. With
 * the workspace switch off and the project switch on, all of them work; with the workspace on and
 * the project off, the item-bound reads and writes answer 409 `feature_disabled`.
 */
import { inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db from "../../apps/api/src/database";
import {
  cycleTable,
  moduleTable,
} from "../../apps/api/src/database/schema-p5-agile";
import { timeEntryTable } from "../../apps/api/src/database/schema-p5-time";
import { resetTestDatabase } from "./helpers/database";
import {
  isoDaysAgo,
  setProjectTimeFlag,
  setTimeFlags,
  type TimeWorld,
  timeWorld,
} from "./helpers/p5-time";

let w: TimeWorld;
beforeEach(async () => {
  await resetTestDatabase();
  w = await timeWorld();
});

function timeSectionReads(workItemId: string) {
  const ws = encodeURIComponent(w.workspaceId);
  return [
    `/api/time-entries?workspaceId=${ws}&workItemId=${encodeURIComponent(workItemId)}`,
    `/api/time-entries?workspaceId=${ws}&needsReview=true`,
    `/api/time-entries/timer?workspaceId=${ws}`,
    `/api/time-activities?workspaceId=${ws}`,
  ];
}

describe("A-10 time tracking follows the project switch", () => {
  it("works on a project switched on inside a workspace switched off", async () => {
    await setTimeFlags(w.workspaceId, { time: false });
    await setProjectTimeFlag(w.projectA.id, "feature.time_tracking", true);

    for (const path of timeSectionReads(w.itemA.id)) {
      const response = await w.agent(w.member.user, path);
      expect(response.status, `${path} ${await response.clone().text()}`).toBe(
        200,
      );
    }
    const logged = await w.logTime(w.member.user);
    expect(logged.status, await logged.clone().text()).toBe(201);

    // The other project keeps the workspace's answer: off (the owner reaches project B).
    const elsewhere = await w.agent(
      w.owner.user,
      `/api/time-entries?workspaceId=${encodeURIComponent(w.workspaceId)}&workItemId=${encodeURIComponent(w.itemB.id)}`,
    );
    expect(elsewhere.status).toBe(409);
    const refused = await w.logTime(w.owner.user, {}, w.itemB.id);
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain("feature_disabled");
  });

  it("refuses item-bound time on a project switched off inside a workspace switched on", async () => {
    await setTimeFlags(w.workspaceId, { time: true });
    const before = await w.logTime(w.member.user);
    expect(before.status).toBe(201);
    const entry = (await before.json()) as { id: string };
    await setProjectTimeFlag(w.projectA.id, "feature.time_tracking", false);

    const list = await w.agent(
      w.member.user,
      `/api/time-entries?workspaceId=${encodeURIComponent(w.workspaceId)}&workItemId=${encodeURIComponent(w.itemA.id)}`,
    );
    expect(list.status).toBe(409);
    expect(await list.text()).toContain("feature_disabled");
    expect((await w.logTime(w.member.user)).status).toBe(409);
    const edit = await w.agent(w.member.user, `/api/time-entries/${entry.id}`, {
      method: "PATCH",
      body: { minutes: 30 },
    });
    expect(edit.status).toBe(409);

    // The rest of the workspace is unaffected.
    expect((await w.logTime(w.owner.user, {}, w.itemB.id)).status).toBe(201);
  });

  it("stays off everywhere when neither the workspace nor any project has it on", async () => {
    await setTimeFlags(w.workspaceId, { time: false });
    for (const path of timeSectionReads(w.itemA.id)) {
      const response = await w.agent(w.member.user, path);
      expect(response.status, path).toBe(409);
    }
  });

  it("decides a cycle- or module-bound summary at the cycle's or module's project", async () => {
    await setTimeFlags(w.workspaceId, { time: false });
    await setProjectTimeFlag(w.projectA.id, "feature.time_tracking", true);
    const ws = encodeURIComponent(w.workspaceId);
    const scopesOf = async (projectId: string) => {
      const [cycle] = await db
        .insert(cycleTable)
        .values({
          workspaceId: w.workspaceId,
          projectId,
          name: "Sprint",
          startDate: isoDaysAgo(7),
          endDate: isoDaysAgo(-7),
        })
        .returning();
      const [module] = await db
        .insert(moduleTable)
        .values({
          workspaceId: w.workspaceId,
          projectId,
          name: "Module",
          createdBy: w.owner.user.id,
        })
        .returning();
      if (!cycle || !module) throw new Error("cycle or module not created");
      return [
        `/api/time-entries/summary?workspaceId=${ws}&cycleId=${encodeURIComponent(cycle.id)}`,
        `/api/time-entries/summary?workspaceId=${ws}&moduleId=${encodeURIComponent(module.id)}`,
      ];
    };

    // Project B inherits the workspace's off, even though project A has it on.
    for (const path of await scopesOf(w.projectB.id)) {
      const response = await w.agent(w.owner.user, path);
      expect(response.status, path).toBe(409);
      expect(await response.text()).toContain("feature_disabled");
    }
    // Project A is switched on inside the off workspace.
    for (const path of await scopesOf(w.projectA.id)) {
      const response = await w.agent(w.owner.user, path);
      expect(response.status, `${path} ${await response.clone().text()}`).toBe(
        200,
      );
    }
  });

  async function loggedOnBothProjects() {
    const onA = await w.logTime(w.owner.user);
    expect(onA.status, await onA.clone().text()).toBe(201);
    const onB = await w.logTime(w.owner.user, {}, w.itemB.id);
    expect(onB.status, await onB.clone().text()).toBe(201);
    const a = ((await onA.json()) as { id: string }).id;
    const b = ((await onB.json()) as { id: string }).id;
    await db
      .update(timeEntryTable)
      .set({ needsReview: true })
      .where(inArray(timeEntryTable.id, [a, b]));
    return { a, b };
  }

  async function workspaceWideIds() {
    const ws = encodeURIComponent(w.workspaceId);
    const lists: string[][] = [];
    for (const path of [
      `/api/time-entries?workspaceId=${ws}`,
      `/api/time-entries?workspaceId=${ws}&needsReview=true`,
    ]) {
      const response = await w.agent(w.owner.user, path);
      expect(response.status, `${path} ${await response.clone().text()}`).toBe(
        200,
      );
      const body = (await response.json()) as { data: Array<{ id: string }> };
      lists.push(body.data.map((row) => row.id));
    }
    return lists;
  }

  it("leaves a switched-off project out of the workspace-wide list (workspace off)", async () => {
    await setTimeFlags(w.workspaceId, { time: false });
    await setProjectTimeFlag(w.projectA.id, "feature.time_tracking", true);
    await setProjectTimeFlag(w.projectB.id, "feature.time_tracking", true);
    const { a, b } = await loggedOnBothProjects();
    await setProjectTimeFlag(w.projectB.id, "feature.time_tracking", false);

    for (const ids of await workspaceWideIds()) {
      expect(ids).toContain(a);
      expect(ids).not.toContain(b);
    }
    const scoped = await w.agent(
      w.owner.user,
      `/api/time-entries?workspaceId=${encodeURIComponent(w.workspaceId)}&projectId=${encodeURIComponent(w.projectB.id)}`,
    );
    expect(scoped.status).toBe(409);
  });

  it("leaves a switched-off project out of the workspace-wide list (workspace on)", async () => {
    await setTimeFlags(w.workspaceId, { time: true });
    const { a, b } = await loggedOnBothProjects();
    await setProjectTimeFlag(w.projectB.id, "feature.time_tracking", false);

    for (const ids of await workspaceWideIds()) {
      expect(ids).toContain(a);
      expect(ids).not.toContain(b);
    }
  });

  it("does not let a project id from another workspace switch the gate on", async () => {
    const other = await timeWorld();
    await setTimeFlags(w.workspaceId, { time: false });
    await setTimeFlags(other.workspaceId, { time: true });
    const response = await w.agent(
      w.member.user,
      `/api/time-entries?workspaceId=${encodeURIComponent(w.workspaceId)}&projectId=${encodeURIComponent(other.projectA.id)}`,
    );
    expect(response.status).toBe(409);
  });
});
