import { beforeEach, describe, expect, it, vi } from "vitest";

const fetch = vi.hoisted(() => vi.fn());
vi.mock("@taskdesk/libs", () => ({ apiFetch: fetch }));

import {
  getEmailLinkHandoff,
  saveMentionEmailPreference,
} from "./canonical-mention-preference";

beforeEach(() => fetch.mockReset());
describe("exact email preference", () => {
  it("treats absent/mismatched handoffs as no selector without changing preferences", async () => {
    fetch.mockResolvedValue(
      Response.json({ message: "Not found" }, { status: 404 }),
    );
    await expect(getEmailLinkHandoff()).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]).toMatchObject({
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
  });
  it("rejects malformed selectors", async () => {
    fetch.mockResolvedValue(
      Response.json({ eventKind: "work_item.mentioned" }),
    );
    await expect(getEmailLinkHandoff()).rejects.toThrow(
      "Invalid preference selector",
    );
  });
  it("writes only the explicit global mention preference", async () => {
    fetch.mockResolvedValue(Response.json({}));
    await saveMentionEmailPreference(false);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      canonicalPreference: {
        eventKind: "work_item.mentioned",
        channel: "notify.email",
        scope: "global",
        scopeId: null,
        enabled: false,
        digest: "off",
      },
    });
  });
  it("preserves denial instead of reporting a save", async () => {
    fetch.mockResolvedValue(Response.json({}, { status: 403 }));
    await expect(saveMentionEmailPreference(false)).rejects.toMatchObject({
      status: 403,
    });
  });
});
