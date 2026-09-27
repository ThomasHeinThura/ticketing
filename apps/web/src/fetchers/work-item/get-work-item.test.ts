import { beforeEach, describe, expect, it, vi } from "vitest";
import getWorkItem from "./get-work-item";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("@taskdesk/libs", () => ({
  client: {
    "work-items": {
      ":key": {
        $get: mocks.get,
      },
    },
  },
}));

function makeDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: "wi_1",
    projectId: "proj_1",
    workspaceId: "ws_1",
    typeId: "type_1",
    number: 1,
    key: "PROJ-1",
    title: "Fix the thing",
    description: null,
    stateId: "state_1",
    stateName: "Backlog",
    stateCategory: "backlog",
    priority: "high",
    assigneeId: null,
    assigneeName: null,
    requesterId: null,
    parentId: null,
    position: "1.0000000000",
    customerVisibility: "private",
    startDate: null,
    dueDate: "2026-10-01T00:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    version: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("getWorkItem", () => {
  beforeEach(() => {
    mocks.get.mockReset();
  });

  it("returns the parsed row with no unavailable fields for a valid response", async () => {
    mocks.get.mockResolvedValue({
      ok: true,
      json: async () => makeDetail(),
    });

    const row = await getWorkItem("PROJ-1");

    expect(mocks.get).toHaveBeenCalledWith({ param: { key: "PROJ-1" } });
    expect(row.unavailableFields).toEqual([]);
    expect(row.key).toBe("PROJ-1");
    expect(row.title).toBe("Fix the thing");
    expect(row.stateName).toBe("Backlog");
  });

  it("marks a field unavailable rather than throwing when one field fails validation", async () => {
    mocks.get.mockResolvedValue({
      ok: true,
      json: async () => makeDetail({ stateName: "" }),
    });

    const row = await getWorkItem("PROJ-1");

    expect(row.unavailableFields).toEqual(["stateName"]);
    // The rest of the row still renders.
    expect(row.title).toBe("Fix the thing");
  });

  it("throws an HttpError carrying the real status for a non-ok response (the screen needs the 404)", async () => {
    mocks.get.mockResolvedValue({ ok: false, status: 404 });

    await expect(getWorkItem("PROJ-404")).rejects.toMatchObject({
      name: "HttpError",
      status: 404,
    });
  });
});
