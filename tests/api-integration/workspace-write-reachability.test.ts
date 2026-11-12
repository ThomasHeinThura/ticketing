/**
 * S4 — who can reach the native workspace write routes at all.
 * Issue #6, retrofit plan §3 (S4 row, the DISABLE_WORKSPACE_CREATION gate)
 * and risk R10 (new routes are API-key reachable; plugin routes were not).
 *
 * R10, and why this file exists. `enableSessionForAPIKeys: false`
 * (`apps/api/src/auth.ts`) means an API key never became a better-auth
 * session, so `/organization/*` was effectively session-only. Every route
 * mounted under `apps/api/src/index.ts`'s global guard authenticates API keys
 * too — so a native create/update/delete would become API-key reachable for
 * the FIRST time, silently, as a side effect of moving the route.
 *
 * These routes therefore require a session, via `requireSessionOnly()`
 * (`apps/api/src/utils/require-session-only.ts`, #65) — the SAME control the
 * S2 native reads use, not a second implementation of it. Both a policy
 * declaration (`sessionOnly: true`, `apps/api/src/workspace/policy.ts`) and
 * this runtime enforcement exist; the declaration alone would be inert
 * metadata (nothing wires `policyRegistry` into `apps/api/src/index.ts` yet
 * — issue #8's), so the assertions below are against the runtime, not the
 * registry. Effects 7 and 8 also need a session row to mutate, so a
 * sessionless create could not satisfy the NINE-effect contract in any case.
 *
 * An earlier version of this file asserted `401` for an API-key call, back
 * when these routes ran a bespoke `requireSession` that only checked for
 * `session?.id` and could not distinguish "no credential" from "the wrong
 * kind of credential". Consolidating onto `requireSessionOnly()` means these
 * routes now give the same `403 session_required` the S2 reads give for the
 * same case — asserted below, not the stale `401`.
 */
import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import { signUpInstanceAdmin, signUpUser } from "./helpers/organization-http";
import { inviteAndAcceptAsNewMemberNative } from "./helpers/workspace-invitation-write-http";
import {
  createWorkspaceNative,
  postCreateWorkspace,
} from "./helpers/workspace-write-http";

beforeEach(async () => {
  await resetTestDatabase();
});

// `vi.stubEnv` rather than assigning to `process.env`: the shared setup file
// only restores mocks, so an unstubbed write would leak the flag into every
// later file in this single-worker run.
afterEach(() => {
  vi.unstubAllEnvs();
});

