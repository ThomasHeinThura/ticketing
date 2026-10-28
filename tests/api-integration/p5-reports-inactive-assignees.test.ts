import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import { workItemWorld } from "./helpers/p4-closeout";
import { type ReportsWorld, reportsWorld } from "./helpers/p5-reports";
import { personIdOf } from "./helpers/p5-time";

let w: ReportsWorld;
beforeEach(async () => {
  await resetTestDatabase();
  w = await reportsWorld();
});

describe("inactive assignees report (AS-10)", () => {
  it("lists current inactive assignments, drills and exports with identical reach and filters", async () => {
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.id, w.other.personId));

    await w.addItem({
      createdDaysAgo: 4,
      assigneeId: w.other.personId,
      title: "Inactive open project A",
    });
    await w.addItem({
      createdDaysAgo: 8,
      resolvedDaysAgo: 2,
      assigneeId: w.other.personId,
      title: "Inactive completed project A",
    });
    await w.addItem({
      projectId: w.projectB.id,
      createdDaysAgo: 3,
      assigneeId: w.other.personId,
      title: "Inactive open project B",
    });
    await w.addItem({
      createdDaysAgo: 3,
      assigneeId: w.ownerPersonId,
      title: "Active assignee excluded",
    });
    await w.addItem({
      createdDaysAgo: 3,
      title: "Unassigned item excluded",
    });

    const strangerPersonId = await personIdOf(w.stranger.user.id);
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.id, strangerPersonId));
    const foreignWorld = await workItemWorld(
      w.stranger.workspace.id,
      w.strangerProject.id,
    );
    const foreignItem = await foreignWorld.makeItem(
      "Other workspace item excluded",
    );
    await db
      .update(schema.workItemTable)
      .set({ assigneeId: strangerPersonId })
      .where(eq(schema.workItemTable.id, foreignItem.id));

    const all = await w.report(w.owner.user, "inactive_assignees");
    expect(all.response.status).toBe(200);
    expect(all.body.window.live).toBe(true);
    expect(all.body.scope.kind).toBe("all");
    expect(all.body.rows).toHaveLength(1);
    const allRow = all.body.rows[0] as Record<string, unknown>;
    expect(allRow._drill).toBe(w.other.personId);
    expect(allRow.inactive).toBe("Inactive");
    expect(allRow.assigned).toBe(3);
    expect(allRow.open).toBe(2);
    expect(
      all.body.metrics.find((metric) => metric.key === "assigned")?.value,
    ).toBe(3);

    const reached = await w.report(w.member.user, "inactive_assignees");
    expect(reached.response.status).toBe(200);
    expect(reached.body.scope.kind).toBe("reach");
    const reachedRow = reached.body.rows[0] as Record<string, unknown>;
    expect(reachedRow.assigned).toBe(2);
    expect(reachedRow.open).toBe(1);

    const projectOnly = await w.report(
      w.owner.user,
      "inactive_assignees",
      `&projectId=${encodeURIComponent(w.projectA.id)}`,
    );
    const filteredRow = projectOnly.body.rows[0] as Record<string, unknown>;
    expect(filteredRow.assigned).toBe(2);
    const drill = await w.get(
      w.owner.user,
      `/api/reports/inactive_assignees/items?workspaceId=${w.workspaceId}` +
        `&projectId=${encodeURIComponent(w.projectA.id)}` +
        `&handle=${encodeURIComponent(String(filteredRow._drill))}&limit=100`,
    );
    expect(drill.status).toBe(200);
    const drillItems = (await drill.json()) as {
      data: Array<{ title: string; projectKey: string | null }>;
    };
    expect(drillItems.data.map((item) => item.title).sort()).toEqual([
      "Inactive completed project A",
      "Inactive open project A",
    ]);
    expect(
      drillItems.data.every((item) => item.projectKey === w.projectA.slug),
    ).toBe(true);

    const csvResponse = await w.get(
      w.owner.user,
      "/api/reports/inactive_assignees/export",
      {
        method: "POST",
        body: { workspaceId: w.workspaceId, projectId: w.projectA.id },
      },
    );
    expect(csvResponse.status).toBe(200);
    const csv = await csvResponse.text();
    const csvRows = csv
      .split("\r\n")
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    expect(csvRows).toHaveLength(2);
    expect(csvRows[0]).toBe("Assignee,Status,Assigned work,Open work");
    expect(csvRows[1]).toContain(",Inactive,2,1");
  });
});
