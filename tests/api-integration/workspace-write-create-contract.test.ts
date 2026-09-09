/**
 * S4 — the NATIVE workspace create route reproduces the inherited create
 * contract. Issue #6, retrofit plan §3 (S4 row) and §2.5 (the contract).
 *
 * THE EQUIVALENCE OBLIGATION IS NINE, NOT FOUR. This file is the S1 oracle's
 * create assertions RE-POINTED at `POST /api/workspace`: the same NINE
 * observable effects — EIGHT first-order plus ONE one-hop durable consequence
 * — asserted the same way, on DATABASE STATE rather than on a response shape.
 *
 * It does not replace the S1 oracle and does not touch it. The oracle keeps
 * driving the still-mounted plugin (S4 ships dark; the client is repointed at
 * S3/S8a, not here), so after this batch BOTH paths are pinned to the same
 * nine effects — which is exactly what makes the eventual cutover checkable.
 *
 * Effect 9 is asserted as EVENTUAL via a bounded poll, never as synchronous
 * pre-response persistence (§2.5, "Timing is NOT contractual").
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { subscribeToEvent } from "../../apps/api/src/events";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import { signUpUser } from "./helpers/organization-http";
import { createWorkspaceNative } from "./helpers/workspace-write-http";

type RecordedEvent = { type: string; data: unknown };
const recordedEvents: RecordedEvent[] = [];
let eventSubscribersInitialized = false;

function initEventSubscribers() {
  if (eventSubscribersInitialized) return;
  eventSubscribersInitialized = true;
  // Subscribe to the real event bus, exactly as the S1 oracle does, rather
  // than mocking publishEvent — a mock would characterize the stand-in.
  subscribeToEvent("workspace.created", async (data) => {
    recordedEvents.push({ type: "workspace.created", data });
  });
}

beforeEach(async () => {
  await resetTestDatabase();
  recordedEvents.length = 0;
  initEventSubscribers();
});

describe("S4 native create: the NINE-effect contract (A2-P1..A2-P4)", () => {
  // A2-P1. One test on purpose, for the same reason the S1 oracle gives:
  // split apart, an implementation could pass the headline assertions while
  // silently ceasing to write one of the others.
  it("A2-P1 writes all NINE contract effects — workspace, owner workspace_member, three seeded workspace_role rows, workspace.created, a default team, its team_member, the creating session's active_organization_id and active_team_id, plus the eventual workspace_created notification", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);

    // (7)+(8) BEFORE. Capture the creating session as a ROW, so the
    // assertions afterwards are about THIS persisted session and cannot be
    // satisfied by minting a fresh one that happens to carry the workspace.
    const sessionsBefore = await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, owner.user.id));
    expect(sessionsBefore).toHaveLength(1);
    const creatingSessionId = sessionsBefore[0]?.id;
    if (!creatingSessionId) throw new Error("expected one creating session");
    expect(sessionsBefore[0]?.activeOrganizationId).toBeNull();
    expect(sessionsBefore[0]?.activeTeamId).toBeNull();

    const created = await createWorkspaceNative(app, owner.cookie, {
      name: "Acme Inc",
    });
    expect(created.status).toBe(200);
    const workspace = (await created.json()) as { id: string; slug: string };

    // (1) the workspace row
    const workspaceRows = await db
      .select()
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, workspace.id));
    expect(workspaceRows).toHaveLength(1);
    expect(workspaceRows[0]?.name).toBe("Acme Inc");
    // R8: slug is NOT NULL UNIQUE and the plugin was its only generator.
    expect(workspaceRows[0]?.slug).toBeTruthy();

    // (2) the owner workspace_member row
    const memberRows = await db
      .select()
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.workspaceId, workspace.id));
    expect(memberRows).toHaveLength(1);
    expect(memberRows[0]?.userId).toBe(owner.user.id);
    expect(memberRows[0]?.role).toBe("owner");
    expect(memberRows[0]?.joinedAt).toBeInstanceOf(Date);

    // (3) three seeded workspace_role rows, and NO owner row (R5) — owner
    // authority stays entirely in the compiled-in static role.
    const roleRows = await db
      .select()
      .from(schema.workspaceRoleTable)
      .where(eq(schema.workspaceRoleTable.workspaceId, workspace.id));
    expect(roleRows).toHaveLength(3);
    expect(new Set(roleRows.map((r) => r.role))).toEqual(
      new Set(["viewer", "member", "admin"]),
    );
    expect(roleRows.some((r) => r.role === "owner")).toBe(false);

    // (4) the workspace.created event, PAYLOAD included: effect 9 is produced
    // from exactly these fields, so a handler that published with a missing
    // ownerId would silently stop producing the notification while still
    // "publishing workspace.created".
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

    // (5)+(6) the default team and its team_member, in the SAME request.
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

    // (7)+(8) AFTER, on the SAME session row re-read by its captured id.
    const sessionsAfter = await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.id, creatingSessionId));
    expect(sessionsAfter).toHaveLength(1);
    expect(sessionsAfter[0]?.activeOrganizationId).toBe(workspace.id);
    expect(sessionsAfter[0]?.activeTeamId).toBe(team.id);

    // (9) the one-hop durable consequence, asserted as EVENTUAL.
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

  it("A2-P2 rejects a name that fails checkWorkspaceName before any row is written", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);

    const response = await createWorkspaceNative(app, owner.cookie, {
      name: "Visit http://evil.example.com now",
    });
    expect(response.status).toBe(400);

    const workspaces = await db.select().from(schema.workspaceTable);
    expect(workspaces).toHaveLength(0);
  });

  it("A2-P3 generates and dedupes a slug when none is supplied (R8)", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);

    const first = await createWorkspaceNative(app, owner.cookie, {
      name: "Acme Inc",
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { id: string; slug: string };
    expect(firstBody.slug).toBe("acme-inc");

    // Same name again: the plugin required the caller to supply a unique
    // slug; the native route must not 500 on the UNIQUE constraint.
    const second = await createWorkspaceNative(app, owner.cookie, {
      name: "Acme Inc",
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { id: string; slug: string };
    expect(secondBody.slug).not.toBe(firstBody.slug);
    expect(secondBody.slug.startsWith("acme-inc")).toBe(true);

    const rows = await db.select().from(schema.workspaceTable);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.slug)).size).toBe(2);
  });

  it("A2-P4 returns 409 — not 500 — when an explicitly supplied slug is taken, and writes nothing", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);

    const slug = `taken-${randomUUID().slice(0, 8)}`;
    const first = await createWorkspaceNative(app, owner.cookie, {
      name: "First",
      slug,
    });
    expect(first.status).toBe(200);

    const second = await createWorkspaceNative(app, owner.cookie, {
      name: "Second",
      slug,
    });
    expect(second.status).toBe(409);

    const rows = await db.select().from(schema.workspaceTable);
    expect(rows).toHaveLength(1);
    // No orphaned member/role/team rows from the refused attempt.
    expect(await db.select().from(schema.workspaceUserTable)).toHaveLength(1);
    expect(await db.select().from(schema.workspaceRoleTable)).toHaveLength(3);
    expect(await db.select().from(schema.teamTable)).toHaveLength(1);
  });

  it("A2-P4b survives a real slug race — concurrent creates of the same name all succeed with distinct slugs", async () => {
    // The generated slug is chosen by a read, so two creates in flight at
    // once can both pick it. The read cannot be made atomic; the UNIQUE
    // constraint is what decides, and losing that race must produce another
    // workspace rather than a 500. This drives it concurrently rather than
    // asserting the retry path by inspection.
    const { app } = createApp();
    const owner = await signUpUser(app);

    const responses = await Promise.all(
      Array.from({ length: 12 }, () =>
        createWorkspaceNative(app, owner.cookie, { name: "Race Condition" }),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual(Array(12).fill(200));

    const rows = await db.select().from(schema.workspaceTable);
    expect(rows).toHaveLength(12);
    expect(new Set(rows.map((r) => r.slug)).size).toBe(12);
    for (const row of rows) {
      expect(row.slug.startsWith("race-condition")).toBe(true);
    }

    // Every one of them is complete: a create that lost the race and retried
    // must still have seeded its roles and its team.
    for (const row of rows) {
      const roleRows = await db
        .select()
        .from(schema.workspaceRoleTable)
        .where(eq(schema.workspaceRoleTable.workspaceId, row.id));
      expect(roleRows).toHaveLength(3);
      const teamRows = await db
        .select()
        .from(schema.teamTable)
        .where(eq(schema.teamTable.workspaceId, row.id));
      expect(teamRows).toHaveLength(1);
    }
  });

  it("A2-P5 writes description and logo, the two columns only the plugin wrote (R8)", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);

    const created = await createWorkspaceNative(app, owner.cookie, {
      name: "With Extras",
      description: "A described workspace",
      logo: "https://cdn.example.com/logo.png",
    });
    expect(created.status).toBe(200);
    const workspace = (await created.json()) as { id: string };

    const [row] = await db
      .select()
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, workspace.id));
    expect(row?.description).toBe("A described workspace");
    expect(row?.logo).toBe("https://cdn.example.com/logo.png");
  });
});
