/**
 * The project work-item list (`GET /api/projects/{projectId}/work-items`, the board's and the
 * list's default read) runs a fixed number of SQL statements per request, however many rows
 * the page holds, and reports its phases in `Server-Timing`.
 *
 * Every per-row branch is exercised so a per-row query cannot hide behind an early return:
 * each row is SLA-pinned on a business-hours calendar in a real timezone with holidays
 * (`feature.sla` on), carries labels, an assignee with a project membership, an open
 * `blocks` relation, an epic parent, and some rows have SLA pauses. Statements are counted
 * at the `pg` client, so middleware and helpers that import `db` directly are counted too.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { getDatabasePool, schema } from "../../apps/api/src/database";
import { slaPauseTable } from "../../apps/api/src/database/migration-schema";
import { invalidateFeatureFlagCache } from "../../apps/api/src/feature-flag/enforce";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { requireRow } from "./helpers/fixtures";
import { ago, slaFixture } from "./helpers/sla-fixture";

const WEEKDAY_WINDOWS = Object.fromEntries(
  ["mon", "tue", "wed", "thu", "fri"].map((day) => [
    day,
    [{ from: 9 * 60, to: 18 * 60 }],
  ]),
);

/** A project with `count` fully decorated, SLA-pinned rows (row 1 is the fixture's own). */
async function seedProject(count: number) {
  const fixture = await slaFixture();
  const { owner, project, type, item } = fixture;
  const workspaceId = owner.workspace.id;

  // A realistic policy: weekdays 09:00-18:00 in a real zone, with holidays, and multi-day
  // targets, so each badge has real calendar arithmetic to do. Published (backdated) only
  // after its goals exist, as published versions are immutable.
  const calendar = requireRow(
    await db
      .insert(schema.serviceCalendarTable)
      .values({
        workspaceId,
        name: "Office hours",
        timezone: "Asia/Bangkok",
        windows: WEEKDAY_WINDOWS,
        holidays: [
          { date: "2026-10-23", name: "Chulalongkorn Day" },
          { from: "2026-12-24", to: "2026-12-26", name: "Year end" },
          { recurs: "annually", month: 1, day: 1, name: "New Year" },
        ],
      })
      .returning(),
    "calendar",
  );
  const policy = requireRow(
    await db
      .insert(schema.slaPolicyTable)
      .values({ workspaceId, name: "Office hours" })
      .returning(),
    "policy",
  );
  const version = requireRow(
    await db
      .insert(schema.slaPolicyVersionTable)
      .values({
        workspaceId,
        policyId: policy.id,
        calendarId: calendar.id,
        number: 1,
        atRiskThresholdPct: 75,
      })
      .returning(),
    "version",
  );
  await db.insert(schema.slaGoalTable).values(
    (["low", "medium", "high", "urgent"] as const).flatMap((priority) => [
      {
        workspaceId,
        versionId: version.id,
        metric: "first_response" as const,
        priority,
        workItemTypeId: type.id,
        targetMinutes: 240,
      },
      {
        workspaceId,
        versionId: version.id,
        metric: "resolution" as const,
        priority,
        workItemTypeId: type.id,
        targetMinutes: 2400,
      },
    ]),
  );
  await db
    .update(schema.slaPolicyVersionTable)
    .set({ effectiveFrom: ago(120 * 24 * 60) })
    .where(eq(schema.slaPolicyVersionTable.id, version.id));

  const assignee = requireRow(
    await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, owner.user.id)),
    "assignee person",
  );
  const epicType = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId,
        key: `epic-${randomUUID()}`,
        name: "Epic",
        category: "delivery",
        isEpic: true,
      })
      .returning(),
    "epic type",
  );
  // The shared epic parent is one extra row on the page; the assertions below skip it.
  const epic = requireRow(
    await db
      .insert(schema.workItemTable)
      .values({
        workspaceId,
        projectId: project.id,
        typeId: epicType.id,
        stateId: item.stateId,
        number: 100_000,
        key: `${project.slug}-100000`,
        title: "Epic",
      })
      .returning(),
    "epic",
  );

  const priorities = ["low", "medium", "high", "urgent"] as const;
  const extra =
    count > 1
      ? await db
          .insert(schema.workItemTable)
          .values(
            Array.from({ length: count - 1 }, (_, index) => {
              const number = index + 2;
              return {
                workspaceId,
                projectId: project.id,
                typeId: type.id,
                stateId: item.stateId,
                number,
                key: `${project.slug}-${number}`,
                title: `Row ${number}`,
                priority: priorities[number % priorities.length],
                assigneeId: assignee.id,
                parentId: epic.id,
                slaPolicyVersionId: version.id,
                // Spread start facts across ~two months so badges cover ok/at-risk/breached.
                slaStartedAt: ago(number * 13 * 60),
                firstResponseAt:
                  number % 3 === 0 ? ago(number * 13 * 60 - 90) : null,
              };
            }),
          )
          .returning()
      : [];
  await db
    .update(schema.workItemTable)
    .set({
      assigneeId: assignee.id,
      parentId: epic.id,
      slaPolicyVersionId: version.id,
    })
    .where(eq(schema.workItemTable.id, item.id));
  const rows = [item, ...extra];

  const labels = await db
    .insert(schema.labelTable)
    .values(
      ["bug", "customer"].map((name) => ({
        workspaceId,
        projectId: project.id,
        name: `${name}-${randomUUID().slice(0, 8)}`,
        color: "#336699",
      })),
    )
    .returning();
  await db
    .insert(schema.workItemLabelTable)
    .values(
      rows.flatMap((row) =>
        labels.map((label) => ({ workItemId: row.id, labelId: label.id })),
      ),
    );
  await db.insert(schema.workItemRelationTable).values(
    rows.slice(1).map((row, index) => ({
      sourceId: rows[index]?.id ?? item.id,
      targetId: row.id,
      type: "blocks",
    })),
  );
  await db.insert(slaPauseTable).values(
    rows
      .filter((_, index) => index % 4 === 1)
      .map((row) => ({
        workItemId: row.id,
        metric: "resolution",
        startedAt: ago(6 * 60),
        endedAt: ago(3 * 60),
        reason: "waiting_customer",
      })),
  );

  await db
    .insert(schema.instanceFeatureFlagTable)
    .values({ featureKey: "feature.sla", enabled: true })
    .onConflictDoUpdate({
      target: schema.instanceFeatureFlagTable.featureKey,
      set: { enabled: true },
    });
  invalidateFeatureFlagCache();
  return { owner, project, epicId: epic.id };
}

