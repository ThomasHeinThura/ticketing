import { beforeEach, describe, expect, it, vi } from "vitest";

const fetch = vi.hoisted(() => vi.fn());
vi.mock("@taskdesk/libs", () => ({ apiFetch: fetch }));

import {
  getPortalCanonicalPreferences,
  getPortalQuietHours,
  PORTAL_CANONICAL_EVENT_KINDS,
  savePortalCanonicalPreference,
  savePortalQuietHours,
} from "./portal-canonical-preference";

const rows = () =>
  PORTAL_CANONICAL_EVENT_KINDS.map((eventKind) => ({
    eventKind,
    channel: "notify.email",
    scope: "global",
    scopeId: null,
    enabled: true,
    digest: "off",
    source: "default",
  }));
beforeEach(() => fetch.mockReset());
describe("portal canonical preferences", () => {
  it("reads the closed nine-event matrix without caching", async () => {
    fetch.mockResolvedValue(Response.json(rows()));
    expect(await getPortalCanonicalPreferences()).toHaveLength(9);
    expect(fetch.mock.calls[0][1]).toMatchObject({
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
  });
  it.each(["work_item.mentioned", "approval.expiring"] as const)(
    "forces %s to immediate delivery",
    async (eventKind) => {
      fetch.mockResolvedValue(Response.json(rows()));
      await savePortalCanonicalPreference({
        eventKind,
        enabled: false,
        digest: "daily",
      });
      expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
        eventKind,
        enabled: false,
        digest: "off",
        channel: "notify.email",
        scope: "global",
        scopeId: null,
      });
    },
  );
  it("preserves digest cadence for non-urgent events", async () => {
    fetch.mockResolvedValue(Response.json(rows()));
    await savePortalCanonicalPreference({
      eventKind: "submission.accepted",
      enabled: true,
      digest: "daily",
    });
    expect(JSON.parse(fetch.mock.calls[0][1].body).digest).toBe("daily");
  });
  it.each([
    { value: [...rows(), { ...rows()[0], eventKind: "secret.event" }] },
    { value: rows().slice(1) },
    {
      value: rows().map((row, index) =>
        index === 0 ? { ...row, channel: "notify.in_app" } : row,
      ),
    },
    {
      value: rows().map((row, index) =>
        index === 0 ? { ...row, digest: "daily" } : row,
      ),
    },
  ])("rejects malformed or unsupported matrix rows", async ({ value }) => {
    fetch.mockResolvedValue(Response.json(value));
    await expect(getPortalCanonicalPreferences()).rejects.toThrow(
      "Invalid notification preferences",
    );
  });
  it("uses the customer quiet-hours endpoint and exact nullable body", async () => {
    const value = { start: "22:00", end: "07:00", timezone: "UTC" };
    fetch
      .mockResolvedValueOnce(Response.json(null))
      .mockResolvedValueOnce(Response.json(value))
      .mockResolvedValueOnce(Response.json(null));
    await expect(getPortalQuietHours()).resolves.toBeNull();
    await expect(savePortalQuietHours(value)).resolves.toEqual(value);
    expect(fetch.mock.calls[1][0]).toContain(
      "/portal/notification-preferences/canonical/quiet-hours",
    );
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      quietHours: value,
    });
    await expect(savePortalQuietHours(null)).resolves.toBeNull();
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({
      quietHours: null,
    });
  });
  it.each([
    { start: "22:00", end: "22:00", timezone: "UTC" },
    { start: "24:00", end: "07:00", timezone: "UTC" },
    { start: "22:00", end: "07:00", timezone: "Invalid/Zone" },
    { start: "22:00", end: "07:00" },
  ])("rejects invalid quiet-hour responses", async (value) => {
    fetch.mockResolvedValue(Response.json(value));
    await expect(getPortalQuietHours()).rejects.toThrow("Invalid quiet hours");
  });
  it("preserves permission and save refusals", async () => {
    fetch.mockResolvedValue(Response.json({}, { status: 404 }));
    await expect(savePortalQuietHours(null)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      savePortalCanonicalPreference({
        eventKind: "approval.requested",
        enabled: false,
        digest: "off",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
