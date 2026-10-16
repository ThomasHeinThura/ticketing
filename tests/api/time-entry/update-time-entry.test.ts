import type { ResolvedIdentity } from "@taskdesk/permissions";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findTimeEntryById: vi.fn(),
  lockTaskAndAssertProjectLive: vi.fn(),
  updateTimeEntryById: vi.fn(),
  transaction: vi.fn(),
  tx: { marker: "time-entry-transaction" },
}));

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    transaction: (callback: (tx: unknown) => unknown) =>
      mocks.transaction(callback),
  },
}));

vi.mock("../../../apps/api/src/time-entry/repository", () => ({
  findTimeEntryById: (...args: unknown[]) => mocks.findTimeEntryById(...args),
  lockTaskAndAssertProjectLive: (...args: unknown[]) =>
    mocks.lockTaskAndAssertProjectLive(...args),
  updateTimeEntryById: (...args: unknown[]) =>
    mocks.updateTimeEntryById(...args),
}));

import updateTimeEntry from "../../../apps/api/src/time-entry/controllers/update-time-entry";

const identity: ResolvedIdentity = {
  userId: "user-1",
  personId: "person-1",
  side: "staff",
  organisationId: "organisation-1",
  portal: "agent",
  credential: "session",
  memberships: [],
  teamIds: [],
  reach: { kind: "membership" },
  authority: [],
};

describe("updateTimeEntry", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) => callback(mocks.tx),
    );
    mocks.findTimeEntryById.mockResolvedValue(undefined);
    mocks.lockTaskAndAssertProjectLive.mockResolvedValue(undefined);
    mocks.updateTimeEntryById.mockResolvedValue(undefined);
  });

  it("preserves a stored endTime and duration when endTime is omitted", async () => {
    const storedStartTime = new Date("2026-08-10T10:00:00.000Z");
    const storedEndTime = new Date("2026-08-10T11:00:00.000Z");
    const nextStartTime = new Date("2026-08-10T10:15:00.000Z");
    const updatedRow = {
      id: "time-entry-1",
      startTime: nextStartTime,
      endTime: storedEndTime,
      duration: 2700,
      description: "renamed",
    };
    mocks.findTimeEntryById.mockResolvedValue({
      id: "time-entry-1",
      taskId: "task-1",
      startTime: storedStartTime,
      endTime: storedEndTime,
      duration: 3600,
    });
    mocks.updateTimeEntryById.mockResolvedValue(updatedRow);

    await updateTimeEntry({
      identity,
      timeEntryId: "time-entry-1",
      startTime: nextStartTime,
      description: "renamed",
    });

    expect(mocks.findTimeEntryById).toHaveBeenCalledWith(
      identity,
      "time-entry-1",
    );
    expect(mocks.lockTaskAndAssertProjectLive).toHaveBeenCalledWith(
      mocks.tx,
      identity,
      "task-1",
    );
    expect(mocks.updateTimeEntryById).toHaveBeenCalledWith(
      mocks.tx,
      identity,
      "time-entry-1",
      {
        startTime: nextStartTime,
        endTime: storedEndTime,
        duration: 2700,
        description: "renamed",
      },
    );
  });

  it("rejects a startTime later than the preserved endTime", async () => {
    mocks.findTimeEntryById.mockResolvedValue({
      id: "time-entry-1",
      taskId: "task-1",
      startTime: new Date("2026-08-10T10:00:00.000Z"),
      endTime: new Date("2026-08-10T11:00:00.000Z"),
      duration: 3600,
    });

    await expect(
      updateTimeEntry({
        identity,
        timeEntryId: "time-entry-1",
        startTime: new Date("2026-08-10T12:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ status: 400 });

    expect(mocks.findTimeEntryById).toHaveBeenCalledWith(
      identity,
      "time-entry-1",
    );
    expect(mocks.lockTaskAndAssertProjectLive).toHaveBeenCalledWith(
      mocks.tx,
      identity,
      "task-1",
    );
    expect(mocks.updateTimeEntryById).not.toHaveBeenCalled();
  });

  it("rejects a startTime later than an endTime supplied in the same update", async () => {
    mocks.findTimeEntryById.mockResolvedValue({
      id: "time-entry-1",
      taskId: "task-1",
      startTime: new Date("2026-08-10T10:00:00.000Z"),
      endTime: null,
      duration: null,
    });

    await expect(
      updateTimeEntry({
        identity,
        timeEntryId: "time-entry-1",
        startTime: new Date("2026-08-10T12:00:00.000Z"),
        endTime: new Date("2026-08-10T11:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ status: 400 });

    expect(mocks.findTimeEntryById).toHaveBeenCalledWith(
      identity,
      "time-entry-1",
    );
    expect(mocks.lockTaskAndAssertProjectLive).toHaveBeenCalledWith(
      mocks.tx,
      identity,
      "task-1",
    );
    expect(mocks.updateTimeEntryById).not.toHaveBeenCalled();
  });

  it("still allows an open entry to have its startTime moved forward", async () => {
    const nextStartTime = new Date("2026-08-10T12:00:00.000Z");
    mocks.findTimeEntryById.mockResolvedValue({
      id: "time-entry-1",
      taskId: "task-1",
      startTime: new Date("2026-08-10T10:00:00.000Z"),
      endTime: null,
      duration: null,
    });
    mocks.updateTimeEntryById.mockResolvedValue({ id: "time-entry-1" });

    await updateTimeEntry({
      identity,
      timeEntryId: "time-entry-1",
      startTime: nextStartTime,
    });

    expect(mocks.findTimeEntryById).toHaveBeenCalledWith(
      identity,
      "time-entry-1",
    );
    expect(mocks.lockTaskAndAssertProjectLive).toHaveBeenCalledWith(
      mocks.tx,
      identity,
      "task-1",
    );
    expect(mocks.updateTimeEntryById).toHaveBeenCalledWith(
      mocks.tx,
      identity,
      "time-entry-1",
      { startTime: nextStartTime, endTime: null, duration: null },
    );
  });
});
