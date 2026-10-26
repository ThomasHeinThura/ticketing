import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertOwned: vi.fn(),
  processDigest: vi.fn(),
  sealDigests: vi.fn(),
}));

vi.mock("../../../apps/api/src/scheduler/leader-lock", () => ({
  assertJobExecutionOwned: () => mocks.assertOwned(),
  withJobLease: async (_name: string, run: () => Promise<unknown>) => run(),
}));
vi.mock("../../../apps/api/src/notification/digest-delivery", () => ({
  processNextNotificationDigest: () => mocks.processDigest(),
}));
vi.mock("../../../apps/api/src/notification/digest-seal", () => ({
  sealDueDigestGroups: () => mocks.sealDigests(),
}));

import { runNotificationDigest } from "../../../apps/api/src/scheduler/notification-digest";

describe("cooperative scheduler checkpoints", () => {
  beforeEach(() => {
    mocks.assertOwned
      .mockReset()
      .mockRejectedValue(new Error("reservation lost"));
    mocks.processDigest.mockReset();
    mocks.sealDigests.mockReset().mockResolvedValue(1);
  });

  it("stops before the next digest unit when the run reservation is lost", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await expect(runNotificationDigest()).rejects.toThrow("reservation lost");
    expect(mocks.sealDigests).toHaveBeenCalledOnce();
    expect(mocks.processDigest).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
