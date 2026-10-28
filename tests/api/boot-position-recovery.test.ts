import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPositionRecoveryBootTask } from "../../apps/api/src/index";

const mocks = vi.hoisted(() => ({ recover: vi.fn(), log: vi.fn() }));
vi.mock(
  "../../apps/api/src/scheduler/position-rebalance",
  async (original) => ({
    ...(await original<
      typeof import("../../apps/api/src/scheduler/position-rebalance")
    >()),
    recoverDensePositionPartitions: mocks.recover,
  }),
);
vi.mock(
  "../../apps/api/src/instance/observability/runtime",
  async (original) => ({
    ...(await original<
      typeof import("../../apps/api/src/instance/observability/runtime")
    >()),
    logTaskDesk: mocks.log,
  }),
);

describe("bounded boot position recovery", () => {
  beforeEach(() => {
    mocks.recover.mockReset();
    mocks.log.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());
  it("awaits the real recovery entry with explicit startup bounds", async () => {
    let finish: (() => void) | undefined;
    mocks.recover.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve([]);
        }),
    );
    let completed = false;
    const pending = runPositionRecoveryBootTask().then(() => {
      completed = true;
    });
    expect(mocks.recover).toHaveBeenCalledWith(10, {
      scanRows: 2000,
      maxPartitionRows: 1000,
    });
    expect(completed).toBe(false);
    if (!finish) throw new Error("Recovery never started");
    finish();
    await pending;
    expect(completed).toBe(true);
    expect(mocks.log).not.toHaveBeenCalled();
  });
  it.each(["busy", "leased", "bounded", "unavailable"])(
    "reports %s as degraded rather than successful recovery",
    async (status) => {
      mocks.recover.mockResolvedValue([{ outcome: { status, changed: 0 } }]);
      await runPositionRecoveryBootTask();
      expect(mocks.log).toHaveBeenCalledWith({
        module: "jobs",
        message: "jobs.failure",
        level: "warn",
        result: "degraded",
      });
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("incomplete"),
      );
    },
  );
  it("observes operational failure without swallowing the other boot guards", async () => {
    mocks.recover.mockRejectedValue(new Error("private database detail"));
    await expect(runPositionRecoveryBootTask()).resolves.toBeUndefined();
    expect(mocks.log).toHaveBeenCalledWith({
      module: "jobs",
      message: "jobs.failure",
      level: "error",
      result: "degraded",
    });
    expect(console.warn).toHaveBeenCalledWith(
      "Position recovery failed; deferred work remains persisted for retry",
    );
  });
});
