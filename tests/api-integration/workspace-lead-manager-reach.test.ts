/**
 * UAT re-audit (release d35d165): a workspace `lead` or `manager` is admitted by
 * resolveIdentity through the canonical workspace-scope system `role` row, but the SQL reach
 * predicate (`currentWorkspaceReachPredicate`) used to accept a legacy key only when a legacy
 * `workspace_role` row backed it. Only viewer, member and admin have that row, so a lead or
 * manager listed the triage queue and then got 404 on every submission, and was refused the
 * realtime project subscription, the workspace labels, canned responses, invitation
 * cancellation and the workspace audit log.
 *
 * The world is built the way production builds it: the lead and the manager join through the
 * real add-member route, with the six built-in canonical rows seeded the way workspace creation
 * seeds them, and NO legacy `workspace_role` row for `lead` or `manager`. The precondition is
 * asserted, so this file cannot pass on a fixture shape that hides the defect.
 */
import type { ClientRequest, IncomingMessage } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendAuditLog } from "../../apps/api/src/audit/audit-writer";
import db, { schema } from "../../apps/api/src/database";
import { createApp, createNodeServer } from "../../apps/api/src/index";
import cancelInvitation from "../../apps/api/src/invitation/controllers/cancel-invitation";
import { InvitationNotFoundError } from "../../apps/api/src/invitation/controllers/invitation-action-errors";
import { seedWorkspaceBuiltInRoles } from "../../apps/api/src/workspace/built-in-roles.repository";
import {
  initializeWebSocketAdapter,
  shutdownWebSocketAdapter,
} from "../../apps/api/src/ws";
import { authorizeNativeTopic } from "../../apps/api/src/ws/native-work-item-realtime";
import { authorizeProjectSocketRead } from "../../apps/api/src/ws/project-read-authorization";
import { personOf } from "./helpers/approval-fixtures";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceMember,
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";
import {
  type IntakeSeed,
  seedIntake,
  staffRequest,
  submissionRow,
  submitAs,
} from "./helpers/intake-http";

type Staff = Awaited<ReturnType<typeof createWorkspaceMember>>;
type World = {
  s: IntakeSeed;
  workspaceId: string;
  ref: string;
  lead: Staff;
  manager: Staff;
  /** A genuine lead of ANOTHER workspace (its own canonical rows), not of this one. */
  outsider: Staff;
  customer: IntakeSeed["customer"];
};

async function addThroughRoute(s: IntakeSeed, role: "lead" | "manager") {
  // The person's own sandbox workspace is a `member` one; the role under test is only ever
  // granted in the tenant workspace, through the real route.
  const staff = await createWorkspaceMember({ role: "member" });
  const added = await staffRequest(
    s.t,
    s.t.requester,
    `/api/workspace/${s.t.workspaceId}/members`,
    { method: "POST", body: { userId: staff.user.id, role } },
  );
  expect(added.status, await added.clone().text()).toBe(200);
  // On the project roster (the UAT lead is on SUP's roster). Project reach only: the
  // workspace predicate is the thing under test.
  await grantProjectRole(staff.user.id, s.t.project.id, [
    "project:read",
    "work_item:read",
  ]);
  return staff;
}

async function buildWorld(label: string): Promise<World> {
  const s = await seedIntake(label);
  // Workspace creation (`create-workspace.ts`) seeds the six built-in canonical rows.
  await seedWorkspaceBuiltInRoles(db, s.t.workspaceId);
  const lead = await addThroughRoute(s, "lead");
  const manager = await addThroughRoute(s, "manager");

  const outsider = await createWorkspaceMember({ role: "lead" });
  await seedWorkspaceBuiltInRoles(db, outsider.workspace.id);

  const ref = await submitAs(s, s.customer, "Lead reach check");
  return {
    s,
    workspaceId: s.t.workspaceId,
    ref,
    lead,
    manager,
    outsider,
    customer: s.customer,
  };
}

