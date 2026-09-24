/**
 * `GET /api/projects/{projectId}/assignable` (`docs/03-features/assignment.md` § API) --
 * the person-picker feed: the roster with open-work counts, filtered to the people the
 * ACTOR may actually assign to.
 *
 * The three caller tiers are the point of the suite (AS-1/AS-2/the screens section): a
 * lead sees the active roster, a member sees exactly themselves, a viewer sees nothing.
 * If the actor-dependent filter regressed to "everyone sees everyone", only these cases
 * would catch it.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { ensureInternalOrganisation } from "../../apps/api/src/utils/seed-internal-organisation";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

async function makeWorkItemType(workspaceId: string) {
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId,
        key: `type-${randomUUID()}`,
        name: "Task",
        category: "delivery",
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeWorkItemType",
  );
}

/** A state (and its template) with the given lifecycle group. */
async function makeState(
  workspaceId: string,
  projectId: string,
  group: string,
  isDefault = false,
) {
  const now = new Date();
  const stateTemplate = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId,
        key: `state-${randomUUID()}`,
        name: `State ${group}`,
        group,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeState: state_template",
  );
  return requireRow(
    await db
      .insert(schema.stateTable)
      .values({
        projectId,
        stateTemplateId: stateTemplate.id,
        isDefault,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeState: state",
  );
}

async function addWorkspaceMember(workspaceId: string, role: string) {
  const userId = `user-${randomUUID()}`;
  const user = requireRow(
    await db
      .insert(schema.userTable)
      .values({
        id: userId,
        email: `${userId}@example.com`,
        emailVerified: true,
        name: "Integration Test User",
      })
      .returning(),
    "addWorkspaceMember: user",
  );

  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: user.id,
    role,
    joinedAt: new Date(),
  });

  if (role !== "owner") {
    const now = new Date();
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId,
      role,
      permission: JSON.stringify({}),
      isSystem: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  return user;
}

