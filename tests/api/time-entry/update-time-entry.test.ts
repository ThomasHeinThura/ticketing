import type { ResolvedIdentity } from "@taskdesk/permissions";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findTimeEntryMutationTarget: vi.fn(),
  lockTimeEntryForUpdate: vi.fn(),
  assertCallerHasCapabilityOrOwner: vi.fn(),
  projectFeatureEnabled: vi.fn(),
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
  findTimeEntryMutationTarget: (...args: unknown[]) =>
    mocks.findTimeEntryMutationTarget(...args),
  lockTimeEntryForUpdate: (...args: unknown[]) =>
    mocks.lockTimeEntryForUpdate(...args),
  lockTaskAndAssertProjectLive: (...args: unknown[]) =>
    mocks.lockTaskAndAssertProjectLive(...args),
  updateTimeEntryById: (...args: unknown[]) =>
    mocks.updateTimeEntryById(...args),
}));

vi.mock("../../../apps/api/src/utils/require-workspace-capability", () => ({
  assertCallerHasCapabilityOrOwner: (...args: unknown[]) =>
    mocks.assertCallerHasCapabilityOrOwner(...args),
}));

vi.mock("../../../apps/api/src/feature-flag/enforce", () => ({
  projectFeatureEnabled: (...args: unknown[]) =>
    mocks.projectFeatureEnabled(...args),
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
    mocks.findTimeEntryMutationTarget.mockResolvedValue(undefined);
    mocks.lockTimeEntryForUpdate.mockResolvedValue(undefined);
    mocks.assertCallerHasCapabilityOrOwner.mockResolvedValue(undefined);
    mocks.projectFeatureEnabled.mockResolvedValue(true);
    mocks.lockTaskAndAssertProjectLive.mockResolvedValue({
      workspaceId: "workspace-1",
      projectId: "project-1",
    });
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
    mocks.findTimeEntryMutationTarget.mockResolvedValue({
      id: "time-entry-1",
      taskId: "task-1",
    });
    mocks.lockTimeEntryForUpdate.mockResolvedValue({
      ownerPersonId: identity.personId,
      id: "time-entry-1",
      taskId: "task-1",
      startTime: storedStartTime,
      endTime: storedEndTime,
      duration: 3600,
    });
    mocks.updateTimeEntryById.mockResolvedValue(updatedRow);

    await updateTimeEntry({
      identity,
      credential: { kind: "session" },
      timeEntryId: "time-entry-1",
      startTime: nextStartTime,
      description: "renamed",
    });

    expect(mocks.findTimeEntryMutationTarget).toHaveBeenCalledWith(
      identity,
      "time-entry-1",
    );
    expect(mocks.lockTimeEntryForUpdate).toHaveBeenCalledWith(
      mocks.tx,
      identity,
      "time-entry-1",
      "task-1",
    );
    expect(mocks.lockTaskAndAssertProjectLive).toHaveBeenCalledWith(
      mocks.tx,
      identity,
      "task-1",
    );
    expect(mocks.assertCallerHasCapabilityOrOwner).toHaveBeenCalledWith(
      "workspace-1",
      identity.userId,
      "time_entry:update_any",
      "time_entry:update_own",
      true,
      { kind: "session" },
      mocks.tx,
    );
    expect(mocks.projectFeatureEnabled).toHaveBeenCalledWith(
      "feature.time_tracking",
      "project-1",
      mocks.tx,
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
    mocks.findTimeEntryMutationTarget.mockResolvedValue({
      id: "time-entry-1",
      taskId: "task-1",
    });
    mocks.lockTimeEntryForUpdate.mockResolvedValue({
      ownerPersonId: identity.personId,
      id: "time-entry-1",
      taskId: "task-1",
      startTime: new Date("2026-08-10T10:00:00.000Z"),
      endTime: new Date("2026-08-10T11:00:00.000Z"),
      duration: 3600,
    });

    await expect(
      updateTimeEntry({
        identity,
        credential: { kind: "session" },
        timeEntryId: "time-entry-1",
        startTime: new Date("2026-08-10T12:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ status: 400 });

    expect(mocks.findTimeEntryMutationTarget).toHaveBeenCalledWith(
      identity,
      "time-entry-1",
    );
    expect(mocks.lockTimeEntryForUpdate).toHaveBeenCalledWith(
      mocks.tx,
      identity,
      "time-entry-1",
      "task-1",
    );
    expect(mocks.lockTaskAndAssertProjectLive).toHaveBeenCalledWith(
      mocks.tx,
      identity,
      "task-1",
    );
    expect(mocks.updateTimeEntryById).not.toHaveBeenCalled();
  });

  it("rejects a startTime later than an endTime supplied in the same update", async () => {
    mocks.findTimeEntryMutationTarget.mockResolvedValue({
      id: "time-entry-1",
      taskId: "task-1",
    });
    mocks.lockTimeEntryForUpdate.mockResolvedValue({
      ownerPersonId: identity.personId,
      id: "time-entry-1",
      taskId: "task-1",
      startTime: new Date("2026-08-10T10:00:00.000Z"),
      endTime: null,
      duration: null,
    });

    await expect(
      updateTimeEntry({
        identity,
        credential: { kind: "session" },
        timeEntryId: "time-entry-1",
        startTime: new Date("2026-08-10T12:00:00.000Z"),
        endTime: new Date("2026-08-10T11:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ status: 400 });

    expect(mocks.findTimeEntryMutationTarget).toHaveBeenCalledWith(
      identity,
      "time-entry-1",
    );
    expect(mocks.lockTimeEntryForUpdate).toHaveBeenCalledWith(
      mocks.tx,
      identity,
      "time-entry-1",
      "task-1",
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
    mocks.findTimeEntryMutationTarget.mockResolvedValue({
      id: "time-entry-1",
      taskId: "task-1",
    });
    mocks.lockTimeEntryForUpdate.mockResolvedValue({
      ownerPersonId: identity.personId,
      id: "time-entry-1",
      taskId: "task-1",
      startTime: new Date("2026-08-10T10:00:00.000Z"),
      endTime: null,
      duration: null,
    });
    mocks.updateTimeEntryById.mockResolvedValue({ id: "time-entry-1" });

    await updateTimeEntry({
      identity,
      credential: { kind: "session" },
      timeEntryId: "time-entry-1",
      startTime: nextStartTime,
    });

    expect(mocks.findTimeEntryMutationTarget).toHaveBeenCalledWith(
      identity,
      "time-entry-1",
    );
    expect(mocks.lockTimeEntryForUpdate).toHaveBeenCalledWith(
      mocks.tx,
      identity,
      "time-entry-1",
      "task-1",
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

  it("uses the locked row's current owner and denies a lost own/any capability", async () => {
    mocks.findTimeEntryMutationTarget.mockResolvedValue({ taskId: "task-1" });
    mocks.lockTimeEntryForUpdate.mockResolvedValue({
      taskId: "task-1",
      ownerPersonId: "another-person",
      endTime: null,
    });
    mocks.assertCallerHasCapabilityOrOwner.mockRejectedValue({ status: 403 });

    await expect(
      updateTimeEntry({
        identity,
        credential: { kind: "session" },
        timeEntryId: "time-entry-1",
        startTime: new Date("2026-08-10T12:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.assertCallerHasCapabilityOrOwner).toHaveBeenCalledWith(
      "workspace-1",
      identity.userId,
      "time_entry:update_any",
      "time_entry:update_own",
      false,
      { kind: "session" },
      mocks.tx,
    );
    expect(mocks.updateTimeEntryById).not.toHaveBeenCalled();
  });

  it("rechecks the project feature in the write transaction", async () => {
    mocks.findTimeEntryMutationTarget.mockResolvedValue({ taskId: "task-1" });
    mocks.lockTimeEntryForUpdate.mockResolvedValue({
      taskId: "task-1",
      ownerPersonId: identity.personId,
      endTime: null,
    });
    mocks.projectFeatureEnabled.mockResolvedValue(false);

    await expect(
      updateTimeEntry({
        identity,
        credential: { kind: "session" },
        timeEntryId: "time-entry-1",
        startTime: new Date("2026-08-10T12:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.projectFeatureEnabled).toHaveBeenCalledWith(
      "feature.time_tracking",
      "project-1",
      mocks.tx,
    );
    expect(mocks.updateTimeEntryById).not.toHaveBeenCalled();
  });
});
