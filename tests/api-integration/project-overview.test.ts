/**
 * Project Overview (migration 0213; decisions D1/D2, Thomas 31 Oct 2026):
 * `GET /api/project/{id}/overview`, `PATCH /api/project/{id}/summary` and
 * `GET`/`PUT /api/project/{id}/contract`. Covers the migration (new columns, defaults and
 * CHECKs), the derived counts, the hour bank, permissions, tenant isolation and the audit rows.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { slaPauseTable } from "../../apps/api/src/database/migration-schema";
import {
  timeActivityTable,
  timeEntryTable,
} from "../../apps/api/src/database/schema-p5-time";
import { createApp } from "../../apps/api/src/index";
import { createCalendar } from "../../apps/api/src/service-calendar/repository";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectManageAccess,
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";

type User = Parameters<typeof mockAuthenticatedSession>[0];

async function call(
  user: User | null,
  path: string,
  init: { method?: string; body?: unknown } = {},
) {
  if (user) mockAuthenticatedSession(user);
  else mockAnonymousSession();
  const { app } = createApp();
  return app.request(path, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json" },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

async function adminWorld() {
  const admin = await createWorkspaceMember({ role: "admin" });
  const { project } = await createProjectFixture({
    workspaceId: admin.workspace.id,
    name: "Overview project",
  });
  await grantProjectManageAccess(admin.user.id, project.id);
  return { admin, project, workspaceId: admin.workspace.id };
}

async function stateIn(
  workspaceId: string,
  projectId: string,
  group: "backlog" | "unstarted" | "started" | "completed" | "cancelled",
) {
  const template = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId,
        key: `st-${randomUUID()}`,
        name: group,
        group,
      })
      .returning(),
    "template",
  );
  return requireRow(
    await db
      .insert(schema.stateTable)
      .values({ projectId, stateTemplateId: template.id })
      .returning(),
    "state",
  ).id;
}

async function itemFactory(workspaceId: string, projectId: string) {
  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId,
        key: `type-${randomUUID()}`,
        name: "Incident",
        category: "service",
      })
      .returning(),
    "type",
  );
  const states = {
    backlog: await stateIn(workspaceId, projectId, "backlog"),
    started: await stateIn(workspaceId, projectId, "started"),
    completed: await stateIn(workspaceId, projectId, "completed"),
    cancelled: await stateIn(workspaceId, projectId, "cancelled"),
  };
  let number = 0;
  async function make(
    group: keyof typeof states,
    extra: { breached?: boolean; waiting?: boolean; deleted?: boolean } = {},
  ) {
    number += 1;
    const item = requireRow(
      await db
        .insert(schema.workItemTable)
        .values({
          workspaceId,
          projectId,
          typeId: type.id,
          stateId: states[group],
          title: `Item ${number}`,
          number,
          key: `OVW-${randomUUID().slice(0, 8)}`,
          deletedAt: extra.deleted ? new Date() : null,
        })
        .returning(),
      "item",
    );
    if (extra.breached) {
      // Both metrics breached: still one breached item.
      for (const metric of ["first_response", "resolution"] as const)
        await db.insert(schema.workItemSlaCacheTable).values({
          workItemId: item.id,
          metric,
          state: "breached",
          dueAt: new Date(Date.now() - 3_600_000),
          computedAt: new Date(),
        });
    }
    if (extra.waiting)
      await db.insert(slaPauseTable).values({
        workItemId: item.id,
        metric: "resolution",
        reason: "waiting_customer",
      });
    return item;
  }
  return { type, make };
}

type Overview = {
  status: string;
  kind: string;
  counts: Record<string, number>;
  currentMilestone: { id: string; name: string } | null;
  overdueMilestoneIds: string[];
  facts: Record<string, string | null>;
  serviceLevels: {
    policyName: string | null;
    source: string;
    goals: unknown[];
  };
};

type Contract = {
  contract: Record<string, unknown> | null;
  state: string;
  daysRemaining: number | null;
  hourBank: {
    contractedMinutes: number;
    usedMinutes: number;
    remainingMinutes: number;
    usedPct: number;
  } | null;
  recentEntries: Array<{
    minutes: number;
    date: string;
    workItemKey: string | null;
  }>;
  recentEntriesVisible: boolean;
};

function isoDaysFromToday(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

describe("API integration: project overview, summary and contract (0213)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("migration 0213: existing and new projects are active, with empty summary and the status CHECK", async () => {
    const { project } = await adminWorld();
    expect(project.status).toBe("active");
    expect(project.objective).toBeNull();
    expect(project.statusNoteAt).toBeNull();
    await expect(
      db
        .update(schema.projectTable)
        .set({ status: "paused" })
        .where(eq(schema.projectTable.id, project.id)),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.projectContractTable).values({
        projectId: project.id,
        startDate: "2026-02-01",
        endDate: "2026-01-01",
        contractedMinutes: 60,
        coverage: "9x5",
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.projectContractTable).values({
        projectId: project.id,
        startDate: "2026-01-01",
        endDate: "2026-02-01",
        contractedMinutes: 60,
        coverage: "7x7",
      }),
    ).rejects.toThrow();
  });

  it("rejects unauthenticated requests", async () => {
    const response = await call(null, "/api/project/missing/overview");
    expect(response.status).toBe(401);
  });

  it("derives open, breached, in progress, waiting and done/total counts, prerequisites and milestones", async () => {
    const { admin, project, workspaceId } = await adminWorld();
    const { make } = await itemFactory(workspaceId, project.id);
    await make("backlog");
    await make("backlog", { breached: true });
    await make("started");
    await make("started", { waiting: true, breached: true });
    await make("completed");
    await make("completed", { breached: true }); // closed: not counted as breached
    await make("cancelled");
    await make("started", { deleted: true }); // deleted: not counted at all

    await db.insert(schema.prerequisiteTable).values([
      {
        projectId: project.id,
        title: "VPN",
        ownerSide: "customer",
        isBlocking: true,
      },
      {
        projectId: project.id,
        title: "Accounts",
        ownerSide: "us",
        isBlocking: true,
        completedAt: new Date(),
      },
      {
        projectId: project.id,
        title: "Docs",
        ownerSide: "both",
        isBlocking: false,
      },
    ]);
    const [past] = await db
      .insert(schema.milestoneTable)
      .values([
        {
          projectId: project.id,
          name: "Kick-off",
          date: new Date("2026-01-01"),
        },
        {
          projectId: project.id,
          name: "Design",
          date: new Date("2026-02-01"),
          reachedAt: new Date("2026-02-01"),
        },
        {
          projectId: project.id,
          name: "Go-live",
          date: new Date("2099-01-01"),
        },
      ])
      .returning();

    const response = await call(
      admin.user,
      `/api/project/${project.id}/overview`,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as Overview;
    expect(body.counts).toEqual({
      open: 4,
      breached: 2,
      inProgress: 1,
      waiting: 1,
      done: 2,
      total: 6,
      blockingPrerequisitesOutstanding: 1,
      prerequisites: 3,
    });
    expect(body.currentMilestone?.name).toBe("Kick-off");
    expect(body.overdueMilestoneIds).toEqual([past?.id]);
    expect(body.status).toBe("active");
    expect(body.kind).toBe("project");
    expect(body.serviceLevels).toEqual({
      policyName: null,
      source: "none",
      goals: [],
    });
  });

  it("keeps a milestone due today on time; only a past due day is overdue", async () => {
    const { admin, project } = await adminWorld();
    // The UI stores a due day as midnight UTC, which is already behind `now` all day.
    const [, yesterday] = await db
      .insert(schema.milestoneTable)
      .values([
        {
          projectId: project.id,
          name: "Due today",
          date: new Date(`${isoDaysFromToday(0)}T00:00:00.000Z`),
        },
        {
          projectId: project.id,
          name: "Due yesterday",
          date: new Date(`${isoDaysFromToday(-1)}T00:00:00.000Z`),
        },
      ])
      .returning();
    const response = await call(
      admin.user,
      `/api/project/${project.id}/overview`,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as Overview;
    expect(body.overdueMilestoneIds).toEqual([yesterday?.id]);
  });

  it("returns zero counts and no milestone for an empty project", async () => {
    const { admin, project } = await adminWorld();
    const response = await call(
      admin.user,
      `/api/project/${project.id}/overview`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Overview;
    expect(Object.values(body.counts).every((value) => value === 0)).toBe(true);
    expect(body.currentMilestone).toBeNull();
  });

  it("updates the summary and status, stamps the status note time and audits only field names", async () => {
    const { admin, project } = await adminWorld();
    const response = await call(
      admin.user,
      `/api/project/${project.id}/summary`,
      {
        method: "PATCH",
        body: {
          objective: "  Move support to TaskDesk  ",
          inScope: "Incidents",
          statusNote: "On track for go-live",
          status: "on_hold",
        },
      },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.objective).toBe("Move support to TaskDesk");
    expect(body.status).toBe("on_hold");
    expect(body.statusNoteAt).not.toBeNull();

    // Blank clears; an unchanged note keeps its timestamp.
    const firstNoteAt = body.statusNoteAt;
    const cleared = await call(
      admin.user,
      `/api/project/${project.id}/summary`,
      {
        method: "PATCH",
        body: { inScope: "   ", statusNote: "On track for go-live" },
      },
    );
    const clearedBody = (await cleared.json()) as Record<string, unknown>;
    expect(clearedBody.inScope).toBeNull();
    expect(clearedBody.statusNoteAt).toBe(firstNoteAt);

    const detail = await call(admin.user, `/api/project/${project.id}`);
    const detailBody = (await detail.json()) as Record<string, unknown>;
    expect(detailBody.objective).toBe("Move support to TaskDesk");
    expect(detailBody.status).toBe("on_hold");

    const audits = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.action, "project.summary_updated"),
          eq(schema.auditLogTable.entityId, project.id),
        ),
      );
    expect(audits).toHaveLength(2);
    const serialised = JSON.stringify(audits.map((row) => row.after));
    expect(serialised).toContain("objective");
    expect(serialised).not.toContain("Move support");

    const invalid = await call(
      admin.user,
      `/api/project/${project.id}/summary`,
      {
        method: "PATCH",
        body: { status: "paused" },
      },
    );
    expect(invalid.status).toBe(400);
    const empty = await call(admin.user, `/api/project/${project.id}/summary`, {
      method: "PATCH",
      body: {},
    });
    expect(empty.status).toBe(400);
  });

  it("saves the contract, derives state and hour bank from billable time in the period, and audits", async () => {
    const { admin, project, workspaceId } = await adminWorld();
    const none = await call(admin.user, `/api/project/${project.id}/contract`);
    expect(none.status).toBe(200);
    expect(((await none.json()) as Contract).state).toBe("none");

    const save = await call(admin.user, `/api/project/${project.id}/contract`, {
      method: "PUT",
      body: {
        startDate: isoDaysFromToday(-60),
        endDate: isoDaysFromToday(20),
        contractedMinutes: 600,
        coverage: "24x7",
        kickoffStatus: "completed",
        kickoffDate: isoDaysFromToday(-55),
      },
    });
    expect(save.status, await save.clone().text()).toBe(200);
    expect(((await save.json()) as Contract).state).toBe("expiring");

    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, admin.user.id))
      .limit(1);
    const activity = requireRow(
      await db
        .insert(timeActivityTable)
        .values({ workspaceId, name: "Support" })
        .returning(),
      "activity",
    );
    const entry = (date: string, minutes: number, billable = true) => ({
      workspaceId,
      projectId: project.id,
      personId: person?.id as string,
      date,
      minutes,
      activityId: activity.id,
      billable,
      description: "secret customer detail",
    });
    await db.insert(timeEntryTable).values([
      entry(isoDaysFromToday(-10), 120),
      entry(isoDaysFromToday(-5), 90),
      entry(isoDaysFromToday(-4), 500, false), // not billable
      entry(isoDaysFromToday(-90), 300), // before the period
    ]);

    const read = await call(admin.user, `/api/project/${project.id}/contract`);
    const body = (await read.json()) as Contract;
    expect(body.hourBank).toEqual({
      contractedMinutes: 600,
      usedMinutes: 210,
      remainingMinutes: 390,
      usedPct: 35,
    });
    expect(body.daysRemaining).toBe(20);
    expect(body.recentEntries.map((row) => row.minutes)).toEqual([90, 120]);
    expect(JSON.stringify(body)).not.toContain("secret customer detail");

    // Re-saving updates the one row; kickoff not completed reads as kickoff_pending.
    const resave = await call(
      admin.user,
      `/api/project/${project.id}/contract`,
      {
        method: "PUT",
        body: {
          startDate: isoDaysFromToday(-60),
          endDate: isoDaysFromToday(200),
          contractedMinutes: 6000,
          coverage: "9x5",
          kickoffStatus: "scheduled",
          kickoffDate: null,
        },
      },
    );
    expect(((await resave.json()) as Contract).state).toBe("kickoff_pending");
    const rows = await db
      .select()
      .from(schema.projectContractTable)
      .where(eq(schema.projectContractTable.projectId, project.id));
    expect(rows).toHaveLength(1);

    const audits = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "project_contract.set"));
    expect(audits).toHaveLength(2);
    expect(audits[0]?.projectId).toBe(project.id);

    const backwards = await call(
      admin.user,
      `/api/project/${project.id}/contract`,
      {
        method: "PUT",
        body: {
          startDate: "2026-05-01",
          endDate: "2026-04-01",
          contractedMinutes: 60,
          coverage: "9x5",
          kickoffStatus: "pending",
        },
      },
    );
    expect(backwards.status).toBe(422);
  });

  it("rejects impossible calendar dates with 400 and accepts a real leap day", async () => {
    const { admin, project } = await adminWorld();
    const valid = {
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      contractedMinutes: 600,
      coverage: "9x5",
      kickoffStatus: "scheduled",
      kickoffDate: "2026-01-05",
    };
    for (const patch of [
      { startDate: "2026-02-30" },
      { endDate: "2026-02-30" },
      { kickoffDate: "2026-04-31" },
      { startDate: "2026-13-01" },
    ]) {
      const response = await call(
        admin.user,
        `/api/project/${project.id}/contract`,
        { method: "PUT", body: { ...valid, ...patch } },
      );
      expect(response.status, JSON.stringify(patch)).toBe(400);
    }
    expect(
      await db
        .select()
        .from(schema.projectContractTable)
        .where(eq(schema.projectContractTable.projectId, project.id)),
    ).toHaveLength(0);

    const leap = await call(admin.user, `/api/project/${project.id}/contract`, {
      method: "PUT",
      body: { ...valid, endDate: "2028-02-29" },
    });
    expect(leap.status, await leap.clone().text()).toBe(200);
  });

  it("lets a viewer read but not write, and writes nothing on refusal", async () => {
    const { project, workspaceId } = await adminWorld();
    const viewer = await createWorkspaceMember({ role: "viewer" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId,
      userId: viewer.user.id,
      role: "viewer",
      joinedAt: new Date(),
    });
    await grantProjectRole(viewer.user.id, project.id, ["project:read"]);

    const read = await call(viewer.user, `/api/project/${project.id}/overview`);
    expect(read.status, await read.clone().text()).toBe(200);
    const readContract = await call(
      viewer.user,
      `/api/project/${project.id}/contract`,
    );
    expect(readContract.status).toBe(200);

    const summary = await call(
      viewer.user,
      `/api/project/${project.id}/summary`,
      {
        method: "PATCH",
        body: { status: "closed" },
      },
    );
    expect(summary.status).toBe(403);
    const contract = await call(
      viewer.user,
      `/api/project/${project.id}/contract`,
      {
        method: "PUT",
        body: {
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          contractedMinutes: 60,
          coverage: "9x5",
          kickoffStatus: "pending",
        },
      },
    );
    expect(contract.status).toBe(403);

    const [row] = await db
      .select({ status: schema.projectTable.status })
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, project.id));
    expect(row?.status).toBe("active");
    const contracts = await db.select().from(schema.projectContractTable);
    expect(contracts).toHaveLength(0);
  });

  it("withholds individual time entries without time_entry:read_any but keeps the aggregate hour bank", async () => {
    const { admin, project, workspaceId } = await adminWorld();
    const saved = await call(
      admin.user,
      `/api/project/${project.id}/contract`,
      {
        method: "PUT",
        body: {
          startDate: isoDaysFromToday(-30),
          endDate: isoDaysFromToday(60),
          contractedMinutes: 600,
          coverage: "9x5",
          kickoffStatus: "completed",
        },
      },
    );
    expect(saved.status, await saved.clone().text()).toBe(200);
    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, admin.user.id))
      .limit(1);
    const activity = requireRow(
      await db
        .insert(timeActivityTable)
        .values({ workspaceId, name: "Support" })
        .returning(),
      "activity",
    );
    await db.insert(timeEntryTable).values({
      workspaceId,
      projectId: project.id,
      personId: person?.id as string,
      date: isoDaysFromToday(-2),
      minutes: 150,
      activityId: activity.id,
      billable: true,
    });

    const own = (await (
      await call(admin.user, `/api/project/${project.id}/contract`)
    ).json()) as Contract;
    expect(own.recentEntriesVisible).toBe(true);
    expect(own.recentEntries.map((row) => row.minutes)).toEqual([150]);

    const viewer = await createWorkspaceMember({ role: "viewer" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId,
      userId: viewer.user.id,
      role: "viewer",
      joinedAt: new Date(),
    });
    await grantProjectRole(viewer.user.id, project.id, ["project:read"]);
    // Built-in members and viewers hold no time_entry:read_any (only lead, admin and owner do).
    const member = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId,
      userId: member.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    await grantProjectRole(member.user.id, project.id, ["project:read"]);

    for (const user of [viewer.user, member.user]) {
      const read = await call(user, `/api/project/${project.id}/contract`);
      expect(read.status, await read.clone().text()).toBe(200);
      const body = (await read.json()) as Contract;
      expect(body.hourBank?.usedMinutes).toBe(150);
      expect(body.hourBank?.remainingMinutes).toBe(450);
      expect(body.recentEntries).toEqual([]);
      expect(body.recentEntriesVisible).toBe(false);
    }
  });

  it("refuses a member without project:manage_settings on the contract write", async () => {
    const { project, workspaceId } = await adminWorld();
    const member = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId,
      userId: member.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    await grantProjectManageAccess(member.user.id, project.id);
    const contract = await call(
      member.user,
      `/api/project/${project.id}/contract`,
      {
        method: "PUT",
        body: {
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          contractedMinutes: 60,
          coverage: "9x5",
          kickoffStatus: "pending",
        },
      },
    );
    expect(contract.status).toBe(403);
  });

  it("isolates tenants: another workspace's admin gets 404 on every route", async () => {
    const { project } = await adminWorld();
    const stranger = await createWorkspaceMember({ role: "admin" });
    for (const [method, path, body] of [
      ["GET", "overview", undefined],
      ["GET", "contract", undefined],
      ["PATCH", "summary", { status: "closed" }],
      [
        "PUT",
        "contract",
        {
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          contractedMinutes: 60,
          coverage: "9x5",
          kickoffStatus: "pending",
        },
      ],
    ] as const) {
      const response = await call(
        stranger.user,
        `/api/project/${project.id}/${path}`,
        {
          method,
          body,
        },
      );
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    const contracts = await db.select().from(schema.projectContractTable);
    expect(contracts).toHaveLength(0);
  });

  it("shows a managed service's effective SLA targets and facts read-only", async () => {
    const { admin, project, workspaceId } = await adminWorld();
    const { type } = await itemFactory(workspaceId, project.id);
    const calendar = await createCalendar({
      workspaceId,
      name: "Business hours",
      timezone: "UTC",
      windows: { mon: [{ from: 540, to: 1020 }] },
      holidays: [],
      actor: { actorId: admin.user.id, actorType: "person", apiKeyId: null },
    });
    const policy = requireRow(
      await db
        .insert(schema.slaPolicyTable)
        .values({ workspaceId, name: "Gold support" })
        .returning(),
      "policy",
    );
    const version = requireRow(
      await db
        .insert(schema.slaPolicyVersionTable)
        .values({
          workspaceId,
          policyId: policy.id,
          number: 1,
          calendarId: calendar.id,
          atRiskThresholdPct: 80,
        })
        .returning(),
      "version",
    );
    // A published version needs the complete matrix: both metrics at every priority.
    const targets = {
      urgent: [15, 240],
      high: [60, 480],
      medium: [240, 1440],
      low: [480, 2880],
    };
    await db.insert(schema.slaGoalTable).values(
      Object.entries(targets).flatMap(([priority, [response, resolution]]) =>
        (
          [
            ["first_response", response],
            ["resolution", resolution],
          ] as const
        ).map(([metric, targetMinutes]) => ({
          workspaceId,
          versionId: version.id,
          metric,
          workItemTypeId: type.id,
          priority: priority as "urgent" | "high" | "medium" | "low",
          targetMinutes: targetMinutes as number,
        })),
      ),
    );
    // Publish: goals are written to the draft first, then the version takes effect.
    await db
      .update(schema.slaPolicyVersionTable)
      .set({ effectiveFrom: new Date() })
      .where(eq(schema.slaPolicyVersionTable.id, version.id));
    await db
      .update(schema.slaPolicyTable)
      .set({ activeVersionId: version.id })
      .where(eq(schema.slaPolicyTable.id, policy.id));
    await db
      .update(schema.projectTable)
      .set({
        kind: "managed_service",
        supportLevel: "L2",
        serviceCalendarId: calendar.id,
        serviceCalendarMode: "override",
        slaPolicyId: policy.id,
        slaPolicyMode: "override",
      })
      .where(eq(schema.projectTable.id, project.id));

    const response = await call(
      admin.user,
      `/api/project/${project.id}/overview`,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as Overview;
    expect(body.kind).toBe("managed_service");
    expect(body.facts.supportLevel).toBe("L2");
    expect(body.facts.serviceCalendarName).toBe("Business hours");
    expect(body.facts.customerName).toBeNull();
    expect(body.serviceLevels.policyName).toBe("Gold support");
    expect(body.serviceLevels.source).toBe("project");
    expect(body.serviceLevels.goals).toHaveLength(8);
    expect(body.serviceLevels.goals.slice(0, 2)).toEqual([
      {
        metric: "first_response",
        workItemTypeName: "Incident",
        priority: "urgent",
        targetMinutes: 15,
      },
      {
        metric: "resolution",
        workItemTypeName: "Incident",
        priority: "urgent",
        targetMinutes: 240,
      },
    ]);
  });

  it("names stakeholders on the list route (Team tab)", async () => {
    const { admin, project } = await adminWorld();
    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, admin.user.id))
      .limit(1);
    await db.insert(schema.stakeholderTable).values({
      projectId: project.id,
      personId: person?.id as string,
      role: "Project manager",
      escalationOrder: 1,
    });
    const response = await call(
      admin.user,
      `/api/project/${project.id}/stakeholders`,
    );
    expect(response.status).toBe(200);
    const rows = (await response.json()) as Array<{
      displayName: string | null;
      role: string;
    }>;
    expect(rows).toEqual([
      expect.objectContaining({
        role: "Project manager",
        displayName: "Integration Test User",
      }),
    ]);
  });

  it("deletes the contract with its project", async () => {
    const { admin, project } = await adminWorld();
    await call(admin.user, `/api/project/${project.id}/contract`, {
      method: "PUT",
      body: {
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        contractedMinutes: 60,
        coverage: "12x5",
        kickoffStatus: "pending",
      },
    });
    await db
      .delete(schema.projectTable)
      .where(eq(schema.projectTable.id, project.id));
    const contracts = await db.select().from(schema.projectContractTable);
    expect(contracts).toHaveLength(0);
  });
});