/** A named, user-linked person on the project roster (so the feed can show a name). */
async function addNamedPersonOnRoster({
  name,
  projectId,
  roleName = "Project Member",
  roleRank = 10,
}: {
  name: string;
  projectId: string;
  roleName?: string;
  roleRank?: number;
}) {
  const organisation = await ensureInternalOrganisation();
  const userId = `user-${randomUUID()}`;
  const now = new Date();
  await db.insert(schema.userTable).values({
    id: userId,
    email: `${userId}@example.com`,
    emailVerified: true,
    name,
  });
  const person = requireRow(
    await db
      .insert(schema.personTable)
      .values({
        userId,
        organisationId: organisation.id,
        side: "staff",
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "addNamedPersonOnRoster: person",
  );
  const role = requireRow(
    await db
      .insert(schema.roleTable)
      .values({
        scope: "project",
        key: `role-${randomUUID()}`,
        name: roleName,
        rank: roleRank,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "addNamedPersonOnRoster: role",
  );
  await db.insert(schema.membershipTable).values({
    personId: person.id,
    scope: "project",
    scopeId: projectId,
    roleId: role.id,
    createdAt: now,
    updatedAt: now,
  });
  return { person, userId };
}

async function assignItemTo(
  workspaceId: string,
  projectId: string,
  typeId: string,
  stateId: string,
  assigneeId: string,
) {
  const now = new Date();
  await db.insert(schema.workItemTable).values({
    workspaceId,
    projectId,
    typeId,
    stateId,
    number: Math.floor(Math.random() * 1_000_000) + 1,
    key: `TST-${randomUUID().slice(0, 8)}`,
    title: "Assigned item",
    assigneeId,
    createdAt: now,
    updatedAt: now,
  });
}

async function setup() {
  const { user: creator, workspace } = await createWorkspaceMember({
    role: "admin",
  });
  const { project } = await createProjectFixture({ workspaceId: workspace.id });
  const type = await makeWorkItemType(workspace.id);
  const backlog = await makeState(workspace.id, project.id, "backlog", true);
  return { creator, workspace, project, type, backlog };
}

function assignableRequest(
  app: ReturnType<typeof createApp>["app"],
  projectId: string,
) {
  return app.request(`/api/projects/${projectId}/assignable`);
}

describe("API integration: assignable people (#30, assignment.md)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("AS-1: a lead sees the ACTIVE roster with names, roles and open-work counts", async () => {
    const { workspace, project, type, backlog } = await setup();
    const lead = await addWorkspaceMember(workspace.id, "lead");
    const ada = await addNamedPersonOnRoster({
      name: "Ada Lovelace",
      projectId: project.id,
    });
    const grace = await addNamedPersonOnRoster({
      name: "Grace Hopper",
      projectId: project.id,
      roleName: "Project Lead",
      roleRank: 5,
    });
    // Inactive and non-roster people must not appear.
    const inactive = await addNamedPersonOnRoster({
      name: "Departed Dana",
      projectId: project.id,
    });
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.id, inactive.person.id));

    // Load: Ada holds two open items; Grace one item in a COMPLETED group (counts zero).
    await assignItemTo(
      workspace.id,
      project.id,
      type.id,
      backlog.id,
      ada.person.id,
    );
    await assignItemTo(
      workspace.id,
      project.id,
      type.id,
      backlog.id,
      ada.person.id,
    );
    const completed = await makeState(workspace.id, project.id, "completed");
    await assignItemTo(
      workspace.id,
      project.id,
      type.id,
      completed.id,
      grace.person.id,
    );

    mockAuthenticatedSession(lead);
    const { app } = createApp();
    const response = await assignableRequest(app, project.id);

    expect(response.status).toBe(200);
    const people = (await response.json()) as Array<Record<string, unknown>>;
    expect(people.map((entry) => entry.name)).toEqual([
      "Ada Lovelace",
      "Grace Hopper",
    ]);
    expect(people[0]).toEqual({
      personId: ada.person.id,
      name: "Ada Lovelace",
      roleName: "Project Member",
      openWorkCount: 2,
    });
    expect(people[1]?.openWorkCount).toBe(0);
    expect(people[1]?.roleName).toBe("Project Lead");
    expect(people.some((entry) => entry.name === "Departed Dana")).toBe(false);
  });

  it("AS-1: a person with two membership rows on this project appears once, with their most privileged role", async () => {
    const { workspace, project } = await setup();
    const lead = await addWorkspaceMember(workspace.id, "lead");
    const ada = await addNamedPersonOnRoster({
      name: "Ada Lovelace",
      projectId: project.id,
      roleName: "Viewer Role",
      roleRank: 2,
    });
    const betterRole = requireRow(
      await db
        .insert(schema.roleTable)
        .values({
          scope: "project",
          key: `role-${randomUUID()}`,
          name: "Project Admin",
          rank: 30,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning(),
      "betterRole",
    );
    await db.insert(schema.membershipTable).values({
      personId: ada.person.id,
      scope: "project",
      scopeId: project.id,
      roleId: betterRole.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockAuthenticatedSession(lead);
    const { app } = createApp();
    const people = (await (
      await assignableRequest(app, project.id)
    ).json()) as Array<Record<string, unknown>>;

    expect(people).toHaveLength(1);
    expect(people[0]?.roleName).toBe("Project Admin");
  });

  it("AS-2: a member sees only THEMSELVES — the single 'assign to me' candidate", async () => {
    const { workspace, project } = await setup();
    const memberUser = await addWorkspaceMember(workspace.id, "member");
    const memberPerson = await addNamedPersonOnRoster({
      name: "Mia Member",
      projectId: project.id,
    });
    await db
      .update(schema.personTable)
      .set({ userId: memberUser.id })
      .where(eq(schema.personTable.id, memberPerson.person.id));
    await addNamedPersonOnRoster({
      name: "Someone Else",
      projectId: project.id,
    });

    mockAuthenticatedSession(memberUser);
    const { app } = createApp();
    const people = (await (
      await assignableRequest(app, project.id)
    ).json()) as Array<Record<string, unknown>>;

    expect(people).toHaveLength(1);
    expect(people[0]?.personId).toBe(memberPerson.person.id);
  });

  it("a viewer sees an EMPTY list, not a list of people it cannot use", async () => {
    const { workspace, project } = await setup();
    const viewer = await addWorkspaceMember(workspace.id, "viewer");
    await addNamedPersonOnRoster({
      name: "Ada Lovelace",
      projectId: project.id,
    });

    mockAuthenticatedSession(viewer);
    const { app } = createApp();
    const response = await assignableRequest(app, project.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("a viewer who IS on the roster and linked to a user still sees NOTHING (F2: the filter is the capability, not the person row)", async () => {
    const { workspace, project } = await setup();
    const viewer = await addWorkspaceMember(workspace.id, "viewer");
    const viewerPerson = await addNamedPersonOnRoster({
      name: "Vera Viewer",
      projectId: project.id,
    });
    // Link the person row to the viewer's user -- the exact shape the earlier filter
    // mistook for "may assign themselves".
    await db
      .update(schema.personTable)
      .set({ userId: viewer.id })
      .where(eq(schema.personTable.id, viewerPerson.person.id));

    mockAuthenticatedSession(viewer);
    const { app } = createApp();
    const response = await assignableRequest(app, project.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("a non-member of the workspace gets nothing (400/403), never the roster", async () => {
    const { project } = await setup();
    await addNamedPersonOnRoster({
      name: "Ada Lovelace",
      projectId: project.id,
    });
    const outsider = await createWorkspaceMember({ role: "admin" });

    mockAuthenticatedSession(outsider.user);
    const { app } = createApp();
    const response = await assignableRequest(app, project.id);
    expect([400, 403, 404]).toContain(response.status);
  });

  it("an unknown project id is refused uniformly", async () => {
    const { creator } = await setup();
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const response = await assignableRequest(app, "project-does-not-exist");
    expect(response.status).toBe(400);
  });

  it("the count question and the roster are answered from the SAME predicate as the write", async () => {
    // A person rostered only on ANOTHER project of this workspace must not appear.
    const { workspace, project } = await setup();
    const lead = await addWorkspaceMember(workspace.id, "lead");
    const { project: sibling } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const ada = await addNamedPersonOnRoster({
      name: "Ada Lovelace",
      projectId: sibling.id,
    });

    mockAuthenticatedSession(lead);
    const { app } = createApp();
    const people = (await (
      await assignableRequest(app, project.id)
    ).json()) as Array<Record<string, unknown>>;
    expect(people.some((entry) => entry.personId === ada.person.id)).toBe(
      false,
    );

    // The write-side cross-check (the assign route refusing the same person) lands with
    // #353's branch, which adds POST /assign; on main this test pins the feed's side of
    // the shared predicate, and #359 carries the extraction into one helper.
  });
});