/** Production's data shape: canonical system rows only, no legacy row, no workspace membership row. */
async function expectProductionShape(world: World) {
  const legacy = await db
    .select({ role: schema.workspaceRoleTable.role })
    .from(schema.workspaceRoleTable)
    .where(
      and(
        eq(schema.workspaceRoleTable.workspaceId, world.workspaceId),
        inArray(schema.workspaceRoleTable.role, ["lead", "manager"]),
      ),
    );
  expect(legacy).toEqual([]);

  const canonical = await db
    .select({
      key: schema.roleTable.key,
      isSystem: schema.roleTable.isSystem,
    })
    .from(schema.roleTable)
    .where(
      and(
        eq(schema.roleTable.scope, "workspace"),
        eq(schema.roleTable.workspaceId, world.workspaceId),
        inArray(schema.roleTable.key, ["lead", "manager"]),
      ),
    );
  expect(canonical.sort((a, b) => a.key.localeCompare(b.key))).toEqual([
    { key: "lead", isSystem: true },
    { key: "manager", isSystem: true },
  ]);

  for (const staff of [world.lead, world.manager]) {
    const person = await personOf(staff.user.id);
    const workspaceMembership = await db
      .select({ id: schema.membershipTable.id })
      .from(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, person.id),
          eq(schema.membershipTable.scope, "workspace"),
          eq(schema.membershipTable.scopeId, world.workspaceId),
        ),
      );
    expect(workspaceMembership).toEqual([]);
  }
}

