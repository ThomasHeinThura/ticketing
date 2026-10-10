import type { Capability } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import { isCurrentInstanceAdmin } from "../instance/observability/audit-failure-notifier";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireSessionOnly } from "../utils/require-session-only";
import {
  canWithdrawApproval,
  hasApprovalCapability,
  hasWorkItemReach,
  isCabTeamMember,
  listApprovalRows,
  listApprovalsForPerson,
  loadApprovalTargetByApprovalId,
  loadApprovalTargetByKey,
  resolveApprovalIdentity,
  resolveApprovalIdentityIfActive,
} from "./repository";
import {
  approvalIdParam,
  approvalListResponseSchema,
  createApprovalBody,
  decideApprovalBody,
  workItemKeyParam,
} from "./schema";
import { createApproval, decideApproval, withdrawApproval } from "./service";

function actorType(apiKey: unknown): "person" | "api_key" {
  return apiKey ? "api_key" : "person";
}

function responseRow(row: {
  id: string;
  workItemId: string;
  workItemKey: string;
  workItemTitle: string;
  transitionId: string;
  kind: string;
  state: string;
  createdAt: Date;
  expiresAt: Date;
  decidedAt: Date | null;
  decisionNote: string | null;
  requesterId: string;
  requesterName: string | null;
  approverId: string;
  approverName: string | null;
  approverReachLost: boolean;
  canWithdraw: boolean;
}) {
  return {
    id: row.id,
    workItemId: row.workItemId,
    workItemKey: row.workItemKey,
    workItemTitle: row.workItemTitle,
    transitionId: row.transitionId,
    kind: row.kind as "customer" | "cab",
    state: row.state as
      | "pending"
      | "approved"
      | "rejected"
      | "expired"
      | "withdrawn",
    requester: { id: row.requesterId, displayName: row.requesterName },
    approver: { id: row.approverId, displayName: row.approverName },
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionNote: row.decisionNote,
    approverReachLost: row.approverReachLost,
    canWithdraw: row.canWithdraw,
  };
}

async function formatApproval(
  row:
    | Awaited<ReturnType<typeof listApprovalRows>>[number]
    | Awaited<ReturnType<typeof listApprovalsForPerson>>[number],
  viewer: Awaited<ReturnType<typeof resolveApprovalIdentity>>,
  knownTarget?: Awaited<ReturnType<typeof loadApprovalTargetByKey>>,
) {
  const target =
    knownTarget ?? (await loadApprovalTargetByKey(row.workItemKey));
  const approverIdentity = row.approverUserId
    ? row.approverUserId === viewer.userId
      ? viewer
      : await resolveApprovalIdentityIfActive(row.approverUserId)
    : null;
  const approverReachLost =
    row.state === "pending" &&
    (!approverIdentity || !(await hasWorkItemReach(approverIdentity, target)));
  const withdrawal = await canWithdrawApproval(row, viewer, target, {
    allowInstanceAdmin: true,
  });
  return responseRow({
    ...row,
    approverReachLost,
    canWithdraw: withdrawal.actionable,
  });
}

/**
 * An inbox lists the caller's own addressed approvals, each re-anchored to its approval's
 * workspace. Reach is deliberately not a filter: a named approver who lost reach still sees
 * the pending approval, flagged `approverReachLost`, per the approvals edge-case table.
 */
async function formatReachableApprovals(
  rows: Awaited<ReturnType<typeof listApprovalsForPerson>>,
  viewer: Awaited<ReturnType<typeof resolveApprovalIdentity>>,
) {
  const formatted = await Promise.all(
    rows.map(async (row) => {
      const target = await loadApprovalTargetByKey(row.workItemKey);
      if (target.workspaceId !== row.workspaceId) return null;
      return formatApproval(row, viewer, target);
    }),
  );
  return formatted.filter((row) => row !== null);
}

