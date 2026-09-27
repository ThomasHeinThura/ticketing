import { beforeEach, describe, expect, it, vi } from "vitest";
import getWorkItemTypes from "./get-work-item-types";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("@taskdesk/libs", () => ({
  client: {
    workspace: {
      ":workspaceId": {
        "work-item-types": {
          $get: mocks.get,
        },
      },
    },
  },
}));

function makeType(overrides: Record<string, unknown> = {}) {
  return {
    id: "type-1",
    key: "task",
    name: "Task",
    icon: null,
    category: "delivery",
    isEpic: false,
    isChange: false,
    ...overrides,
  };
}

describe("getWorkItemTypes", () => {
  beforeEach(() => {
    mocks.get.mockReset();
  });

  it("returns valid rows and calls the route with the workspace id", async () => {
    mocks.get.mockResolvedValue({
      ok: true,
      json: async () => [makeType(), makeType({ id: "type-2", name: "Bug" })],
    });

    const rows = await getWorkItemTypes("ws-1");

    expect(mocks.get).toHaveBeenCalledWith({ param: { workspaceId: "ws-1" } });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.name).toBe("Task");
  });

  it("drops a malformed row rather than offering an unusable option", async () => {
    mocks.get.mockResolvedValue({
      ok: true,
      json: async () => [
        makeType(),
        makeType({ id: "", name: "No id" }),
        makeType({ id: "type-3", name: "   " }),
        makeType({ id: "type-4", key: "" }),
      ],
    });

    const rows = await getWorkItemTypes("ws-1");

    expect(rows.map((row) => row.id)).toEqual(["type-1"]);
  });

  it("throws an HttpError carrying the real status for a non-ok response", async () => {
    mocks.get.mockResolvedValue({ ok: false, status: 403 });

    await expect(getWorkItemTypes("ws-1")).rejects.toMatchObject({
      name: "HttpError",
      status: 403,
    });
  });
});
