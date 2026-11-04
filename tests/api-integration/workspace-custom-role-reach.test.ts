/**
 * Thomas, 4 November 2026: a custom workspace role gets exactly the workspace reach its
 * canonical `role` row grants, the rule #1035 applied to lead and manager.
 *
 * resolveIdentity admits a custom `workspace_member.role` key through a non-system canonical
 * workspace-scope `role` row of the same workspace. The SQL reach predicate
 * (`currentWorkspaceReachPredicate`) used to accept a legacy key only through a system row, so
 * a custom-role holder had the capability but no reach: the triage queue listed a submission
 * and its detail answered 404, workspace labels and the realtime project subscription were
 * refused.
 *
 * The custom roles are created through the real role route (with a genuine step-up proof) and
 * assigned through the real add-member route. The production shape is asserted, so the
 * membership-table branch of the predicate cannot be what admits the holder.
 */
import type { ClientRequest, IncomingMessage } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { currentWorkspaceReachPredicate } from "../../apps/api/src/database/repositories/identity-scope.repository";
import { createApp, createNodeServer } from "../../apps/api/src/index";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
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
  submitAs,
} from "./helpers/intake-http";
import { seedMockedSessionForStepUp } from "./helpers/step-up";
import { createWorkspaceRoleNative } from "./helpers/workspace-role-write-http";

type Staff = Awaited<ReturnType<typeof createWorkspaceMember>>;
type Owner = { user: Staff["user"] };

/** The tenant's capability set for the positive custom role. */
const SUPPORT_CAPABILITIES = [
  "workspace:read",
  "intake:triage",
  "label:manage",
];
/** A custom role that reaches the workspace but lacks triage and label management. */
const READER_CAPABILITIES = ["workspace:read"];

/** Creates a custom role through the real elevated route; returns its key from the response. */
async function createCustomRole(
  app: IntakeSeed["t"]["app"],
  owner: Owner,
  workspaceId: string,
  name: string,
  capabilities: string[],
): Promise<string> {
  mockAuthenticatedSession(owner.user);
  await seedMockedSessionForStepUp(owner.user.id);
  const created = await createWorkspaceRoleNative(
    app,
    `__Host-tdk_agent_session=token-${owner.user.id}`,
    workspaceId,
    { role: name, capabilities },
  );
  expect(created.status, await created.clone().text()).toBe(200);
  const body = (await created.json()) as { role: string; isSystem: boolean };
  expect(body.isSystem).toBe(false);
  return body.role;
}

/** Adds a fresh staff person to the workspace with `roleKey` through the real route. */
async function addThroughRoute(
  s: IntakeSeed,
  owner: Owner,
  workspaceId: string,
  roleKey: string,
) {
  const staff = await createWorkspaceMember({ role: "member" });
  const added = await staffRequest(
    s.t,
    owner,
    `/api/workspace/${workspaceId}/members`,
    { method: "POST", body: { userId: staff.user.id, role: roleKey } },
  );
  expect(added.status, await added.clone().text()).toBe(200);
  return staff;
}

type World = {
  s: IntakeSeed;
  workspaceId: string;
  ref: string;
  supportKey: string;
  readerKey: string;
  support: Staff;
  reader: Staff;
  /** Holds a custom role with the same key, but in ANOTHER workspace. */
  outsider: Staff;
  outsiderWorkspaceId: string;
};