async function withdrawApprovalForIdentity(input: {
  id: string;
  identity: Awaited<ReturnType<typeof resolveApprovalIdentity>>;
  actorType: "person" | "api_key";
  allowInstanceAdmin: boolean;
}) {
  const target = await loadApprovalTargetByApprovalId(
    input.id,
    input.identity,
    { currentInstanceAdmin: input.allowInstanceAdmin },
  );
  if (!target) throw new HTTPException(404, { message: "Approval not found" });
  const row = (
    await listApprovalRows(target.workItemId, target.workspaceId)
  ).find((item) => item.id === input.id);
  if (!row) throw new HTTPException(404, { message: "Approval not found" });
  const withdrawal = await canWithdrawApproval(row, input.identity, target, {
    allowInstanceAdmin: input.allowInstanceAdmin,
  });
  if (!withdrawal.authorized)
    throw new HTTPException(403, { message: "Insufficient permissions" });
  const updated = await withdrawApproval({
    approvalId: input.id,
    identity: input.identity,
    actorType: input.actorType,
    target,
    isInstanceAdmin: input.allowInstanceAdmin,
  });
  const fresh = (
    await listApprovalRows(target.workItemId, target.workspaceId)
  ).find((item) => item.id === updated.id);
  if (!fresh) throw new Error("Withdrawn approval could not be reloaded");
  return formatApproval(fresh, input.identity, target);
}

const listWorkItemApprovalsRoute = createRoute({
  method: "get",
  operationId: "listWorkItemApprovals",
  path: "/work-items/{key}/approvals",
  tags: ["Approvals"],
  summary: "List a work item's approvals",
  request: { params: workItemKeyParam },
  responses: {
    200: jsonResponse(
      "Approvals visible to this caller",
      approvalListResponseSchema,
    ),
    401: errorResponse("Authentication required"),
    404: errorResponse("Work item not found or outside caller reach"),
  },
});

const createWorkItemApprovalRoute = createRoute({
  method: "post",
  operationId: "createWorkItemApproval",
  path: "/work-items/{key}/approvals",
  tags: ["Approvals"],
  summary: "Request a work-item approval",
  request: {
    params: workItemKeyParam,
    body: {
      required: true,
      content: { "application/json": { schema: createApprovalBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "Created approval",
      approvalListResponseSchema.shape.approvals.element,
    ),
    400: errorResponse("Invalid request"),
    401: errorResponse("Authentication required"),
    403: errorResponse("Missing approval request capability"),
    404: errorResponse("Work item not found or outside caller reach"),
    422: errorResponse("Approval request violates the approval contract"),
  },
});

const decideApprovalRoute = createRoute({
  method: "post",
  operationId: "decideApproval",
  path: "/approvals/{id}/decide",
  tags: ["Approvals"],
  summary: "Decide an approval",
  request: {
    params: approvalIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: decideApprovalBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "Decision recorded",
      approvalListResponseSchema.shape.approvals.element,
    ),
    400: errorResponse("Invalid request"),
    401: errorResponse("Authentication required"),
    403: errorResponse("Caller is not the named eligible approver"),
    404: errorResponse("Approval not found"),
    409: errorResponse("Approval is no longer pending"),
    422: errorResponse("Rejected decisions require a non-empty note"),
  },
});

const withdrawApprovalRoute = createRoute({
  method: "post",
  operationId: "withdrawApproval",
  path: "/approvals/{id}/withdraw",
  tags: ["Approvals"],
  summary: "Withdraw an approval request",
  request: { params: approvalIdParam },
  responses: {
    200: jsonResponse(
      "Approval withdrawn",
      approvalListResponseSchema.shape.approvals.element,
    ),
    401: errorResponse("Authentication required"),
    403: errorResponse("Caller may not withdraw this approval"),
    404: errorResponse("Approval not found"),
    409: errorResponse("Approval is no longer pending"),
  },
});

const withdrawApprovalAsAdminRoute = createRoute({
  method: "post",
  operationId: "withdrawApprovalAsInstanceAdmin",
  path: "/admin/approvals/{id}/withdraw",
  tags: ["Approvals"],
  summary: "Withdraw an approval as an instance administrator",
  middleware: [requireSessionOnly()] as const,
  request: { params: approvalIdParam },
  responses: {
    200: jsonResponse(
      "Approval withdrawn",
      approvalListResponseSchema.shape.approvals.element,
    ),
    401: errorResponse("Authentication required"),
    403: errorResponse("Instance administrator session required"),
    404: errorResponse("Approval not found"),
    409: errorResponse("Approval is no longer pending"),
  },
});

const listMyApprovalsRoute = createRoute({
  method: "get",
  operationId: "listMyApprovals",
  path: "/me/approvals",
  tags: ["Approvals"],
  summary: "List approvals addressed to me",
  responses: {
    200: jsonResponse(
      "Approvals addressed to this person",
      approvalListResponseSchema,
    ),
    401: errorResponse("Authentication required"),
  },
});

const listPortalApprovalsRoute = createRoute({
  method: "get",
  operationId: "listPortalApprovals",
  path: "/portal/approvals",
  tags: ["Portal approvals"],
  summary: "List customer approvals addressed to me",
  responses: {
    200: jsonResponse(
      "Customer approvals addressed to this person",
      approvalListResponseSchema,
    ),
    401: errorResponse("Authentication required"),
    403: errorResponse("Customer portal identity required"),
  },
});

const decidePortalApprovalRoute = createRoute({
  method: "post",
  operationId: "decidePortalApproval",
  path: "/portal/approvals/{id}/decide",
  tags: ["Portal approvals"],
  summary: "Decide a customer approval",
  request: {
    params: approvalIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: decideApprovalBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "Decision recorded",
      approvalListResponseSchema.shape.approvals.element,
    ),
    401: errorResponse("Authentication required"),
    403: errorResponse("Customer approval addressed to this person required"),
    404: errorResponse("Approval not found"),
  },
});

