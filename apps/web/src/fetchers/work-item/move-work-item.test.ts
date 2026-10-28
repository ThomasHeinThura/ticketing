import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkItemVersionConflictError } from "@/lib/work-item-errors";

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@taskdesk/libs", () => ({
  client: {
    v2: { "work-items": { ":key": { move: { $post: mocks.post } } } },
  },
}));

import moveWorkItem from "./move-work-item";

beforeEach(() => vi.resetAllMocks());

describe("move work item fetcher", () => {
  it("sends the target, the explicit children choice and the asserted version", async () => {
    mocks.post.mockResolvedValue(Response.json({ moved: [] }));
    await moveWorkItem({
      key: "OPS-1",
      version: 3,
      targetProjectId: "p2",
      moveChildren: false,
    });
    expect(mocks.post).toHaveBeenCalledWith(
      {
        param: { key: "OPS-1" },
        header: { "if-match": '"3"' },
        json: { targetProjectId: "p2", moveChildren: false },
      },
      { headers: { "If-Match": '"3"' } },
    );
  });

  it("reports a structured version conflict and any other refusal's status", async () => {
    mocks.post.mockResolvedValueOnce(
      Response.json(
        { message: "Version mismatch", assertedVersion: 3, currentVersion: 4 },
        { status: 409 },
      ),
    );
    await expect(
      moveWorkItem({
        key: "OPS-1",
        version: 3,
        targetProjectId: "p2",
        moveChildren: true,
      }),
    ).rejects.toBeInstanceOf(WorkItemVersionConflictError);
    mocks.post.mockResolvedValueOnce(
      Response.json({ message: "No matching state" }, { status: 422 }),
    );
    await expect(
      moveWorkItem({
        key: "OPS-1",
        version: 4,
        targetProjectId: "p2",
        moveChildren: true,
      }),
    ).rejects.toMatchObject({ status: 422 });
  });
});