async function buildWorld(label: string): Promise<World> {
  const s = await seedIntake(label);
  const workspaceId = s.t.workspaceId;
  const owner = s.t.requester;

  const supportKey = await createCustomRole(
    s.t.app,
    owner,
    workspaceId,
    "Support desk",
    SUPPORT_CAPABILITIES,
  );
  const readerKey = await createCustomRole(
    s.t.app,
    owner,
    workspaceId,
    "Desk reader",
    READER_CAPABILITIES,
  );
  const support = await addThroughRoute(s, owner, workspaceId, supportKey);
  const reader = await addThroughRoute(s, owner, workspaceId, readerKey);
  // On the project roster: project reach only, the workspace predicate is under test.
  for (const staff of [support, reader]) {
    await grantProjectRole(staff.user.id, s.t.project.id, [
      "project:read",
      "work_item:read",
    ]);
  }

  // Another workspace with its own custom role of the SAME key, held by the outsider.
  const otherOwner = await createWorkspaceMember({ role: "owner" });
  const otherKey = await createCustomRole(
    s.t.app,
    otherOwner,
    otherOwner.workspace.id,
    "Support desk",
    SUPPORT_CAPABILITIES,
  );
  expect(otherKey).toBe(supportKey);
  const outsider = await addThroughRoute(
    s,
    otherOwner,
    otherOwner.workspace.id,
    otherKey,
  );

  const ref = await submitAs(s, s.customer, "Custom role reach check");
  return {
    s,
    workspaceId,
    ref,
    supportKey,
    readerKey,
    support,
    reader,
    outsider,
    outsiderWorkspaceId: otherOwner.workspace.id,
  };
}

/** Production's data shape: a custom canonical row, no legacy row, no workspace membership row. */
async function expectProductionShape(world: World) {
  for (const key of [world.supportKey, world.readerKey]) {
    const canonical = await db
      .select({ isSystem: schema.roleTable.isSystem })
      .from(schema.roleTable)
      .where(
        and(
          eq(schema.roleTable.scope, "workspace"),
          eq(schema.roleTable.workspaceId, world.workspaceId),
          eq(schema.roleTable.key, key),
        ),
      );
    expect(canonical).toEqual([{ isSystem: false }]);

    const legacy = await db
      .select({ role: schema.workspaceRoleTable.role })
      .from(schema.workspaceRoleTable)
      .where(
        and(
          eq(schema.workspaceRoleTable.workspaceId, world.workspaceId),
          eq(schema.workspaceRoleTable.role, key),
        ),
      );
    expect(legacy).toEqual([]);
  }

  for (const staff of [world.support, world.reader, world.outsider]) {
    const person = await personOf(staff.user.id);
    const workspaceMembership = await db
      .select({ id: schema.membershipTable.id })
      .from(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, person.id),
          eq(schema.membershipTable.scope, "workspace"),
        ),
      );
    expect(workspaceMembership).toEqual([]);
  }
}

