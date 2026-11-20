import { describe, expect, it, vi } from "vitest";

const append = vi.hoisted(() => vi.fn());
vi.mock("../../../apps/api/src/events/audit-savepoint", () => ({
  appendAuditSavepoint: append,
}));
vi.mock(
  "../../../apps/api/src/instance/observability/audit-failure-notifier",
  () => ({
    notifyCurrentInstanceAdminsOfAuditFailure: vi.fn(),
  }),
);

import { cannedResponseDeletionTarget } from "../../../apps/api/src/canned-response/canned-response-deletion-target";

function deletionTransaction(rows: object[]) {
  const builder = { where: () => builder, returning: async () => rows };
  return { delete: () => builder };
}

const execution = {
  loaded: {
    id: "snippet-1",
    workspaceId: "workspace-1",
    projectId: null,
    organisationId: null,
  },
  input: { userId: "user-1", traceId: "trace-1" },
};

describe("pending canned-response deletion audit", () => {
  it("appends only after the target is actually deleted", async () => {
    append.mockReset().mockResolvedValue(false);
    await expect(
      cannedResponseDeletionTarget.execute(
        deletionTransaction([]) as never,
        execution as never,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(append).not.toHaveBeenCalled();

    await cannedResponseDeletionTarget.execute(
      deletionTransaction([{ id: "snippet-1" }]) as never,
      execution as never,
    );
    expect(append).toHaveBeenCalledWith(expect.anything(), {
      actorId: "user-1",
      actorType: "person",
      traceId: "trace-1",
      workspaceId: "workspace-1",
      action: "canned_response.deleted",
      entityType: "canned_response",
      entityId: "snippet-1",
      after: { changedFields: ["name", "body", "visibilityDefault"] },
    });
  });
});