type CountedResponse = { response: Response; statements: number };

/** Every statement any pooled `pg` client sends while `run` is in flight. */
async function countStatements(
  run: () => Promise<Response>,
): Promise<CountedResponse> {
  const client = await getDatabasePool().connect();
  const prototype = Object.getPrototypeOf(client) as { query: () => unknown };
  client.release();
  const spy = vi.spyOn(prototype, "query");
  try {
    const response = await run();
    await response.clone().arrayBuffer();
    return { response, statements: spy.mock.calls.length };
  } finally {
    spy.mockRestore();
  }
}

type ListBody = {
  data: Array<{
    id: string;
    labels: unknown[];
    sla?: { state: string };
    epic: { id: string } | null;
    blockedByOpenCount: number;
    assigneeActive: boolean | null;
    assigneeOnProject: boolean | null;
  }>;
};

describe("GET /api/projects/{projectId}/work-items query budget", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("runs the same number of statements for 10 and 100 fully decorated rows", async () => {
    const small = await seedProject(10);
    const large = await seedProject(100);
    const { app } = createApp();
    const read = (projectId: string) => () =>
      Promise.resolve(
        app.request(
          `/api/projects/${projectId}/work-items?limit=200&sort=position`,
        ),
      );

    const counts: number[] = [];
    for (const { owner, project, epicId } of [small, large]) {
      mockAuthenticatedSession(owner.user);
      // Warm per-process caches (feature flags, identity) so both reads are counted alike.
      expect((await read(project.id)()).status).toBe(200);
      const { response, statements } = await countStatements(read(project.id));
      expect(response.status).toBe(200);
      const body = (await response.json()) as ListBody;
      const rows = body.data.filter((row) => row.id !== epicId);
      expect(rows).toHaveLength(project === small.project ? 10 : 100);
      // Every per-row branch really ran.
      expect(rows.every((row) => row.epic?.id === epicId)).toBe(true);
      expect(rows.every((row) => row.labels.length === 2)).toBe(true);
      expect(rows.every((row) => row.sla !== undefined)).toBe(true);
      expect(rows.every((row) => row.assigneeActive === true)).toBe(true);
      expect(rows.every((row) => row.assigneeOnProject === true)).toBe(true);
      expect(rows.filter((row) => row.blockedByOpenCount > 0)).toHaveLength(
        rows.length - 1,
      );
      counts.push(statements);
    }

    expect(counts[0]).toBeGreaterThan(0);
    expect(counts[1]).toBe(counts[0]);
  });

  it("reports its phases in Server-Timing", async () => {
    const { owner, project } = await seedProject(3);
    mockAuthenticatedSession(owner.user);
    const { app } = createApp();
    const response = await app.request(
      `/api/projects/${project.id}/work-items`,
    );
    expect(response.status).toBe(200);
    const phases = (response.headers.get("server-timing") ?? "")
      .split(",")
      .map((entry) => entry.trim().split(";")[0]);
    expect(phases).toEqual([
      "project",
      "filters",
      "rows",
      "count",
      "labels",
      "facts",
      "sla",
      "epic",
      "total",
    ]);
    expect(response.headers.get("server-timing")).toMatch(
      /^(\w+;dur=\d+\.\d)(, \w+;dur=\d+\.\d)*$/,
    );
  });
});