// Minted by direct insert, the same way tests/api-integration/api-key-bearer.test.ts
// does it: the api-key plugin's own hashing is not the subject here, and going
// through its route would couple this probe to that route's own gating.
function hashApiKeyForTest(key: string): string {
  return createHash("sha256")
    .update(key)
    .digest()
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function issueApiKey(userId: string): Promise<string> {
  const rawKey = `taskdesk_test_${randomUUID()}`;
  const now = new Date();
  await db.insert(schema.apikeyTable).values({
    referenceId: userId,
    userId,
    key: hashApiKeyForTest(rawKey),
    name: "A2 reachability probe key",
    start: rawKey.slice(0, 12),
    prefix: "taskdesk",
    createdAt: now,
    updatedAt: now,
  });
  return rawKey;
}

describe("S4 native writes are session-only (A2-P22)", () => {
  it("A2-P22 refuses an API key on create, update and delete, and writes nothing", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceNative(app, owner.cookie, {
      name: "Session Only",
    });
    expect(created.status).toBe(200);
    const { id } = (await created.json()) as { id: string };

    const apiKey = await issueApiKey(owner.user.id);
    const keyHeaders = {
      "content-type": "application/json",
      "x-api-key": apiKey,
    };

    const create = await app.request("/api/workspace", {
      method: "POST",
      headers: keyHeaders,
      body: JSON.stringify({ name: "By Key" }),
    });
    expect(create.status).toBe(403);
    expect(await create.text()).toContain("session_required");

    const update = await app.request(`/api/workspace/${id}`, {
      method: "PATCH",
      headers: keyHeaders,
      body: JSON.stringify({ name: "By Key" }),
    });
    expect(update.status).toBe(403);
    expect(await update.text()).toContain("session_required");

    const remove = await app.request(`/api/workspace/${id}`, {
      method: "DELETE",
      headers: { "x-api-key": apiKey },
    });
    expect(remove.status).toBe(403);
    expect(await remove.text()).toContain("session_required");

    const rows = await db.select().from(schema.workspaceTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Session Only");
  });
});

/**
 * Owner decision D-A (12 Nov 2026, final): only a CURRENT instance administrator creates a
 * workspace, and the request names its owner. `DISABLE_WORKSPACE_CREATION` stays registered but
 * no longer widens or narrows anything, so every refusal below is asserted under all three of
 * its states (unset, "false", "true").
 */
describe("S4 create is for a current instance administrator only (A2-P23)", () => {
  async function workspaceCount(): Promise<number> {
    return (await db.select().from(schema.workspaceTable)).length;
  }

  it("A2-P23 refuses a workspace member, a workspace admin and the owner of another workspace, whatever DISABLE_WORKSPACE_CREATION says, and writes nothing", async () => {
    const { app } = createApp();
    const ownerA = await signUpUser(app);
    const createdA = await createWorkspaceNative(app, ownerA.cookie, {
      name: "Alpha",
    });
    expect(createdA.status).toBe(200);
    const workspaceA = ((await createdA.json()) as { id: string }).id;
    const adminA = await inviteAndAcceptAsNewMemberNative(
      app,
      ownerA.cookie,
      workspaceA,
      "admin",
    );
    const memberA = await inviteAndAcceptAsNewMemberNative(
      app,
      ownerA.cookie,
      workspaceA,
      "member",
    );
    const ownerB = await signUpUser(app);
    expect(
      (await createWorkspaceNative(app, ownerB.cookie, { name: "Bravo" }))
        .status,
    ).toBe(200);
    const before = await workspaceCount();
    expect(before).toBe(2);

    const attempts = [
      { label: "workspace member", person: memberA },
      { label: "workspace admin", person: adminA },
      { label: "owner of workspace A", person: ownerA },
      { label: "owner of workspace B", person: ownerB },
    ];
    for (const flag of [undefined, "false", "true"] as const) {
      vi.stubEnv("DISABLE_WORKSPACE_CREATION", flag);
      for (const { label, person } of attempts) {
        const refused = await postCreateWorkspace(app, person.cookie, {
          name: `By ${label}`,
          ownerUserId: person.user.id,
        });
        expect(refused.status, `${label} with flag ${String(flag)}`).toBe(403);
      }
    }
    expect(await workspaceCount()).toBe(before);
  });

  it("A2-P23b admits an instance admin who names another user: the nominee becomes the owner, the creator is NOT a member, and the audit row records both", async () => {
    const { app } = createApp();
    const instanceAdmin = await signUpInstanceAdmin(app);
    const nominee = await signUpUser(app);

    const created = await postCreateWorkspace(app, instanceAdmin.cookie, {
      name: "Handed Over",
      ownerUserId: nominee.user.id,
    });
    expect(created.status).toBe(200);
    const workspace = (await created.json()) as { id: string };

    const members = await db
      .select()
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.workspaceId, workspace.id));
    expect(members).toHaveLength(1);
    expect(members[0]?.userId).toBe(nominee.user.id);
    expect(members[0]?.role).toBe("owner");
    const teamMembers = await db
      .select()
      .from(schema.teamMemberTable)
      .innerJoin(
        schema.teamTable,
        eq(schema.teamTable.id, schema.teamMemberTable.teamId),
      )
      .where(eq(schema.teamTable.workspaceId, workspace.id));
    expect(teamMembers.map((row) => row.team_member.userId)).toEqual([
      nominee.user.id,
    ]);

    // The creating administrator holds no membership anywhere and their session is untouched:
    // it must not point at a workspace they do not belong to.
    expect(
      await db
        .select()
        .from(schema.workspaceUserTable)
        .where(eq(schema.workspaceUserTable.userId, instanceAdmin.user.id)),
    ).toHaveLength(0);
    const adminSessions = await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, instanceAdmin.user.id));
    expect(adminSessions.length).toBeGreaterThan(0);
    for (const session of adminSessions) {
      expect(session.activeOrganizationId).toBeNull();
      expect(session.activeTeamId).toBeNull();
    }

    // The nominee has the normal owner reach: they can read the workspace they were handed.
    const read = await app.request(`/api/workspace/${workspace.id}`, {
      headers: { cookie: nominee.cookie },
    });
    expect(read.status).toBe(200);

    // The creator and the named owner are both in the audit log.
    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.action, "workspace.created"),
          eq(schema.auditLogTable.workspaceId, workspace.id),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorId).toBe(instanceAdmin.user.id);
    expect(audit[0]?.entityId).toBe(workspace.id);
    expect(audit[0]?.after).toMatchObject({
      createdBy: instanceAdmin.user.id,
      ownerUserId: nominee.user.id,
    });
  });

  it("A2-P23c first run: the first user is the instance admin and can create the first workspace by naming themselves, which also selects it in their session", async () => {
    const { app } = createApp();
    const firstAdmin = await signUpInstanceAdmin(app);

    const created = await postCreateWorkspace(app, firstAdmin.cookie, {
      name: "First Workspace",
      ownerUserId: firstAdmin.user.id,
    });
    expect(created.status).toBe(200);
    const workspace = (await created.json()) as { id: string };

    const members = await db
      .select()
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.workspaceId, workspace.id));
    expect(members).toHaveLength(1);
    expect(members[0]?.userId).toBe(firstAdmin.user.id);
    expect(members[0]?.role).toBe("owner");
    const [session] = await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, firstAdmin.user.id));
    expect(session?.activeOrganizationId).toBe(workspace.id);
  });

  it("A2-P23d needs a named owner who is an existing, active, unsuspended staff user, and writes nothing otherwise", async () => {
    const { app } = createApp();
    const instanceAdmin = await signUpInstanceAdmin(app);
    const deactivated = await signUpUser(app);
    const suspended = await signUpUser(app);
    const expiredBan = await signUpUser(app);
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.userId, deactivated.user.id));
    await db
      .update(schema.userTable)
      .set({ banned: true })
      .where(eq(schema.userTable.id, suspended.user.id));

    await db
      .update(schema.userTable)
      .set({ banned: true, banExpires: new Date(0) })
      .where(eq(schema.userTable.id, expiredBan.user.id));

    const bodies = [
      { label: "no owner at all", body: {} },
      { label: "an unknown user", body: { ownerUserId: "no-such-user" } },
      {
        label: "a deactivated staff person",
        body: { ownerUserId: deactivated.user.id },
      },
      { label: "a suspended user", body: { ownerUserId: suspended.user.id } },
      {
        label: "a user with an expired ban still set",
        body: { ownerUserId: expiredBan.user.id },
      },
    ];
    for (const { label, body } of bodies) {
      const refused = await postCreateWorkspace(app, instanceAdmin.cookie, {
        name: "Nobody Owns Me",
        ...body,
      });
      expect(refused.status, label).toBe(400);
    }
    expect(await workspaceCount()).toBe(0);
    expect(await db.select().from(schema.workspaceUserTable)).toHaveLength(0);
  });

  it("A2-P23e an instance admin may create whatever DISABLE_WORKSPACE_CREATION says: the variable no longer changes who may create", async () => {
    const { app } = createApp();
    const instanceAdmin = await signUpInstanceAdmin(app);

    for (const flag of [undefined, "false", "true"] as const) {
      vi.stubEnv("DISABLE_WORKSPACE_CREATION", flag);
      const created = await postCreateWorkspace(app, instanceAdmin.cookie, {
        name: `Flag ${String(flag)}`,
        ownerUserId: instanceAdmin.user.id,
      });
      expect(created.status, `flag ${String(flag)}`).toBe(200);
    }
    expect(await workspaceCount()).toBe(3);
  });

  it("A2-P23f refuses an API key even when the key belongs to an instance admin", async () => {
    const { app } = createApp();
    const instanceAdmin = await signUpInstanceAdmin(app);
    const apiKey = await issueApiKey(instanceAdmin.user.id);

    const refused = await app.request("/api/workspace", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({
        name: "By Admin Key",
        ownerUserId: instanceAdmin.user.id,
      }),
    });
    expect(refused.status).toBe(403);
    expect(await refused.text()).toContain("session_required");
    expect(await workspaceCount()).toBe(0);
  });

  it("A2-P23g reads the administrator role fresh from the database: an admin demoted since signing in is refused at once", async () => {
    const { app } = createApp();
    const instanceAdmin = await signUpInstanceAdmin(app);
    await db
      .update(schema.userTable)
      .set({ role: "user" })
      .where(eq(schema.userTable.id, instanceAdmin.user.id));

    const refused = await postCreateWorkspace(app, instanceAdmin.cookie, {
      name: "Stale Admin",
      ownerUserId: instanceAdmin.user.id,
    });
    expect(refused.status).toBe(403);
    expect(await workspaceCount()).toBe(0);
  });
});
