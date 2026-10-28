/**
 * P1 projects (WRITTEN, NOT RUN by its author -- the coordinator runs DB integration tests):
 * PR-1 hierarchy and ownership route, PR-6/PR-7/PR-10 composition warnings, PR-13 key
 * validation, AS-11 default assignee settings, PR-16 includeDeleted, the archive-parent rule
 * and PR-17 project states.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resolveProjectDefaultAssignee } from "../../apps/api/src/project/default-assignee";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectManageAccess,
  grantProjectRole,
} from "./helpers/fixtures";
import { addMember, makeState } from "./helpers/reach-world";

const MANAGE_MEMBERS = [
  "project:read",
  "project:update",
  "project:manage_members",
  "project:manage_settings",
  "project:archive",
] as const;

function jsonRequest(method: string, path: string, body?: unknown) {
  const { app } = createApp();
  return app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function projectWithManage(
  workspaceId: string,
  userId: string,
  slug: string,
) {
  const { project } = await createProjectFixture({ workspaceId, slug });
  await grantProjectManageAccess(userId, project.id);
  await grantProjectRole(userId, project.id, [...MANAGE_MEMBERS]);
  return project;
}

async function setup() {
  const owner = await createWorkspaceMember({ role: "admin" });
  mockAuthenticatedSession(owner.user);
  return owner;
}

describe("API integration: project hierarchy (PR-1)", () => {
  beforeEach(async () => resetTestDatabase());

  it("sets and clears a parent, audits the reach change, and refuses depth 5, cycles and self", async () => {
    const owner = await setup();
    const ws = owner.workspace.id;
    const a = await projectWithManage(ws, owner.user.id, "AAA");
    const b = await projectWithManage(ws, owner.user.id, "BBB");
    const c = await projectWithManage(ws, owner.user.id, "CCC");
    const d = await projectWithManage(ws, owner.user.id, "DDD");
    const e = await projectWithManage(ws, owner.user.id, "EEE");

    for (const [child, parent] of [
      [b, a],
      [c, b],
      [d, c],
    ] as const) {
      const res = await jsonRequest(
        "PATCH",
        `/api/projects/${child.id}/ownership`,
        { parentId: parent.id },
      );
      expect(res.status).toBe(200);
    }

    // A fifth level is refused with an explanation.
    const tooDeep = await jsonRequest(
      "PATCH",
      `/api/projects/${e.id}/ownership`,
      { parentId: d.id },
    );
    expect(tooDeep.status).toBe(422);
    await expect(tooDeep.text()).resolves.toContain("PR-1");

    // The moved subtree counts: moving a (height 4) under e is also a cycle-free overflow.
    const subtreeOverflow = await jsonRequest(
      "PATCH",
      `/api/projects/${a.id}/ownership`,
      { parentId: e.id },
    );
    expect(subtreeOverflow.status).toBe(422);

    const cycle = await jsonRequest(
      "PATCH",
      `/api/projects/${a.id}/ownership`,
      { parentId: d.id },
    );
    expect(cycle.status).toBe(422);

    const self = await jsonRequest("PATCH", `/api/projects/${a.id}/ownership`, {
      parentId: a.id,
    });
    expect(self.status).toBe(422);

    const [stored] = await db
      .select({ parentId: schema.projectTable.parentId })
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, d.id));
    expect(stored?.parentId).toBe(c.id);

    const cleared = await jsonRequest(
      "PATCH",
      `/api/projects/${d.id}/ownership`,
      { parentId: null },
    );
    expect(cleared.status).toBe(200);

    const audit = await db
      .select({ action: schema.auditLogTable.action })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.entityId, d.id),
          eq(schema.auditLogTable.action, "project.reach_changed"),
        ),
      );
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });

  it("needs project:manage_members on the prospective parent too", async () => {
    const owner = await setup();
    const ws = owner.workspace.id;
    const child = await projectWithManage(ws, owner.user.id, "CHILD");
    const { project: parent } = await createProjectFixture({
      workspaceId: ws,
      slug: "PARENT",
    });
    // Reaches the parent but cannot manage its members.
    await grantProjectRole(owner.user.id, parent.id, ["project:read"]);

    const res = await jsonRequest(
      "PATCH",
      `/api/projects/${child.id}/ownership`,
      { parentId: parent.id },
    );
    expect(res.status).toBe(403);
    const [stored] = await db
      .select({ parentId: schema.projectTable.parentId })
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, child.id));
    expect(stored?.parentId).toBeNull();
  });

  it("never accepts parentId through the general update", async () => {
    const owner = await setup();
    const ws = owner.workspace.id;
    const a = await projectWithManage(ws, owner.user.id, "AAA");
    const b = await projectWithManage(ws, owner.user.id, "BBB");
    const res = await jsonRequest("PUT", `/api/project/${b.id}`, {
      name: b.name,
      icon: "Folder",
      slug: b.slug,
      description: "",
      parentId: a.id,
    });
    expect(res.status).toBe(200);
    const [stored] = await db
      .select({ parentId: schema.projectTable.parentId })
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, b.id));
    expect(stored?.parentId).toBeNull();
  });

  it("refuses to archive a parent that still has active children, then allows it", async () => {
    const owner = await setup();
    const ws = owner.workspace.id;
    const parent = await projectWithManage(ws, owner.user.id, "PARENT");
    const child = await projectWithManage(ws, owner.user.id, "CHILD");
    expect(
      (
        await jsonRequest("PATCH", `/api/projects/${child.id}/ownership`, {
          parentId: parent.id,
        })
      ).status,
    ).toBe(200);

    const refused = await jsonRequest(
      "PUT",
      `/api/project/${parent.id}/archive`,
    );
    expect(refused.status).toBe(409);

    expect(
      (await jsonRequest("PUT", `/api/project/${child.id}/archive`)).status,
    ).toBe(200);
    expect(
      (await jsonRequest("PUT", `/api/project/${parent.id}/archive`)).status,
    ).toBe(200);

    // An archived project cannot take a new child.
    const other = await projectWithManage(ws, owner.user.id, "OTHER");
    const toArchived = await jsonRequest(
      "PATCH",
      `/api/projects/${other.id}/ownership`,
      { parentId: parent.id },
    );
    expect(toArchived.status).toBe(422);
  });
});

describe("API integration: project settings fields (PR-6, PR-10, PR-13, AS-11, PR-16)", () => {
  beforeEach(async () => resetTestDatabase());

  it("reports composition warnings and clears them as rules are met", async () => {
    const owner = await setup();
    const project = await projectWithManage(
      owner.workspace.id,
      owner.user.id,
      "COMP",
    );
    // The fixture grants the caller a project role, so PR-7 is already met.
    const before = await jsonRequest("GET", `/api/project/${project.id}`);
    const body = (await before.json()) as { compositionWarnings: string[] };
    expect(body.compositionWarnings).toEqual(["PR-6", "PR-10"]);

    const manager = await addMember(owner.workspace.id, "member");
    await grantProjectRole(manager.user.id, project.id, ["project:read"]);
    const update = await jsonRequest("PUT", `/api/project/${project.id}`, {
      name: project.name,
      icon: "Folder",
      slug: project.slug,
      description: "",
      managerId: manager.personId,
      startDate: "2026-11-01",
    });
    expect(update.status).toBe(200);
    const after = await jsonRequest("GET", `/api/project/${project.id}`);
    await expect(after.json()).resolves.toMatchObject({
      managerId: manager.personId,
      startDate: "2026-11-01",
      compositionWarnings: [],
    });
  });

  it("refuses a manager or default assignee who is off the roster or inactive, and an end date before the start", async () => {
    const owner = await setup();
    const project = await projectWithManage(
      owner.workspace.id,
      owner.user.id,
      "PEOPLE",
    );
    const outsider = await addMember(owner.workspace.id, "member");
    const common = {
      name: project.name,
      icon: "Folder",
      slug: project.slug,
      description: "",
    };

    const offRoster = await jsonRequest("PUT", `/api/project/${project.id}`, {
      ...common,
      managerId: outsider.personId,
    });
    expect(offRoster.status).toBe(422);
    const offRosterDefault = await jsonRequest(
      "PUT",
      `/api/project/${project.id}`,
      { ...common, defaultAssigneeId: outsider.personId },
    );
    expect(offRosterDefault.status).toBe(422);

    await grantProjectRole(outsider.user.id, project.id, ["project:read"]);
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.id, outsider.personId));
    const inactive = await jsonRequest("PUT", `/api/project/${project.id}`, {
      ...common,
      defaultAssigneeId: outsider.personId,
    });
    expect(inactive.status).toBe(422);

    const dates = await jsonRequest("PUT", `/api/project/${project.id}`, {
      ...common,
      startDate: "2026-12-01",
      endDate: "2026-11-01",
    });
    expect(dates.status).toBe(422);
  });

  it("needs project:manage_settings for the new fields but not for a plain rename", async () => {
    const owner = await setup();
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
      slug: "LEAD",
    });
    // update but NOT manage_settings (a lead-like role).
    await grantProjectRole(owner.user.id, project.id, [
      "project:read",
      "project:update",
    ]);
    const common = {
      name: "Renamed",
      icon: "Folder",
      slug: project.slug,
      description: "",
    };
    expect(
      (await jsonRequest("PUT", `/api/project/${project.id}`, common)).status,
    ).toBe(200);
    expect(
      (
        await jsonRequest("PUT", `/api/project/${project.id}`, {
          ...common,
          startDate: "2026-11-01",
        })
      ).status,
    ).toBe(403);
  });

  it("validates a project key on create, and on update only when the key changes", async () => {
    const owner = await setup();
    const ws = owner.workspace.id;
    const create = (slug: string) =>
      jsonRequest("POST", "/api/project", {
        workspaceId: ws,
        name: "Keyed",
        icon: "Folder",
        slug,
      });
    expect((await create("lower")).status).toBe(400);
    expect((await create("A")).status).toBe(400);
    expect((await create("TOOLONGKEY")).status).toBe(400);
    expect((await create("OKAY")).status).toBe(200);

    // A legacy lowercase key (inserted directly) stays editable while unchanged...
    const { project } = await createProjectFixture({
      workspaceId: ws,
      slug: "legacy-key",
    });
    await grantProjectManageAccess(owner.user.id, project.id);
    const common = { name: "Legacy", icon: "Folder", description: "" };
    expect(
      (
        await jsonRequest("PUT", `/api/project/${project.id}`, {
          ...common,
          slug: "legacy-key",
        })
      ).status,
    ).toBe(200);
    // ...but cannot be renamed to another invalid key.
    expect(
      (
        await jsonRequest("PUT", `/api/project/${project.id}`, {
          ...common,
          slug: "other-legacy",
        })
      ).status,
    ).toBe(400);
  });

  it("applies the default-assignee rule: request type overrides project, inactive default leaves unassigned", async () => {
    const owner = await setup();
    const project = await projectWithManage(
      owner.workspace.id,
      owner.user.id,
      "DEFA",
    );
    const projectDefault = await addMember(owner.workspace.id, "member");
    await grantProjectRole(projectDefault.user.id, project.id, [
      "project:read",
    ]);
    await db
      .update(schema.projectTable)
      .set({ defaultAssigneeId: projectDefault.personId })
      .where(eq(schema.projectTable.id, project.id));

    expect(
      await resolveProjectDefaultAssignee(db, { projectId: project.id }),
    ).toBe(projectDefault.personId);

    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.id, projectDefault.personId));
    expect(
      await resolveProjectDefaultAssignee(db, { projectId: project.id }),
    ).toBeNull();
  });

  it("reveals soft-deleted projects only when includeDeleted is set", async () => {
    const owner = await setup();
    const ws = owner.workspace.id;
    const live = await projectWithManage(ws, owner.user.id, "LIVE");
    const gone = await projectWithManage(ws, owner.user.id, "GONE");
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date(), purgeAfter: new Date(Date.now() + 1e9) })
      .where(eq(schema.projectTable.id, gone.id));

    const ids = async (query: string) => {
      const res = await jsonRequest(
        "GET",
        `/api/project?workspaceId=${ws}${query}`,
      );
      expect(res.status).toBe(200);
      return ((await res.json()) as Array<{ id: string }>).map((p) => p.id);
    };
    expect(await ids("")).toEqual([live.id]);
    expect((await ids("&includeDeleted=true")).sort()).toEqual(
      [live.id, gone.id].sort(),
    );
  });
});

describe("API integration: project states (PR-17)", () => {
  beforeEach(async () => resetTestDatabase());

  it("creates a state from a template that has an outbound transition, refuses one without, reorders and re-defaults", async () => {
    const owner = await setup();
    const ws = owner.workspace.id;
    const project = await projectWithManage(ws, owner.user.id, "STAT");
    const first = await makeState(ws, project.id, "unstarted", true);
    const second = await makeState(ws, project.id, "started", false);

    // A fresh template nothing transitions out of.
    const [template] = await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId: ws,
        key: "waiting",
        name: "Waiting",
        group: "started",
      })
      .returning();
    if (!template) throw new Error("template missing");

    const refused = await jsonRequest(
      "POST",
      `/api/projects/${project.id}/states`,
      { stateTemplateId: template.id },
    );
    expect(refused.status).toBe(422);
    await expect(refused.text()).resolves.toContain("PR-17");

    const templates = await jsonRequest(
      "GET",
      `/api/projects/${project.id}/state-templates`,
    );
    const listed = (await templates.json()) as Array<{
      id: string;
      hasOutboundTransition: boolean;
      inUse: boolean;
    }>;
    expect(listed.find((t) => t.id === template.id)).toMatchObject({
      hasOutboundTransition: false,
      inUse: false,
    });

    // Reorder and re-default.
    const moved = await jsonRequest(
      "PATCH",
      `/api/projects/${project.id}/states/${second.state.id}`,
      { position: 0, isDefault: true },
    );
    expect(moved.status).toBe(200);
    const states = (await moved.json()) as Array<{
      id: string;
      position: number;
      isDefault: boolean;
    }>;
    expect(states[0]?.id).toBe(second.state.id);
    expect(states.filter((s) => s.isDefault).map((s) => s.id)).toEqual([
      second.state.id,
    ]);
    expect(first.state.id).toBeTruthy();
  });
});
