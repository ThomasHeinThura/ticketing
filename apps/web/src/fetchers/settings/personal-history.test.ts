import { afterEach, expect, it, vi } from "vitest";
import { getSelfHistory } from "./personal-history";

afterEach(() => vi.unstubAllGlobals());

const at = "2026-01-01T00:00:00Z";
const stub = (body: unknown, status = 200) => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};

it.each([
  [
    "profile",
    "staff",
    "me/settings/history?section=profile",
    "changedFields",
    ["name", "locale", "image"],
  ],
  [
    "preferences",
    "staff",
    "me/settings/history?section=preferences",
    "changedFields",
    ["density", "columns"],
  ],
  [
    "notifications",
    "staff",
    "me/settings/history?section=notifications",
    "changedCategories",
    ["delivery", "workspaceRule"],
  ],
  [
    "notifications",
    "portal",
    "portal/account/settings-history?section=notifications",
    "changedCategories",
    ["digest"],
  ],
  [
    "security",
    "staff",
    "me/settings/history?section=security",
    "changedCategories",
    ["password", "mfa"],
  ],
  [
    "security",
    "portal",
    "portal/account/settings-history?section=security",
    "changedCategories",
    ["password"],
  ],
  [
    "apiKeys",
    "staff",
    "me/settings/history?section=apiKeys",
    "changedCategories",
    ["personalKey"],
  ],
] as const)(
  "reads closed %s %s history as normalised rows",
  async (section, audience, path, field, markers) => {
    const fetcher = stub({
      section,
      lastChanged: { at, actor: "you", secret: "hidden" },
      rows: [{ at, actor: "you", [field]: markers, keyId: "hidden" }],
    });
    const signal = new AbortController().signal;
    const result = await getSelfHistory({ audience, section } as never, signal);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(path);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      credentials: "include",
      signal,
    });
    expect(result).toEqual({
      section,
      lastChanged: { at, actor: "you" },
      rows: [{ at, changed: [...markers] }],
    });
  },
);

it("rejects a marker outside the section's closed set and a wrong section", async () => {
  const signal = new AbortController().signal;
  stub({
    section: "security",
    lastChanged: null,
    rows: [{ at, actor: "you", changedCategories: ["mfa"] }],
  });
  await expect(
    getSelfHistory({ audience: "portal", section: "security" }, signal),
  ).rejects.toThrow();
  stub({ section: "profile", lastChanged: null, rows: [] });
  await expect(
    getSelfHistory({ audience: "staff", section: "security" }, signal),
  ).rejects.toThrow();
});

it("keeps the refusal status without the body", async () => {
  stub({ message: "secret" }, 403);
  await expect(
    getSelfHistory(
      { audience: "staff", section: "profile" },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ status: 403, message: "Failed to load history" });
});
