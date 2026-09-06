/**
 * S1 — characterization of the inherited better-auth `organization()` plugin.
 * Issue #6, retrofit plan step S1.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * S1 CHARACTERIZATION ASSERTIONS UNRUN — POSTGRESQL REQUIRED
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Not one assertion in this file has executed. There is no PostgreSQL reachable
 * from the environment these were written in. Every test here fails today with a
 * single `ECONNREFUSED 127.0.0.1:5432`, which proves the imports resolve, the app
 * boots and the HTTP requests are issued — and proves nothing whatsoever about
 * what the plugin actually writes.
 *
 * Do not treat this file as an oracle until it has run green against the real
 * plugin. Do not start S2 on the strength of it.
 *
 * BASELINE. This branch is cut from #16 (`feat/p0-remove-inherited-surfaces`),
 * NOT from `main`, because the retrofit plan is written against that tree: on #16
 * billing is already removed and `enableSessionForAPIKeys` is `false`. Those
 * differences from `main` are intentional #16 changes, not plan defects. If #16's
 * head moves or #16 merges, this branch must be semantically rebased and the
 * characterization surface re-inspected — a stale plugin baseline here is worse
 * than none, because it would silently certify the wrong behaviour.
 *
 * LINE CITATIONS. The `apps/api/src/auth.ts:NNN` references in the comments below
 * were authored against `main` and only partly re-verified against this branch.
 * Treat them as pointers to the right code, not as exact addresses, and correct
 * them on the first green run.
 *
 * WHAT THIS FILE IS FOR. These assertions are the equivalence oracle for S4–S7.
 * Each asserts on DATABASE STATE, never on plugin response shapes — a response
 * assertion would break the moment the shape changes, which is precisely what
 * must not happen when the routes move to native TaskDesk handlers.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { subscribeToEvent } from "../../apps/api/src/events";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceViaPlugin,
  inviteAndAcceptAsNewMember,
  signUpUser,
} from "./helpers/organization-http";

// S1 characterization tests for the better-auth organization() plugin
// retrofit (issue #6). These drive the CURRENT plugin routes over real HTTP
// (createApp() + app.request(), real sign-up cookies -- never
// mockAuthenticatedSession, because the plugin's own routes resolve their
// session from the request, not from auth.api.getSession) and assert on
// DATABASE STATE, never on the plugin's JSON response shapes. They are the
// equivalence oracle for S4-S7: the same assertions must keep passing once
// each concern moves to a native TaskDesk route.
//
// UNRUN: there is no PostgreSQL in this environment. Every assertion below
// was verified by reading apps/api/src/auth.ts, apps/api/src/database/
// schema.ts, packages/permissions/src/index.ts and the better-auth
// organization plugin's own source (crud-org.mjs, crud-invites.mjs,
// crud-access-control.mjs, has-permission.mjs) -- see the report for
// file:line citations per assertion.

type RecordedEvent = { type: string; data: unknown };
const recordedEvents: RecordedEvent[] = [];
let eventSubscribersInitialized = false;

function initEventSubscribers() {
  if (eventSubscribersInitialized) return;
  eventSubscribersInitialized = true;
  // workspace.created is published from afterCreateOrganization --
  // apps/api/src/auth.ts:405. Subscribe to the real event bus
  // (apps/api/src/events/index.ts) rather than mocking publishEvent, so this
  // characterizes the actual event, not a stand-in for it.
  subscribeToEvent("workspace.created", async (data) => {
    recordedEvents.push({ type: "workspace.created", data });
  });
}

describe("API integration: organization() plugin characterization (S1, issue #6)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    recordedEvents.length = 0;
    initEventSubscribers();
  });

  describe("create", () => {
    // THE ORACLE. Every observable side effect of one plugin create call, in
    // one test on purpose: S4 replaces this route and must reproduce ALL of it.
    it("create writes EVERY side effect: workspace, owner workspace_member, 3 seeded workspace_role rows, workspace.created, a default team and its team_member", async () => {
      const { app } = createApp();
      const owner = await signUpUser(app);

      const created = await createWorkspaceViaPlugin(app, owner.cookie, {
        name: "Acme Inc",
      });
      expect(created.status).toBe(200);
      const workspace = (await created.json()) as { id: string };

      // workspace row -- schema mapping apps/api/src/auth.ts:341-352,
      // adapter model map apps/api/src/auth.ts:212, table
      // apps/api/src/database/schema.ts:141-151.
      const workspaceRows = await db
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, workspace.id));
      expect(workspaceRows).toHaveLength(1);
      expect(workspaceRows[0]?.name).toBe("Acme Inc");

      // workspace_member row, role=owner. The plugin's own createOrganization
      // handler creates this with role = orgOptions.creatorRole ?? "owner"
      // (better-auth crud-org.mjs); our schema remaps organizationId ->
      // workspaceId and createdAt -> joinedAt (apps/api/src/auth.ts:353-359),
      // table at apps/api/src/database/schema.ts:153-176.
      const memberRows = await db
        .select()
        .from(schema.workspaceUserTable)
        .where(eq(schema.workspaceUserTable.workspaceId, workspace.id));
      expect(memberRows).toHaveLength(1);
      expect(memberRows[0]?.userId).toBe(owner.user.id);
      expect(memberRows[0]?.role).toBe("owner");
      expect(memberRows[0]?.joinedAt).toBeInstanceOf(Date);

      // 3 workspace_role rows seeded by afterCreateOrganization --
      // apps/api/src/auth.ts:381-410 (seed loop at :425-452), names from
      // DEFAULT_ROLE_NAMES = ["viewer", "member", "admin"] --
      // packages/permissions/src/index.ts:60. "owner" is deliberately never
      // seeded (packages/permissions/src/index.ts:56-60; this is R5 in the
      // retrofit plan) -- owner authority stays entirely in the compiled-in
      // static role.
      const roleRows = await db
        .select()
        .from(schema.workspaceRoleTable)
        .where(eq(schema.workspaceRoleTable.workspaceId, workspace.id));
      expect(roleRows).toHaveLength(3);
      expect(new Set(roleRows.map((r) => r.role))).toEqual(
        new Set(["viewer", "member", "admin"]),
      );
      expect(roleRows.some((r) => r.role === "owner")).toBe(false);

      // workspace.created event published -- apps/api/src/auth.ts:405.
      expect(
        recordedEvents.some(
          (e) =>
            e.type === "workspace.created" &&
            (e.data as { workspaceId?: string }).workspaceId === workspace.id,
        ),
      ).toBe(true);

      // A DEFAULT TEAM AND ITS team_member, in the SAME request.
      //
      // `teams.enabled: true` with `teams.defaultTeam` left unset
      // (apps/api/src/auth.ts:287-291) means better-auth's own createOrganization
      // handler also writes a team named after the workspace plus a team_member row
      // for the creator. The retrofit plan's S1 row lists only the four assertions
      // above, so these two are asserted HERE, in the same oracle, rather than in a
      // test of their own: split apart, S4 could pass the headline assertions while
      // silently ceasing to write the team rows, which is the exact failure this
      // suite exists to catch.
      //
      // Plan section 3 (S9) keeps the `team` / `team_member` TABLES. Whether create
      // still populates them is a separate question, and this is where it is pinned.
      const teamRows = await db
        .select()
        .from(schema.teamTable)
        .where(eq(schema.teamTable.workspaceId, workspace.id));
      expect(teamRows).toHaveLength(1);
      const team = teamRows[0];
      if (!team) throw new Error("expected a default team row");
      expect(team.name).toBe("Acme Inc");

      const teamMemberRows = await db
        .select()
        .from(schema.teamMemberTable)
        .where(eq(schema.teamMemberTable.teamId, team.id));
      expect(teamMemberRows).toHaveLength(1);
      expect(teamMemberRows[0]?.userId).toBe(owner.user.id);
    });

    it("rejects a name that fails checkWorkspaceName before any row is written", async () => {
      // beforeCreateOrganization -- apps/api/src/auth.ts:412-417, validator
      // at apps/api/src/utils/check-workspace-name.ts (URL_PATTERN check).
      const { app } = createApp();
      const owner = await signUpUser(app);

      const response = await createWorkspaceViaPlugin(app, owner.cookie, {
        name: "Visit http://evil.example.com now",
      });
      expect(response.status).toBe(400);

      const workspaces = await db.select().from(schema.workspaceTable);
      expect(workspaces).toHaveLength(0);
    });
  });

  describe("invite", () => {
    it("creates an invitation row with status=pending", async () => {
      // invite-member -- apps/api/src/auth.ts:413-444 (sendInvitationEmail),
      // table apps/api/src/database/schema.ts:259-283 (status defaults to
      // "pending" at schema.ts:271), adapter mapping apps/api/src/auth.ts:
      // 360-365.
      const { app } = createApp();
      const owner = await signUpUser(app);
      const created = await createWorkspaceViaPlugin(app, owner.cookie);
      const workspace = (await created.json()) as { id: string };

      const inviteeEmail = `invitee-${randomUUID()}@example.com`;
      const invited = await app.request(
        "/api/auth/organization/invite-member",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: owner.cookie,
          },
          body: JSON.stringify({
            organizationId: workspace.id,
            email: inviteeEmail,
            role: "member",
          }),
        },
      );
      expect(invited.status).toBe(200);

      const invitationRows = await db
        .select()
        .from(schema.invitationTable)
        .where(eq(schema.invitationTable.workspaceId, workspace.id));
      expect(invitationRows).toHaveLength(1);
      expect(invitationRows[0]?.email).toBe(inviteeEmail.toLowerCase());
      expect(invitationRows[0]?.status).toBe("pending");
      expect(invitationRows[0]?.role).toBe("member");
      expect(invitationRows[0]?.inviterId).toBe(owner.user.id);
    });

    it("FINDING: accepts a role name that only exists as a seeded workspace_role row, not one of better-auth's own static role names", async () => {
      // better-auth's createInvitation handler treats any role not in its
      // own defaultRoles ({admin, owner, member}) plus orgOptions.roles
      // ({owner}, apps/api/src/auth.ts:331) as "unknown", then -- because
      // dynamicAccessControl.enabled is true (apps/api/src/auth.ts:332-335)
      // -- falls back to looking the name up in workspace_role for this
      // workspace. "viewer" only exists there because
      // afterCreateOrganization just seeded it. Confirmed against
      // better-auth's crud-invites.mjs createInvitation (unknownRoles /
      // dynamicAccessControl branch).
      const { app } = createApp();
      const owner = await signUpUser(app);
      const created = await createWorkspaceViaPlugin(app, owner.cookie);
      const workspace = (await created.json()) as { id: string };

      const inviteeEmail = `invitee-${randomUUID()}@example.com`;
      const invited = await app.request(
        "/api/auth/organization/invite-member",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: owner.cookie,
          },
          body: JSON.stringify({
            organizationId: workspace.id,
            email: inviteeEmail,
            role: "viewer",
          }),
        },
      );
      expect(invited.status).toBe(200);

      const invitationRows = await db
        .select()
        .from(schema.invitationTable)
        .where(eq(schema.invitationTable.email, inviteeEmail.toLowerCase()));
      expect(invitationRows).toHaveLength(1);
      expect(invitationRows[0]?.role).toBe("viewer");
    });
  });

  describe("accept", () => {
    it("creates a workspace_member row for the invitee and flips the invitation to accepted", async () => {
      // acceptInvitation (better-auth crud-invites.mjs): matches
      // invitation.email against session.user.email (case-insensitively),
      // then updates invitation.status pending -> accepted and inserts a
      // workspace_member row with role = invitation.role.
      // requireEmailVerificationOnInvitation: false (apps/api/src/auth.ts:
      // 410) means the invitee's unverified email does not block this.
      const { app } = createApp();
      const owner = await signUpUser(app);
      const created = await createWorkspaceViaPlugin(app, owner.cookie);
      const workspace = (await created.json()) as { id: string };

      const inviteeEmail = `invitee-${randomUUID()}@example.com`;
      const invited = await app.request(
        "/api/auth/organization/invite-member",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: owner.cookie,
          },
          body: JSON.stringify({
            organizationId: workspace.id,
            email: inviteeEmail,
            role: "member",
          }),
        },
      );
      const invitation = (await invited.json()) as { id: string };

      const invitee = await signUpUser(app, { email: inviteeEmail });
      const accepted = await app.request(
        "/api/auth/organization/accept-invitation",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: invitee.cookie,
          },
          body: JSON.stringify({ invitationId: invitation.id }),
        },
      );
      expect(accepted.status).toBe(200);

      const memberRows = await db
        .select()
        .from(schema.workspaceUserTable)
        .where(
          and(
            eq(schema.workspaceUserTable.workspaceId, workspace.id),
            eq(schema.workspaceUserTable.userId, invitee.user.id),
          ),
        );
      expect(memberRows).toHaveLength(1);
      expect(memberRows[0]?.role).toBe("member");

      const invitationRows = await db
        .select()
        .from(schema.invitationTable)
        .where(eq(schema.invitationTable.id, invitation.id));
      expect(invitationRows[0]?.status).toBe("accepted");
    });

    it("rejects acceptance from a signed-in user whose email does not match the invitation, and writes no membership row", async () => {
      const { app } = createApp();
      const owner = await signUpUser(app);
      const created = await createWorkspaceViaPlugin(app, owner.cookie);
      const workspace = (await created.json()) as { id: string };

      const invited = await app.request(
        "/api/auth/organization/invite-member",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: owner.cookie,
          },
          body: JSON.stringify({
            organizationId: workspace.id,
            email: `invitee-${randomUUID()}@example.com`,
            role: "member",
          }),
        },
      );
      const invitation = (await invited.json()) as { id: string };

      const stranger = await signUpUser(app);
      const accepted = await app.request(
        "/api/auth/organization/accept-invitation",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: stranger.cookie,
          },
          body: JSON.stringify({ invitationId: invitation.id }),
        },
      );
      expect(accepted.status).toBe(403);

      const memberRows = await db
        .select()
        .from(schema.workspaceUserTable)
        .where(
          and(
            eq(schema.workspaceUserTable.workspaceId, workspace.id),
            eq(schema.workspaceUserTable.userId, stranger.user.id),
          ),
        );
      expect(memberRows).toHaveLength(0);

      const invitationRows = await db
        .select()
        .from(schema.invitationTable)
        .where(eq(schema.invitationTable.id, invitation.id));
      expect(invitationRows[0]?.status).toBe("pending");
    });
  });

  describe("workspace_role create / update / delete", () => {
    it("create-role inserts a workspace_role row with the given permission JSON", async () => {
      const { app } = createApp();
      const owner = await signUpUser(app);
      const created = await createWorkspaceViaPlugin(app, owner.cookie);
      const workspace = (await created.json()) as { id: string };

      const response = await app.request("/api/auth/organization/create-role", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: owner.cookie,
        },
        body: JSON.stringify({
          organizationId: workspace.id,
          role: "readonly",
          permission: { task: ["read"] },
        }),
      });
      expect(response.status).toBe(200);

      const roleRows = await db
        .select()
        .from(schema.workspaceRoleTable)
        .where(
          and(
            eq(schema.workspaceRoleTable.workspaceId, workspace.id),
            eq(schema.workspaceRoleTable.role, "readonly"),
          ),
        );
      expect(roleRows).toHaveLength(1);
      const roleRow = roleRows[0];
      if (!roleRow) throw new Error("expected a readonly workspace_role row");
      expect(JSON.parse(roleRow.permission)).toEqual({
        task: ["read"],
      });
    });

    it("update-role overwrites the permission JSON of an existing workspace_role row", async () => {
      const { app } = createApp();
      const owner = await signUpUser(app);
      const created = await createWorkspaceViaPlugin(app, owner.cookie);
      const workspace = (await created.json()) as { id: string };

      await app.request("/api/auth/organization/create-role", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: owner.cookie },
        body: JSON.stringify({
          organizationId: workspace.id,
          role: "readonly",
          permission: { task: ["read"] },
        }),
      });

      const response = await app.request("/api/auth/organization/update-role", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: owner.cookie,
        },
        body: JSON.stringify({
          organizationId: workspace.id,
          roleName: "readonly",
          data: { permission: { task: ["read", "create"] } },
        }),
      });
      expect(response.status).toBe(200);

      const [roleRow] = await db
        .select()
        .from(schema.workspaceRoleTable)
        .where(
          and(
            eq(schema.workspaceRoleTable.workspaceId, workspace.id),
            eq(schema.workspaceRoleTable.role, "readonly"),
          ),
        );
      if (!roleRow) throw new Error("expected the readonly workspace_role row");
      expect(JSON.parse(roleRow.permission)).toEqual({
        task: ["read", "create"],
      });
    });

    it("delete-role removes the workspace_role row", async () => {
      const { app } = createApp();
      const owner = await signUpUser(app);
      const created = await createWorkspaceViaPlugin(app, owner.cookie);
      const workspace = (await created.json()) as { id: string };

      await app.request("/api/auth/organization/create-role", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: owner.cookie },
        body: JSON.stringify({
          organizationId: workspace.id,
          role: "readonly",
          permission: { task: ["read"] },
        }),
      });

      const response = await app.request("/api/auth/organization/delete-role", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: owner.cookie,
        },
        body: JSON.stringify({
          organizationId: workspace.id,
          roleName: "readonly",
        }),
      });
      expect(response.status).toBe(200);

      const roleRows = await db
        .select()
        .from(schema.workspaceRoleTable)
        .where(
          and(
            eq(schema.workspaceRoleTable.workspaceId, workspace.id),
            eq(schema.workspaceRoleTable.role, "readonly"),
          ),
        );
      expect(roleRows).toHaveLength(0);
    });

    it("FINDING: delete-role refuses to delete a seeded default role (e.g. 'admin') while it is assigned to a member -- better-auth's own 'cannot delete a pre-defined role' guard does NOT protect it", async () => {
      // better-auth's deleteOrgRole only blocks names in
      // orgOptions.roles (= {owner} here, apps/api/src/auth.ts:331), so
      // "admin"/"member"/"viewer" are NOT protected as pre-defined roles at
      // the plugin level -- only the separate "role is assigned to a
      // member" guard stops this delete. Confirmed against better-auth's
      // crud-access-control.mjs deleteOrgRole.
      const { app } = createApp();
      const owner = await signUpUser(app);
      const created = await createWorkspaceViaPlugin(app, owner.cookie);
      const workspace = (await created.json()) as { id: string };

      await inviteAndAcceptAsNewMember(
        app,
        owner.cookie,
        workspace.id,
        "admin",
      );

      const response = await app.request("/api/auth/organization/delete-role", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: owner.cookie,
        },
        body: JSON.stringify({
          organizationId: workspace.id,
          roleName: "admin",
        }),
      });
      expect(response.status).toBe(400);

      const roleRows = await db
        .select()
        .from(schema.workspaceRoleTable)
        .where(
          and(
            eq(schema.workspaceRoleTable.workspaceId, workspace.id),
            eq(schema.workspaceRoleTable.role, "admin"),
          ),
        );
      expect(roleRows).toHaveLength(1);
    });
  });

  describe("has-permission", () => {
    async function checkPermission(
      app: ReturnType<typeof createApp>["app"],
      cookie: string,
      organizationId: string,
      permissions: Record<string, string[]>,
    ): Promise<boolean> {
      const response = await app.request(
        "/api/auth/organization/has-permission",
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ organizationId, permissions }),
        },
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { success: boolean };
      // The `success` boolean IS the substantive behavior being
      // characterized here (an authorization decision), analogous to
      // asserting on an HTTP status code elsewhere in this suite -- not a
      // "response shape" that S2's /api/capabilities replacement must
      // reproduce byte-for-byte. S2 explicitly diffs the two evaluators
      // over the same fixtures rather than assuming shape equality (plan
      // §3, S2 row).
      return body.success;
    }

    // Permission matrix cross-checked against packages/permissions/src/
    // index.ts (viewer :19-25, member :27-33, admin :35-41, owner :43-49)
    // and better-auth's has-permission.mjs / permission.mjs merge logic:
    // for any role name other than "owner" (which is the only entry in
    // orgOptions.roles, apps/api/src/auth.ts:331), the workspace_role DB
    // row's JSON is merged onto an empty statement set, so it behaves as a
    // full replacement in practice.

    it("owner: workspace:delete is granted", async () => {
      const { app } = createApp();
      const owner = await signUpUser(app);
      const created = await createWorkspaceViaPlugin(app, owner.cookie);
      const workspace = (await created.json()) as { id: string };

      expect(
        await checkPermission(app, owner.cookie, workspace.id, {
          workspace: ["delete"],
        }),
      ).toBe(true);
    });

    it("admin: workspace:delete is denied but task:create is granted", async () => {
      const { app } = createApp();
      const owner = await signUpUser(app);
      const created = await createWorkspaceViaPlugin(app, owner.cookie);
      const workspace = (await created.json()) as { id: string };
      const admin = await inviteAndAcceptAsNewMember(
        app,
        owner.cookie,
        workspace.id,
        "admin",
      );

      expect(
        await checkPermission(app, admin.cookie, workspace.id, {
          workspace: ["delete"],
        }),
      ).toBe(false);
      expect(
        await checkPermission(app, admin.cookie, workspace.id, {
          task: ["create"],
        }),
      ).toBe(true);
    });

    it("member: task:create is granted but workspace:manage_settings is denied", async () => {
      const { app } = createApp();
      const owner = await signUpUser(app);
      const created = await createWorkspaceViaPlugin(app, owner.cookie);
      const workspace = (await created.json()) as { id: string };
      const member = await inviteAndAcceptAsNewMember(
        app,
        owner.cookie,
        workspace.id,
        "member",
      );

      expect(
        await checkPermission(app, member.cookie, workspace.id, {
          task: ["create"],
        }),
      ).toBe(true);
      expect(
        await checkPermission(app, member.cookie, workspace.id, {
          workspace: ["manage_settings"],
        }),
      ).toBe(false);
    });

    it("viewer: task:read is granted but task:create is denied", async () => {
      const { app } = createApp();
      const owner = await signUpUser(app);
      const created = await createWorkspaceViaPlugin(app, owner.cookie);
      const workspace = (await created.json()) as { id: string };
      const viewer = await inviteAndAcceptAsNewMember(
        app,
        owner.cookie,
        workspace.id,
        "viewer",
      );

      expect(
        await checkPermission(app, viewer.cookie, workspace.id, {
          task: ["read"],
        }),
      ).toBe(true);
      expect(
        await checkPermission(app, viewer.cookie, workspace.id, {
          task: ["create"],
        }),
      ).toBe(false);
    });

    it("custom role: only the permissions explicitly granted in its workspace_role row are allowed", async () => {
      const { app } = createApp();
      const owner = await signUpUser(app);
      const created = await createWorkspaceViaPlugin(app, owner.cookie);
      const workspace = (await created.json()) as { id: string };

      await app.request("/api/auth/organization/create-role", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: owner.cookie },
        body: JSON.stringify({
          organizationId: workspace.id,
          role: "readonly",
          permission: { task: ["read"] },
        }),
      });
      const readonly = await inviteAndAcceptAsNewMember(
        app,
        owner.cookie,
        workspace.id,
        "readonly",
      );

      expect(
        await checkPermission(app, readonly.cookie, workspace.id, {
          task: ["read"],
        }),
      ).toBe(true);
      expect(
        await checkPermission(app, readonly.cookie, workspace.id, {
          task: ["create"],
        }),
      ).toBe(false);
    });

    it("FINDING: a member whose workspace_member.role has no matching workspace_role row and is not 'owner' is denied every permission", async () => {
      // R5 in the retrofit plan: workspace_member.role is free text with no
      // FK to workspace_role (apps/api/src/database/schema.ts:169). A role
      // name that resolves to neither a static role ("owner") nor a
      // workspace_role row gets no statements at all in better-auth's
      // has-permission merge (has-permission.mjs), so every permission
      // check is denied -- a silent, undiagnosable 403 in the app's own
      // require-workspace-permission.ts, and `success: false` here.
      const { app } = createApp();
      const owner = await signUpUser(app);
      const created = await createWorkspaceViaPlugin(app, owner.cookie);
      const workspace = (await created.json()) as { id: string };
      const ghost = await signUpUser(app);
      await db.insert(schema.workspaceUserTable).values({
        workspaceId: workspace.id,
        userId: ghost.user.id,
        role: "does-not-exist-anywhere",
        joinedAt: new Date(),
      });

      expect(
        await checkPermission(app, ghost.cookie, workspace.id, {
          task: ["read"],
        }),
      ).toBe(false);
    });
  });
});
