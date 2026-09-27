import { beforeEach, describe, expect, it, vi } from "vitest";
import getWorkItems from "./get-work-items";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("@taskdesk/libs", () => ({
  client: {
    projects: {
      ":projectId": {
        "work-items": {
          $get: mocks.get,
        },
      },
    },
  },
}));

function makeItem(overrides: Record<string, unknown> = {}) {
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

function makeEnvelope(
  data: unknown[],
  page: { nextCursor: string | null; hasMore: boolean } = {
    nextCursor: null,
    hasMore: false,
  },
) {
  return { data, page, meta: { total: data.length } };
}

describe("getWorkItems", () => {
  beforeEach(() => {
    mocks.get.mockReset();
  });

  it("returns hasPartialFailure: false with every row intact when the whole response is valid", async () => {
    const goodA = makeItem({ id: "wi_1", key: "PROJ-1", number: 1 });
    const goodB = makeItem({ id: "wi_2", key: "PROJ-2", number: 2 });
    mocks.get.mockResolvedValue({
      ok: true,
      json: async () => makeEnvelope([goodA, goodB]),
    });

    const result = await getWorkItems("proj_1", "key", "asc");

    expect(result.hasPartialFailure).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.unavailableFields).toEqual([]);
    expect(result.items[1]?.unavailableFields).toEqual([]);
    expect(result.items[0]?.title).toBe("Fix the thing");
    expect(result.hasMore).toBe(false);
  });

  it("returns hasPartialFailure: true when one row is bad, keeping the good rows intact", async () => {
    const good = makeItem({ id: "wi_1", key: "PROJ-1", number: 1 });
    const bad = makeItem({
      id: "wi_2",
      key: "PROJ-2",
      number: 2,
      title: "",
    });
    mocks.get.mockResolvedValue({
      ok: true,
      json: async () => makeEnvelope([good, bad]),
    });

    const result = await getWorkItems("proj_1", "key", "asc");

    expect(result.hasPartialFailure).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.unavailableFields).toEqual([]);
    expect(result.items[0]?.title).toBe("Fix the thing");
    expect(result.items[1]?.unavailableFields).toEqual(["title"]);
    expect(result.items[1]?.id).toBe("wi_2");
  });

  it("throws on a non-ok response rather than reporting a partial failure", async () => {
    mocks.get.mockResolvedValue({ ok: false, status: 500 });

    await expect(getWorkItems("proj_1", "key", "asc")).rejects.toThrow(
      "Failed to fetch work items",
    );
  });

  it("forwards sort/dir as query params, and reports page.hasMore from the envelope (#310)", async () => {
    mocks.get.mockResolvedValue({
      ok: true,
      json: async () =>
        makeEnvelope([makeItem()], { nextCursor: "abc", hasMore: true }),
    });

    const result = await getWorkItems("proj_1", "priority", "desc");

    expect(mocks.get).toHaveBeenCalledWith({
      param: { projectId: "proj_1" },
      query: { sort: "priority", dir: "desc" },
    });
    expect(result.hasMore).toBe(true);
  });
});