function approvalRouter() {
  return apiRouter()
    .openapi(listWorkItemApprovalsRoute, async (c) => {
      const identity = await resolveApprovalIdentity(
        c.get("userId"),
        c.get("apiKey"),
      );
      const target = await loadApprovalTargetByKey(c.req.valid("param").key);
      if (!(await hasWorkItemReach(identity, target))) {
        throw new HTTPException(404, { message: "Work item not found" });
      }
      if (
        identity.side === "staff" &&
        !hasApprovalCapability(identity, "work_item:read" as Capability, target)
      ) {
        throw new HTTPException(403, { message: "Insufficient permissions" });
      }
      const rows = await listApprovalRows(
        target.workItemId,
        target.workspaceId,
      );
      const visible =
        identity.side === "customer"
          ? rows.filter(
              (row) =>
                row.approverId === identity.personId ||
                row.requesterId === identity.personId,
            )
          : rows;
      const approvals = await Promise.all(
        visible.map((row) => formatApproval(row, identity, target)),
      );
      return c.json({ approvals }, 200);
    })
    .openapi(createWorkItemApprovalRoute, async (c) => {
      const identity = await resolveApprovalIdentity(
        c.get("userId"),
        c.get("apiKey"),
      );
      if (identity.side !== "staff")
        throw new HTTPException(403, { message: "Staff only" });
      const target = await loadApprovalTargetByKey(c.req.valid("param").key);
      if (!(await hasWorkItemReach(identity, target))) {
        throw new HTTPException(404, { message: "Work item not found" });
      }
      if (
        !hasApprovalCapability(
          identity,
          "approval:request" as Capability,
          target,
        )
      ) {
        throw new HTTPException(403, { message: "Insufficient permissions" });
      }
      const body = c.req.valid("json");
      if (
        body.kind === "cab" &&
        !hasApprovalCapability(
          identity,
          "approval:request_cab" as Capability,
          target,
        )
      ) {
        throw new HTTPException(403, { message: "Insufficient permissions" });
      }
      const row = await createApproval({
        targetKey: target.workItemKey,
        identity,
        actorType: actorType(c.get("apiKey")),
        transitionId: body.transitionId,
        kind: body.kind,
        approverId: body.approverId,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
      });
      const rows = await listApprovalRows(
        target.workItemId,
        target.workspaceId,
      );
      const created = rows.find((candidate) => candidate.id === row.id);
      if (!created) throw new Error("Created approval could not be reloaded");
      return c.json(await formatApproval(created, identity, target), 200);
    })
    .openapi(decideApprovalRoute, async (c) => {
      const identity = await resolveApprovalIdentity(
        c.get("userId"),
        c.get("apiKey"),
      );
      const id = c.req.valid("param").id;
      const target = await loadApprovalTargetByApprovalId(id, identity);
      if (!target)
        throw new HTTPException(404, { message: "Approval not found" });
      if (
        !hasApprovalCapability(
          identity,
          "approval:decide" as Capability,
          target,
        )
      ) {
        throw new HTTPException(403, { message: "Insufficient permissions" });
      }
      const row = (
        await listApprovalRows(target.workItemId, target.workspaceId)
      ).find((item) => item.id === id);
      if (!row) throw new HTTPException(404, { message: "Approval not found" });
      const isCabMember =
        row.kind === "cab"
          ? await isCabTeamMember(identity.userId, target.workspaceId)
          : false;
      if (
        row.kind === "cab" &&
        !hasApprovalCapability(
          identity,
          "approval:decide_cab" as Capability,
          target,
        )
      ) {
        throw new HTTPException(403, { message: "Insufficient permissions" });
      }
      const body = c.req.valid("json");
      const updated = await decideApproval({
        approvalId: id,
        identity,
        actorType: actorType(c.get("apiKey")),
        action: body.action,
        note: body.note ?? null,
        isCabMember,
        target,
      });
      const fresh = (
        await listApprovalRows(target.workItemId, target.workspaceId)
      ).find((item) => item.id === updated.id);
      if (!fresh) throw new Error("Decided approval could not be reloaded");
      return c.json(await formatApproval(fresh, identity, target), 200);
    })
    .openapi(withdrawApprovalRoute, async (c) => {
      const identity = await resolveApprovalIdentity(
        c.get("userId"),
        c.get("apiKey"),
      );
      const approval = await withdrawApprovalForIdentity({
        id: c.req.valid("param").id,
        identity,
        actorType: actorType(c.get("apiKey")),
        allowInstanceAdmin: false,
      });
      return c.json(approval, 200);
    })
    .openapi(withdrawApprovalAsAdminRoute, async (c) => {
      const userId = c.get("userId");
      if (!(await isCurrentInstanceAdmin(userId)))
        throw new HTTPException(403, {
          message: "Instance administrator session required",
        });
      const identity = await resolveApprovalIdentity(userId);
      const approval = await withdrawApprovalForIdentity({
        id: c.req.valid("param").id,
        identity,
        actorType: "person",
        allowInstanceAdmin: true,
      });
      return c.json(approval, 200);
    })
    .openapi(listMyApprovalsRoute, async (c) => {
      const identity = await resolveApprovalIdentity(
        c.get("userId"),
        c.get("apiKey"),
      );
      const rows = await listApprovalsForPerson(identity.personId, {
        addressedOnly: true,
        pendingOnly: true,
      });
      const approvals = await formatReachableApprovals(rows, identity);
      return c.json({ approvals }, 200);
    })
    .openapi(listPortalApprovalsRoute, async (c) => {
      const identity = await resolveApprovalIdentity(
        c.get("userId"),
        c.get("apiKey"),
      );
      if (identity.side !== "customer")
        throw new HTTPException(403, {
          message: "Customer portal identity required",
        });
      const rows = await listApprovalsForPerson(identity.personId, {
        addressedOnly: true,
        pendingOnly: true,
      });
      const approvals = await formatReachableApprovals(
        rows.filter((row) => row.kind === "customer"),
        identity,
      );
      return c.json({ approvals }, 200);
    })
    .openapi(decidePortalApprovalRoute, async (c) => {
      const identity = await resolveApprovalIdentity(
        c.get("userId"),
        c.get("apiKey"),
      );
      if (identity.side !== "customer")
        throw new HTTPException(403, {
          message: "Customer portal identity required",
        });
      const id = c.req.valid("param").id;
      const target = await loadApprovalTargetByApprovalId(id, identity);
      if (!target)
        throw new HTTPException(404, { message: "Approval not found" });
      const row = (
        await listApprovalRows(target.workItemId, target.workspaceId)
      ).find((item) => item.id === id);
      if (row?.kind !== "customer" || row.approverId !== identity.personId) {
        throw new HTTPException(403, {
          message: "Customer approval addressed to this person required",
        });
      }
      if (
        !hasApprovalCapability(
          identity,
          "approval:decide" as Capability,
          target,
        )
      ) {
        throw new HTTPException(403, { message: "Insufficient permissions" });
      }
      const body = c.req.valid("json");
      const updated = await decideApproval({
        approvalId: id,
        identity,
        actorType: "person",
        action: body.action,
        note: body.note ?? null,
        isCabMember: false,
        target,
      });
      const fresh = (
        await listApprovalRows(target.workItemId, target.workspaceId)
      ).find((item) => item.id === updated.id);
      if (!fresh) throw new Error("Decided approval could not be reloaded");
      return c.json(await formatApproval(fresh, identity, target), 200);
    });
}

export default approvalRouter();
