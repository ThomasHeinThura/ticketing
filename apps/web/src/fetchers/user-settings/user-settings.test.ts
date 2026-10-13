import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUserSettings } from "./user-settings";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@taskdesk/libs", () => ({
  client: { me: { settings: { $get: mocks.get, $patch: vi.fn() } } },
}));

describe("getUserSettings", () => {
  beforeEach(() => mocks.get.mockReset());

  it("returns a well-formed settings object", async () => {
    mocks.get.mockResolvedValue({
      ok: true,
      json: async () => ({ settings: { density: "compact" } }),
    });
    await expect(getUserSettings()).resolves.toEqual({
      settings: { density: "compact" },
    });
  });

  it.each([
    ["an empty array (a catch-all stub)", []],
    ["an empty object", {}],
    ["null", null],
    ["settings as an array", { settings: [] }],
    ["settings as a string", { settings: "x" }],
  ])("rejects %s instead of returning it", async (_name, body) => {
    mocks.get.mockResolvedValue({ ok: true, json: async () => body });
    await expect(getUserSettings()).rejects.toMatchObject({ status: 502 });
  });

  it("rejects a non-2xx response with its status", async () => {
    mocks.get.mockResolvedValue({ ok: false, status: 404 });
    await expect(getUserSettings()).rejects.toMatchObject({ status: 404 });
  });
});
