import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendAuditLog: vi.fn(),
  notifyAdmins: vi.fn(),
  recordAuditWriteFailure: vi.fn(),
}));

vi.mock("../../../apps/api/src/audit/audit-writer", () => ({
  appendAuditLog: mocks.appendAuditLog,
}));
vi.mock("../../../apps/api/src/database", () => ({ default: {} }));
vi.mock(
  "../../../apps/api/src/instance/observability/audit-failure-notifier",
  () => ({
    notifyCurrentInstanceAdminsOfAuditFailure: mocks.notifyAdmins,
  }),
);
vi.mock("../../../apps/api/src/instance/observability/runtime", () => ({
  recordAuditWriteFailure: mocks.recordAuditWriteFailure,
}));

import { auditMcpRequest } from "../../../apps/api/src/utils/mcp-request-audit";

describe("MCP request audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendAuditLog.mockResolvedValue(undefined);
    mocks.notifyAdmins.mockResolvedValue(undefined);
  });

  it("records only the fixed agent marker and verified key owner identity", async () => {
    await auditMcpRequest({ apiKeyId: "key-id", ownerUserId: "owner-id" });

    expect(mocks.appendAuditLog).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        actorId: "owner-id",
        actorType: "api_key",
        apiKeyId: "key-id",
        action: "mcp.request",
        entityType: "api_key",
        entityId: "key-id",
        after: { agentOriginated: true },
      }),
    );
    expect(mocks.recordAuditWriteFailure).not.toHaveBeenCalled();
  });

  it("keeps the request path usable and reports an audit failure", async () => {
    mocks.appendAuditLog.mockRejectedValue(new Error("audit unavailable"));

    await expect(
      auditMcpRequest({ apiKeyId: "key-id", ownerUserId: "owner-id" }),
    ).resolves.toBeUndefined();

    expect(mocks.recordAuditWriteFailure).toHaveBeenCalledWith("mutation");
    expect(mocks.notifyAdmins).toHaveBeenCalledWith("mutation");
  });

  it("retains the bounded failure signal if the durable notice also fails", async () => {
    mocks.appendAuditLog.mockRejectedValue(new Error("audit unavailable"));
    mocks.notifyAdmins.mockRejectedValue(new Error("notice unavailable"));

    await expect(
      auditMcpRequest({ apiKeyId: "key-id", ownerUserId: "owner-id" }),
    ).resolves.toBeUndefined();
    expect(mocks.recordAuditWriteFailure).toHaveBeenCalledWith("mutation");
  });
});
