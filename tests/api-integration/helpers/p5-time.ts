import { eq } from "drizzle-orm";
import db, { schema } from "../../../apps/api/src/database";
import {
  hourlyRateTable,
  runningTimerTable,
  timeActivityTable,
  timeEntryTable,
} from "../../../apps/api/src/database/schema-p5-time";
import { createApp } from "../../../apps/api/src/index";
import { mockAuthenticatedSession } from "./auth";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  grantWorkItemProjectAccess,
} from "./fixtures";
import { workItemWorld } from "./p4-closeout";
import { addMember } from "./reach-world";

export const JSON_HEADERS = { "content-type": "application/json" };
type User = Parameters<typeof mockAuthenticatedSession>[0];

export async function setTimeFlags(
  workspaceId: string,
  flags: { time?: boolean; cost?: boolean } = {},
) {
  for (const [key, enabled] of [
    ["feature.time_tracking", flags.time ?? true],
    ["feature.cost_tracking", flags.cost ?? true],
  ] as const) {
    await db
      .insert(schema.instanceFeatureFlagTable)
      .values({ featureKey: key, enabled: true, locked: false })
      .onConflictDoUpdate({
        target: schema.instanceFeatureFlagTable.featureKey,
        set: { enabled: true, locked: false },
      });
    await db
      .insert(schema.workspaceFeatureFlagTable)
      .values({ workspaceId, featureKey: key, enabled })
      .onConflictDoUpdate({
        target: [
          schema.workspaceFeatureFlagTable.workspaceId,
          schema.workspaceFeatureFlagTable.featureKey,
        ],
        set: { enabled },
      });
  }
}

/** A project-level switch, which beats the workspace's (project, workspace, instance, default). */
export async function setProjectTimeFlag(
  projectId: string,
  key: "feature.time_tracking" | "feature.cost_tracking",
  enabled: boolean,
) {
  await db
    .insert(schema.projectFeatureFlagTable)
    .values({ projectId, featureKey: key, enabled })
    .onConflictDoUpdate({
      target: [
        schema.projectFeatureFlagTable.projectId,
        schema.projectFeatureFlagTable.featureKey,
      ],
      set: { enabled },
    });
}

export async function personIdOf(userId: string) {
  const [person] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, userId))
    .limit(1);
  if (!person) throw new Error("person missing");
  return person.id;
}

