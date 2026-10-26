import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lease = vi.hoisted(() => ({
  claim: vi.fn(),
  owns: vi.fn(),
  release: vi.fn(),
}));

vi.mock("../../../apps/api/src/scheduler/repository", () => ({
  claimJobLease: (...args: unknown[]) => lease.claim(...args),
  ownsJobLease: (...args: unknown[]) => lease.owns(...args),
  releaseJobLease: (...args: unknown[]) => lease.release(...args),
}));

import {
  assertJobExecutionOwned,
  JobExecutionReservationLostError,
  withJobExecutionReservation,
  withJobLease,
} from "../../../apps/api/src/scheduler/leader-lock";

beforeEach(() => {
  lease.claim.mockReset().mockResolvedValue(true);
  lease.owns.mockReset().mockResolvedValue(true);
  lease.release.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("job execution reservation", () => {
  it("adopts only the matching manually reserved lease and composes both ownership checks", async () => {
    const handler = vi.fn().mockResolvedValue("done");
    const assertRunOwned = vi.fn().mockResolvedValue(true);

    await expect(
      withJobExecutionReservation(
        {
          jobName: "session-cleanup",
          runId: "run-id",
          runnerId: "runner-id",
          leaseOwner: "runner-id",
          assertRunOwned,
        },
        () => withJobLease("session-cleanup", handler, () => "busy"),
      ),
    ).resolves.toBe("done");

    expect(lease.claim).not.toHaveBeenCalled();
    expect(assertRunOwned).toHaveBeenCalledOnce();
    expect(lease.owns).toHaveBeenCalledWith("session-cleanup", "runner-id");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("refuses the next work boundary after the run owner is lost", async () => {
    const handler = vi.fn(async () => assertJobExecutionOwned());

    await expect(
      withJobExecutionReservation(
        {
          jobName: "session-cleanup",
          runId: "run-id",
          runnerId: "runner-id",
          leaseOwner: "runner-id",
          assertRunOwned: async () => false,
        },
        () => withJobLease("session-cleanup", handler, () => "busy"),
      ),
    ).rejects.toBeInstanceOf(JobExecutionReservationLostError);

    expect(handler).not.toHaveBeenCalled();
  });

  it("reports a real existing lease as busy without running the handler", async () => {
    lease.claim.mockResolvedValue(false);
    const handler = vi.fn();

    await expect(
      withJobLease("session-cleanup", handler, () => "busy"),
    ).resolves.toBe("busy");
    expect(handler).not.toHaveBeenCalled();
    expect(lease.release).not.toHaveBeenCalled();
  });

  it("does not adopt a different job name's reservation", async () => {
    const handler = vi.fn().mockResolvedValue("done");

    await expect(
      withJobExecutionReservation(
        {
          jobName: "session-cleanup",
          runId: "run-id",
          runnerId: "runner-id",
          leaseOwner: "runner-id",
          assertRunOwned: async () => true,
        },
        () => withJobLease("audit-purge", handler, () => "busy"),
      ),
    ).resolves.toBe("done");

    expect(lease.claim).toHaveBeenCalledWith(
      "audit-purge",
      expect.any(String),
      expect.any(String),
    );
    expect(lease.owns).toHaveBeenCalledWith("audit-purge", expect.any(String));
    expect(handler).toHaveBeenCalledOnce();
  });
});
