/**
 * AK-7 over HTTP: a workspace service key (no person behind it) works on the workspace-level
 * routes whose legacy gates used to answer 401, within its stored capability subset only.
 * It never gains instance authority, project reach, approval rights or a person's identity.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createServiceApiKey } from "../../apps/api/src/api-key/service";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import { makeTeam } from "./helpers/p4-closeout";

async function world(capabilities: string[]) {
  const owner = await createWorkspaceMember({ role: "owner" });
  const created = await createServiceApiKey(
    { userId: owner.user.id },
    owner.workspace.id,
    { name: "ci-bot", capabilities },
  );
  const other = await createWorkspaceMember({ role: "owner" });
  const { project } = await createProjectFixture({
    workspaceId: owner.workspace.id,
  });
  const team = await makeTeam(owner.workspace.id, []);
  // The key is the only credential on these requests: no session.
  mockAnonymousSession();
  const { app } = createApp();
  const call = (path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: {
        "x-api-key": created.key,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  return { owner, other, project, team, call };
}

describe("workspace service key on workspace-level routes", () => {
  beforeEach(async () => resetTestDatabase());

  it("reads its own workspace within its capability subset", async () => {
    const w = await world(["workspace:read"]);
    const own = await w.call(`/api/teams?workspaceId=${w.owner.workspace.id}`);
    expect(own.status, await own.clone().text()).toBe(200);
    const body = (await own.json()) as { id: string }[] | { teams: unknown[] };
    expect(JSON.stringify(body)).toContain(w.team.id);
  });

  it("works the same way on another workspace-addressed family (custom fields)", async () => {
    const w = await world(["workspace:read", "custom_field:manage"]);
    const ws = w.owner.workspace.id;
    expect(
      (await w.call(`/api/custom-field-sections?workspaceId=${ws}`)).status,
    ).toBe(200);
    expect((await w.call(`/api/custom-fields?workspaceId=${ws}`)).status).toBe(
      200,
    );
    const made = await w.call("/api/custom-field-sections", {
      method: "POST",
      body: JSON.stringify({ workspaceId: ws, name: "Bot section" }),
    });
    expect(made.status, await made.clone().text()).toBe(200);
    // Holding manage on custom fields does not open the team write (workspace:manage_settings).
    const team = await w.call("/api/teams", {
      method: "POST",
      body: JSON.stringify({ workspaceId: ws, name: "Nope" }),
    });
    expect(team.status).toBe(403);
    expect(
      (await w.call(`/api/custom-fields?workspaceId=${w.other.workspace.id}`))
        .status,
    ).toBe(403);
  });

  it("refuses another workspace, a capability outside the subset, and every write it was not given", async () => {
    const w = await world(["workspace:read"]);
    const foreign = await w.call(
      `/api/teams?workspaceId=${w.other.workspace.id}`,
    );
    expect(foreign.status).toBe(403);
    // Holds read, not manage_settings: the team write is refused at the gate.
    const write = await w.call("/api/teams", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: w.owner.workspace.id,
        name: "Not allowed",
      }),
    });
    expect(write.status).toBe(403);

    const narrow = await world(["work_item:read"]);
    const noScope = await narrow.call(
      `/api/teams?workspaceId=${narrow.owner.workspace.id}`,
    );
    expect(noScope.status).toBe(403);
  });

  it("holds no project reach, no instance authority and no person routes", async () => {
    const w = await world(["workspace:read", "project:read", "work_item:read"]);
    // No project membership and no sees_all: a project route answers like a missing project.
    const project = await w.call(`/api/projects/${w.project.id}`);
    expect([403, 404]).toContain(project.status);
    // Instance routes and self routes stay refused.
    for (const path of [
      "/api/instance/users",
      "/api/instance/settings",
      "/api/me/api-keys",
      "/api/me/pending-actions",
    ]) {
      const response = await w.call(path);
      expect([401, 403, 404], path).toContain(response.status);
    }
    // A session-only self write is refused for a key.
    const prefs = await w.call("/api/notification-preferences", {
      method: "PUT",
      body: JSON.stringify({ emailEnabled: false }),
    });
    expect([401, 403]).toContain(prefs.status);
  });

  it("never opens a route that is not a capability route of its own workspace", async () => {
    // Holding capabilities is not enough where the route is membership-, self- or session-bound.
    const w = await world([
      "workspace:read",
      "workspace:manage_settings",
      "api_key:manage",
    ]);
    // Membership-gated and person-bound: refused even though the key holds api_key:manage.
    const keys = await w.call(
      `/api/workspaces/${w.owner.workspace.id}/api-keys`,
    );
    expect(keys.status).toBe(403);
    // A self route in the key's own workspace stays closed.
    const self = await w.call(
      `/api/notification-preferences/workspaces/${w.owner.workspace.id}`,
      { method: "DELETE" },
    );
    expect([401, 403]).toContain(self.status);
  });

  it("cannot request or approve a deletion (no person to approve it)", async () => {
    const w = await world(["workspace:read", "workspace:manage_settings"]);
    // Row-addressed routes need project/row reach a service key does not hold: 404, and the
    // deletion is never requested (a pending action would need an approver).
    const response = await w.call(`/api/teams/${w.team.id}`, {
      method: "DELETE",
    });
    expect([403, 404]).toContain(response.status);
    expect(
      await db
        .select({ id: schema.pendingActionTable.id })
        .from(schema.pendingActionTable),
    ).toHaveLength(0);
  });

  it("writes within its subset when the route is addressed by workspace", async () => {
    const w = await world(["workspace:read", "workspace:manage_settings"]);
    const response = await w.call("/api/teams", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: w.owner.workspace.id,
        name: "Made by a bot",
      }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const rows = await db
      .select({ name: schema.teamTable.name })
      .from(schema.teamTable)
      .where(eq(schema.teamTable.workspaceId, w.owner.workspace.id));
    expect(rows.map((row) => row.name)).toContain("Made by a bot");
    // Attributed to the key, never to a person.
    const [audit] = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "team.created"));
    expect(audit?.actorType).toBe("api_key");
    expect(audit?.apiKeyId).toBeTruthy();
  });

  it("a revoked or unknown key stays 401", async () => {
    const w = await world(["workspace:read"]);
    const bad = await w.call(`/api/teams?workspaceId=${w.owner.workspace.id}`, {
      headers: { "x-api-key": "taskdesk_not_a_real_key" },
    });
    expect(bad.status).toBe(401);
  });
});
