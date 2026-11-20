import { describe, expect, it, vi } from "vitest";

const append = vi.hoisted(() => vi.fn());
const update = vi.hoisted(() => vi.fn());
vi.mock("../../../apps/api/src/events/audit-savepoint", () => ({
  appendAuditSavepoint: append,
}));
vi.mock(
  "../../../apps/api/src/instance/observability/audit-failure-notifier",
  () => ({
    notifyCurrentInstanceAdminsOfAuditFailure: vi.fn(),
  }),
);
vi.mock("../../../apps/api/src/database", () => ({
  default: {
    transaction: async (fn: (tx: object) => Promise<unknown>) => {
      const results = [
        [{ id: "w1" }],
        [{ id: "p1", stateSetMode: "override" }],
        [{ id: "s1", position: 0, isDefault: true }],
      ];
      const select = () => {
        const rows = results.shift() ?? [];
        const builder = {
          from: () => builder,
          where: () => builder,
          for: () => builder,
          limit: async () => rows,
          orderBy: async () => rows,
        };
        return builder;
      };
      return fn({ select, update });
    },
  },
}));

import { updateProjectState } from "../../../apps/api/src/project/controllers/manage-project-states";

describe("project state attribution", () => {
  it("does not write or attribute an unchanged order and default", async () => {
    update.mockReset();
    append.mockReset();
    const result = await updateProjectState(
      "p1",
      "w1",
      "s1",
      { position: 0, isDefault: true },
      {
        actorId: "user-1",
        actorType: "person",
      },
    );
    expect(result).toEqual({ id: "s1" });
    expect(update).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });
});
