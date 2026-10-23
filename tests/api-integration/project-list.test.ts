import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember as createRestrictedWorkspaceMember,
  grantWorkItemProjectAccess,
  requireRow,
} from "./helpers/fixtures";
import { createSeesAllWorkspaceMember as createWorkspaceMember } from "./helpers/project-reach-world";

type ProjectListEntry = typeof schema.projectTable.$inferSelect & {
  statistics: {
    completionPercentage: number;
    totalTasks: number;
    dueDate: string | null;
  };
  tasks?: unknown;
};

async function seedWorkItems(
  projectId: string,
  items: {
    title: string;
    group: string;
    dueDate?: Date;
    number: number;
    archivedAt?: Date;
    deletedAt?: Date;
    stateName?: string;
  }[],
) {
  const project = requireRow(
    await db
      .select()
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, projectId)),
    "project",
  );
  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: project.workspaceId,
        key: randomUUID(),
        name: "Task",
        category: "delivery",
      })
      .returning(),
    "type",
  );
  for (const item of items) {
    const template = requireRow(
      await db
        .insert(schema.stateTemplateTable)
        .values({
          workspaceId: project.workspaceId,
          key: randomUUID(),
          name: item.stateName ?? "Custom state",
          group: item.group,
        })
        .returning(),
      "state template",
    );
    const state = requireRow(
      await db
        .insert(schema.stateTable)
        .values({ projectId, stateTemplateId: template.id })
        .returning(),
      "state",
    );
    await db.insert(schema.workItemTable).values({
      projectId,
      workspaceId: project.workspaceId,
      typeId: type.id,
      stateId: state.id,
      title: item.title,
      number: item.number,
      key: `${project.slug}-${item.number}`,
      dueDate: item.dueDate ?? null,
      archivedAt: item.archivedAt ?? null,
      deletedAt: item.deletedAt ?? null,
    });
  }
}

describe("API integration: project list payload", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("does not embed task rows in the project list response", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    await seedWorkItems(project.id, [
      { title: "First", group: "unstarted", number: 1 },
      { title: "Second", group: "completed", number: 2 },
      { title: "Third", group: "cancelled", number: 3 },
    ]);

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/project?workspaceId=${member.workspace.id}`,
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as ProjectListEntry[];
    expect(payload).toHaveLength(1);

    // The list endpoint is a summary view. Task rows must not ride along:
    // the payload grows without bound as a project fills up.
    const entry = requireRow(payload, "payload");
    expect(entry.tasks).toBeUndefined();
  });

  it("still reports accurate task statistics without embedding tasks", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    const earliest = new Date("2026-01-10T00:00:00.000Z");
    const later = new Date("2026-03-01T00:00:00.000Z");

    await seedWorkItems(project.id, [
      { title: "Open", group: "unstarted", dueDate: later, number: 1 },
      { title: "Closed", group: "completed", dueDate: earliest, number: 2 },
      { title: "Filed", group: "cancelled", number: 3 },
      { title: "Doing", group: "started", number: 4 },
    ]);

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/project?workspaceId=${member.workspace.id}`,
    );
    const payload = (await response.json()) as ProjectListEntry[];

    // Completed + cancelled mapped groups count as finished: 2 of 4 => 50%.
    const entry = requireRow(payload, "payload");
    expect(entry.statistics).toMatchObject({
      totalTasks: 4,
      completionPercentage: 50,
    });
    expect(new Date(entry.statistics.dueDate as string)).toEqual(earliest);
  });

  it("reports zeroed statistics for a project with no tasks", async () => {
    const member = await createWorkspaceMember();
    await createProjectFixture({ workspaceId: member.workspace.id });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/project?workspaceId=${member.workspace.id}`,
    );
    const payload = (await response.json()) as ProjectListEntry[];

    const entry = requireRow(payload, "payload");
    expect(entry.statistics).toMatchObject({
      totalTasks: 0,
      completionPercentage: 0,
      dueDate: null,
    });
    expect(entry.tasks).toBeUndefined();
  });

  it("keeps statistics isolated per project", async () => {
    const member = await createWorkspaceMember();
    const { project: alpha } = await createProjectFixture({
      workspaceId: member.workspace.id,
      name: "Alpha",
      slug: "alpha",
    });
    const { project: beta } = await createProjectFixture({
      workspaceId: member.workspace.id,
      name: "Beta",
      slug: "beta",
    });

    await seedWorkItems(alpha.id, [
      { title: "A1", group: "completed", number: 1 },
      { title: "A2", group: "unstarted", number: 2 },
    ]);
    await seedWorkItems(beta.id, [
      { title: "B1", group: "completed", number: 1 },
    ]);

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/project?workspaceId=${member.workspace.id}`,
    );
    const payload = (await response.json()) as ProjectListEntry[];

    const byName = new Map(payload.map((p) => [p.name, p]));
    expect(byName.get("Alpha")?.statistics).toMatchObject({
      totalTasks: 2,
      completionPercentage: 50,
    });
    expect(byName.get("Beta")?.statistics).toMatchObject({
      totalTasks: 1,
      completionPercentage: 100,
    });
  });
});