describe("custom workspace role reach through the canonical role row", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens a triage submission the queue lists for a custom role holding intake:triage", async () => {
    const world = await buildWorld("custom-detail");
    await expectProductionShape(world);

    const queue = await staffRequest(
      world.s.t,
      world.support,
      `/api/submissions?workspaceId=${world.workspaceId}`,
    );
    expect(queue.status, await queue.clone().text()).toBe(200);
    expect(JSON.stringify(await queue.json())).toContain(world.ref);

    const detail = await staffRequest(
      world.s.t,
      world.support,
      `/api/submissions/${world.ref}`,
    );
    expect(detail.status, await detail.clone().text()).toBe(200);
    expect(JSON.stringify(await detail.json())).toContain(
      "Custom role reach check",
    );
  });

  it("refuses the submission to a custom role without intake:triage, to the same key in another workspace and to a customer", async () => {
    const world = await buildWorld("custom-denials");

    for (const path of [
      `/api/submissions?workspaceId=${world.workspaceId}`,
      `/api/submissions/${world.ref}`,
    ]) {
      const reader = await staffRequest(world.s.t, world.reader, path);
      expect(reader.status).toBe(403);
      expect(await reader.text()).not.toContain(world.ref);
    }

    const foreign = await staffRequest(
      world.s.t,
      world.outsider,
      `/api/submissions/${world.ref}`,
    );
    expect(foreign.status).toBe(404);
    expect(await foreign.text()).not.toContain("Custom role reach check");

    const customer = await staffRequest(
      world.s.t,
      world.s.customer,
      `/api/submissions/${world.ref}`,
    );
    expect(customer.status).not.toBe(200);
    expect(await customer.text()).not.toContain("Custom role reach check");
  });

  it("creates and reads workspace labels with label:manage; a reader lists but cannot create", async () => {
    const world = await buildWorld("custom-labels");

    const created = await staffRequest(world.s.t, world.support, "/api/label", {
      method: "POST",
      body: {
        name: "Custom reach label",
        color: "#123456",
        workspaceId: world.workspaceId,
      },
    });
    expect(created.status, await created.clone().text()).toBe(200);
    const { id } = (await created.json()) as { id: string };

    for (const staff of [world.support, world.reader]) {
      const listed = await staffRequest(
        world.s.t,
        staff,
        `/api/label/workspace/${world.workspaceId}`,
      );
      expect(listed.status, await listed.clone().text()).toBe(200);
      expect(JSON.stringify(await listed.json())).toContain(
        "Custom reach label",
      );
      const single = await staffRequest(world.s.t, staff, `/api/label/${id}`);
      expect(single.status, await single.clone().text()).toBe(200);
    }

    const refused = await staffRequest(world.s.t, world.reader, "/api/label", {
      method: "POST",
      body: {
        name: "Reader label",
        color: "#654321",
        workspaceId: world.workspaceId,
      },
    });
    expect(refused.status).toBe(403);
    const readerLabels = await db
      .select({ id: schema.labelTable.id })
      .from(schema.labelTable)
      .where(eq(schema.labelTable.name, "Reader label"));
    expect(readerLabels).toEqual([]);

    const foreign = await staffRequest(
      world.s.t,
      world.outsider,
      `/api/label/workspace/${world.workspaceId}`,
    );
    expect(foreign.status).not.toBe(200);
    expect(await foreign.text()).not.toContain("Custom reach label");
  });

  it("authorizes the project socket topic for a custom role holder and refuses the same key in another workspace", async () => {
    const world = await buildWorld("custom-socket-authz");
    const projectId = world.s.t.project.id;

    await expect(
      authorizeProjectSocketRead({ userId: world.support.user.id }, projectId),
    ).resolves.toEqual({ projectId, workspaceId: world.workspaceId });
    await expect(
      authorizeNativeTopic(
        { userId: world.support.user.id, portal: "agent" },
        `project:${projectId}`,
      ),
    ).resolves.toMatchObject({ projectId, workspaceId: world.workspaceId });

    // Even with a stale project role row here.
    await grantProjectRole(world.outsider.user.id, projectId, [
      "project:read",
      "work_item:read",
    ]);
    await expect(
      authorizeProjectSocketRead({ userId: world.outsider.user.id }, projectId),
    ).resolves.toBeNull();
    await expect(
      authorizeProjectSocketRead(
        { userId: world.s.customer.user.id },
        projectId,
      ),
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

describe("realtime project subscription for a custom workspace role", () => {
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

  it("answers subscribed for the custom role holder, denied for the same key in another workspace", async () => {
    const world = await buildWorld("custom-socket");
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
      [world.support, { type: "subscribed", topic: `project:${projectId}` }],
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

/* ------------------------------------------------------------------ *
 * resolveIdentity and currentWorkspaceReachPredicate parity
 * ------------------------------------------------------------------ */

/** Evaluates the SQL predicate for `workspaceId` the way the repositories embed it. */
async function predicateAdmits(
  identity: ResolvedIdentity,
  workspaceId: string,
): Promise<boolean> {
  const [row] = await db
    .select({
      reach: sql<boolean>`${currentWorkspaceReachPredicate(identity, schema.workspaceTable.id)}`,
    })
    .from(schema.workspaceTable)
    .where(eq(schema.workspaceTable.id, workspaceId));
  return row?.reach === true;
}

/** Does a fresh resolveIdentity grant a workspace-scope role in `workspaceId`? */
async function resolverAdmits(
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const identity = await resolveIdentity({ userId, credential: "session" });
  return (
    identity?.authority.some(
      (grant) => grant.scope === "workspace" && grant.scopeId === workspaceId,
    ) ?? false
  );
}

/**
 * The identity a request resolved earlier (stale), carrying the workspace grant for `roleKey`:
 * the predicate's own job is to re-check that grant against the CURRENT rows. Without the grant
 * the predicate would be trivially false and parity would prove nothing.
 */
async function identityHolding(
  userId: string,
  workspaceId: string,
  roleKey: string,
): Promise<ResolvedIdentity> {
  const base = requireRow(
    [await resolveIdentity({ userId, credential: "session" })].filter(
      (identity): identity is ResolvedIdentity => identity !== null,
    ),
    "staff identity",
  );
  return {
    ...base,
    authority: [
      {
        roleKey,
        scope: "workspace",
        scopeId: workspaceId,
        rank: 1,
        capabilities: ["workspace:read"],
      },
    ],
  };
}

async function setMemberRole(
  workspaceId: string,
  userId: string,
  role: string,
) {
  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId,
    role,
    joinedAt: new Date(),
  });
}

async function plantLegacySystemRow(workspaceId: string, role: string) {
  const now = new Date();
  await db.insert(schema.workspaceRoleTable).values({
    workspaceId,
    role,
    permission: JSON.stringify({ workspace: ["read"] }),
    isSystem: true,
    createdAt: now,
    updatedAt: now,
  });
}

function canonicalRow(workspaceId: string, key: string) {
  return and(
    eq(schema.roleTable.scope, "workspace"),
    eq(schema.roleTable.workspaceId, workspaceId),
    eq(schema.roleTable.key, key),
  );
}

async function insertCustomRow(
  workspaceId: string,
  key: string,
  capabilities: unknown = ["workspace:read"],
) {
  await db.insert(schema.roleTable).values({
    scope: "workspace",
    workspaceId,
    key,
    name: key,
    rank: 10,
    capabilities: sql`${JSON.stringify(capabilities)}::jsonb`,
    isSystem: false,
    isEditable: true,
  });
}

type ParityCase = {
  name: string;
  key: string;
  /** Shapes the role rows of a fresh workspace `w` (built-ins seeded) and another `other`. */
  arrange: (w: string, other: string) => Promise<void>;
  expected: boolean;
};

const parityCases: ParityCase[] = [
  {
    name: "system key with only its canonical row (lead)",
    key: "lead",
    arrange: async () => {},
    expected: true,
  },
  {
    name: "system key with canonical and legacy system rows (member)",
    key: "member",
    arrange: (w) => plantLegacySystemRow(w, "member"),
    expected: true,
  },
  {
    name: "system key with only a legacy system row (member, no canonical row)",
    key: "member",
    arrange: async (w) => {
      await plantLegacySystemRow(w, "member");
      await db.delete(schema.roleTable).where(canonicalRow(w, "member"));
    },
    expected: true,
  },
  {
    name: "malformed canonical row is refused even with a legacy system row (member)",
    key: "member",
    arrange: async (w) => {
      await plantLegacySystemRow(w, "member");
      await db
        .update(schema.roleTable)
        .set({ capabilities: sql`'["workspace:read", 1]'::jsonb` })
        .where(canonicalRow(w, "member"));
    },
    expected: false,
  },
  {
    name: "non-array canonical capabilities are refused (lead)",
    key: "lead",
    arrange: async (w) => {
      await db
        .update(schema.roleTable)
        .set({ capabilities: sql`'{"workspace:read": true}'::jsonb` })
        .where(canonicalRow(w, "lead"));
    },
    expected: false,
  },
  {
    name: "built-in key on a custom canonical row is refused even with a legacy system row (member)",
    key: "member",
    arrange: async (w) => {
      await plantLegacySystemRow(w, "member");
      await db
        .update(schema.roleTable)
        .set({ isSystem: false })
        .where(canonicalRow(w, "member"));
    },
    expected: false,
  },
  {
    name: "custom key with a valid custom canonical row",
    key: "support-desk",
    arrange: (w) => insertCustomRow(w, "support-desk"),
    expected: true,
  },
  {
    name: "custom key with malformed capabilities",
    key: "support-desk",
    arrange: (w) =>
      insertCustomRow(w, "support-desk", ["workspace:read", { bad: 1 }]),
    expected: false,
  },
  {
    name: "custom key whose canonical row lives only in another workspace",
    key: "support-desk",
    arrange: (_w, other) => insertCustomRow(other, "support-desk"),
    expected: false,
  },
  {
    name: "custom key backed only by a legacy system row (no canonical row)",
    key: "support-desk",
    arrange: (w) => plantLegacySystemRow(w, "support-desk"),
    expected: false,
  },
  {
    name: "non-workspace built-in key (customer) even with a legacy system row",
    key: "customer",
    arrange: (w) => plantLegacySystemRow(w, "customer"),
    expected: false,
  },
];

describe("resolveIdentity and currentWorkspaceReachPredicate agree", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  for (const parity of parityCases) {
    it(parity.name, async () => {
      // Each case gets fresh workspaces with the six built-in canonical rows seeded.
      const { workspace } = await createWorkspaceMember({ role: "owner" });
      const { workspace: other } = await createWorkspaceMember({
        role: "owner",
      });
      const subject = await createWorkspaceMember({ role: "member" });
      await parity.arrange(workspace.id, other.id);
      await setMemberRole(workspace.id, subject.user.id, parity.key);

      const resolved = await resolverAdmits(subject.user.id, workspace.id);
      const predicate = await predicateAdmits(
        await identityHolding(subject.user.id, workspace.id, parity.key),
        workspace.id,
      );
      expect({ resolved, predicate }).toEqual({
        resolved: parity.expected,
        predicate: parity.expected,
      });
    });
  }

  it("owner reach is unchanged, even with a malformed canonical owner row", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    await db
      .update(schema.roleTable)
      .set({ capabilities: sql`'[1]'::jsonb` })
      .where(canonicalRow(owner.workspace.id, "owner"));

    expect(await resolverAdmits(owner.user.id, owner.workspace.id)).toBe(true);
    expect(
      await predicateAdmits(
        await identityHolding(owner.user.id, owner.workspace.id, "owner"),
        owner.workspace.id,
      ),
    ).toBe(true);
  });

  it("instance-admin reach is unchanged and a customer identity never reaches a workspace", async () => {
    const { workspace } = await createWorkspaceMember({ role: "owner" });
    const admin = await createWorkspaceMember({ role: "member" });
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, admin.user.id));
    const adminIdentity = requireRow(
      [
        await resolveIdentity({ userId: admin.user.id, credential: "session" }),
      ].filter((identity): identity is ResolvedIdentity => identity !== null),
      "instance admin identity",
    );
    expect(adminIdentity.reach.kind).toBe("all");
    expect(await predicateAdmits(adminIdentity, workspace.id)).toBe(true);

    const s = await seedIntake("custom-parity-customer");
    const customerIdentity = requireRow(
      [
        await resolveIdentity({
          userId: s.customer.user.id,
          credential: "session",
        }),
      ].filter((identity): identity is ResolvedIdentity => identity !== null),
      "customer identity",
    );
    expect(customerIdentity.side).toBe("customer");
    expect(
      await predicateAdmits(
        {
          ...customerIdentity,
          authority: [
            {
              roleKey: "owner",
              scope: "workspace",
              scopeId: s.t.workspaceId,
              rank: 1,
              capabilities: [],
            },
          ],
        },
        s.t.workspaceId,
      ),
    ).toBe(false);
  });
});