describe("workspace lead and manager reach through the canonical role row", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens a triage submission the queue lists, for a lead and a manager", async () => {
    const world = await buildWorld("lead-detail");
    await expectProductionShape(world);

    for (const staff of [world.lead, world.manager]) {
      const queue = await staffRequest(
        world.s.t,
        staff,
        `/api/submissions?workspaceId=${world.workspaceId}`,
      );
      expect(queue.status, await queue.clone().text()).toBe(200);
      expect(JSON.stringify(await queue.json())).toContain(world.ref);

      const detail = await staffRequest(
        world.s.t,
        staff,
        `/api/submissions/${world.ref}`,
      );
      expect(detail.status, await detail.clone().text()).toBe(200);
      expect(JSON.stringify(await detail.json())).toContain("Lead reach check");
    }
  });

  it("lists a submission's attachments for a lead and a manager", async () => {
    const world = await buildWorld("lead-attachments");
    const submission = await submissionRow(world.ref);
    await db.insert(schema.attachmentTable).values({
      workspaceId: world.workspaceId,
      organisationId: world.customer.orgId,
      submissionId: submission.id,
      objectKey: `workspace/${world.workspaceId}/submission/${submission.id}/attachment/a1/evidence.pdf`,
      filename: "evidence.pdf",
      mimeType: "application/pdf",
      size: 10,
      state: "ready",
      customerVisible: true,
      uploadedBy: world.customer.person.id,
    });

    for (const staff of [world.lead, world.manager]) {
      const response = await staffRequest(
        world.s.t,
        staff,
        `/api/submissions/${world.ref}/attachments`,
      );
      expect(response.status, await response.clone().text()).toBe(200);
      const files = (await response.json()) as Array<{ filename: string }>;
      expect(files.map((file) => file.filename)).toEqual(["evidence.pdf"]);
    }

    const foreign = await staffRequest(
      world.s.t,
      world.outsider,
      `/api/submissions/${world.ref}/attachments`,
    );
    expect([403, 404]).toContain(foreign.status);
    expect(await foreign.text()).not.toContain("evidence.pdf");
  });

  it("creates and reads workspace labels as a lead and a manager", async () => {
    const world = await buildWorld("lead-labels");
    for (const [index, staff] of [world.lead, world.manager].entries()) {
      const name = `Reach label ${index}`;
      const created = await staffRequest(world.s.t, staff, "/api/label", {
        method: "POST",
        body: { name, color: "#123456", workspaceId: world.workspaceId },
      });
      expect(created.status, await created.clone().text()).toBe(200);
      const { id } = (await created.json()) as { id: string };

      const listed = await staffRequest(
        world.s.t,
        staff,
        `/api/label/workspace/${world.workspaceId}`,
      );
      expect(listed.status, await listed.clone().text()).toBe(200);
      expect(JSON.stringify(await listed.json())).toContain(name);

      const single = await staffRequest(world.s.t, staff, `/api/label/${id}`);
      expect(single.status, await single.clone().text()).toBe(200);
    }

    const foreign = await staffRequest(
      world.s.t,
      world.outsider,
      `/api/label/workspace/${world.workspaceId}`,
    );
    expect(foreign.status).not.toBe(200);
    expect(await foreign.text()).not.toContain("Reach label");
  });

  it("lists canned responses for management as a manager; a lead stays capability-refused", async () => {
    const world = await buildWorld("lead-canned");
    await db.insert(schema.cannedResponseTable).values({
      workspaceId: world.workspaceId,
      name: "Workspace reply",
      body: { type: "doc", content: [] },
    });
    const path = `/api/canned-responses/manage?workspaceId=${world.workspaceId}`;

    const manager = await staffRequest(world.s.t, world.manager, path);
    expect(manager.status, await manager.clone().text()).toBe(200);
    expect(await manager.json()).toEqual([
      expect.objectContaining({ name: "Workspace reply" }),
    ]);

    // The lead reaches the workspace but holds no canned-response management capability.
    const lead = await staffRequest(world.s.t, world.lead, path);
    expect(lead.status).toBe(403);
    expect(await lead.text()).not.toContain("Workspace reply");

    const foreign = await staffRequest(world.s.t, world.outsider, path);
    expect(foreign.status).not.toBe(200);
    expect(await foreign.text()).not.toContain("Workspace reply");
  });

  it("cancels a pending staff invitation as a lead and a manager in the reach-bound repository", async () => {
    // `controllers/cancel-invitation.ts` is the only caller of the reach-bound invitation
    // statements (`findInvitationStatus`, `cancelPendingInvitation`); no route calls it today
    // (`DELETE /api/invitation/{id}` goes through the registered pending-action deletion), so it
    // is exercised directly.
    const world = await buildWorld("lead-invitations");
    const invite = async (email: string) =>
      requireRow(
        await db
          .insert(schema.invitationTable)
          .values({
            workspaceId: world.workspaceId,
            email,
            role: "member",
            status: "pending",
            expiresAt: new Date(Date.now() + 86_400_000),
            inviterId: world.s.t.requester.user.id,
          })
          .returning(),
        "reach invitation",
      );

    for (const [index, staff] of [world.lead, world.manager].entries()) {
      const sent = await invite(`reach-${index}@example.test`);
      await expect(cancelInvitation(sent.id, staff.user.id)).resolves.toEqual({
        id: sent.id,
        status: "canceled",
      });
    }

    const foreignTarget = await invite("reach-foreign@example.test");
    await expect(
      cancelInvitation(foreignTarget.id, world.outsider.user.id),
    ).rejects.toBeInstanceOf(InvitationNotFoundError);
    await expect(
      cancelInvitation(foreignTarget.id, world.customer.user.id),
    ).rejects.toBeInstanceOf(InvitationNotFoundError);
    const [row] = await db
      .select({ status: schema.invitationTable.status })
      .from(schema.invitationTable)
      .where(eq(schema.invitationTable.id, foreignTarget.id));
    expect(row?.status).toBe("pending");
  });

  it("reads the workspace audit log as a manager; a lead stays capability-refused", async () => {
    const world = await buildWorld("lead-audit");
    const seeded = await appendAuditLog(db, {
      actorId: null,
      actorType: "system",
      workspaceId: world.workspaceId,
      action: "role.created",
      entityType: "audit_log",
      entityId: world.workspaceId,
    });
    const path = `/api/workspaces/${world.workspaceId}/audit`;

    const manager = await staffRequest(world.s.t, world.manager, path);
    expect(manager.status, await manager.clone().text()).toBe(200);
    const body = (await manager.json()) as { rows: Array<{ id: string }> };
    expect(body.rows.map((row) => row.id)).toContain(seeded.id);

    const lead = await staffRequest(world.s.t, world.lead, path);
    expect(lead.status).toBe(403);

    const foreign = await staffRequest(world.s.t, world.outsider, path);
    expect(foreign.status).not.toBe(200);
  });

  it("refuses a lead of another workspace and a customer the submission detail", async () => {
    const world = await buildWorld("lead-denials");

    const foreign = await staffRequest(
      world.s.t,
      world.outsider,
      `/api/submissions/${world.ref}`,
    );
    expect(foreign.status).toBe(404);
    expect(await foreign.text()).not.toContain("Lead reach check");

    const customer = await staffRequest(
      world.s.t,
      world.customer,
      `/api/submissions/${world.ref}`,
    );
    expect(customer.status).not.toBe(200);
    expect(await customer.text()).not.toContain("Lead reach check");
  });

  it("drops the submission once the lead leaves the workspace", async () => {
    const world = await buildWorld("lead-removed");
    const before = await staffRequest(
      world.s.t,
      world.lead,
      `/api/submissions/${world.ref}`,
    );
    expect(before.status).toBe(200);

    await db
      .delete(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, world.workspaceId),
          eq(schema.workspaceUserTable.userId, world.lead.user.id),
        ),
      );
    const after = await staffRequest(
      world.s.t,
      world.lead,
      `/api/submissions/${world.ref}`,
    );
    expect(after.status).not.toBe(200);
    expect(await after.text()).not.toContain("Lead reach check");
  });

  it("authorizes the project socket topic for a lead and a manager, and refuses others", async () => {
    const world = await buildWorld("lead-socket-authz");
    const projectId = world.s.t.project.id;

    for (const staff of [world.lead, world.manager]) {
      await expect(
        authorizeProjectSocketRead({ userId: staff.user.id }, projectId),
      ).resolves.toEqual({ projectId, workspaceId: world.workspaceId });
      await expect(
        authorizeNativeTopic(
          { userId: staff.user.id, portal: "agent" },
          `project:${projectId}`,
        ),
      ).resolves.toMatchObject({ projectId, workspaceId: world.workspaceId });
    }

    // A genuine lead of another workspace, even with a stale project role row here.
    await grantProjectRole(world.outsider.user.id, projectId, [
      "project:read",
      "work_item:read",
    ]);
    await expect(
      authorizeProjectSocketRead({ userId: world.outsider.user.id }, projectId),
    ).resolves.toBeNull();
    await expect(
      authorizeProjectSocketRead({ userId: world.customer.user.id }, projectId),
    ).resolves.toBeNull();
  });
});

