import type { ResolvedIdentity } from "@taskdesk/permissions";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findTimeEntryById: vi.fn(),
}));

vi.mock("../../../apps/api/src/time-entry/repository", () => ({
  findTimeEntryById: (...args: unknown[]) => mocks.findTimeEntryById(...args),
}));

import getTimeEntry from "../../../apps/api/src/time-entry/controllers/get-time-entry";

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

describe("getTimeEntry", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("conceals an entry that disappears after route reach admission", async () => {
    // The route's fromTimeEntry middleware admits the row first; this controller
    // read is the second scoped lookup and may observe a concurrent deletion.
    mocks.findTimeEntryById.mockResolvedValue(undefined);

    await expect(getTimeEntry(identity, "entry-1")).rejects.toMatchObject({
      status: 404,
      message: "Time entry not found",
    });
    expect(mocks.findTimeEntryById).toHaveBeenCalledWith(identity, "entry-1");
  });

  it("returns an entry that remains reachable", async () => {
    const entry = { id: "entry-1", description: "work" };
    mocks.findTimeEntryById.mockResolvedValue(entry);

    await expect(getTimeEntry(identity, "entry-1")).resolves.toBe(entry);
  });
});
