import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { WorkItemVersionConflictError } from "@/lib/work-item-errors";

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@taskdesk/libs", () => ({
  client: {
    v2: { "work-items": { ":key": { archive: { $post: mocks.post } } } },
  },
}));

import archiveWorkItem from "./archive-work-item";

beforeEach(() => vi.resetAllMocks());

describe("archive work item fetcher", () => {
  it("posts the asserted version in typed and actual headers", async () => {
    mocks.post.mockResolvedValue(Response.json({ key: "OPS-1", version: 4 }));
    expect(await archiveWorkItem({ key: "OPS-1", version: 3 })).toEqual({
      key: "OPS-1",
      version: 4,
    });
    expect(mocks.post).toHaveBeenCalledWith(
      { param: { key: "OPS-1" }, header: { "if-match": '"3"' } },
      { headers: { "If-Match": '"3"' } },
    );
  });

  it("reports a structured version conflict", async () => {
    mocks.post.mockResolvedValue(
      Response.json(
        { message: "Version mismatch", assertedVersion: 3, currentVersion: 5 },
        { status: 409 },
      ),
    );
    await expect(
      archiveWorkItem({ key: "OPS-1", version: 3 }),
    ).rejects.toBeInstanceOf(WorkItemVersionConflictError);
  });

  it("raises an HttpError carrying the status for any other refusal", async () => {
    mocks.post.mockResolvedValue(
      Response.json({ message: "Work item not found" }, { status: 404 }),
    );
    await expect(
      archiveWorkItem({ key: "OPS-1", version: 3 }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      archiveWorkItem({ key: "OPS-1", version: 3 }),
    ).rejects.toBeInstanceOf(HttpError);
  });
});
