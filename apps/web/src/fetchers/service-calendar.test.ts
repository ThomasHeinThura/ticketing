import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ServiceCalendarConflictError,
  updateServiceCalendar,
} from "./service-calendar";

const mocks = vi.hoisted(() => ({ patch: vi.fn() }));

vi.mock("@taskdesk/libs", () => ({
  client: { "service-calendars": { ":id": { $patch: mocks.patch } } },
}));

describe("service calendar optimistic concurrency", () => {
  beforeEach(() => mocks.patch.mockReset());

  it("sends the loaded version in If-Match", async () => {
    mocks.patch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "cal-1", version: 4 }),
    });
    await updateServiceCalendar({
      id: "cal-1",
      version: 3,
      data: { name: "Hours", timezone: "UTC", windows: {}, holidays: [] },
    });
    expect(mocks.patch).toHaveBeenCalledWith({
      param: { id: "cal-1" },
      header: { "if-match": '"3"' },
      json: { name: "Hours", timezone: "UTC", windows: {}, holidays: [] },
    });
  });

  it("surfaces asserted/current versions without retrying a conflict", async () => {
    mocks.patch.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        message: "Version mismatch",
        assertedVersion: 3,
        currentVersion: 4,
      }),
    });
    const update = updateServiceCalendar({
      id: "cal-1",
      version: 3,
      data: { name: "Hours", timezone: "UTC", windows: {}, holidays: [] },
    });
    await expect(update).rejects.toBeInstanceOf(ServiceCalendarConflictError);
    await expect(update).rejects.toMatchObject({
      status: 409,
      assertedVersion: 3,
      currentVersion: 4,
    });
    expect(mocks.patch).toHaveBeenCalledTimes(1);
  });
});