it("ignores stale legacy rows and archived/deleted canonical items while using terminal group mapping", async () => {
  const member = await createWorkspaceMember();
  const { project } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  const earliest = new Date("2026-01-10T00:00:00.000Z");
  const later = new Date("2026-03-01T00:00:00.000Z");
  await seedWorkItems(project.id, [
    {
      title: "Delivered",
      group: "completed",
      stateName: "Needs review",
      number: 1,
      dueDate: earliest,
    },
    { title: "Cancelled", group: "cancelled", stateName: "Waiting", number: 2 },
    {
      title: "Still open",
      group: "started",
      stateName: "Done",
      number: 3,
      dueDate: later,
    },
    {
      title: "Archived",
      group: "completed",
      number: 4,
      archivedAt: new Date(),
      dueDate: new Date("1999-01-01"),
    },
    {
      title: "Deleted",
      group: "completed",
      number: 5,
      deletedAt: new Date(),
      dueDate: new Date("1998-01-01"),
    },
  ]);
  await db.insert(schema.taskTable).values([
    {
      projectId: project.id,
      title: "STALE_LEGACY_SENTINEL",
      status: "done",
      number: 1,
      dueDate: new Date("1990-01-01"),
    },
    {
      projectId: project.id,
      title: "Another stale row",
      status: "archived",
      number: 2,
    },
  ]);
  mockAuthenticatedSession(member.user);
  const { app } = createApp();
  const response = await app.request(
    `/api/project?workspaceId=${member.workspace.id}`,
  );
  expect(response.status).toBe(200);
  const entry = requireRow(
    (await response.json()) as ProjectListEntry[],
    "project list",
  );
  expect(entry.statistics).toEqual({
    totalTasks: 3,
    completionPercentage: 67,
    dueDate: earliest.toISOString(),
  });
  expect(JSON.stringify(entry)).not.toContain("STALE_LEGACY_SENTINEL");
});
it("keeps hidden, deleted and foreign projects out of canonical statistics and only includes archived projects when requested", async () => {
  const member = await createRestrictedWorkspaceMember({ role: "member" });
  const { project: visible } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  await grantWorkItemProjectAccess(member.user.id, visible.id);
  const { project: hidden } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  const { project: archived } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  await grantWorkItemProjectAccess(member.user.id, archived.id);
  await db
    .update(schema.projectTable)
    .set({ archivedAt: new Date() })
    .where(eq(schema.projectTable.id, archived.id));
  const { project: deleted } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  await grantWorkItemProjectAccess(member.user.id, deleted.id);
  await db
    .update(schema.projectTable)
    .set({ deletedAt: new Date() })
    .where(eq(schema.projectTable.id, deleted.id));
  const foreignMember = await createRestrictedWorkspaceMember({
    role: "owner",
  });
  const { project: foreign } = await createProjectFixture({
    workspaceId: foreignMember.workspace.id,
  });
  await seedWorkItems(visible.id, [
    { title: "Visible", group: "started", number: 1 },
  ]);
  await seedWorkItems(hidden.id, [
    {
      title: "HIDDEN_PROJECT_SENTINEL",
      group: "completed",
      number: 1,
      dueDate: new Date("1990-01-01"),
    },
  ]);
  await seedWorkItems(archived.id, [
    { title: "Archived project item", group: "cancelled", number: 1 },
  ]);
  await seedWorkItems(foreign.id, [
    { title: "FOREIGN_PROJECT_SENTINEL", group: "completed", number: 1 },
  ]);
  mockAuthenticatedSession(member.user);
  const { app } = createApp();
  const current = (await (
    await app.request(`/api/project?workspaceId=${member.workspace.id}`)
  ).json()) as ProjectListEntry[];
  expect(current.map((row) => row.id)).toEqual([visible.id]);
  expect(current[0]?.statistics).toEqual({
    totalTasks: 1,
    completionPercentage: 0,
    dueDate: null,
  });
  const withArchived = (await (
    await app.request(
      `/api/project?workspaceId=${member.workspace.id}&includeArchived=true`,
    )
  ).json()) as ProjectListEntry[];
  expect(withArchived.map((row) => row.id).sort()).toEqual(
    [visible.id, archived.id].sort(),
  );
  expect(
    withArchived.find((row) => row.id === archived.id)?.statistics,
  ).toEqual({ totalTasks: 1, completionPercentage: 100, dueDate: null });
  expect(JSON.stringify(withArchived)).not.toContain("HIDDEN_PROJECT_SENTINEL");
  expect(JSON.stringify(withArchived)).not.toContain(
    "FOREIGN_PROJECT_SENTINEL",
  );
});
