/**
 * #310: server-side sort, cursor pagination and filters for
 * `GET /api/projects/{projectId}/work-items`, plus state/assignee name resolution.
 *
 * `work-item-create-read-list.test.ts` (#23) covers the route's baseline shape and
 * reach/archival behaviour; this file is #310's own dedicated coverage: every sort
 * field/direction, stable tie-break, a real cursor walk under ties, every filter,
 * invalid-parameter 400s, and that neither reach nor visibility widened.
 */
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
} from "./helpers/fixtures";

async function makeWorkItemType(workspaceId: string) {
  const now = new Date();
  const [type] = await db
    .insert(schema.workItemTypeTable)
    .values({
      workspaceId,
      key: `type-${randomUUID()}`,
      name: "Task",
      category: "delivery",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!type) throw new Error("makeWorkItemType: insert returned no row");
  return type;
}

async function makeState(
  workspaceId: string,
  projectId: string,
  opts: { isDefault: boolean; group?: string; name?: string } = {
    isDefault: true,
  },
) {
  const now = new Date();
  const [stateTemplate] = await db
    .insert(schema.stateTemplateTable)
    .values({
      workspaceId,
      key: `state-${randomUUID()}`,
      name: opts.name ?? "Backlog",
      group: opts.group ?? "backlog",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!stateTemplate)
    throw new Error("makeState: state_template insert returned no row");

  const [state] = await db
    .insert(schema.stateTable)
    .values({
      projectId,
      stateTemplateId: stateTemplate.id,
      isDefault: opts.isDefault,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!state) throw new Error("makeState: state insert returned no row");
  return { state, stateTemplate };
}

async function setupProject() {
  const creator = await createWorkspaceMember({ role: "member" });
  const { project } = await createProjectFixture({
    workspaceId: creator.workspace.id,
  });
  const type = await makeWorkItemType(creator.workspace.id);
  const { state } = await makeState(creator.workspace.id, project.id);
  return { creator, project, type, state };
}

function createWorkItemRequest(
  app: ReturnType<typeof createApp>["app"],
  projectId: string,
  body: Record<string, unknown>,
) {
  return app.request(`/api/projects/${projectId}/work-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createItem(
  app: ReturnType<typeof createApp>["app"],
  projectId: string,
  typeId: string,
  title: string,
  priority?: "low" | "medium" | "high" | "urgent",
) {
  const response = await createWorkItemRequest(app, projectId, {
    typeId,
    title,
    ...(priority ? { priority } : {}),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    id: string;
    key: string;
    number: number;
    version: number;
  };
}

async function setDueDate(
  app: ReturnType<typeof createApp>["app"],
  key: string,
  version: number,
  dueDate: string | null,
) {
  const response = await app.request(`/api/work-items/${key}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "if-match": String(version),
    },
    body: JSON.stringify({ dueDate }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { version: number };
}

type ListBody = {
  data: Array<{
    id: string;
    key: string;
    number: number;
    title: string;
    priority: string | null;
    dueDate: string | null;
    stateId: string;
    stateName: string;
    stateCategory: string;
    assigneeId: string | null;
    assigneeName: string | null;
  }>;
  page: { nextCursor: string | null; hasMore: boolean };
  meta: { total: number };
};

async function list(
  app: ReturnType<typeof createApp>["app"],
  projectId: string,
  query = "",
): Promise<{ status: number; body: ListBody | string }> {
  const response = await app.request(
    `/api/projects/${projectId}/work-items${query ? `?${query}` : ""}`,
  );
  const status = response.status;
  const body =
    status === 200
      ? ((await response.json()) as ListBody)
      : await response.text();
  return { status, body };
}

describe("API integration: work item list sort/pagination/filters (#310)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("sorts by title asc and desc", async () => {
    const { creator, project, type } = await setupProject();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    await createItem(app, project.id, type.id, "Banana");
    await createItem(app, project.id, type.id, "Apple");
    await createItem(app, project.id, type.id, "Cherry");

    const asc = await list(app, project.id, "sort=title&dir=asc");
    expect(asc.status).toBe(200);
    expect((asc.body as ListBody).data.map((i) => i.title)).toEqual([
      "Apple",
      "Banana",
      "Cherry",
    ]);

    const desc = await list(app, project.id, "sort=title&dir=desc");
    expect((desc.body as ListBody).data.map((i) => i.title)).toEqual([
      "Cherry",
      "Banana",
      "Apple",
    ]);
  });

  it("sorts by key (number) asc and desc -- numeric order, not text order", async () => {
    const { creator, project, type } = await setupProject();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    // Ten items so key text order ("PROJ-10" < "PROJ-2") would visibly diverge from
    // numeric order if the implementation ever regressed to sorting the text column.
    for (let i = 1; i <= 10; i++) {
      await createItem(app, project.id, type.id, `Item ${i}`);
    }

    const asc = await list(app, project.id, "sort=key&dir=asc&limit=200");
    expect((asc.body as ListBody).data.map((i) => i.number)).toEqual(
      Array.from({ length: 10 }, (_, i) => i + 1),
    );

    const desc = await list(app, project.id, "sort=key&dir=desc&limit=200");
    expect((desc.body as ListBody).data.map((i) => i.number)).toEqual(
      Array.from({ length: 10 }, (_, i) => 10 - i),
    );
  });

  it("sorts by priority on the urgent > high > medium > low > (none) scale, both directions", async () => {
    const { creator, project, type } = await setupProject();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    await createItem(app, project.id, type.id, "Low", "low");
    await createItem(app, project.id, type.id, "Urgent", "urgent");
    await createItem(app, project.id, type.id, "NoPriority");
    await createItem(app, project.id, type.id, "Medium", "medium");
    await createItem(app, project.id, type.id, "High", "high");

    const desc = await list(app, project.id, "sort=priority&dir=desc");
    expect((desc.body as ListBody).data.map((i) => i.title)).toEqual([
      "Urgent",
      "High",
      "Medium",
      "Low",
      "NoPriority",
    ]);

    const asc = await list(app, project.id, "sort=priority&dir=asc");
    // No-priority sorts LAST in both directions (documented judgment call in
    // `list-query.ts`), not first (which a naive null-as-0 ascending sort would give).
    expect((asc.body as ListBody).data.map((i) => i.title)).toEqual([
      "Low",
      "Medium",
      "High",
      "Urgent",
      "NoPriority",
    ]);
  });

  it("sorts by dueDate, with no-due-date items always last in both directions", async () => {
    const { creator, project, type } = await setupProject();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const soon = await createItem(app, project.id, type.id, "Soon");
    const later = await createItem(app, project.id, type.id, "Later");
    const never = await createItem(app, project.id, type.id, "Never");

    await setDueDate(app, soon.key, soon.version, "2026-10-01T00:00:00.000Z");
    await setDueDate(app, later.key, later.version, "2026-11-01T00:00:00.000Z");
    void never;

    const asc = await list(app, project.id, "sort=dueDate&dir=asc");
    expect((asc.body as ListBody).data.map((i) => i.title)).toEqual([
      "Soon",
      "Later",
      "Never",
    ]);

    const desc = await list(app, project.id, "sort=dueDate&dir=desc");
    expect((desc.body as ListBody).data.map((i) => i.title)).toEqual([
      "Later",
      "Soon",
      "Never",
    ]);
  });

  it("stable tie-break: identical priority ties are ordered consistently by id, not arbitrarily", async () => {
    const { creator, project, type } = await setupProject();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    for (let i = 0; i < 5; i++) {
      await createItem(app, project.id, type.id, `Tied ${i}`, "high");
    }

    const first = await list(app, project.id, "sort=priority&dir=asc");
    const second = await list(app, project.id, "sort=priority&dir=asc");
    expect((first.body as ListBody).data.map((i) => i.id)).toEqual(
      (second.body as ListBody).data.map((i) => i.id),
    );
  });

  it("cursor walk over ties: paging one item at a time visits every row exactly once, in the same order a single unpaged call returns", async () => {
    const { creator, project, type } = await setupProject();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    for (let i = 0; i < 12; i++) {
      // Same priority for every item -- forces the walk through a long run of ties,
      // which is exactly where a page boundary could duplicate or skip a row if the
      // tie-break (`id`) were not applied consistently.
      await createItem(app, project.id, type.id, `Item ${i}`, "high");
    }

    const wholeList = await list(
      app,
      project.id,
      "sort=priority&dir=asc&limit=200",
    );
    const expectedIds = (wholeList.body as ListBody).data.map((i) => i.id);
    expect(expectedIds).toHaveLength(12);

    const walkedIds: string[] = [];
    let cursor: string | null = null;
    let hasMore = true;
    let iterations = 0;
    while (hasMore) {
      iterations += 1;
      if (iterations > 20) throw new Error("walk did not terminate");
      const query = `sort=priority&dir=asc&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const page = await list(app, project.id, query);
      expect(page.status).toBe(200);
      const body = page.body as ListBody;
      expect(body.data).toHaveLength(1);
      walkedIds.push(body.data[0]?.id as string);
      cursor = body.page.nextCursor;
      hasMore = body.page.hasMore;
    }

    expect(walkedIds).toHaveLength(12);
    expect(new Set(walkedIds).size).toBe(12); // no duplicates
    expect(walkedIds).toEqual(expectedIds); // no gaps, same order as the unpaged call
  });

  it("filters by state", async () => {
    const { creator, project, type, state } = await setupProject();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const { state: otherState } = await makeState(
      creator.workspace.id,
      project.id,
      { isDefault: false, group: "started", name: "In progress" },
    );

    const a = await createItem(app, project.id, type.id, "In backlog");
    const b = await createItem(app, project.id, type.id, "In progress");
    await db
      .update(schema.workItemTable)
      .set({ stateId: otherState.id })
      .where(eq(schema.workItemTable.id, b.id));

    const backlogOnly = await list(app, project.id, `state=${state.id}`);
    expect((backlogOnly.body as ListBody).data.map((i) => i.id)).toEqual([
      a.id,
    ]);

    const progressOnly = await list(app, project.id, `state=${otherState.id}`);
    expect((progressOnly.body as ListBody).data.map((i) => i.id)).toEqual([
      b.id,
    ]);
  });

  it("filters by assignee=none and by an explicit personId", async () => {
    const { creator, project, type } = await setupProject();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const [organisation] = await db
      .insert(schema.organisationTable)
      .values({ key: `org-${randomUUID()}`, name: `Org ${randomUUID()}` })
      .returning();
    if (!organisation) throw new Error("organisation insert failed");
    const [person] = await db
      .insert(schema.personTable)
      .values({ organisationId: organisation.id, side: "agent" })
      .returning();
    if (!person) throw new Error("person insert failed");

    const unassigned = await createItem(app, project.id, type.id, "Unassigned");
    const assigned = await createItem(app, project.id, type.id, "Assigned");
    await db
      .update(schema.workItemTable)
      .set({ assigneeId: person.id })
      .where(eq(schema.workItemTable.id, assigned.id));

    const none = await list(app, project.id, "assignee=none");
    expect((none.body as ListBody).data.map((i) => i.id)).toEqual([
      unassigned.id,
    ]);

    const byPerson = await list(app, project.id, `assignee=${person.id}`);
    expect((byPerson.body as ListBody).data.map((i) => i.id)).toEqual([
      assigned.id,
    ]);
    expect((byPerson.body as ListBody).data[0]?.assigneeId).toBe(person.id);
  });

  it("assignee=me with no linked person row matches nothing, rather than erroring or matching everything", async () => {
    const { creator, project, type } = await setupProject();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    await createItem(app, project.id, type.id, "Anything");

    const response = await list(app, project.id, "assignee=me");
    expect(response.status).toBe(200);
    expect((response.body as ListBody).data).toHaveLength(0);
    expect((response.body as ListBody).meta.total).toBe(0);
  });

  it("filters by priority (comma-separated)", async () => {
    const { creator, project, type } = await setupProject();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const low = await createItem(app, project.id, type.id, "Low", "low");
    await createItem(app, project.id, type.id, "Medium", "medium");
    const urgent = await createItem(
      app,
      project.id,
      type.id,
      "Urgent",
      "urgent",
    );

    const response = await list(app, project.id, "priority=low,urgent");
    expect((response.body as ListBody).data.map((i) => i.id).sort()).toEqual(
      [low.id, urgent.id].sort(),
    );
  });

  it("filters by due_before", async () => {
    const { creator, project, type } = await setupProject();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const before = await createItem(app, project.id, type.id, "Before");
    const after = await createItem(app, project.id, type.id, "After");
    await setDueDate(
      app,
      before.key,
      before.version,
      "2026-09-01T00:00:00.000Z",
    );
    await setDueDate(app, after.key, after.version, "2026-12-01T00:00:00.000Z");

    const response = await list(app, project.id, "due_before=2026-10-01");
    expect((response.body as ListBody).data.map((i) => i.id)).toEqual([
      before.id,
    ]);
  });

  it("rejects an unknown sort field with 400 -- the allowlist cannot be bypassed to sort on a field the response doesn't even expose", async () => {
    const { creator, project } = await setupProject();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const response = await list(app, project.id, "sort=customerVisibility");
    expect(response.status).toBe(400);
  });

  it("rejects an invalid dir with 400", async () => {
    const { creator, project } = await setupProject();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const response = await list(app, project.id, "dir=sideways");
    expect(response.status).toBe(400);
  });

  it("rejects a limit of 0 and a limit over 200 with 400", async () => {
    const { creator, project } = await setupProject();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    expect((await list(app, project.id, "limit=0")).status).toBe(400);
    expect((await list(app, project.id, "limit=201")).status).toBe(400);
    expect((await list(app, project.id, "limit=abc")).status).toBe(400);
  });

  it("rejects an invalid priority filter value with 400", async () => {
    const { creator, project } = await setupProject();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const response = await list(
      app,
      project.id,
      "priority=urgent,not-a-priority",
    );
    expect(response.status).toBe(400);
  });

  it("rejects a malformed due_before with 400, including a rollover date", async () => {
    const { creator, project } = await setupProject();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    expect((await list(app, project.id, "due_before=not-a-date")).status).toBe(
      400,
    );
    expect((await list(app, project.id, "due_before=2026-02-31")).status).toBe(
      400,
    );
  });

  it("rejects a malformed cursor with 400", async () => {
    const { creator, project } = await setupProject();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const response = await list(app, project.id, "cursor=not-base64-json");
    expect(response.status).toBe(400);
  });

  it("rejects a cursor minted for a different sort/dir with 400, rather than silently reinterpreting it", async () => {
    const { creator, project, type } = await setupProject();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    await createItem(app, project.id, type.id, "A");
    await createItem(app, project.id, type.id, "B");

    const page = await list(app, project.id, "sort=title&dir=asc&limit=1");
    const cursor = (page.body as ListBody).page.nextCursor as string;
    expect(cursor).not.toBeNull();

    const wrongDir = await list(
      app,
      project.id,
      `sort=title&dir=desc&cursor=${encodeURIComponent(cursor)}`,
    );
    expect(wrongDir.status).toBe(400);

    const wrongSort = await list(
      app,
      project.id,
      `sort=key&dir=asc&cursor=${encodeURIComponent(cursor)}`,
    );
    expect(wrongSort.status).toBe(400);
  });

  it("meta.total reflects the FILTERED count, unaffected by cursor pagination position", async () => {
    const { creator, project, type } = await setupProject();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    for (let i = 0; i < 5; i++) {
      await createItem(app, project.id, type.id, `Item ${i}`, "high");
    }
    await createItem(app, project.id, type.id, "Different priority", "low");

    const firstPage = await list(app, project.id, "priority=high&limit=2");
    expect((firstPage.body as ListBody).meta.total).toBe(5);
    expect((firstPage.body as ListBody).page.hasMore).toBe(true);

    const cursor = (firstPage.body as ListBody).page.nextCursor as string;
    const secondPage = await list(
      app,
      project.id,
      `priority=high&limit=2&cursor=${encodeURIComponent(cursor)}`,
    );
    expect((secondPage.body as ListBody).meta.total).toBe(5);
  });

  it("reach is unchanged: a caller without workspace membership still can't reach the list, whatever filters/sort are supplied", async () => {
    // #290/#307 (merged into `main` after this test was first written): an
    // out-of-reach project now answers the SAME 400 an unknown project id gets,
    // rather than a distinguishing 403 -- closing the cross-workspace existence
    // oracle `workspaceAccess.fromProject()` otherwise leaves open (`workspace-
    // access-middleware.ts`'s own file comment has the full incident). 403 stays
    // reserved for a reachable workspace with a missing capability. Reach itself
    // is still exactly as narrow as before -- only the status code that proves it
    // changed, not from a change made in this PR.
    const { project, type } = await setupProject();
    const stranger = await createWorkspaceMember({ role: "member" });
    mockAuthenticatedSession(stranger.user);
    const { app } = createApp();
    void type;

    const response = await list(
      app,
      project.id,
      "sort=priority&dir=desc&limit=5&state=anything&assignee=me",
    );
    expect(response.status).toBe(400);
  });

  it("visibility is unchanged: filtering/sorting cannot surface a work item from a DIFFERENT project", async () => {
    const { creator, project, type } = await setupProject();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const { project: otherProject } = await createProjectFixture({
      workspaceId: creator.workspace.id,
    });
    const otherType = await makeWorkItemType(creator.workspace.id);
    await makeState(creator.workspace.id, otherProject.id);

    const inThisProject = await createItem(app, project.id, type.id, "Mine");
    await createItem(app, otherProject.id, otherType.id, "Not mine");

    const response = await list(app, project.id, "limit=200");
    expect((response.body as ListBody).data.map((i) => i.id)).toEqual([
      inThisProject.id,
    ]);
    expect((response.body as ListBody).meta.total).toBe(1);
  });

  it("visibility is unchanged: a cursor minted in project A cannot be replayed against project B to leak A's rows", async () => {
    // The cursor's own keyset condition (`workItemCursorCondition`) carries no project
    // or workspace scoping of its own -- it is only ever ANDed onto the route's
    // existing `(projectId, workspaceId)` filter (`list-work-items.ts`'s
    // `buildFilterConditions`/`pageConditions`). This test proves that composition
    // holds for a REAL cross-project replay, not just by reading the source: a cursor
    // minted while listing project A, then sent on a request addressed to project B,
    // must return only B's own rows (or none), and never resurface A's.
    const { creator, project: projectA, type: typeA } = await setupProject();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const { project: projectB } = await createProjectFixture({
      workspaceId: creator.workspace.id,
    });
    const typeB = await makeWorkItemType(creator.workspace.id);
    await makeState(creator.workspace.id, projectB.id);

    // Two items in A so paging with limit=1 actually yields a next cursor.
    await createItem(app, projectA.id, typeA.id, "A1");
    await createItem(app, projectA.id, typeA.id, "A2");
    const b1 = await createItem(app, projectB.id, typeB.id, "B1");
    const b2 = await createItem(app, projectB.id, typeB.id, "B2");
    const bIds = new Set([b1.id, b2.id]);

    // Mint a real cursor by paging project A with limit=1.
    const firstPageOfA = await list(
      app,
      projectA.id,
      "sort=key&dir=asc&limit=1",
    );
    expect(firstPageOfA.status).toBe(200);
    const realCursorFromA = (firstPageOfA.body as ListBody).page
      .nextCursor as string;
    expect(realCursorFromA).not.toBeNull();

    const replayedAgainstB = await list(
      app,
      projectB.id,
      `sort=key&dir=asc&limit=200&cursor=${encodeURIComponent(realCursorFromA)}`,
    );

    expect(replayedAgainstB.status).toBe(200);
    const body = replayedAgainstB.body as ListBody;
    // Every id returned belongs to project B's own items -- project A's item(s),
    // including the one the cursor was minted from, must never appear.
    for (const item of body.data) {
      expect(bIds.has(item.id)).toBe(true);
    }
    expect(body.meta.total).toBe(2); // project B's own total, unaffected by A's rows
  });
});
