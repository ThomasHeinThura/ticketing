import { beforeEach, describe, expect, it, vi } from "vitest";
import inviteWorkspaceMember from "../../../apps/api/src/workspace/controllers/invite-workspace-member";

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  metric: vi.fn(),
  notify: vi.fn(),
  send: vi.fn(),
  existing: vi.fn(),
  insert: vi.fn(),
  refresh: vi.fn(),
  events: [] as string[],
  abort: false,
}));
vi.mock("../../../apps/api/src/audit/audit-writer", () => ({
  appendAuditLog: mocks.audit,
}));
vi.mock("../../../apps/api/src/instance/observability/runtime", () => ({
  recordAuditWriteFailure: mocks.metric,
}));
vi.mock(
  "../../../apps/api/src/instance/observability/audit-failure-notifier",
  () => ({ notifyCurrentInstanceAdminsOfAuditFailure: mocks.notify }),
);
vi.mock("../../../apps/api/src/utils/send-workspace-invitation-email", () => ({
  sendNativeWorkspaceInvitationEmail: mocks.send,
}));
vi.mock("../../../apps/api/src/utils/workspace-member-roles", () => ({
  roleGrantsOwner: (role: string) => role === "owner",
}));
vi.mock("../../../apps/api/src/workspace/role-assignment-guard", () => ({
  assertMayAssignRole: vi.fn(),
}));
vi.mock(
  "../../../apps/api/src/workspace/workspace-role-assignment.repository",
  () => ({ lockWorkspaceRoleAssignment: vi.fn() }),
);
vi.mock("../../../apps/api/src/database", () => ({
  default: {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const result = await fn({
        transaction: async (inner: (tx: unknown) => Promise<unknown>) =>
          inner({}),
      });
      if (mocks.abort) throw new Error("outer transaction failed");
      mocks.events.push("commit");
      return result;
    },
  },
}));
vi.mock(
  "../../../apps/api/src/workspace/workspace-invitation.repository",
  () => ({
    findExistingWorkspaceMemberByEmail: vi.fn().mockResolvedValue([]),
    findPendingWorkspaceInvitation: mocks.existing,
    findWorkspaceInvitationRole: vi
      .fn()
      .mockResolvedValue([{ role: "member" }]),
    readInvitationLifetimeHours: vi.fn().mockResolvedValue(24),
    countPendingWorkspaceInvitations: vi.fn().mockResolvedValue([{ value: 0 }]),
    insertWorkspaceInvitation: mocks.insert,
    refreshWorkspaceInvitation: mocks.refresh,
    findWorkspaceInvitationWorkspace: vi
      .fn()
      .mockResolvedValue([{ name: "Workspace" }]),
    findWorkspaceInvitationInviter: vi
      .fn()
      .mockResolvedValue([{ name: "Inviter", email: "inviter@example.test" }]),
  }),
);

const row = {
  id: "inv-1",
  email: "recipient@example.test",
  role: "member",
  workspaceId: "ws",
  status: "pending",
  expiresAt: new Date(),
  createdAt: new Date(),
  inviterId: "actor",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.events.length = 0;
  mocks.abort = false;
  mocks.existing.mockResolvedValue([]);
  mocks.insert.mockResolvedValue([row]);
  mocks.refresh.mockImplementation(
    async (_tx, _id, expiresAt, role, inviterId) => [
      { ...row, expiresAt, role, inviterId },
    ],
  );
  mocks.audit.mockRejectedValue(new Error("sensitive audit failure"));
  mocks.notify.mockImplementation(async () => {
    mocks.events.push("notification");
  });
  mocks.send.mockImplementation(async () => {
    mocks.events.push("delivery");
  });
});

describe("staff invitation AU-14", () => {
  it.each(["create", "resend"] as const)(
    "commits %s and reports an audit failure before delivery",
    async (kind) => {
      if (kind === "resend")
        mocks.existing.mockResolvedValue([{ id: row.id, role: "member" }]);
      const result = await inviteWorkspaceMember({
        workspaceId: "ws",
        email: row.email,
        inviterId: "actor",
        ...(kind === "resend"
          ? { resend: true, role: "admin" }
          : { role: "member" }),
      });
      expect(result.id).toBe(row.id);
      expect(result.role).toBe(kind === "resend" ? "admin" : "member");
      expect(
        kind === "resend" ? mocks.refresh : mocks.insert,
      ).toHaveBeenCalledOnce();
      expect(mocks.metric).toHaveBeenCalledExactlyOnceWith("mutation");
      expect(mocks.notify).toHaveBeenCalledExactlyOnceWith("mutation");
      expect(mocks.send).toHaveBeenCalledOnce();
      expect(mocks.events).toEqual(["commit", "notification", "delivery"]);
      expect(JSON.stringify(mocks.notify.mock.calls)).not.toContain(
        "sensitive audit failure",
      );
    },
  );
  it("does not notify or send when the outer transaction fails", async () => {
    mocks.abort = true;
    await expect(
      inviteWorkspaceMember({
        workspaceId: "ws",
        email: row.email,
        inviterId: "actor",
        role: "member",
      }),
    ).rejects.toThrow("outer transaction failed");
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("does not notify on a successful audit", async () => {
    mocks.audit.mockResolvedValue(undefined);
    await inviteWorkspaceMember({
      workspaceId: "ws",
      email: row.email,
      inviterId: "actor",
      role: "member",
    });
    expect(mocks.metric).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledOnce();
  });
});
