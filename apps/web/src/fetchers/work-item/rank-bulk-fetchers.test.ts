import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import bulkAssignWorkItems from "./bulk-assign-work-items";
import rankWorkItem from "./rank-work-item";

const mocks = vi.hoisted(() => ({ rank: vi.fn(), bulk: vi.fn() }));

vi.mock("@taskdesk/libs", () => ({
  client: {
    "work-items": {
      ":key": { rank: { $post: mocks.rank } },
      bulk: { $post: mocks.bulk },
    },
  },
}));

beforeEach(() => {
  mocks.rank.mockReset();
  mocks.bulk.mockReset();
});

describe("rankWorkItem", () => {
  it("sends only the neighbours it was given", async () => {
    mocks.rank.mockResolvedValue({ ok: true, json: async () => ({}) });
    await rankWorkItem({ key: "WLP-1", afterId: "b" });
    expect(mocks.rank).toHaveBeenCalledWith({
      param: { key: "WLP-1" },
      json: { afterId: "b" },
    });
    await rankWorkItem({ key: "WLP-1", beforeId: "a", afterId: "b" });
    expect(mocks.rank).toHaveBeenLastCalledWith({
      param: { key: "WLP-1" },
      json: { beforeId: "a", afterId: "b" },
    });
  });

  it.each([400, 403, 404, 409, 422])(
    "keeps HTTP %i on the thrown error",
    async (status) => {
      mocks.rank.mockResolvedValue({ ok: false, status });
      const error = await rankWorkItem({ key: "WLP-1", afterId: "b" }).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(status);
    },
  );
});

describe("bulkAssignWorkItems", () => {
  it("posts the assign operation scoped to the workspace", async () => {
    mocks.bulk.mockResolvedValue({
      ok: true,
      json: async () => ({ succeeded: ["WLP-1"], failed: [] }),
    });
    const result = await bulkAssignWorkItems({
      workspaceId: "ws_1",
      workItemKeys: ["WLP-1"],
      assigneeId: "p1",
    });
    expect(mocks.bulk).toHaveBeenCalledWith({
      json: {
        workspaceId: "ws_1",
        workItemKeys: ["WLP-1"],
        assigneeId: "p1",
        operation: "assign",
      },
    });
    expect(result.succeeded).toEqual(["WLP-1"]);
  });

  it.each([400, 403, 404, 409, 422])(
    "keeps HTTP %i on the thrown error",
    async (status) => {
      mocks.bulk.mockResolvedValue({ ok: false, status });
      const error = await bulkAssignWorkItems({
        workspaceId: "ws_1",
        workItemKeys: ["WLP-1"],
        assigneeId: "p1",
      }).catch((caught: unknown) => caught);
      expect((error as HttpError).status).toBe(status);
    },
  );
});
