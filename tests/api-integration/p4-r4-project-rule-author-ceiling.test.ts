/**
 * P4R4-M1 (AM-3, RL-3): for a PROJECT rule the author ceiling is the evaluator's own scope
 * resolution, not a union of every workspace and project grant. A direct project-scope grant
 * replaces the workspace grants for that project, and with none the nearest ancestor project's
 * grant stands in, so an admin narrowed by a project override cannot save, enable or dry-run a
 * project rule that runs as the full workspace admin role.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { workspaceFeatureFlagTable } from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { setProjectParent } from "../../apps/api/src/project/hierarchy.repository";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import { createProjectFixture, grantProjectRole } from "./helpers/fixtures";
import { signUpUser } from "./helpers/organization-http";
import { projectKey } from "./helpers/project-key";
import { inviteAndAcceptAsNewMemberNative } from "./helpers/workspace-invitation-write-http";
import { createWorkspaceNative } from "./helpers/workspace-write-http";

beforeEach(async () => {
  await resetTestDatabase();
});

type App = ReturnType<typeof createApp>["app"];

function get(app: App, cookie: string, path: string) {
  return app.request(path, { headers: { cookie } });
}

function call(
  app: App,
  cookie: string,
  method: string,
  path: string,
  body?: unknown,
) {
  return csrfRequest(
    app,
    path,
    {
      method,
      headers: { "content-type": "application/json", cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    cookie,
  );
}

async function world() {
  const { app } = createApp();
  const owner = await signUpUser(app);
  const workspace = await createWorkspaceNative(app, owner.cookie, {
    name: "Rules",
  });
  const workspaceId = ((await workspace.json()) as { id: string }).id;
  await db.insert(workspaceFeatureFlagTable).values({
    workspaceId,
    featureKey: "feature.automations",
    enabled: true,
  });
  const parent = (
    await createProjectFixture({ workspaceId, slug: projectKey() })
  ).project;
  const child = (
    await createProjectFixture({ workspaceId, slug: projectKey() })
  ).project;
  await setProjectParent(db, child.id, parent.id);
  const [adminRole] = await db
    .select()
    .from(schema.roleTable)
    .where(
      and(
        eq(schema.roleTable.workspaceId, workspaceId),
        eq(schema.roleTable.key, "admin"),
      ),
    );
  if (!adminRole) throw new Error("admin role row");
  expect(adminRole.capabilities as string[]).toContain("comment:create");
  // The workspace admin: a member whose only authority is the workspace admin role.
  const admin = await inviteAndAcceptAsNewMemberNative(
    app,
    owner.cookie,
    workspaceId,
    "admin",
  );
  return { app, owner, admin, workspaceId, parent, child, adminRole };
}

type World = Awaited<ReturnType<typeof world>>;

const rulesPath = (project: { slug: string }) =>
  `/api/projects/${project.slug}/automations`;

const ruleBody = (adminRoleId: string) => ({
  name: "Runs as admin",
  trigger: "work_item.created",
  conditions: [],
  actions: [{ type: "set_priority", priority: "high" }],
  effectiveRoleId: adminRoleId,
});

/** The owner saves a project rule running as the workspace admin role. */
async function ownerRule(w: World, project: { slug: string }) {
  const created = await call(
    w.app,
    w.owner.cookie,
    "POST",
    rulesPath(project),
    ruleBody(w.adminRole.id),
  );
  expect(created.status, await created.clone().text()).toBe(201);
  return ((await created.json()) as { id: string }).id;
}

/**
 * The override carries the workspace admin's own rank, so the rank check passes and only the
 * automation-management capability passes the operation gate, then the capability subset
 * (RL-3) can refuse.
 */
async function narrow(w: World, projectId: string) {
  const role = await grantProjectRole(w.admin.user.id, projectId, NARROWED);
  await db
    .update(schema.roleTable)
    .set({ rank: w.adminRole.rank })
    .where(eq(schema.roleTable.id, role.id));
}

/** Narrowed: can manage project automations, but holds no comment:create / work_item:assign. */
const NARROWED = ["project:read", "automation:manage"];

async function expectCeiling(w: World, project: { slug: string }) {
  const ruleId = await ownerRule(w, project);

  const create = await call(
    w.app,
    w.admin.cookie,
    "POST",
    rulesPath(project),
    ruleBody(w.adminRole.id),
  );
  expect(create.status, await create.clone().text()).toBe(403);
  expect(await create.text()).toContain(
    "effective_role_exceeds_your_capabilities",
  );

  const enable = await call(
    w.app,
    w.admin.cookie,
    "POST",
    `/api/automations/${ruleId}/enable`,
    {},
  );
  expect(enable.status, await enable.clone().text()).toBe(403);
  expect(await enable.text()).toContain(
    "effective_role_exceeds_your_capabilities",
  );

  const dryRun = await call(
    w.app,
    w.admin.cookie,
    "POST",
    `/api/automations/${ruleId}/dry-run`,
  );
  expect(dryRun.status, await dryRun.clone().text()).toBe(403);
  expect(await dryRun.text()).toContain(
    "effective_role_exceeds_your_capabilities",
  );

  const list = await get(w.app, w.admin.cookie, rulesPath(project));
  expect(list.status, await list.clone().text()).toBe(200);
  const body = (await list.json()) as {
    meta: { assignableRoles: { id: string }[] };
  };
  expect(body.meta.assignableRoles.map((r) => r.id)).not.toContain(
    w.adminRole.id,
  );
}

describe("project rule author ceiling follows the evaluator's scope resolution (P4R4-M1)", () => {
  it("a project override with automation:manage but no comment:create cannot save, enable or dry-run an admin-role project rule", async () => {
    const w = await world();
    await narrow(w, w.parent.id);
    await expectCeiling(w, w.parent);
  });

  it("a child project inheriting a narrowed parent override is held to the same ceiling", async () => {
    const w = await world();
    await narrow(w, w.parent.id);
    await expectCeiling(w, w.child);
  });

  it("an un-narrowed admin may still save, enable and dry-run and sees the admin role", async () => {
    const w = await world();
    const create = await call(
      w.app,
      w.admin.cookie,
      "POST",
      rulesPath(w.parent),
      ruleBody(w.adminRole.id),
    );
    expect(create.status, await create.clone().text()).toBe(201);
    const ruleId = ((await create.json()) as { id: string }).id;
    const enable = await call(
      w.app,
      w.admin.cookie,
      "POST",
      `/api/automations/${ruleId}/enable`,
      {},
    );
    expect(enable.status, await enable.clone().text()).toBe(200);
    const dryRun = await call(
      w.app,
      w.admin.cookie,
      "POST",
      `/api/automations/${ruleId}/dry-run`,
    );
    expect(dryRun.status, await dryRun.clone().text()).toBe(200);
    const list = await get(w.app, w.admin.cookie, rulesPath(w.child));
    const body = (await list.json()) as {
      meta: { assignableRoles: { id: string }[] };
    };
    expect(body.meta.assignableRoles.map((r) => r.id)).toContain(
      w.adminRole.id,
    );
  });
});
