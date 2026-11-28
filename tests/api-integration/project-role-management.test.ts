/**
 * Project-scope custom roles through the existing workspace role routes: list (`?scope=project`),
 * PATCH (rename / re-describe only, step-up `workspace_role_update`) and DELETE (RL-8 click
 * approval). Built-in project roles are immutable; the role key never changes.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { getDatabasePool, schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resolveRosterRole } from "../../apps/api/src/project/members/roster.repository";
import {
  resolveRoleCaller,
  updateProjectRoleDetails,
} from "../../apps/api/src/workspace/role-service";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import { createProjectFixture } from "./helpers/fixtures";
import { signUpUser } from "./helpers/organization-http";
import { projectKey } from "./helpers/project-key";
import { addMember } from "./helpers/reach-world";
import { mintStepUpToken } from "./helpers/step-up";
import { inviteAndAcceptAsNewMemberNative } from "./helpers/workspace-invitation-write-http";
import {
  approveWorkspaceRoleDeletion,
  deleteWorkspaceRoleNative,
  getWorkspaceRoleHistoryNative,
  listWorkspaceRolesNative,
  requestWorkspaceRoleDeletion,
  updateWorkspaceRoleNative,
} from "./helpers/workspace-role-write-http";
import { createWorkspaceNative } from "./helpers/workspace-write-http";

type App = ReturnType<typeof createApp>["app"];

async function createWorkspace(app: App, cookie: string, name: string) {
  const created = await createWorkspaceNative(app, cookie, { name });
  if (created.status !== 200) throw new Error(await created.text());
  return ((await created.json()) as { id: string }).id;
}

async function projectRole(
  workspaceId: string,
  key: string,
  overrides: Partial<typeof schema.roleTable.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.roleTable)
    .values({
      id: randomUUID(),
      scope: "project",
      workspaceId,
      key,
      name: key,
      description: null,
      rank: 1,
      capabilities: ["work_item:read"],
      isSystem: false,
      isEditable: true,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("role insert failed");
  return row;
}

async function holder(
  roleId: string,
  workspaceId: string,
  projectId: string,
  state: "active" | "revoked" = "active",
) {
  const { personId } = await addMember(workspaceId, "member");
  if (state === "active") {
    const [membership] = await db
      .insert(schema.membershipTable)
      .values({ personId, scope: "project", scopeId: projectId, roleId })
      .returning({ id: schema.membershipTable.id });
    await db.insert(schema.membershipGrantTable).values({
      membershipId: membership?.id ?? null,
      personId,
      scope: "project",
      scopeId: projectId,
      roleId,
      sourceKind: "direct",
      directOrigin: "system_backfill",
    });
  } else {
    await db.insert(schema.membershipGrantTable).values({
      personId,
      scope: "project",
      scopeId: projectId,
      roleId,
      sourceKind: "direct",
      directOrigin: "system_backfill",
      revokedAt: new Date(),
      revocationReason: "direct_removed",
    });
  }
  return personId;
}

async function world() {
  const { app } = createApp();
  const owner = await signUpUser(app);
  const workspaceId = await createWorkspace(app, owner.cookie, "Roles");
  const project = (
    await createProjectFixture({ workspaceId, slug: projectKey() })
  ).project;
  return { app, owner, workspaceId, project };
}

async function roleRow(roleId: string) {
  const [row] = await db
    .select()
    .from(schema.roleTable)
    .where(eq(schema.roleTable.id, roleId));
  return row;
}

async function waitForBlockedQuery() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await getDatabasePool().query<{ waiting: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_locks WHERE locktype = 'transactionid' AND NOT granted
       ) AS waiting`,
    );
    if (result.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("nothing queued behind the role row lock");
}

beforeEach(async () => resetTestDatabase());

describe("list project roles (GET /roles?scope=project)", () => {
  it("returns only this workspace's project roles with membership-based counts; default list is unchanged", async () => {
    const w = await world();
    const cab = await projectRole(w.workspaceId, "cab", { name: "CAB" });
    // Same key as a workspace role: the workspace `lead` holder count must not leak in.
    await projectRole(w.workspaceId, "lead", { name: "Lead (project)" });
    await holder(cab.id, w.workspaceId, w.project.id);
    await holder(cab.id, w.workspaceId, w.project.id);
    await holder(cab.id, w.workspaceId, w.project.id, "revoked");

    const other = await world();
    await projectRole(other.workspaceId, "elsewhere");

    const response = await w.app.request(
      `/api/workspace/${w.workspaceId}/roles?scope=project`,
      { headers: { cookie: w.owner.cookie } },
    );
    expect(response.status).toBe(200);
    const roles = (await response.json()) as Array<{
      role: string;
      scope: string;
      holderCount: number;
      projectCount?: number;
    }>;
    // `project-lead` is the built-in the workspace already materialised.
    expect(roles.map((r) => r.role).sort()).toEqual([
      "cab",
      "lead",
      "project-lead",
    ]);
    expect(roles.find((r) => r.role === "cab")).toMatchObject({
      scope: "project",
      holderCount: 2,
      projectCount: 1,
    });
    expect(roles.find((r) => r.role === "lead")?.holderCount).toBe(0);

    const defaults = await listWorkspaceRolesNative(
      w.app,
      w.owner.cookie,
      w.workspaceId,
    );
    const workspaceRoles = (await defaults.json()) as Array<{
      role: string;
      scope: string;
    }>;
    expect(workspaceRoles.map((r) => r.role)).not.toContain("cab");
    expect(workspaceRoles.every((r) => r.scope === "workspace")).toBe(true);
  });
});

describe("update project role (PATCH, step-up)", () => {
  it("renames and re-describes; the key is stable; the audit row records scope and before/after", async () => {
    const w = await world();
    const role = await projectRole(w.workspaceId, "cab", { name: "CAB" });

    const response = await updateWorkspaceRoleNative(
      w.app,
      w.owner.cookie,
      w.workspaceId,
      role.id,
      { name: "  Change board ", description: "Reviews changes" },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      role: string;
      name: string;
      description: string;
      version: string;
      scope: string;
    };
    expect(body).toMatchObject({
      role: "cab",
      name: "Change board",
      description: "Reviews changes",
      scope: "project",
    });
    const stored = await roleRow(role.id);
    expect(stored).toMatchObject({
      key: "cab",
      name: "Change board",
      scope: "project",
    });
    expect(body.version).not.toBe(String(role.updatedAt.getTime()));

    const [audit] = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.entityId, role.id),
          eq(schema.auditLogTable.action, "role.updated"),
        ),
      );
    expect(audit?.after).toMatchObject({
      scope: "project",
      role: "cab",
      name: { before: "CAB", after: "Change board" },
      description: { before: null, after: "Reviews changes" },
    });
  });

  it("needs step-up, and a replayed proof is refused", async () => {
    const w = await world();
    const role = await projectRole(w.workspaceId, "cab", { name: "CAB" });
    const without = await updateWorkspaceRoleNative(
      w.app,
      w.owner.cookie,
      w.workspaceId,
      role.id,
      { name: "A" },
      false,
    );
    expect(without.status).toBe(403);
    expect(await without.text()).toContain("step_up_required");

    const { mintStepUpToken } = await import("./helpers/step-up");
    const token = await mintStepUpToken(
      w.app,
      w.owner.cookie,
      "workspace_role_update",
      { workspaceId: w.workspaceId, roleId: role.id, name: "A" },
    );
    expect(token).toBeTruthy();
    const first = await updateWorkspaceRoleNative(
      w.app,
      w.owner.cookie,
      w.workspaceId,
      role.id,
      { name: "A" },
      token ?? undefined,
    );
    expect(first.status).toBe(200);
    const replay = await updateWorkspaceRoleNative(
      w.app,
      w.owner.cookie,
      w.workspaceId,
      role.id,
      { name: "A" },
      token ?? undefined,
    );
    expect(replay.status).toBe(403);
  });

  it("refuses a proof bound to different content", async () => {
    const w = await world();
    const role = await projectRole(w.workspaceId, "cab", { name: "CAB" });
    const { mintStepUpToken } = await import("./helpers/step-up");
    const token = await mintStepUpToken(
      w.app,
      w.owner.cookie,
      "workspace_role_update",
      { workspaceId: w.workspaceId, roleId: role.id, name: "Approved name" },
    );
    const response = await updateWorkspaceRoleNative(
      w.app,
      w.owner.cookie,
      w.workspaceId,
      role.id,
      { name: "Different name" },
      token ?? undefined,
    );
    expect(response.status).toBe(403);
    expect((await roleRow(role.id))?.name).toBe("CAB");
  });

  it("answers 409 role_changed for a stale version and 400 for capability, rank or permission edits", async () => {
    const w = await world();
    const role = await projectRole(w.workspaceId, "cab", { name: "CAB" });
    const stale = await updateWorkspaceRoleNative(
      w.app,
      w.owner.cookie,
      w.workspaceId,
      role.id,
      { name: "B", expectedVersion: "1" },
    );
    expect(stale.status).toBe(409);
    expect(await stale.text()).toContain("role_changed");

    for (const body of [
      { capabilities: ["work_item:read"] },
      { rank: 5 },
      { name: "X", permission: { work_item: ["read"] } },
    ]) {
      const refused = await updateWorkspaceRoleNative(
        w.app,
        w.owner.cookie,
        w.workspaceId,
        role.id,
        body,
        false,
      );
      expect(refused.status).toBe(400);
      expect(await refused.text()).toContain("project_role_details_only");
    }
    expect((await roleRow(role.id))?.name).toBe("CAB");
  });

  it("refuses built-in project roles, materialised or fakes keyed like one", async () => {
    const w = await world();
    const builtIn = await projectRole(w.workspaceId, "project-viewer", {
      name: "Project viewer",
      isSystem: true,
    });
    const fake = await projectRole(w.workspaceId, "project-member", {
      name: "Not really",
      isSystem: false,
    });
    for (const role of [builtIn, fake]) {
      for (const body of [{ name: "Renamed" }, { description: "Reworded" }]) {
        const response = await updateWorkspaceRoleNative(
          w.app,
          w.owner.cookie,
          w.workspaceId,
          role.id,
          body,
        );
        expect(response.status).toBe(403);
        expect(await response.text()).toContain("role_not_editable");
      }
      const removal = await deleteWorkspaceRoleNative(
        w.app,
        w.owner.cookie,
        w.workspaceId,
        role.id,
      );
      expect(removal.status).toBe(400);
      expect(await removal.text()).toContain("role_not_deletable");
    }
    expect((await roleRow(builtIn.id))?.name).toBe("Project viewer");
  });

  it("refuses a duplicate name (case-insensitive, custom or canonical) but allows keeping its own", async () => {
    const w = await world();
    const a = await projectRole(w.workspaceId, "a", { name: "Service desk" });
    await projectRole(w.workspaceId, "b", { name: "Reviewer" });
    for (const name of ["reviewer", " REVIEWER ", "Project member"]) {
      const response = await updateWorkspaceRoleNative(
        w.app,
        w.owner.cookie,
        w.workspaceId,
        a.id,
        { name },
      );
      expect(response.status).toBe(409);
    }
    const same = await updateWorkspaceRoleNative(
      w.app,
      w.owner.cookie,
      w.workspaceId,
      a.id,
      { name: "service desk", description: "x" },
    );
    expect(same.status).toBe(200);
  });

  it("two concurrent renames to the same name leave exactly one winner", async () => {
    const w = await world();
    const a = await projectRole(w.workspaceId, "a", { name: "A" });
    const b = await projectRole(w.workspaceId, "b", { name: "B" });
    const caller = await resolveRoleCaller(w.workspaceId, w.owner.user.id, {
      userId: w.owner.user.id,
      actorType: "person",
    });
    const attempt = (roleId: string) =>
      updateProjectRoleDetails({
        workspaceId: w.workspaceId,
        roleId,
        name: "Contested",
        caller,
      });
    const results = await Promise.allSettled([attempt(a.id), attempt(b.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((r) => r.status === "rejected");
    expect((loser as PromiseRejectedResult).reason?.name).toBe(
      "RoleNameTakenError",
    );
  });

  it("denies a plain member, and treats another workspace's role id like a missing one", async () => {
    const w = await world();
    const role = await projectRole(w.workspaceId, "cab", { name: "CAB" });
    const member = await inviteAndAcceptAsNewMemberNative(
      w.app,
      w.owner.cookie,
      w.workspaceId,
      "member",
    );
    const denied = await updateWorkspaceRoleNative(
      w.app,
      member.cookie,
      w.workspaceId,
      role.id,
      { name: "Nope" },
    );
    expect(denied.status).toBe(403);

    const stranger = await world();
    const crossPatch = await updateWorkspaceRoleNative(
      w.app,
      stranger.owner.cookie,
      stranger.workspaceId,
      role.id,
      { name: "Nope" },
    );
    const missingPatch = await updateWorkspaceRoleNative(
      w.app,
      stranger.owner.cookie,
      stranger.workspaceId,
      "no-such-role",
      { name: "Nope" },
    );
    expect(crossPatch.status).toBe(404);
    expect(missingPatch.status).toBe(404);
    // The message only echoes the id the caller sent.
    const withoutId = (text: string, id: string) => text.replace(id, "<id>");
    expect(withoutId(await crossPatch.text(), role.id)).toBe(
      withoutId(await missingPatch.text(), "no-such-role"),
    );

    const crossDelete = await deleteWorkspaceRoleNative(
      w.app,
      stranger.owner.cookie,
      stranger.workspaceId,
      role.id,
    );
    expect(crossDelete.status).toBe(404);
    expect((await roleRow(role.id))?.name).toBe("CAB");
  });
});

describe("delete project role (RL-8 click approval)", () => {
  it("refuses with a coded 409 and the holder count while anyone holds it", async () => {
    const w = await world();
    const role = await projectRole(w.workspaceId, "cab", { name: "CAB" });
    await holder(role.id, w.workspaceId, w.project.id);
    await holder(role.id, w.workspaceId, w.project.id);
    const response = await deleteWorkspaceRoleNative(
      w.app,
      w.owner.cookie,
      w.workspaceId,
      role.id,
    );
    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({
      error: "role_in_use",
      message: expect.any(String),
      holderCount: 2,
      projectCount: 1,
      projects: [{ id: w.project.id, name: expect.any(String) }],
    });
    expect(await roleRow(role.id)).toBeDefined();
  });

  it("deletes an unheld role on approval, never touching a workspace role with the same key", async () => {
    const w = await world();
    const role = await projectRole(w.workspaceId, "lead", {
      name: "Dup",
      description: "Keep me",
    });
    const [workspaceLead] = await db
      .select({ id: schema.roleTable.id })
      .from(schema.roleTable)
      .where(
        and(
          eq(schema.roleTable.scope, "workspace"),
          eq(schema.roleTable.workspaceId, w.workspaceId),
          eq(schema.roleTable.key, "lead"),
        ),
      );
    const legacyBefore = await db
      .select()
      .from(schema.workspaceRoleTable)
      .where(eq(schema.workspaceRoleTable.workspaceId, w.workspaceId));

    const pending = await requestWorkspaceRoleDeletion(
      w.app,
      w.owner.cookie,
      w.workspaceId,
      role.id,
    );
    const approved = await approveWorkspaceRoleDeletion(
      w.app,
      w.owner.cookie,
      pending,
    );
    expect(approved.status, await approved.clone().text()).toBe(200);
    expect(await roleRow(role.id)).toBeUndefined();
    expect(workspaceLead && (await roleRow(workspaceLead.id))).toBeDefined();
    const legacyAfter = await db
      .select()
      .from(schema.workspaceRoleTable)
      .where(eq(schema.workspaceRoleTable.workspaceId, w.workspaceId));
    expect(legacyAfter).toHaveLength(legacyBefore.length);

    const [audit] = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.entityId, role.id),
          eq(schema.auditLogTable.action, "role.deleted"),
        ),
      );
    expect(audit?.before).toMatchObject({
      scope: "project",
      role: "lead",
      name: "Dup",
      description: "Keep me",
      holderCount: 0,
    });
  });

  it("re-checks holders at approval time", async () => {
    const w = await world();
    const role = await projectRole(w.workspaceId, "cab", { name: "CAB" });
    const pending = await requestWorkspaceRoleDeletion(
      w.app,
      w.owner.cookie,
      w.workspaceId,
      role.id,
    );
    await holder(role.id, w.workspaceId, w.project.id);
    const approved = await approveWorkspaceRoleDeletion(
      w.app,
      w.owner.cookie,
      pending,
    );
    expect(approved.status).toBe(409);
    expect(await roleRow(role.id)).toBeDefined();
  });

  it("refuses, with a coded error, when revoked grants still reference the role", async () => {
    const w = await world();
    const role = await projectRole(w.workspaceId, "cab", { name: "CAB" });
    await holder(role.id, w.workspaceId, w.project.id, "revoked");
    const response = await deleteWorkspaceRoleNative(
      w.app,
      w.owner.cookie,
      w.workspaceId,
      role.id,
    );
    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({
      error: "role_has_revoked_grants",
      revokedGrantCount: 1,
    });
    expect(await roleRow(role.id)).toBeDefined();
    const grants = await db
      .select()
      .from(schema.membershipGrantTable)
      .where(eq(schema.membershipGrantTable.roleId, role.id));
    expect(grants).toHaveLength(1);
  });

  it("a roster-style write holding the role makes a concurrent delete refuse, not 500", async () => {
    const w = await world();
    const role = await projectRole(w.workspaceId, "cab", { name: "CAB" });
    const { personId } = await addMember(w.workspaceId, "member");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held!: () => void;
    const holding = new Promise<void>((resolve) => {
      held = resolve;
    });
    // The writer references the role (FK key-share lock) and has not committed yet.
    const writer = db.transaction(async (tx) => {
      await tx.insert(schema.membershipTable).values({
        personId,
        scope: "project",
        scopeId: w.project.id,
        roleId: role.id,
      });
      held();
      await gate;
    });
    await holding;
    const deletion = deleteWorkspaceRoleNative(
      w.app,
      w.owner.cookie,
      w.workspaceId,
      role.id,
    );
    await waitForBlockedQuery();
    release();
    await writer;
    const response = await deletion;
    expect(response.status, await response.clone().text()).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "role_in_use",
      holderCount: 1,
    });
    expect(await roleRow(role.id)).toBeDefined();
  });

  it("a roster role lookup racing an in-flight delete re-reads instead of returning a doomed role", async () => {
    const w = await world();
    const doomed = await projectRole(w.workspaceId, "project-viewer", {
      name: "Project viewer",
      isSystem: true,
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const deleting = db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT id FROM role WHERE id = ${doomed.id} FOR UPDATE`,
      );
      await tx
        .delete(schema.roleTable)
        .where(eq(schema.roleTable.id, doomed.id));
      locked();
      await gate;
    });
    await lockTaken;
    const lookup = db.transaction((tx) =>
      resolveRosterRole(tx, w.workspaceId, "project-viewer"),
    );
    await waitForBlockedQuery();
    release();
    await deleting;
    const resolved = await lookup;
    expect(resolved?.roleId).toBeDefined();
    expect(resolved?.roleId).not.toBe(doomed.id);
  });
});

describe("project role history", () => {
  it("shows a rename and a re-description, and hides the role from another workspace", async () => {
    const w = await world();
    const role = await projectRole(w.workspaceId, "cab", { name: "CAB" });
    const patch = await updateWorkspaceRoleNative(
      w.app,
      w.owner.cookie,
      w.workspaceId,
      role.id,
      { name: "Change board", description: "Reviews changes" },
    );
    expect(patch.status).toBe(200);

    const response = await getWorkspaceRoleHistoryNative(
      w.app,
      w.owner.cookie,
      w.workspaceId,
      role.id,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const history = (await response.json()) as Array<{
      action: string;
      name: { before: string | null; after: string | null } | null;
      description: { before: string | null; after: string | null } | null;
    }>;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      action: "role.updated",
      name: { before: "CAB", after: "Change board" },
      description: { before: null, after: "Reviews changes" },
    });

    const stranger = await world();
    const cross = await getWorkspaceRoleHistoryNative(
      w.app,
      stranger.owner.cookie,
      stranger.workspaceId,
      role.id,
    );
    const missing = await getWorkspaceRoleHistoryNative(
      w.app,
      stranger.owner.cookie,
      stranger.workspaceId,
      "no-such-role",
    );
    expect(cross.status).toBe(404);
    expect(missing.status).toBe(404);
  });
});

describe("contract: structured refusals are declared as JSON", () => {
  it("declares the coded JSON body next to the plain-text one", () => {
    const spec = JSON.parse(
      readFileSync(
        new URL("../api-contract/openapi.json", import.meta.url),
        "utf8",
      ),
    ) as {
      paths: Record<
        string,
        Record<
          string,
          { responses: Record<string, { content?: Record<string, unknown> }> }
        >
      >;
      components: { schemas: Record<string, { properties?: object }> };
    };
    const path = spec.paths["/workspace/{workspaceId}/roles/{roleId}"];
    for (const [method, status] of [
      ["delete", "409"],
      ["delete", "400"],
      ["patch", "409"],
      ["patch", "403"],
      ["patch", "400"],
    ] as const) {
      const content = path?.[method]?.responses[status]?.content;
      expect(Object.keys(content ?? {}).sort()).toEqual([
        "application/json",
        "text/plain",
      ]);
    }
    expect(
      Object.keys(spec.components.schemas.RoleRefusal?.properties ?? {}),
    ).toEqual(
      expect.arrayContaining([
        "error",
        "holderCount",
        "projectCount",
        "projects",
        "revokedGrantCount",
      ]),
    );
  });
});

async function injectRoleAuditFailure<T>(run: () => Promise<T>): Promise<T> {
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION fail_role_updated_audit() RETURNS trigger AS $$
    BEGIN
      IF NEW.action = 'role.updated' THEN RAISE EXCEPTION 'injected audit failure'; END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql`);
  await db.execute(
    sql`CREATE TRIGGER fail_role_updated_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_role_updated_audit()`,
  );
  try {
    return await run();
  } finally {
    await db.execute(
      sql`DROP TRIGGER IF EXISTS fail_role_updated_audit ON audit_log`,
    );
    await db.execute(sql`DROP FUNCTION IF EXISTS fail_role_updated_audit()`);
  }
}

describe("failure injection and races", () => {
  it("an audit failure after the proof and the write rolls everything back; the same proof works after recovery", async () => {
    const w = await world();
    const role = await projectRole(w.workspaceId, "cab", { name: "CAB" });
    const body = { name: "Renamed" };
    const token = await mintStepUpToken(
      w.app,
      w.owner.cookie,
      "workspace_role_update",
      { workspaceId: w.workspaceId, roleId: role.id, ...body },
    );
    expect(token).toBeTruthy();

    const failed = await injectRoleAuditFailure(() =>
      updateWorkspaceRoleNative(
        w.app,
        w.owner.cookie,
        w.workspaceId,
        role.id,
        body,
        token ?? undefined,
      ),
    );
    expect(failed.status).toBeGreaterThanOrEqual(500);
    const after = await roleRow(role.id);
    expect(after?.name).toBe("CAB");
    expect(after?.updatedAt.getTime()).toBe(role.updatedAt.getTime());
    const audits = await db
      .select({ action: schema.auditLogTable.action })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.entityId, role.id));
    expect(audits.filter((a) => a.action === "role.updated")).toHaveLength(0);
    const consumed = await db
      .select({ id: schema.auditLogTable.id })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "auth.step_up_consumed"));
    expect(consumed).toHaveLength(0);
    const spent = await db.execute(
      sql`SELECT count(*)::int AS n FROM step_up_confirmation WHERE state = 'consumed'`,
    );
    expect((spent.rows[0] as { n: number }).n).toBe(0);

    const retry = await updateWorkspaceRoleNative(
      w.app,
      w.owner.cookie,
      w.workspaceId,
      role.id,
      body,
      token ?? undefined,
    );
    expect(retry.status, await retry.clone().text()).toBe(200);
    expect((await roleRow(role.id))?.name).toBe("Renamed");
  });

  it("refuses an approval when a revoked grant appeared after the request", async () => {
    const w = await world();
    const role = await projectRole(w.workspaceId, "cab", { name: "CAB" });
    const pending = await requestWorkspaceRoleDeletion(
      w.app,
      w.owner.cookie,
      w.workspaceId,
      role.id,
    );
    await holder(role.id, w.workspaceId, w.project.id, "revoked");
    const approved = await approveWorkspaceRoleDeletion(
      w.app,
      w.owner.cookie,
      pending,
    );
    expect(approved.status).toBe(409);
    expect(await roleRow(role.id)).toBeDefined();
  });
});

describe("workflow saves vs project role delete", () => {
  async function workflowWorld() {
    const w = await world();
    const [a, b] = await db
      .insert(schema.stateTemplateTable)
      .values([
        { workspaceId: w.workspaceId, key: "a", name: "A", group: "backlog" },
        { workspaceId: w.workspaceId, key: "b", name: "B", group: "started" },
      ])
      .returning();
    if (!a || !b) throw new Error("state fixture missing");
    const post = (path: string, body: unknown) =>
      csrfRequest(
        w.app,
        path,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: w.owner.cookie,
          },
          body: JSON.stringify(body),
        },
        w.owner.cookie,
      );
    const created = await post("/api/workflows", {
      workspaceId: w.workspaceId,
      key: "flow",
      name: "Flow",
    });
    expect(created.status, await created.clone().text()).toBeLessThan(300);
    const workflow = (await created.json()) as { id: string };
    const edge = (roleId: string | null) => ({
      fromStateTemplateId: a.id,
      toStateTemplateId: b.id,
      roleId,
      notePolicy: "none",
      noteVisibility: "internal",
    });
    return { ...w, a, b, workflow, post, edge };
  }

  it("a save that validated a role deleted meanwhile answers 409, not an FK 500", async () => {
    const w = await workflowWorld();
    const role = await projectRole(w.workspaceId, "cab", { name: "CAB" });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    // An approved delete in flight: row locked and deleted, not yet committed.
    const deleting = db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT id FROM role WHERE id = ${role.id} FOR UPDATE`,
      );
      await tx.delete(schema.roleTable).where(eq(schema.roleTable.id, role.id));
      locked();
      await gate;
    });
    await lockTaken;
    const save = w.post(`/api/workflows/${w.workflow.id}/versions`, {
      transitions: [w.edge(role.id)],
    });
    await waitForBlockedQuery();
    release();
    await deleting;
    const response = await save;
    expect(response.status, await response.clone().text()).toBe(409);
    expect(await response.text()).toContain("workflow_role_deleted");
  });

  it("a delete queued behind a saving workflow refuses because a transition now references the role", async () => {
    const w = await workflowWorld();
    const role = await projectRole(w.workspaceId, "cab", { name: "CAB" });
    const versionResponse = await w.post(
      `/api/workflows/${w.workflow.id}/versions`,
      { transitions: [w.edge(null)] },
    );
    expect(versionResponse.status).toBeLessThan(300);
    const [version] = await db
      .select({ id: schema.workflowVersionTable.id })
      .from(schema.workflowVersionTable)
      .where(eq(schema.workflowVersionTable.workflowId, w.workflow.id));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held!: () => void;
    const holding = new Promise<void>((resolve) => {
      held = resolve;
    });
    // The save: share-locks the role (as the controller does) and inserts a referencing row.
    const saving = db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT id FROM role WHERE id = ${role.id} FOR SHARE`,
      );
      await tx.insert(schema.workflowTransitionTable).values({
        versionId: version?.id ?? "",
        fromStateTemplateId: w.a.id,
        toStateTemplateId: w.b.id,
        roleId: role.id,
        notePolicy: "none",
        noteVisibility: "internal",
      });
      held();
      await gate;
    });
    await holding;
    const deletion = deleteWorkspaceRoleNative(
      w.app,
      w.owner.cookie,
      w.workspaceId,
      role.id,
    );
    await waitForBlockedQuery();
    release();
    await saving;
    const response = await deletion;
    expect(response.status, await response.clone().text()).toBe(409);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({
      error: "role_in_use",
      references: { workflowTransitions: 1 },
    });
    expect(await roleRow(role.id)).toBeDefined();
  });
});
