/**
 * S1 — characterization of the inherited better-auth `organization()` plugin.
 * Issue #6, retrofit plan step S1.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EXECUTED GREEN — the S1 suite is 24/24 against a real PostgreSQL 18
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Every assertion in this file has run. **THIS FILE holds 20 tests; the S1
 * SUITE is 24 passed / 4 files / 0 failed / 0 skipped** against a real
 * database, migrated from scratch — 20 here, 1 in the rate-limit file, 2 in
 * the abuse-guards file, 1 in the active-session file.
 *
 * Both numbers are stated on purpose. An earlier header said "the suite is 20"
 * while 20 was, by coincidence, this file's OWN count — so a reader who counted
 * `it()` blocks here found 20 and concluded the header was right. It was not.
 *
 * That is what makes this an oracle: each assertion pins DATABASE STATE the
 * live plugin actually writes, not a claim about what it should write.
 *
 * The earlier header said the opposite — "not one assertion has executed",
 * "do not treat this file as an oracle" — and stayed that way after the green
 * run, because the commit that executed the suite touched the two files it had
 * to change and not this one. It is corrected rather than quietly dropped.
 *
 * **S2 is still not started, and a green oracle is not permission to start it.**
 *
 * BASELINE — and this is the second correction. This file used to say the branch
 * was cut from #16 (`feat/p0-remove-inherited-surfaces`) rather than from `main`,
 * and warned that "if #16's head moves or #16 merges, this branch must be
 * semantically rebased and the characterization surface re-inspected — a stale
 * plugin baseline here is worse than none, because it would silently certify the
 * wrong behaviour."
 *
 * #16 merged, as `b75cf02`. The warning was acted on: this branch was rebuilt
 * from that merge and carries **only** these five files, and every surface these
 * assertions characterize was re-inspected against it. `apps/api/src/auth.ts`,
 * `apps/api/src/database/schema.ts` and `apps/api/src/events/index.ts` are all
 * byte-identical to the tree this file was written against, so the plugin
 * baseline did not move. `organization()` is still mounted, and it is still the
 * one entry on `better-auth-plugins-pending-removal.json`.
 *
 * LINE CITATIONS. Re-verified against `main` at `b75cf02`, not assumed. The
 * `auth.ts` and `schema.ts` addresses hold exactly, because those two files did
 * not change. FOUR citations did move and are corrected below — three found in
 * the first sweep and a fourth when F3 was closed, which is the same
 * completeness claim F3 flagged, wrong again by one until now. #21 relocated
 * the legacy better-auth access-control module out of
 * `packages/permissions/src/index.ts` into
 * `packages/permissions/src/legacy-better-auth-access-control.ts`. `index.ts`
 * still re-exports `DEFAULT_ROLE_NAMES`, so no import here changed — only the
 * prose addresses were stale.
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
  nextClientIp,
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
// EXECUTED: the S1 suite is 24 passed / 4 files / 0 failed / 0 skipped against
// a real PostgreSQL 18, migrated from scratch; 20 of those 24 live in this file. Every assertion below was ALSO derived by reading
// apps/api/src/auth.ts, apps/api/src/database/schema.ts,
// packages/permissions/src/legacy-better-auth-access-control.ts and the
// better-auth organization plugin's own source (crud-org.mjs, crud-invites.mjs,
// crud-access-control.mjs, has-permission.mjs) -- so a failure here means the
// plugin changed, not that the fixture drifted. See the report for file:line
// citations per assertion.

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
    // THE ORACLE. NINE observable contract effects of one plugin create call:
    // EIGHT first-order create effects, plus ONE one-hop durable event
    // consequence. All in one test on purpose -- S4 replaces this route and
    // must reproduce ALL of them. Split apart, S4 could pass the headline
    // assertions while silently ceasing to write one of the others.
    //
    // The count is DERIVED, not asserted. It was wrong three times (the plan
    // says four; S1 first found six; the review at 9a1eb4e found a seventh; the
    // review at f3ce193 found an eighth) because every round read one step
    // further down the same call stack. It is now closed by TWO independent
    // methods: reading the whole create path, AND diffing every row count in
    // all 29 public tables around one successful create. The second method is
    // what found effect 9 -- it is not in the create stack at all.
    //
    // SOURCE LEDGER -- FIRST-ORDER (1-8), performed by the create stack, its
    // configured hooks and its adapter calls:
    //
    //   1 workspace row              crud-org.mjs:74  -> adapter.mjs:40
    //   2 owner workspace_member     crud-org.mjs:100 -> adapter.mjs:185
    //   3 three workspace_role rows  apps/api/src/auth.ts:395 (afterCreateOrganization),
    //                                names from DEFAULT_ROLE_NAMES; no owner row (R5)
    //   4 workspace.created event    apps/api/src/auth.ts:405 -> events/index.ts:35
    //   5 default team row           crud-org.mjs:126 -> adapter.mjs:383
    //   6 creator team_member row    crud-org.mjs:127 -> adapter.mjs:515
    //   7 session active_organization_id
    //                                crud-org.mjs:142 -> adapter.mjs:294
    //                                -> internal-adapter.mjs:318 (updateSession)
    //   8 session active_team_id     crud-org.mjs:143 -> adapter.mjs:463
    //                                -> internal-adapter.mjs:318 (updateSession)
    //
    // Effects 5 and 6 run because `teams.enabled: true` with `teams.defaultTeam`
    // left unset (apps/api/src/auth.ts:287-291) satisfies crud-org.mjs:106's
    // `teams.enabled && defaultTeam?.enabled !== false` -- `undefined !== false`
    // is true.
    //
    // THE keepCurrentActiveOrganization GATE. Effects 7 and 8 are BOTH
    // conditional on the inherited request flag (crud-org.mjs:18, stripped from
    // the org data at :63) being absent or false, and effect 8 additionally
    // requires a truthy `teamMember` -- the same object that produced effects 5
    // and 6, so TaskDesk's configuration guarantees it. This oracle pins the
    // DEFAULT request: the flag is not sent. `keepCurrentActiveOrganization:
    // true` is deliberately NOT characterized here.
    //
    // Effects 7 and 8 were each unasserted until a review found them (F11, then
    // F12). An S4 handler that omitted either would leave a user who has just
    // created their first workspace with no active workspace or no active team,
    // and no error -- while the whole suite stayed green. Thomas's scope
    // decision for both: PRESERVED by the native replacement through S4-S7. If
    // S9 later removes or redesigns team semantics, that is a separate explicit
    // divergence at S9, not a silent drop during S4.
    //
    // SOURCE LEDGER -- ONE-HOP DURABLE CONSEQUENCE (9):
    //
    //   9 notification row, type=workspace_created
    //        apps/api/src/auth.ts:405 publishEvent("workspace.created")
    //     -> apps/api/src/events/index.ts:35 EventEmitter dispatch
    //     -> apps/api/src/notification/index.ts:167 subscriber
    //     -> apps/api/src/notification/controllers/create-notification.ts:48
    //        db.insert(notificationTable)
    //
    // It is unconditional here: auth.ts:405 always passes ownerId, satisfying
    // the subscriber's `if (data.ownerId)` guard, and createNotification maps
    // only task_*/due_date_* types to a preference key -- "workspace_created"
    // maps to null, so there is no preference lookup and no early return.
    //
    // TIMING IS NOT CONTRACTUAL. The notification consequence is EVENTUAL. On
    // the inherited implementation the row currently lands before the response
    // because additional awaited database round-trips follow workspace.created
    // (setActiveOrganization and setActiveTeam, crud-org.mjs:142-143), but that
    // ordering is INCIDENTAL and is not part of the replacement contract.
    // publishEvent uses EventEmitter dispatch and does not await the async
    // subscriber's promise, so S4 may legitimately do less work after
    // publishing. This oracle therefore polls within a bounded wait and must
    // NOT be read as requiring synchronous persistence before the HTTP
    // response.
    //
    // WHERE THE CONTRACT STOPS. Effect 9 is the one hop from the asserted
    // event. Everything downstream of the notification row belongs to the
    // notification subsystem and is EXCLUDED here:
    //   - notification.created event  (create-notification.ts:63) -- downstream of 9
    //   - deliverNotification(...)    (create-notification.ts:66) -- delivery concern
    //   - email / webhook / push delivery                          -- delivery concern
    // Also excluded, with reasons:
    //   - session.updated_at bumping: a generic consequence of updating the row
    //     at all (Drizzle $onUpdate, apps/api/src/database/schema.ts:53-55), not
    //     a separate create-path decision
    //   - the secondaryStorage session mirror (internal-adapter.mjs:322-345):
    //     unreachable -- no secondaryStorage is configured
    //   - beforeAddMember / afterAddMember / beforeCreateTeam / afterCreateTeam:
    //     unreachable -- not configured in apps/api/src/auth.ts
    //   - session databaseHooks: none exist (auth.ts:523 declares only
    //     user.create.before / user.create.after)
    //   - reads on the path (getSessionFromCtx, findUserById, listOrganizations,
    //     findOrganizationBySlug, the role-seed SELECT): no persistence effect
    //   - rate-limit rows: none -- no `storage` is configured, so the limiter
    //     uses better-auth's in-memory store
    // Unclassified create-path writes or events: 0.
    it("create writes all NINE contract effects -- EIGHT first-order (workspace, owner workspace_member, 3 seeded workspace_role rows, workspace.created, a default team, its team_member, the creating session's active_organization_id and its active_team_id) plus ONE one-hop durable consequence (the workspace_created notification, asserted as eventual)", async () => {
      const { app } = createApp();
      const owner = await signUpUser(app);

      // (7)+(8) BEFORE. Capture the creating session as a ROW, not as a user:
      // the assertions after create have to be about THIS persisted session, so
      // a future implementation cannot satisfy them by minting a fresh session
      // that happens to carry the workspace or the team.
      const sessionsBefore = await db
        .select()
        .from(schema.sessionTable)
        .where(eq(schema.sessionTable.userId, owner.user.id));
      expect(sessionsBefore).toHaveLength(1);
      const creatingSessionId = sessionsBefore[0]?.id;
      if (!creatingSessionId) throw new Error("expected one creating session");
      expect(sessionsBefore[0]?.activeOrganizationId).toBeNull();
      expect(sessionsBefore[0]?.activeTeamId).toBeNull();

      const created = await createWorkspaceViaPlugin(app, owner.cookie, {
        name: "Acme Inc",
      });
      expect(created.status).toBe(200);
      const workspace = (await created.json()) as { id: string };

      // workspace row -- schema mapping apps/api/src/auth.ts:292-303,
      // adapter model map apps/api/src/auth.ts:157-172, table
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
      // workspaceId and createdAt -> joinedAt (apps/api/src/auth.ts:304-310),
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
      // apps/api/src/auth.ts:369-411 (seed loop at :385-393), names from
      // DEFAULT_ROLE_NAMES = ["viewer", "member", "admin"] --
      // packages/permissions/src/legacy-better-auth-access-control.ts:78.
      // "owner" is deliberately never seeded (same file, :73-78; this is R5 in
      // the
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

      // (4) workspace.created event published -- apps/api/src/auth.ts:405.
      // The PAYLOAD is the contract at the event-bus boundary, not merely that
      // an event fired: effect 9 below is produced from these exact fields, and
      // an S4 handler that published the event with a missing ownerId would
      // silently stop producing the notification while still "publishing
      // workspace.created".
      const createdEvents = recordedEvents.filter(
        (e) =>
          e.type === "workspace.created" &&
          (e.data as { workspaceId?: string }).workspaceId === workspace.id,
      );
      expect(createdEvents).toHaveLength(1);
      const createdPayload = createdEvents[0]?.data as {
        workspaceId?: string;
        workspaceName?: string;
        ownerId?: string;
      };
      expect(createdPayload.workspaceId).toBe(workspace.id);
      expect(createdPayload.workspaceName).toBe("Acme Inc");
      expect(createdPayload.ownerId).toBe(owner.user.id);

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

      // (7)+(8) AFTER. The SAME session row, re-read by its captured id:
      // active_organization_id null -> the new workspace id, and
      // active_team_id null -> the new team id. Deliberately not "some session
      // has it", not "a fresh login gets it", not "a second session has it",
      // not "the response says so" -- both transitions on the one row that
      // already existed before the call.
      const sessionsAfter = await db
        .select()
        .from(schema.sessionTable)
        .where(eq(schema.sessionTable.id, creatingSessionId));
      expect(sessionsAfter).toHaveLength(1);
      expect(sessionsAfter[0]?.id).toBe(creatingSessionId);
      expect(sessionsAfter[0]?.activeOrganizationId).toBe(workspace.id);
      expect(sessionsAfter[0]?.activeTeamId).toBe(team.id);

      // (9) The ONE-HOP DURABLE CONSEQUENCE, asserted as EVENTUAL. Bounded
      // poll, not a fixed sleep and not "any notification exists": the
      // predicate is this create's exact notification identity, so the test
      // fails deterministically if the row never arrives. See the timing note
      // in the comment above -- immediate visibility is NOT asserted.
      const findNotification = () =>
        db
          .select()
          .from(schema.notificationTable)
          .where(
            and(
              eq(schema.notificationTable.userId, owner.user.id),
              eq(schema.notificationTable.type, "workspace_created"),
              eq(schema.notificationTable.resourceId, workspace.id),
            ),
          );
      const notificationDeadline = Date.now() + 5_000;
      let notifications = await findNotification();
      while (notifications.length === 0 && Date.now() < notificationDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        notifications = await findNotification();
      }
      expect(notifications).toHaveLength(1);
      expect(notifications[0]?.resourceType).toBe("workspace");
      expect(
        (notifications[0]?.eventData as { workspaceName?: string } | null)
          ?.workspaceName,
      ).toBe("Acme Inc");
    });

    it("rejects a name that fails checkWorkspaceName before any row is written", async () => {
      // beforeCreateOrganization -- apps/api/src/auth.ts:363-368, validator
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
      // table apps/api/src/database/schema.ts:212-236 (status defaults to
      // "pending" at schema.ts:224), adapter mapping apps/api/src/auth.ts:
      // 311-316.
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
            // F8: a distinct client per invitation. These stand for different
            // admins; modelling them as one caller spends the 5/60s invite
            // budget that belongs to the R1 characterization, and a 429 here
            // would be attributed to whichever test happened to run sixth.
            "x-forwarded-for": nextClientIp(),
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
      // ({owner}, apps/api/src/auth.ts:282) as "unknown", then -- because
      // dynamicAccessControl.enabled is true (apps/api/src/auth.ts:283-286)
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
            // F8: a distinct client per invitation. These stand for different
            // admins; modelling them as one caller spends the 5/60s invite
            // budget that belongs to the R1 characterization, and a 429 here
            // would be attributed to whichever test happened to run sixth.
            "x-forwarded-for": nextClientIp(),
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

    // F7: the positive case above cannot distinguish "dynamicAccessControl is
    // on AND a matching workspace_role row exists" from "arbitrary role strings
    // are accepted". Without these two negatives, an S4-S7 route that took any
    // free-text role on invitation would keep the whole suite green -- a real
    // loss of constraint on the retrofit. Both semantics probed live.

    it("rejects an UNKNOWN role that has no workspace_role row -- ROLE_NOT_FOUND", async () => {
      const { app } = createApp();
      const owner = await signUpUser(app);
      const created = await createWorkspaceViaPlugin(app, owner.cookie);
      const workspace = (await created.json()) as { id: string };

      const inviteeEmail = `unknown-role-${randomUUID()}@example.com`;
      const invited = await app.request(
        "/api/auth/organization/invite-member",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: owner.cookie,
            "x-forwarded-for": nextClientIp(),
          },
          body: JSON.stringify({
            organizationId: workspace.id,
            email: inviteeEmail,
            role: "totally-unknown-role",
          }),
        },
      );
      expect(invited.status).toBe(400);
      // The plugin names the rejected role in the message; there is no `code`
      // field on this one, unlike the delete-role guards above.
      expect(await invited.json()).toMatchObject({
        message: "ROLE_NOT_FOUND: totally-unknown-role",
      });

      // Nothing was written.
      const invitationRows = await db
        .select()
        .from(schema.invitationTable)
        .where(eq(schema.invitationTable.email, inviteeEmail.toLowerCase()));
      expect(invitationRows).toHaveLength(0);
    });

    it("rejects 'viewer' itself once its workspace_role ROW is removed -- proving the row, not the name, is the prerequisite", async () => {
      // The sharpest form of the boundary. Same role name that succeeds above,
      // now rejected, with only the row's existence changed. That is what
      // separates the dynamic-access-control lookup from a name allowlist.
      const { app } = createApp();
      const owner = await signUpUser(app);
      const created = await createWorkspaceViaPlugin(app, owner.cookie);
      const workspace = (await created.json()) as { id: string };

      const deleted = await app.request("/api/auth/organization/delete-role", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: owner.cookie },
        body: JSON.stringify({
          organizationId: workspace.id,
          roleName: "viewer",
        }),
      });
      expect(deleted.status).toBe(200);

      const inviteeEmail = `no-viewer-row-${randomUUID()}@example.com`;
      const invited = await app.request(
        "/api/auth/organization/invite-member",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: owner.cookie,
            "x-forwarded-for": nextClientIp(),
          },
          body: JSON.stringify({
            organizationId: workspace.id,
            email: inviteeEmail,
            role: "viewer",
          }),
        },
      );
      expect(invited.status).toBe(400);
      expect(await invited.json()).toMatchObject({
        message: "ROLE_NOT_FOUND: viewer",
      });

      const invitationRows = await db
        .select()
        .from(schema.invitationTable)
        .where(eq(schema.invitationTable.email, inviteeEmail.toLowerCase()));
      expect(invitationRows).toHaveLength(0);
    });
  });

  describe("accept", () => {
    it("creates a workspace_member row for the invitee and flips the invitation to accepted", async () => {
      // acceptInvitation (better-auth crud-invites.mjs): matches
      // invitation.email against session.user.email (case-insensitively),
      // then updates invitation.status pending -> accepted and inserts a
      // workspace_member row with role = invitation.role.
      // requireEmailVerificationOnInvitation: false (apps/api/src/auth.ts:361)
      // means the invitee's unverified email does not block this. :410 is the
      // close of the publishEvent call, not this option.
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
            // F8: a distinct client per invitation. These stand for different
            // admins; modelling them as one caller spends the 5/60s invite
            // budget that belongs to the R1 characterization, and a 429 here
            // would be attributed to whichever test happened to run sixth.
            "x-forwarded-for": nextClientIp(),
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
            // F8: a distinct client per invitation. These stand for different
            // admins; modelling them as one caller spends the 5/60s invite
            // budget that belongs to the R1 characterization, and a 429 here
            // would be attributed to whichever test happened to run sixth.
            "x-forwarded-for": nextClientIp(),
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

    // F6: the two guards better-auth applies here BOTH return 400, so status
    // alone cannot tell them apart -- and the finding this suite records is
    // precisely that the pre-defined guard does NOT protect the seeded roles.
    // Asserting only `status === 400` would stay green under an implementation
    // that DID pre-defined-protect `admin`, which is the opposite of what the
    // title claims. All three cases are pinned on their exact semantic, probed
    // against the live plugin rather than assumed.

    it("delete-role SUCCEEDS on an UNASSIGNED seeded role ('viewer') and removes the row", async () => {
      const { app } = createApp();
      const owner = await signUpUser(app);
      const created = await createWorkspaceViaPlugin(app, owner.cookie);
      const workspace = (await created.json()) as { id: string };

      const response = await app.request("/api/auth/organization/delete-role", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: owner.cookie },
        body: JSON.stringify({
          organizationId: workspace.id,
          roleName: "viewer",
        }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true });

      // The row is really gone -- this is the case that proves the two
      // refusals below are refusals, not a blanket "delete-role never works".
      const roleRows = await db
        .select()
        .from(schema.workspaceRoleTable)
        .where(
          and(
            eq(schema.workspaceRoleTable.workspaceId, workspace.id),
            eq(schema.workspaceRoleTable.role, "viewer"),
          ),
        );
      expect(roleRows).toHaveLength(0);
    });

    it("delete-role refuses 'owner' via the PRE-DEFINED guard -- CANNOT_DELETE_A_PRE_DEFINED_ROLE", async () => {
      // `owner` is the only entry in orgOptions.roles (apps/api/src/auth.ts:282),
      // so it is the only name better-auth's deleteOrgRole treats as
      // pre-defined. Confirmed against better-auth's crud-access-control.mjs.
      const { app } = createApp();
      const owner = await signUpUser(app);
      const created = await createWorkspaceViaPlugin(app, owner.cookie);
      const workspace = (await created.json()) as { id: string };

      const response = await app.request("/api/auth/organization/delete-role", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: owner.cookie },
        body: JSON.stringify({
          organizationId: workspace.id,
          roleName: "owner",
        }),
      });
      expect(response.status).toBe(400);
      // The CODE, not just the status. This is what ties owner's refusal to the
      // pre-defined guard specifically.
      expect(await response.json()).toMatchObject({
        code: "CANNOT_DELETE_A_PRE_DEFINED_ROLE",
      });
    });

    it("FINDING: delete-role refuses an ASSIGNED seeded role ('admin') via the ASSIGNMENT guard -- ROLE_IS_ASSIGNED_TO_MEMBERS, NOT the pre-defined guard", async () => {
      // The finding: "admin"/"member"/"viewer" are NOT pre-defined-protected at
      // the plugin level -- only the separate "role is assigned to a member"
      // check stops this delete. The distinct code is the whole evidence: if a
      // future implementation pre-defined-protected `admin`, the status would
      // still be 400 but the code would become
      // CANNOT_DELETE_A_PRE_DEFINED_ROLE and this test would fail, which is the
      // point. Compare with the 'viewer' case above, where the same seeded role
      // deletes cleanly once nobody holds it.
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
        headers: { "content-type": "application/json", cookie: owner.cookie },
        body: JSON.stringify({
          organizationId: workspace.id,
          roleName: "admin",
        }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: "ROLE_IS_ASSIGNED_TO_MEMBERS",
      });

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
    // legacy-better-auth-access-control.ts (viewer :37-43, member :45-51,
    // admin :53-59, owner :61-67). #21 moved these definitions out of
    // index.ts, which is now a re-export barrel: its :19-49 is plugin-list,
    // capability and elevated-action exports and defines no role at all
    // and better-auth's has-permission.mjs / permission.mjs merge logic:
    // for any role name other than "owner" (which is the only entry in
    // orgOptions.roles, apps/api/src/auth.ts:282), the workspace_role DB
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