interface TestSocket {
  once(event: "open", listener: () => void): TestSocket;
  once(event: "error", listener: (error: Error) => void): TestSocket;
  once(
    event: "unexpected-response",
    listener: (request: ClientRequest, response: IncomingMessage) => void,
  ): TestSocket;
  once(
    event: "message",
    listener: (data: { toString(): string }) => void,
  ): TestSocket;
  once(event: "close", listener: () => void): TestSocket;
  send(data: string): void;
  close(): void;
}

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const WebSocket = apiRequire("ws") as {
  new (url: string, options: { headers: Record<string, string> }): TestSocket;
};

function openSocket(target: string, headers: Record<string, string>) {
  return new Promise<TestSocket>((resolve, reject) => {
    const socket = new WebSocket(target, { headers });
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
    socket.once("unexpected-response", (_request, response) =>
      reject(new Error(`upgrade refused: ${response.statusCode}`)),
    );
  });
}

function nextMessage(socket: TestSocket) {
  return new Promise<unknown>((resolve) =>
    socket.once("message", (data) => resolve(JSON.parse(data.toString()))),
  );
}

describe("realtime project subscription for a workspace lead and manager", () => {
  let closeServer: (() => Promise<unknown>) | undefined;

  beforeEach(async () => {
    await resetTestDatabase();
    await initializeWebSocketAdapter();
  });
  afterEach(async () => {
    await closeServer?.();
    closeServer = undefined;
    await shutdownWebSocketAdapter();
    vi.restoreAllMocks();
  });

  it("answers subscribed on the native socket for a lead and a manager, denied for another workspace's lead", async () => {
    const world = await buildWorld("lead-socket");
    await expectProductionShape(world);
    const projectId = world.s.t.project.id;
    await grantProjectRole(world.outsider.user.id, projectId, [
      "project:read",
      "work_item:read",
    ]);

    const { app } = createApp();
    const node = createNodeServer(app);
    closeServer = node.close;
    await new Promise<void>((resolve, reject) => {
      node.server.once("listening", resolve);
      node.server.once("error", reject);
    });
    const url = `ws://127.0.0.1:${(node.server.address() as AddressInfo).port}/api/ws`;
    const headers = {
      host: "localhost:1337",
      origin: "http://localhost:1337",
      cookie: "__Host-tdk_agent_session=integration-session",
    };

    const expectations: Array<[Staff, unknown]> = [
      [world.lead, { type: "subscribed", topic: `project:${projectId}` }],
      [world.manager, { type: "subscribed", topic: `project:${projectId}` }],
      [world.outsider, { type: "subscription_denied" }],
    ];
    for (const [staff, expected] of expectations) {
      mockAuthenticatedSession(staff.user);
      const socket = await openSocket(url, headers);
      const reply = nextMessage(socket);
      socket.send(
        JSON.stringify({ type: "subscribe", topic: `project:${projectId}` }),
      );
      await expect(reply).resolves.toEqual(expected);
      const closed = new Promise<void>((resolve) =>
        socket.once("close", () => resolve()),
      );
      socket.close();
      await closed;
    }
  });
});
