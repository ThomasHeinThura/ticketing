import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectManageAccess,
  requireRow,
} from "./helpers/fixtures";

async function seedCanonicalItem(input: {
  workspaceId: string;
  projectId: string;
  projectSlug: string;
  number: number;
  stateGroup: "unstarted" | "completed";
  dueDate: Date;
}) {
  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: input.workspaceId,
        key: randomUUID(),
        name: "Visible tree statistics fixture",
        category: "delivery",
      })
      .returning(),
    "work item type",
  );
  const template = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId: input.workspaceId,
        key: randomUUID(),
        name: `${input.projectSlug} ${input.stateGroup}`,
        group: input.stateGroup,
      })
      .returning(),
    "state template",
  );
  const state = requireRow(
    await db
      .insert(schema.stateTable)
      .values({
        projectId: input.projectId,
        stateTemplateId: template.id,
        isDefault: input.number === 1,
      })
      .returning(),
    "project state",
  );
  return requireRow(
    await db
      .insert(schema.workItemTable)
      .values({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        typeId: type.id,
        stateId: state.id,
        title: `${input.projectSlug} visible tree fixture ${input.number}`,
        number: input.number,
        key: `${input.projectSlug}-${input.number}`,
        dueDate: input.dueDate,
      })
      .returning(),
    "work item",
  );
}

describe("project list visible-tree aggregation query", () => {
  beforeEach(async () => resetTestDatabase());

  it("loads multiple project roots and their child subtree through PostgreSQL", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const parent = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const child = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const secondRoot = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await db
      .update(schema.projectTable)
      .set({ parentId: parent.project.id })
      .where(eq(schema.projectTable.id, child.project.id));
    await Promise.all(
      [parent.project.id, child.project.id, secondRoot.project.id].map((id) =>
        grantProjectManageAccess(member.user.id, id),
      ),
    );
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/project?workspaceId=${member.workspace.id}`,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const projects = (await response.json()) as Array<{
      id: string;
      descendantStatistics?: { totalTasks: number };
    }>;
    expect(projects.map((project) => project.id)).toEqual(
      expect.arrayContaining([
        parent.project.id,
        child.project.id,
        secondRoot.project.id,
      ]),
    );
    expect(
      projects.find((project) => project.id === parent.project.id)
        ?.descendantStatistics,
    ).toEqual(expect.objectContaining({ totalTasks: 0 }));
    expect(
      projects.find((project) => project.id === secondRoot.project.id),
    ).not.toHaveProperty("descendantStatistics");
  });

  it("returns known-answer self and visible-tree counts, completion, and due-date minima", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const parent = await createProjectFixture({
      workspaceId: member.workspace.id,
      name: "Visible tree statistics parent",
      slug: "visible-tree-statistics-parent",
    });
    const child = await createProjectFixture({
      workspaceId: member.workspace.id,
      name: "Visible tree statistics child",
      slug: "visible-tree-statistics-child",
    });
    await db
      .update(schema.projectTable)
      .set({ parentId: parent.project.id })
      .where(eq(schema.projectTable.id, child.project.id));
    await Promise.all(
      [parent.project.id, child.project.id].map((id) =>
        grantProjectManageAccess(member.user.id, id),
      ),
    );

    const parentDueDate = new Date("2026-10-30T00:00:00.000Z");
    const childSoonestDueDate = new Date("2026-10-25T00:00:00.000Z");
    await seedCanonicalItem({
      workspaceId: member.workspace.id,
      projectId: parent.project.id,
      projectSlug: parent.project.slug,
      number: 1,
      stateGroup: "unstarted",
      dueDate: parentDueDate,
    });
    await seedCanonicalItem({
      workspaceId: member.workspace.id,
      projectId: child.project.id,
      projectSlug: child.project.slug,
      number: 1,
      stateGroup: "completed",
      dueDate: new Date("2026-11-04T00:00:00.000Z"),
    });
    await seedCanonicalItem({
      workspaceId: member.workspace.id,
      projectId: child.project.id,
      projectSlug: child.project.slug,
      number: 2,
      stateGroup: "unstarted",
      dueDate: childSoonestDueDate,
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const response = await app.request(
      `/api/project?workspaceId=${member.workspace.id}`,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const projects = (await response.json()) as Array<{
      id: string;
      statistics: {
        totalTasks: number;
        completionPercentage: number;
        dueDate: string | null;
      };
      descendantStatistics?: {
        totalTasks: number;
        completionPercentage: number;
        dueDate: string | null;
      };
    }>;
    const parentRow = projects.find(
      (project) => project.id === parent.project.id,
    );
    const childRow = projects.find(
      (project) => project.id === child.project.id,
    );
    expect(parentRow?.statistics).toEqual({
      totalTasks: 1,
      completionPercentage: 0,
      dueDate: parentDueDate.toISOString(),
    });
    expect(parentRow?.descendantStatistics).toEqual({
      totalTasks: 3,
      completionPercentage: 33,
      dueDate: childSoonestDueDate.toISOString(),
    });
    expect(childRow?.statistics).toEqual({
      totalTasks: 2,
      completionPercentage: 50,
      dueDate: childSoonestDueDate.toISOString(),
    });
    expect(childRow).not.toHaveProperty("descendantStatistics");
  });
});