export function isoDaysAgo(days: number, from = new Date()) {
  return new Date(from.getTime() - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * One workspace (time and cost tracking on) with an owner, a lead (reads anyone's time, no rates),
 * two members and a viewer who all reach project A, an outsider member who reaches nothing, a
 * second project B nobody but the owner reaches, one work item per project and the default
 * activities.
 */
export async function timeWorld() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const workspaceId = owner.workspace.id;
  await setTimeFlags(workspaceId);
  const { project: projectA } = await createProjectFixture({ workspaceId });
  const { project: projectB } = await createProjectFixture({ workspaceId });
  const rows = await workItemWorld(workspaceId, projectA.id);
  const itemA = await rows.makeItem("Item A");
  const rowsB = await workItemWorld(workspaceId, projectB.id);
  const itemB = await rowsB.makeItem("Item B");
  const child = await db
    .update(schema.workItemTable)
    .set({ parentId: itemA.id })
    .where(eq(schema.workItemTable.id, (await rows.makeItem("Child of A")).id))
    .returning();
  const childItem = child[0];
  if (!childItem) throw new Error("child missing");
  // Project reach and the project role's capabilities are decided per project (`budget:*` is
  // evaluated against the caller's project role, like every project-scoped route). Rate
  // visibility is resolved at the project too (P5-R1-06), so the owner's project role keeps
  // `time_entry:manage_rates`, as the workspace owner role holds it.
  for (const project of [projectA, projectB]) {
    await grantWorkItemProjectAccess(owner.user.id, project.id);
    await grantProjectRole(owner.user.id, project.id, [
      "budget:read",
      "budget:manage",
      "time_entry:manage_rates",
    ]);
  }
  const people: Record<string, Awaited<ReturnType<typeof addMember>>> = {};
  for (const [name, role] of [
    ["lead", "lead"],
    ["member", "member"],
    ["other", "member"],
    ["viewer", "viewer"],
    ["outsider", "member"],
  ] as const) {
    people[name] = await addMember(workspaceId, role);
    if (name !== "outsider") {
      await grantWorkItemProjectAccess(people[name].user.id, projectA.id);
      if (name !== "viewer")
        await grantProjectRole(people[name].user.id, projectA.id, [
          "budget:read",
        ]);
    }
  }
  const lead = people.lead as NonNullable<typeof people.lead>;
  const member = people.member as NonNullable<typeof people.member>;
  const other = people.other as NonNullable<typeof people.other>;
  const viewer = people.viewer as NonNullable<typeof people.viewer>;
  const outsider = people.outsider as NonNullable<typeof people.outsider>;
  const ownerPersonId = await personIdOf(owner.user.id);
  const { app } = createApp();

  function agent(
    user: User,
    path: string,
    init: { method?: string; body?: unknown } = {},
  ) {
    mockAuthenticatedSession(user);
    return app.request(path, {
      method: init.method ?? "GET",
      headers: JSON_HEADERS,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  }
  async function json<T = Record<string, unknown>>(response: Response) {
    return (await response.json()) as T;
  }
  const activities = await db
    .insert(timeActivityTable)
    .values(
      ["Development", "Support", "Meeting", "Travel"].map((name, position) => ({
        workspaceId,
        name,
        position,
      })),
    )
    .onConflictDoNothing()
    .returning();
  const [dev] = activities.length
    ? activities
    : await db
        .select()
        .from(timeActivityTable)
        .where(eq(timeActivityTable.workspaceId, workspaceId));
  if (!dev) throw new Error("activity missing");
  const defaultActivity = dev;

  async function logTime(
    user: User,
    overrides: Record<string, unknown> = {},
    workItemId = itemA.id,
  ) {
    return agent(user, "/api/time-entries", {
      method: "POST",
      body: {
        workspaceId,
        workItemId,
        date: isoDaysAgo(0),
        minutes: 90,
        activityId: defaultActivity.id,
        ...overrides,
      },
    });
  }
  async function addRate(
    personId: string,
    effectiveFrom: string,
    rateMinor = 6000,
    currency = "EUR",
    projectId: string | null = null,
  ) {
    return agent(owner.user, "/api/rates", {
      method: "POST",
      body: {
        workspaceId,
        personId,
        projectId,
        rateMinor,
        currency,
        effectiveFrom,
      },
    });
  }
  return {
    owner,
    ownerPersonId,
    lead,
    member,
    other,
    viewer,
    outsider,
    workspaceId,
    projectA,
    projectB,
    itemA,
    itemB,
    childItem,
    dev,
    app,
    agent,
    json,
    logTime,
    addRate,
  };
}

export type TimeWorld = Awaited<ReturnType<typeof timeWorld>>;

export async function auditActionsOf(workspaceId: string) {
  const rows = await db
    .select({ action: schema.auditLogTable.action })
    .from(schema.auditLogTable)
    .where(eq(schema.auditLogTable.workspaceId, workspaceId));
  return rows.map((row) => row.action);
}

export async function entryRows(workspaceId: string) {
  return db
    .select()
    .from(timeEntryTable)
    .where(eq(timeEntryTable.workspaceId, workspaceId));
}

export async function timerRows(workspaceId: string) {
  return db
    .select()
    .from(runningTimerTable)
    .where(eq(runningTimerTable.workspaceId, workspaceId));
}

export async function rateRows(workspaceId: string) {
  return db
    .select()
    .from(hourlyRateTable)
    .where(eq(hourlyRateTable.workspaceId, workspaceId));
}
