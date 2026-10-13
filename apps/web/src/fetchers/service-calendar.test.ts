import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getServiceCalendarUsage,
  requestServiceCalendarDeletion,
  ServiceCalendarConflictError,
  updateServiceCalendar,
} from "./service-calendar";

const mocks = vi.hoisted(() => ({
  patch: vi.fn(),
  del: vi.fn(),
  usage: vi.fn(),
}));

vi.mock("@taskdesk/libs", () => ({
  client: {
    "service-calendars": {
      ":id": {
        $patch: mocks.patch,
        $delete: mocks.del,
        usage: { $get: mocks.usage },
      },
    },
  },
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

describe("service calendar usage and deletion", () => {
  beforeEach(() => {
    mocks.del.mockReset();
    mocks.usage.mockReset();
  });

  it("reads aggregate usage counts by calendar id", async () => {
    const body = {
      calendarId: "cal-1",
      counts: {
        projects: 1,
        slaPolicyVersions: 2,
        currentSlaPolicies: 1,
        workItems: 0,
      },
    };
    mocks.usage.mockResolvedValue({ ok: true, json: async () => body });
    await expect(getServiceCalendarUsage("cal-1")).resolves.toEqual(body);
    expect(mocks.usage).toHaveBeenCalledWith({ param: { id: "cal-1" } });
  });

  it("returns the pending action from a 202 deletion request", async () => {
    const pending = { pendingActionId: "pa-1", action: "delete" };
    mocks.del.mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => pending,
    });
    await expect(requestServiceCalendarDeletion("cal-1")).resolves.toEqual(
      pending,
    );
    expect(mocks.del).toHaveBeenCalledWith({ param: { id: "cal-1" } });
  });

  it("surfaces the server message when the calendar is still in use", async () => {
    mocks.del.mockResolvedValue({
      ok: false,
      status: 409,
      text: async () =>
        JSON.stringify({ message: "Calendar is in use by 1 project" }),
    });
    await expect(requestServiceCalendarDeletion("cal-1")).rejects.toMatchObject(
      { status: 409, message: "Calendar is in use by 1 project" },
    );
  });
});
