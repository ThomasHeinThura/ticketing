import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fault = vi.hoisted(() => ({ failApprovalDecisionEvent: false }));

vi.mock("../../apps/api/src/notification/fanout", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../apps/api/src/notification/fanout")
    >();
  return {
    ...actual,
    enqueueNotificationEvent: vi.fn(
      async (...args: Parameters<typeof actual.enqueueNotificationEvent>) => {
        if (
          fault.failApprovalDecisionEvent &&
          args[1].kind === "approval.decided"
        )
          throw new Error("injected approval event failure");
        return actual.enqueueNotificationEvent(...args);
      },
    ),
  };
});

import {
  evaluatePolicy,
  reaches,
  workItemScopeFromRow,
} from "@taskdesk/permissions";
import {
  hasApprovalCapability,
  loadApprovalTargetByApprovalId,
  resolveApprovalIdentity,
} from "../../apps/api/src/approval/repository";
import db, { schema } from "../../apps/api/src/database";
import { apiKeyExtensionTable } from "../../apps/api/src/database/schema";
import { policyRegistry } from "../../apps/api/src/policy-registry";
import {
  approvalRows,
  buildTenant,
  createApproval,
  json,
  restoreProjectMembership,
  revokeProjectMembership,
} from "./helpers/approval-fixtures";
import { mockAnonymousSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";

function hashApiKey(raw: string) {
  return createHash("sha256").update(raw).digest().toString("base64url");
}

async function createMcpKey(
  userId: string,
  personId: string,
  permissions: Record<string, string[]> = {
    approval: ["decide", "decide_cab"],
    work_item: ["read"],
  },
) {
  const raw = `tdk_${randomUUID()}`;
  const now = new Date();
  const [key] = await db
    .insert(schema.apikeyTable)
    .values({
      referenceId: userId,
      userId,
      key: hashApiKey(raw),
      name: "MCP approval decision test key",
      start: raw.slice(0, 12),
      prefix: "taskdesk",
      permissions: JSON.stringify(permissions),
      enabled: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: schema.apikeyTable.id });
  if (!key) throw new Error("MCP test API key was not created");
  await db.insert(apiKeyExtensionTable).values({
    apikeyId: key.id,
    personId,
    isMcp: true,
  });
  return { id: key.id, raw };
}

async function openDecision(
  app: Awaited<ReturnType<typeof buildTenant>>["app"],
  rawKey: string,
  approvalId: string,
  decision: { action: "approve" | "reject"; note?: string },
  idempotencyKey = randomUUID(),
) {
  mockAnonymousSession();
  return app.request(`/api/approvals/${approvalId}/decide`, {
    method: "POST",
    headers: {
      ...json,
      "x-api-key": rawKey,
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(decision),
  });
}

async function approvePendingAction(
  app: Awaited<ReturnType<typeof buildTenant>>["app"],
  user: Awaited<ReturnType<typeof buildTenant>>["approver"]["user"],
  pendingActionId: string,
) {
  const sessionId = `session-${user.id}`;
  const now = new Date();
  await db
    .insert(schema.sessionTable)
    .values({
      id: sessionId,
      token: `token-${user.id}`,
      userId: user.id,
      portal: "agent",
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.sessionTable.id,
      set: {
        expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
        updatedAt: now,
      },
    });
  const { mockAuthenticatedSession } = await import("./helpers/auth");
  mockAuthenticatedSession(user);
  return app.request(`/api/me/pending-actions/${pendingActionId}/approve`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({}),
  });
}

describe("API integration: MCP approval decisions (PA-14)", () => {
  beforeEach(async () => {
    fault.failApprovalDecisionEvent = false;
    await resetTestDatabase();
    await db.insert(schema.instanceFeatureFlagTable).values({
      featureKey: "feature.mcp",
      enabled: true,
    });
  });

  afterEach(() => {
    fault.failApprovalDecisionEvent = false;
  });

  it("returns 202, replays idempotently, then lets only the key owner's session execute the bound decision", async () => {
    const tenant = await buildTenant("mcp-decision");
    const approval = await createApproval(tenant);
    const key = await createMcpKey(
      tenant.approver.user.id,
      tenant.approverPerson.id,
    );
    const keyIdentity = await resolveApprovalIdentity(tenant.approver.user.id, {
      id: key.id,
      userId: tenant.approver.user.id,
      enabled: true,
      permissions: {
        approval: ["decide", "decide_cab"],
        work_item: ["read"],
      },
      isMcp: true,
    });
    expect(keyIdentity.credential).toBe("mcp_key");
    const approvalTarget = await loadApprovalTargetByApprovalId(
      approval.id,
      keyIdentity,
    );
    if (!approvalTarget) throw new Error("Expected current approval target");
    expect(
      hasApprovalCapability(keyIdentity, "approval:decide", approvalTarget),
    ).toBe(true);
    const route = policyRegistry.get("POST /api/approvals/{id}/decide");
    if (route?.kind !== "capability")
      throw new Error("Expected registered approval decision policy");
    expect(route.policy).not.toHaveProperty("sessionOnly");
    expect(
      evaluatePolicy(route.policy, {
        identity: keyIdentity,
        target: {
          workItemId: approvalTarget.workItemId,
          workItemProjectId: approvalTarget.projectId,
          workspaceId: approvalTarget.workspaceId,
        },
        scope: workItemScopeFromRow({
          workItemId: approvalTarget.workItemId,
          projectId: approvalTarget.projectId,
          workspaceId: approvalTarget.workspaceId,
        }),
        inReach: reaches(keyIdentity, approvalTarget.reachFacts),
      }),
    ).toMatchObject({ allowed: true });
    const approvalsRead = await tenant.app.request(
      `/api/work-items/${tenant.key}/approvals`,
      { headers: { "x-api-key": key.raw } },
    );
    expect(approvalsRead.status, await approvalsRead.clone().text()).toBe(200);
    const idempotencyKey = randomUUID();
    const body = {
      action: "reject" as const,
      note: "Needs additional evidence",
    };

    const first = await openDecision(
      tenant.app,
      key.raw,
      approval.id,
      body,
      idempotencyKey,
    );
    expect(first.status, await first.clone().text()).toBe(202);
    const pending = (await first.json()) as {
      pendingActionId: string;
      action: string;
    };
    expect(pending.action).toBe("mcp_destructive");
    expect((await approvalRows(tenant.workItem.id))[0]?.state).toBe("pending");
    const [stored] = await db
      .select()
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, pending.pendingActionId));
    expect(stored?.origin).toBe("mcp");
    expect(stored?.payload).toMatchObject({
      mcp_decision: { action: "reject", note: "Needs additional evidence" },
    });

    const retry = await openDecision(
      tenant.app,
      key.raw,
      approval.id,
      body,
      idempotencyKey,
    );
    expect(retry.status, await retry.clone().text()).toBe(202);
    expect((await retry.json()).pendingActionId).toBe(pending.pendingActionId);
    expect(
      await db
        .select()
        .from(schema.pendingActionTable)
        .where(eq(schema.pendingActionTable.id, pending.pendingActionId)),
    ).toHaveLength(1);

    const requestAudits = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.apiKeyId, key.id),
          eq(schema.auditLogTable.action, "mcp.request"),
        ),
      );
    expect(requestAudits).toHaveLength(3);
    for (const audit of requestAudits) {
      expect(audit).toMatchObject({
        actorId: tenant.approver.user.id,
        actorType: "api_key",
        apiKeyId: key.id,
        entityType: "api_key",
        entityId: key.id,
        after: { agentOriginated: true },
      });
    }

    const executed = await approvePendingAction(
      tenant.app,
      tenant.approver.user,
      pending.pendingActionId,
    );
    expect(executed.status, await executed.clone().text()).toBe(200);
    const [decided] = await approvalRows(tenant.workItem.id);
    expect(decided).toMatchObject({
      id: approval.id,
      state: "rejected",
      decisionNote: "Needs additional evidence",
    });
    const [audit] = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.entityId, approval.id),
          eq(schema.auditLogTable.action, "approval.decided"),
        ),
      );
    expect(audit).toMatchObject({
      actorType: "api_key",
      apiKeyId: key.id,
    });
  });

  it("allows archived work-item approval reads while keeping approval authoring closed", async () => {
    const tenant = await buildTenant("archived-approval-read");
    const approval = await createApproval(tenant);
    await db
      .update(schema.workItemTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.workItemTable.id, tenant.workItem.id));

    const read = await tenant.app.request(
      `/api/work-items/${tenant.key}/approvals`,
    );
    expect(read.status, await read.clone().text()).toBe(200);
    expect(await read.json()).toMatchObject({
      approvals: [
        expect.objectContaining({ id: approval.id, state: "pending" }),
      ],
    });

    const context = await tenant.app.request(
      `/api/work-items/${tenant.key}/approval-request-context`,
    );
    expect(context.status).toBe(404);
    const create = await tenant.app.request(
      `/api/work-items/${tenant.key}/approvals`,
      {
        method: "POST",
        headers: json,
        body: JSON.stringify({
          transitionId: tenant.cabOnly.id,
          kind: "cab",
          approverId: tenant.approverPerson.id,
        }),
      },
    );
    expect(create.status).toBe(404);
  });

  it("requires a current enabled key with its current decision capability at execution", async () => {
    const tenant = await buildTenant("mcp-key-revoked");
    const approval = await createApproval(tenant);
    const key = await createMcpKey(
      tenant.approver.user.id,
      tenant.approverPerson.id,
    );
    const requested = await openDecision(tenant.app, key.raw, approval.id, {
      action: "approve",
    });
    expect(requested.status, await requested.clone().text()).toBe(202);
    const { pendingActionId } = (await requested.json()) as {
      pendingActionId: string;
    };
    await db
      .update(schema.apikeyTable)
      .set({ enabled: false })
      .where(eq(schema.apikeyTable.id, key.id));

    const response = await approvePendingAction(
      tenant.app,
      tenant.approver.user,
      pendingActionId,
    );
    expect(response.status, await response.clone().text()).toBe(409);
    const [pending] = await db
      .select({ state: schema.pendingActionTable.state })
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, pendingActionId));
    expect(pending?.state).toBe("invalidated");
    expect((await approvalRows(tenant.workItem.id))[0]?.state).toBe("pending");
  });

  it("audits MCP requests before downstream capability and rate-limit refusals", async () => {
    const tenant = await buildTenant("mcp-request-audit-refusals");
    const key = await createMcpKey(
      tenant.requester.user.id,
      tenant.requesterPerson.id,
    );
    await db
      .update(apiKeyExtensionTable)
      .set({ rateLimitPerMinute: 1 })
      .where(eq(apiKeyExtensionTable.apikeyId, key.id));

    const request = () =>
      tenant.app.request(
        `/api/project?workspaceId=${encodeURIComponent(tenant.requester.workspace.id)}`,
        { headers: { "x-api-key": key.raw } },
      );
    expect((await request()).status).toBe(403);
    expect((await request()).status).toBe(429);

    const audits = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.apiKeyId, key.id),
          eq(schema.auditLogTable.action, "mcp.request"),
        ),
      );
    expect(audits).toHaveLength(2);
    for (const audit of audits)
      expect(audit.after).toMatchObject({ agentOriginated: true });
  });

  it("invalidates an MCP pending action if the key kind or MCP feature changes", async () => {
    const tenant = await buildTenant("mcp-decision-current-kind");
    const key = await createMcpKey(
      tenant.approver.user.id,
      tenant.approverPerson.id,
    );
    const approvals = [
      await createApproval(tenant),
      await createApproval(tenant),
    ];
    const pendingIds: string[] = [];
    for (const [index, approval] of approvals.entries()) {
      const requested = await openDecision(tenant.app, key.raw, approval.id, {
        action: "approve",
      });
      expect(requested.status, await requested.clone().text()).toBe(202);
      pendingIds.push(
        (
          (await requested.json()) as {
            pendingActionId: string;
          }
        ).pendingActionId,
      );
      if (index === 0) {
        await db
          .update(apiKeyExtensionTable)
          .set({ isMcp: false })
          .where(eq(apiKeyExtensionTable.apikeyId, key.id));
      } else {
        await db
          .update(schema.instanceFeatureFlagTable)
          .set({ enabled: false })
          .where(eq(schema.instanceFeatureFlagTable.featureKey, "feature.mcp"));
      }
      const response = await approvePendingAction(
        tenant.app,
        tenant.approver.user,
        pendingIds[index] ?? "",
      );
      expect(response.status, await response.clone().text()).toBe(409);
      const [pending] = await db
        .select({ state: schema.pendingActionTable.state })
        .from(schema.pendingActionTable)
        .where(eq(schema.pendingActionTable.id, pendingIds[index] ?? ""));
      expect(pending?.state).toBe("invalidated");
      if (index === 0) {
        await db
          .update(apiKeyExtensionTable)
          .set({ isMcp: true })
          .where(eq(apiKeyExtensionTable.apikeyId, key.id));
      }
    }
  });

  it("rechecks the current key subset, key expiry, approver role, and project reach", async () => {
    const tenant = await buildTenant("mcp-decision-current-authority");
    const key = await createMcpKey(
      tenant.approver.user.id,
      tenant.approverPerson.id,
    );
    const [membership] = await db
      .select()
      .from(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, tenant.approverPerson.id),
          eq(schema.membershipTable.scope, "project"),
          eq(schema.membershipTable.scopeId, tenant.project.id),
        ),
      );
    if (!membership) throw new Error("Expected approver project membership");
    const [role] = await db
      .select()
      .from(schema.roleTable)
      .where(eq(schema.roleTable.id, membership.roleId));
    if (!role) throw new Error("Expected approver project role");
    const originalPermissions = JSON.stringify({
      approval: ["decide", "decide_cab"],
      work_item: ["read"],
    });
    const scenarios = [
      {
        name: "key capability subset",
        change: async () =>
          db
            .update(schema.apikeyTable)
            .set({ permissions: JSON.stringify({ work_item: ["read"] }) })
            .where(eq(schema.apikeyTable.id, key.id)),
        restore: async () =>
          db
            .update(schema.apikeyTable)
            .set({ permissions: originalPermissions })
            .where(eq(schema.apikeyTable.id, key.id)),
      },
      {
        name: "key expiry",
        change: async () =>
          db
            .update(schema.apikeyTable)
            .set({ expiresAt: new Date(Date.now() - 1_000) })
            .where(eq(schema.apikeyTable.id, key.id)),
        restore: async () =>
          db
            .update(schema.apikeyTable)
            .set({ expiresAt: null })
            .where(eq(schema.apikeyTable.id, key.id)),
      },
      {
        name: "approver role capability",
        change: async () =>
          db
            .update(schema.roleTable)
            .set({ capabilities: ["project:read", "work_item:read"] })
            .where(eq(schema.roleTable.id, role.id)),
        restore: async () =>
          db
            .update(schema.roleTable)
            .set({ capabilities: role.capabilities })
            .where(eq(schema.roleTable.id, role.id)),
      },
      {
        name: "project reach",
        change: () =>
          revokeProjectMembership(tenant.approverPerson.id, tenant.project.id),
        restore: async () => restoreProjectMembership(membership),
      },
    ];

    for (const scenario of scenarios) {
      const approval = await createApproval(tenant);
      const requested = await openDecision(tenant.app, key.raw, approval.id, {
        action: "approve",
      });
      expect(
        requested.status,
        `${scenario.name}: ${await requested.clone().text()}`,
      ).toBe(202);
      const { pendingActionId } = (await requested.json()) as {
        pendingActionId: string;
      };
      await scenario.change();
      const response = await approvePendingAction(
        tenant.app,
        tenant.approver.user,
        pendingActionId,
      );
      expect(
        response.status,
        `${scenario.name}: ${await response.clone().text()}`,
      ).toBe(409);
      const [pending] = await db
        .select({ state: schema.pendingActionTable.state })
        .from(schema.pendingActionTable)
        .where(eq(schema.pendingActionTable.id, pendingActionId));
      expect(pending?.state, scenario.name).toBe("invalidated");
      expect(
        (await approvalRows(tenant.workItem.id)).find(
          (row) => row.id === approval.id,
        )?.state,
      ).toBe("pending");
      await scenario.restore();
    }
  });

  it("rolls back the approval transition when its decision event cannot be recorded", async () => {
    const tenant = await buildTenant("mcp-decision-rollback");
    const approval = await createApproval(tenant);
    const key = await createMcpKey(
      tenant.approver.user.id,
      tenant.approverPerson.id,
    );
    const requested = await openDecision(tenant.app, key.raw, approval.id, {
      action: "approve",
    });
    expect(requested.status, await requested.clone().text()).toBe(202);
    const { pendingActionId } = (await requested.json()) as {
      pendingActionId: string;
    };
    fault.failApprovalDecisionEvent = true;

    const response = await approvePendingAction(
      tenant.app,
      tenant.approver.user,
      pendingActionId,
    );
    expect(response.status).toBe(500);
    expect((await approvalRows(tenant.workItem.id))[0]?.state).toBe("pending");
    const [pending] = await db
      .select()
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, pendingActionId));
    expect(pending?.state).toBe("failed");
  });
});
