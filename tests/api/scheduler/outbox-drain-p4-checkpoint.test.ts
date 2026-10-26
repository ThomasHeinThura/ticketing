import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertOwned: vi.fn(),
  drainWebhooks: vi.fn(),
  drainAutomations: vi.fn(),
}));

vi.mock("../../../apps/api/src/scheduler/leader-lock", () => ({
  assertJobExecutionOwned: () => mocks.assertOwned(),
}));
vi.mock("../../../apps/api/src/webhook/delivery", () => ({
  drainWebhookDeliveries: () => mocks.drainWebhooks(),
}));
vi.mock("../../../apps/api/src/automation/executor", () => ({
  drainAutomationRuns: () => mocks.drainAutomations(),
}));

import { drainP4Consumers } from "../../../apps/api/src/scheduler/outbox-drain-p4";

describe("P4 outbox consumer checkpoints", () => {
  beforeEach(() => {
    mocks.assertOwned.mockReset().mockResolvedValue(undefined);
    mocks.drainWebhooks.mockReset().mockResolvedValue({ degraded: false });
    mocks.drainAutomations.mockReset().mockResolvedValue({ degraded: false });
  });

  it("does not start the automation drain after losing the reservation", async () => {
    mocks.assertOwned
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("reservation lost"));

    await expect(drainP4Consumers()).rejects.toThrow("reservation lost");
    expect(mocks.drainWebhooks).toHaveBeenCalledOnce();
    expect(mocks.drainAutomations).not.toHaveBeenCalled();
  });
});
