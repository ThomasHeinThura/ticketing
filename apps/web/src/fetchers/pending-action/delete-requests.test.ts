import { beforeEach, describe, expect, it, vi } from "vitest";
import deleteComment from "@/fetchers/comment/delete-comment";
import deleteTaskRelation from "@/fetchers/task-relation/delete-task-relation";

const mocks = vi.hoisted(() => ({
  commentDelete: vi.fn(),
  relationDelete: vi.fn(),
}));

vi.mock("@taskdesk/libs", () => ({
  client: {
    comments: { ":id": { $delete: mocks.commentDelete } },
    "work-items": {
      ":key": { relations: { ":id": { $delete: mocks.relationDelete } } },
    },
  },
}));

describe("canonical deletion requests", () => {
  beforeEach(() => {
    mocks.commentDelete.mockReset();
    mocks.relationDelete.mockReset();
  });

  it("requests comment deletion on /comments/{id} and returns the pending action", async () => {
    mocks.commentDelete.mockResolvedValue(
      Response.json({ pendingActionId: "pa-c" }, { status: 202 }),
    );
    await expect(deleteComment({ commentId: "c1" })).resolves.toEqual({
      pendingActionId: "pa-c",
    });
    expect(mocks.commentDelete).toHaveBeenCalledWith({ param: { id: "c1" } });
  });

  it("requests relation removal under the work item key", async () => {
    mocks.relationDelete.mockResolvedValue(
      Response.json({ pendingActionId: "pa-r" }, { status: 202 }),
    );
    await expect(
      deleteTaskRelation({ key: "PRJ-1", id: "r1" }),
    ).resolves.toEqual({ pendingActionId: "pa-r" });
    expect(mocks.relationDelete).toHaveBeenCalledWith({
      param: { key: "PRJ-1", id: "r1" },
    });
  });

  it("never treats a retired 410 or an immediate 200 as deleted", async () => {
    mocks.commentDelete.mockResolvedValue(
      new Response("Gone", { status: 410 }),
    );
    await expect(deleteComment({ commentId: "c1" })).rejects.toMatchObject({
      status: 410,
    });
    mocks.relationDelete.mockResolvedValue(Response.json({ ok: true }));
    await expect(
      deleteTaskRelation({ key: "PRJ-1", id: "r1" }),
    ).rejects.toMatchObject({ status: 200 });
  });
});
