/**
 * #580 batch 2: behaviour pins for global search once its statements live in the search
 * repository -- tenant scoping (one workspace vs every workspace the caller belongs to),
 * relevance ordering, the short-id exact match, and the type filter.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createProjectFixture } from "./helpers/fixtures";
import { createSeesAllWorkspaceMember } from "./helpers/project-reach-world";

type Result = {
  id: string;
  type: string;
  title: string;
  relevanceScore: number;
  workspaceId?: string;
};

async function searchRaw(workspaceId: string, query: string, extra = "") {
  const { app } = createApp();
  return app.request(
    `/api/search?q=${encodeURIComponent(query)}&workspaceId=${workspaceId}${extra}`,
  );
}

async function search(workspaceId: string, query: string, extra = "") {
  const response = await searchRaw(workspaceId, query, extra);
  expect(response.status).toBe(200);
  return (await response.json()) as { results: Result[]; totalCount: number };
}

async function seedTask(
  projectId: string,
  columnId: string,
  number: number,
  title: string,
  description?: string,
) {
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId,
      title,
      description,
      status: "to-do",
      columnId,
      priority: "medium",
      number,
      position: number,
    })
    .returning();
  if (!task) throw new Error("failed to seed task");
  return task;
}

describe("API integration: global search scope and ranking", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("never returns another tenant's rows, with or without a workspaceId filter", async () => {
    const mine = await createSeesAllWorkspaceMember({ role: "admin" });
    const theirs = await createSeesAllWorkspaceMember({ role: "admin" });
    const myProject = await createProjectFixture({
      workspaceId: mine.workspace.id,
      name: "Zebra mine",
    });
    const theirProject = await createProjectFixture({
      workspaceId: theirs.workspace.id,
      name: "Zebra theirs",
    });
    const myTask = await seedTask(
      myProject.project.id,
      myProject.columns.todo.id,
      1,
      "Zebra task mine",
    );
    const theirTask = await seedTask(
      theirProject.project.id,
      theirProject.columns.todo.id,
      1,
      "Zebra task theirs",
    );
    mockAuthenticatedSession(mine.user);

    const scoped = await search(mine.workspace.id, "Zebra");
    expect(scoped.results.map((r) => r.id).sort()).toEqual(
      [myTask.id, myProject.project.id].sort(),
    );
    expect(scoped.results.map((r) => r.id)).not.toContain(theirTask.id);
    expect(scoped.results.map((r) => r.id)).not.toContain(
      theirProject.project.id,
    );

    const foreign = await searchRaw(theirs.workspace.id, "Zebra");
    expect(foreign.status).toBe(403);
    await foreign.text();
  });

  it("without a workspace filter, searches every workspace the user belongs to and no other", async () => {
    const mine = await createSeesAllWorkspaceMember({ role: "admin" });
    const theirs = await createSeesAllWorkspaceMember({ role: "admin" });
    const myProject = await createProjectFixture({
      workspaceId: mine.workspace.id,
      name: "Okapi mine",
    });
    const theirProject = await createProjectFixture({
      workspaceId: theirs.workspace.id,
      name: "Okapi theirs",
    });

    const { default: globalSearch } = await import(
      "../../apps/api/src/search/controllers/global-search"
    );
    const reachable = async (workspaceIds: string[]) =>
      [myProject.project.id, theirProject.project.id].filter(
        () => workspaceIds.length > 0,
      );

    const result = await globalSearch({
      query: "Okapi",
      userId: mine.user.id,
      type: "projects",
      reachableProjectIds: reachable,
    });
    expect(result.results.map((r) => r.id)).toEqual([myProject.project.id]);

    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date(), purgeAfter: new Date() })
      .where(eq(schema.projectTable.id, myProject.project.id));
    const afterDelete = await globalSearch({
      query: "Okapi",
      userId: mine.user.id,
      type: "projects",
      reachableProjectIds: reachable,
    });
    expect(afterDelete.results).toEqual([]);

    const none = await globalSearch({
      query: "Okapi",
      userId: "user-without-workspaces",
      reachableProjectIds: reachable,
    });
    expect(none).toEqual({ results: [], totalCount: 0, searchQuery: "Okapi" });

    const noneReachable = await globalSearch({
      query: "Okapi",
      userId: mine.user.id,
      reachableProjectIds: async () => [],
    });
    expect(noneReachable.results.filter((r) => r.type !== "workspace")).toEqual(
      [],
    );
  });

  it("ranks a title match above a description match, and filters by type", async () => {
    const member = await createSeesAllWorkspaceMember({ role: "admin" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
      name: "Ranking board",
    });
    const descOnly = await seedTask(
      project.id,
      columns.todo.id,
      1,
      "Plain title",
      "mentions quokka here",
    );
    const titleHit = await seedTask(
      project.id,
      columns.todo.id,
      2,
      "Quokka in the title",
    );
    mockAuthenticatedSession(member.user);

    const { results } = await search(
      member.workspace.id,
      "quokka",
      "&type=tasks",
    );
    expect(results.map((r) => r.id)).toEqual([titleHit.id, descOnly.id]);
    expect(results[0]?.relevanceScore).toBe(3);
    expect(results[1]?.relevanceScore).toBe(2);
    expect(results.every((r) => r.type === "task")).toBe(true);

    const limited = await search(
      member.workspace.id,
      "quokka",
      "&type=tasks&limit=1",
    );
    expect(limited.results.map((r) => r.id)).toEqual([titleHit.id]);

    const projectsOnly = await search(
      member.workspace.id,
      "Ranking",
      "&type=projects",
    );
    expect(projectsOnly.results.map((r) => r.type)).toEqual(["project"]);
  });

  it("puts the exact short-id task first with the top score and lists it once", async () => {
    const member = await createSeesAllWorkspaceMember({ role: "admin" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
      slug: "kiwi",
    });
    const target = await seedTask(
      project.id,
      columns.todo.id,
      7,
      "Unrelated words",
    );
    mockAuthenticatedSession(member.user);

    const { results } = await search(
      member.workspace.id,
      "KIWI-7",
      "&type=tasks",
    );
    expect(results[0]).toMatchObject({ id: target.id, relevanceScore: 10 });
    expect(results.filter((r) => r.id === target.id)).toHaveLength(1);
  });

  it("returns a comment hit only when the activity is a comment under type=comments", async () => {
    const member = await createSeesAllWorkspaceMember({ role: "admin" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id, 1, "Host task");
    await db.insert(schema.taskActivityTable).values([
      {
        taskId: task.id,
        type: "comment",
        userId: member.user.id,
        content: "marmoset in a comment",
      },
      {
        taskId: task.id,
        type: "task",
        userId: member.user.id,
        content: "marmoset in an activity",
      },
    ]);
    mockAuthenticatedSession(member.user);

    const comments = await search(
      member.workspace.id,
      "marmoset",
      "&type=comments",
    );
    expect(comments.results.map((r) => r.type)).toEqual(["comment"]);

    const activities = await search(
      member.workspace.id,
      "marmoset",
      "&type=activities",
    );
    expect(activities.results.map((r) => r.type).sort()).toEqual([
      "activity",
      "comment",
    ]);
  });
});
