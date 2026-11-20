import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSettingsHistory,
  settingsHistoryQueryKey,
} from "./settings-history";

const get = vi.hoisted(() => vi.fn());
vi.mock("@taskdesk/libs", () => ({ client: { audit: { $get: get } } }));

describe("getSettingsHistory", () => {
  beforeEach(() => get.mockReset());
  it("requests the exact entity and rejects a mismatched response", async () => {
    get.mockResolvedValue({
      ok: true,
      json: async () => ({
        entityType: "workspace",
        entityId: "other",
        rows: [],
        lastChanged: null,
      }),
    });
    await expect(getSettingsHistory("workspace", "w1")).rejects.toThrow(
      "Unexpected",
    );
    expect(get).toHaveBeenCalledWith({
      query: { entity_type: "workspace", entity_id: "w1" },
    });
  });
  it("preserves refusal status without exposing the response body", async () => {
    get.mockResolvedValue({ ok: false, status: 403 });
    await expect(getSettingsHistory("workspace", "w1")).rejects.toMatchObject({
      status: 403,
    });
  });
});
it("forwards the optional abort signal to the entity request", async () => {
  const controller = new AbortController();
  get.mockResolvedValue({
    ok: true,
    json: async () => ({
      entityType: "workspace",
      entityId: "w1",
      rows: [],
      lastChanged: null,
    }),
  });
  await getSettingsHistory("workspace", "w1", controller.signal);
  expect(get).toHaveBeenCalledWith(
    { query: { entity_type: "workspace", entity_id: "w1" } },
    { init: { signal: controller.signal } },
  );
});

it("partitions the same terminology cell by explicit instance and workspace scope", async () => {
  const id = "request:both:en-US";
  const instance = { scope: "instance" } as const;
  const workspaceA = { scope: "workspace", workspaceId: "w1" } as const;
  const workspaceB = { scope: "workspace", workspaceId: "w2" } as const;
  expect(
    settingsHistoryQueryKey("terminology_override", id, "u", "s", instance),
  ).not.toEqual(
    settingsHistoryQueryKey("terminology_override", id, "u", "s", workspaceA),
  );
  expect(
    settingsHistoryQueryKey("terminology_override", id, "u", "s", workspaceA),
  ).not.toEqual(
    settingsHistoryQueryKey("terminology_override", id, "u", "s", workspaceB),
  );
  get.mockResolvedValue({
    ok: true,
    json: async () => ({
      entityType: "terminology_override",
      entityId: id,
      rows: [],
      lastChanged: null,
    }),
  });
  await getSettingsHistory("terminology_override", id, undefined, workspaceA);
  expect(get).toHaveBeenCalledWith({
    query: {
      entity_type: "terminology_override",
      entity_id: id,
      scope: "workspace",
      workspace_id: "w1",
    },
  });
  await getSettingsHistory("terminology_override", id, undefined, instance);
  expect(get).toHaveBeenCalledWith({
    query: {
      entity_type: "terminology_override",
      entity_id: id,
      scope: "instance",
    },
  });
});
