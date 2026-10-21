import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import * as hierarchyRepository from "../../apps/api/src/work-item/hierarchy-page.repository";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createItem,
  json,
  makeApiKey,
  setAmbientHeaders,
  setupWorld,
} from "./helpers/reach-world";

type Node = { id: string; key: string; title: string; hasChildren: boolean };
type Page = {
  parent: { key: string };
  ancestors: { key: string }[];
  data: Node[];
  page: { hasMore: boolean; nextCursor: string | null };
  meta: { total: number };
  progress: { total: number; completed: number };
};

async function arrange() {
  const world = await setupWorld();
  const { app } = createApp();
  const parent = await createItem(app, world, "Wide hierarchy parent");
  const [row] = await db
    .select()
    .from(schema.workItemTable)
    .where(eq(schema.workItemTable.id, parent.id));
  if (!row) throw new Error("parent fixture missing");
  return { world, app, parent, row };
}

describe("hierarchy child pagination and complete SQL roll-up", () => {
  beforeEach(resetTestDatabase);
  afterEach(() => {
    setAmbientHeaders({});
    vi.restoreAllMocks();
  });

  it("pages every sibling beyond the legacy 500 cap, preserving ties and exact decimal ordering", async () => {
    const { world, app, parent, row } = await arrange();
    const completeStates: string[] = [];
    for (const group of ["completed", "cancelled"]) {
      const [template] = await db
        .insert(schema.stateTemplateTable)
        .values({
          workspaceId: world.workspaceId,
          key: randomUUID(),
          name: `Not a magic state name: ${group}`,
          group,
        })
        .returning();
      if (!template) throw new Error("state template missing");
      const [state] = await db
        .insert(schema.stateTable)
        .values({ projectId: world.project.id, stateTemplateId: template.id })
        .returning();
      if (!state) throw new Error("state missing");
      completeStates.push(state.id);
    }
    const values = Array.from({ length: 601 }, (_, i) => ({
      id: `hierarchy-child-${String(i).padStart(4, "0")}`,
      workspaceId: world.workspaceId,
      projectId: world.project.id,
      typeId: world.type.id,
      number: i + 1000,
      key: `${world.project.slug}-wide-${i}`,
      title: `Wide child ${i}`,
      parentId: parent.id,
      stateId: i % 3 === 2 ? row.stateId : (completeStates[i % 3] as string),
      position: i < 2 ? `0.100000000${i + 1}` : "1",
    }));
    await db.insert(schema.workItemTable).values(values);
    const first = values[0];
    if (!first) throw new Error("child fixture missing");
    await db.insert(schema.workItemTable).values({
      ...first,
      id: "hierarchy-grandchild",
      number: 2000,
      key: `${world.project.slug}-grandchild`,
      title: "Nested completed child",
      parentId: first.id,
    });
    mockAuthenticatedSession(world.readerLead.user);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const response = await json(
        app,
        "GET",
        `/api/work-items/${parent.key}/children?limit=200${cursor ? `&cursor=${cursor}` : ""}`,
      );
      expect(response.status, await response.clone().text()).toBe(200);
      const body = (await response.json()) as Page;
      expect(body.meta.total).toBe(601);
      expect(body.progress).toEqual({ total: 602, completed: 402 });
      expect(body.data.length).toBeLessThanOrEqual(200);
      expect(body.ancestors).toEqual([]);
      seen.push(...body.data.map((n) => n.id));
      cursor = body.page.nextCursor;
      expect(body.page.hasMore).toBe(cursor !== null);
      if (pages === 0) {
        expect(body.data[0]?.id).toBe(values[0]?.id);
        expect(body.data[1]?.id).toBe(values[1]?.id);
        expect(body.data[0]?.hasChildren).toBe(true);
        expect(body.data[1]?.hasChildren).toBe(false);
        expect(
          (
            await json(
              app,
              "GET",
              `/api/work-items/${parent.key}/children?limit=50&cursor=${cursor}`,
            )
          ).status,
        ).toBe(400);
        expect(
          (
            await json(
              app,
              "GET",
              `/api/work-items/${first.key}/children?limit=200&cursor=${cursor}`,
            )
          ).status,
        ).toBe(400);
      }
      expect(++pages).toBeLessThanOrEqual(4);
    } while (cursor);
    expect(pages).toBe(4);
    expect(seen).toEqual(values.map((n) => n.id));
    expect(new Set(seen).size).toBe(601);
    const nested = await json(
      app,
      "GET",
      `/api/work-items/${first.key}/children`,
    );
    const context = (await nested.json()) as Page;
    expect(context.ancestors.map((n) => n.key)).toEqual([parent.key]);
    expect(context.progress).toEqual({ total: 1, completed: 1 });
    expect(context.data.map((n) => n.id)).toEqual(["hierarchy-grandchild"]);
  });

  it("excludes archived/deleted children and descendants from pages, totals and hasChildren", async () => {
    const { world, app, parent, row } = await arrange();
    for (const [index, lifecycle] of [
      {},
      { deletedAt: new Date() },
      { archivedAt: new Date() },
    ].entries()) {
      const [child] = await db
        .insert(schema.workItemTable)
        .values({
          workspaceId: world.workspaceId,
          projectId: world.project.id,
          typeId: world.type.id,
          stateId: row.stateId,
          number: 1000 + index,
          key: `${world.project.slug}-visibility-${index}`,
          title: "Lifecycle child",
          parentId: parent.id,
          ...lifecycle,
        })
        .returning();
      if (!child) throw new Error("child missing");
      await db.insert(schema.workItemTable).values({
        workspaceId: world.workspaceId,
        projectId: world.project.id,
        typeId: world.type.id,
        stateId: row.stateId,
        number: 2000 + index,
        key: `${world.project.slug}-nested-${index}`,
        title: "Hidden nested child",
        parentId: child.id,
        deletedAt: new Date(),
      });
    }
    mockAuthenticatedSession(world.readerLead.user);
    const response = await json(
      app,
      "GET",
      `/api/work-items/${parent.key}/children`,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as Page;
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.hasChildren).toBe(false);
    expect(body.meta.total).toBe(1);
    expect(body.progress).toEqual({ total: 1, completed: 0 });
    await db
      .update(schema.workItemTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.workItemTable.id, parent.id));
    const hidden = await json(
      app,
      "GET",
      `/api/work-items/${parent.key}/children`,
    );
    const missing = await json(
      app,
      "GET",
      "/api/work-items/no-such-parent/children",
    );
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual(await missing.json());
  });

  it("keeps page and aggregate totals in the same snapshot during a concurrent insertion", async () => {
    const { world, app, parent, row } = await arrange();
    const original = hierarchyRepository.listHierarchyChildrenQuery;
    vi.spyOn(
      hierarchyRepository,
      "listHierarchyChildrenQuery",
    ).mockImplementationOnce(async (...args) => {
      const rows = await original(...args);
      // A separate pooled connection commits after this response's page SELECT.
      await db.insert(schema.workItemTable).values({
        workspaceId: world.workspaceId,
        projectId: world.project.id,
        typeId: world.type.id,
        stateId: row.stateId,
        number: 3000,
        key: `${world.project.slug}-concurrent`,
        title: "Later child",
        parentId: parent.id,
      });
      return rows;
    });
    mockAuthenticatedSession(world.readerLead.user);
    const first = await json(
      app,
      "GET",
      `/api/work-items/${parent.key}/children`,
    );
    expect(first.status, await first.clone().text()).toBe(200);
    const snapshot = (await first.json()) as Page;
    expect(snapshot.data).toEqual([]);
    expect(snapshot.meta.total).toBe(0);
    expect(snapshot.progress.total).toBe(0);
    const second = await json(
      app,
      "GET",
      `/api/work-items/${parent.key}/children`,
    );
    const current = (await second.json()) as Page;
    expect(second.status).toBe(200);
    expect(current.data).toHaveLength(1);
    expect(current.meta.total).toBe(1);
    expect(current.progress.total).toBe(1);
  });

  it("returns empty leaf totals and enforces API-key read ceilings", async () => {
    const { world, app, parent } = await arrange();
    mockAuthenticatedSession(world.readerLead.user);
    const response = await json(
      app,
      "GET",
      `/api/work-items/${parent.key}/children`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Page;
    expect(body.data).toEqual([]);
    expect(body.page).toEqual({ hasMore: false, nextCursor: null });
    expect(body.progress).toEqual({ total: 0, completed: 0 });
    mockAnonymousSession();
    setAmbientHeaders({
      "x-api-key": await makeApiKey(world.projectMember.user.id, {
        project: ["read"],
      }),
    });
    expect(
      (await json(app, "GET", `/api/work-items/${parent.key}/children`)).status,
    ).toBe(403);
    setAmbientHeaders({
      "x-api-key": await makeApiKey(world.projectMember.user.id, {
        project: ["read"],
        work_item: ["read"],
      }),
    });
    expect(
      (await json(app, "GET", `/api/work-items/${parent.key}/children`)).status,
    ).toBe(200);
  });
});
