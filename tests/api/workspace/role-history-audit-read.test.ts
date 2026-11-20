import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The REAL workspace router and the REAL `writeAuditRead`; only the request admission
// middleware, the role service and the audit sink/metric are stand-ins, so this proves the
// route's own AU-13 call order offline. Persistence is proven by the mounted PostgreSQL witnesses
// in tests/api-integration/workspace-role-governance.test.ts.
const h = vi.hoisted(() => ({
  getRoleHistory: vi.fn(),
  appendAuditLog: vi.fn(),
  recordAuditWriteFailure: vi.fn(),
  notifyAdmins: vi.fn(),
  passthrough: async (_c: unknown, next: () => Promise<void>) => next(),
  factory: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

vi.mock("../../../apps/api/src/utils/require-session-only", () => ({
  requireSessionOnly: h.factory,
}));
vi.mock(
  "../../../apps/api/src/utils/workspace-access-middleware",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../apps/api/src/utils/workspace-access-middleware")
      >();
    return {
      ...actual,
      workspaceAccess: {
        ...actual.workspaceAccess,
        fromParam:
          () =>
          async (
            c: {
              set: (k: string, v: string) => void;
              req: { param: (k: string) => string };
            },
            next: () => Promise<void>,
          ) => {
            c.set("workspaceId", c.req.param("workspaceId"));
            await next();
          },
      },
    };
  },
);
vi.mock("../../../apps/api/src/utils/require-workspace-membership", () => ({
  requireWorkspaceMembership: h.passthrough,
}));
vi.mock(
  "../../../apps/api/src/utils/require-workspace-capability",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../apps/api/src/utils/require-workspace-capability")
    >()),
    requireWorkspaceCapability: h.factory,
  }),
);
vi.mock("../../../apps/api/src/utils/require-workspace-permission", () => ({
  requireWorkspacePermission: h.factory,
}));
vi.mock("../../../apps/api/src/utils/require-workspace-role-authority", () => ({
  requireWorkspaceRoleAuthority: h.factory,
}));
vi.mock(
  "../../../apps/api/src/workspace/role-service",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../apps/api/src/workspace/role-service")
    >()),
    getRoleHistory: h.getRoleHistory,
  }),
);
vi.mock("../../../apps/api/src/audit/audit-writer", () => ({
  appendAuditLog: h.appendAuditLog,
}));
vi.mock(
  "../../../apps/api/src/instance/observability/runtime",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../apps/api/src/instance/observability/runtime")
    >()),
    recordAuditWriteFailure: h.recordAuditWriteFailure,
  }),
);
vi.mock(
  "../../../apps/api/src/instance/observability/audit-failure-notifier",
  () => ({
    notifyCurrentInstanceAdminsOfAuditFailure: h.notifyAdmins,
  }),
);

import { HTTPException } from "hono/http-exception";
import { WorkspaceRoleNotFoundError } from "../../../apps/api/src/workspace/controllers/workspace-membership-errors";
import workspace from "../../../apps/api/src/workspace/index";

function mountedApp() {
  const app = new Hono<{ Variables: { userId: string } }>();
  app.use("*", async (c, next) => {
    c.set("userId", "user-1");
    await next();
  });
  app.route("/api/workspace", workspace as never);
  app.onError((error, c) =>
    error instanceof HTTPException
      ? c.text(error.message, error.status)
      : c.text("error", 500),
  );
  return app;
}

const history = (roleId = "role-1") =>
  mountedApp().request(`/api/workspace/ws-1/roles/${roleId}/history`);

beforeEach(() => {
  for (const fn of [
    h.getRoleHistory,
    h.appendAuditLog,
    h.recordAuditWriteFailure,
    h.notifyAdmins,
  ])
    fn.mockReset();
  h.appendAuditLog.mockResolvedValue({});
});

describe("GET /api/workspace/{workspaceId}/roles/{roleId}/history audit read (AU-13)", () => {
  it.each([
    ["a non-empty history", [{ id: "a1", action: "role.updated" }]],
    ["an empty history", []],
  ])(
    "writes exactly one audit.read for %s, with the workspace and request actor",
    async (_name, rows) => {
      h.getRoleHistory.mockResolvedValue(rows);
      const response = await history();
      expect(response.status).toBe(200);
      expect(h.getRoleHistory).toHaveBeenCalledWith("ws-1", "role-1");
      expect(h.appendAuditLog).toHaveBeenCalledOnce();
      expect(h.appendAuditLog.mock.calls[0]?.[1]).toMatchObject({
        action: "audit.read",
        entityType: "audit_log",
        entityId: "ws-1",
        workspaceId: "ws-1",
        actorId: "user-1",
        actorType: "person",
      });
    },
  );

  it("writes no audit.read when the role is missing", async () => {
    h.getRoleHistory.mockRejectedValue(
      new WorkspaceRoleNotFoundError("missing"),
    );
    const response = await history("missing");
    expect(response.status).toBe(404);
    expect(h.appendAuditLog).not.toHaveBeenCalled();
  });

  it("keeps the 200 and raises the shared audit_read failure signal when the append fails", async () => {
    h.getRoleHistory.mockResolvedValue([{ id: "a1", action: "role.created" }]);
    h.appendAuditLog.mockRejectedValue(new Error("audit sink down"));
    const response = await history();
    expect(response.status).toBe(200);
    expect(h.appendAuditLog).toHaveBeenCalledOnce();
    expect(h.recordAuditWriteFailure).toHaveBeenCalledWith("audit_read");
    expect(h.notifyAdmins).toHaveBeenCalledWith("audit_read");
  });
});
