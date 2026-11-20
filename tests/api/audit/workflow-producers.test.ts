import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  append: vi.fn(),
  version: vi.fn(),
  activate: vi.fn(),
}));
vi.mock("../../../apps/api/src/database", () => ({
  default: { transaction: (fn: (tx: object) => Promise<unknown>) => fn({}) },
}));
vi.mock("../../../apps/api/src/permissions/resolve-identity", () => ({
  resolveIdentity: async () => ({ personId: "person-1" }),
}));
vi.mock("../../../apps/api/src/events/audit-savepoint", () => ({
  appendAuditSavepoint: calls.append,
}));
vi.mock(
  "../../../apps/api/src/instance/observability/audit-failure-notifier",
  () => ({
    notifyCurrentInstanceAdminsOfAuditFailure: vi.fn(),
  }),
);
vi.mock("../../../apps/api/src/workflow/repository", () => ({
  findWorkflowVersion: calls.version,
  findWorkflowWorkspaceId: async () => ({ workspaceId: "workspace-1" }),
  hasCompleteWorkflowProjectReach: async () => true,
  stampVersionPublished: async () => ({ id: "version-1" }),
  setActiveWorkflowVersion: calls.activate,
  listVersionTransitions: async () => [],
}));

import publishWorkflowVersion from "../../../apps/api/src/workflow/controllers/publish-workflow-version";

describe("workflow publication audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.append.mockResolvedValue(false);
  });

  it("records only a first successful publication, with identifiers and a closed field name", async () => {
    calls.version.mockResolvedValueOnce({ id: "version-1", publishedAt: null });
    const actor = { actorId: "user-1", actorType: "person" as const };
    await publishWorkflowVersion(
      { userId: "user-1", credential: "session" },
      "workflow-1",
      1,
      actor,
    );
    expect(calls.activate).toHaveBeenCalledOnce();
    expect(calls.append).toHaveBeenCalledWith(expect.anything(), {
      ...actor,
      workspaceId: "workspace-1",
      action: "workflow.version_published",
      entityType: "workflow",
      entityId: "workflow-1",
      after: { versionId: "version-1", changedFields: ["activeVersion"] },
    });

    calls.version.mockResolvedValueOnce({
      id: "version-1",
      publishedAt: new Date(),
    });
    await publishWorkflowVersion(
      { userId: "user-1", credential: "session" },
      "workflow-1",
      1,
      actor,
    );
    expect(calls.activate).toHaveBeenCalledTimes(1);
    expect(calls.append).toHaveBeenCalledTimes(1);
  });
});
