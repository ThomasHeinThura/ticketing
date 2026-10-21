import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { WorkItemVersionConflictError } from "@/lib/work-item-errors";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  remove: vi.fn(),
  get: vi.fn(),
}));
vi.mock("@taskdesk/libs", () => ({
  client: {
    "work-items": { ":key": { $get: mocks.get } },
    v2: {
      "work-items": {
        ":key": { parent: { $post: mocks.post, $delete: mocks.remove } },
      },
    },
  },
}));

import { getParentCandidate, setWorkItemParent } from "./set-work-item-parent";

beforeEach(() => vi.resetAllMocks());
describe("versioned parent fetcher", () => {
  it("attaches with the asserted version in typed and actual headers", async () => {
    mocks.post.mockResolvedValue(
      Response.json({ parentId: "parent", version: 8 }),
    );
    expect(
      await setWorkItemParent({ key: "OPS-1", version: 7, parentKey: "OPS-2" }),
    ).toEqual({ parentId: "parent", version: 8 });
    expect(mocks.post).toHaveBeenCalledWith(
      {
        param: { key: "OPS-1" },
        header: { "if-match": '"7"' },
        json: { parentKey: "OPS-2" },
      },
      { headers: { "If-Match": '"7"' } },
    );
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("detaches with the same precondition and no replacement body", async () => {
    mocks.remove.mockResolvedValue(
      Response.json({ parentId: null, version: 9 }),
    );
    await setWorkItemParent({ key: "OPS-1", version: 8, parentKey: null });
    expect(mocks.remove).toHaveBeenCalledWith(
      { param: { key: "OPS-1" }, header: { "if-match": '"8"' } },
      { headers: { "If-Match": '"8"' } },
    );
  });
  it("reports a structured version conflict", async () => {
    mocks.post.mockResolvedValue(
      Response.json(
        { message: "Version mismatch", assertedVersion: 7, currentVersion: 8 },
        { status: 409 },
      ),
    );
    await expect(
      setWorkItemParent({ key: "OPS-1", version: 7, parentKey: "OPS-2" }),
    ).rejects.toMatchObject({
      assertedVersion: 7,
      currentVersion: 8,
      name: new WorkItemVersionConflictError(7, 8).name,
    });
  });
  it("preserves a plain-text hierarchy conflict without trying to parse JSON", async () => {
    mocks.post.mockResolvedValue(
      new Response("Hierarchy changed concurrently", { status: 409 }),
    );
    await expect(
      setWorkItemParent({ key: "OPS-1", version: 7, parentKey: "OPS-2" }),
    ).rejects.toBeInstanceOf(HttpError);
  });
  it("fails safely on a malformed conflict without reading its body twice", async () => {
    mocks.post.mockResolvedValue(
      Response.json({ message: "Unexpected conflict" }, { status: 409 }),
    );
    await expect(
      setWorkItemParent({ key: "OPS-1", version: 7, parentKey: "OPS-2" }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it.each([403, 404, 422])("retains refusal status %i", async (status) => {
    mocks.post.mockResolvedValue(new Response("Refused", { status }));
    await expect(
      setWorkItemParent({ key: "OPS-1", version: 7, parentKey: "OPS-2" }),
    ).rejects.toMatchObject({ status });
  });
  it("forwards cancellation when resolving a candidate", async () => {
    mocks.get.mockResolvedValue(Response.json({ key: "OPS-2" }));
    const signal = new AbortController().signal;
    await getParentCandidate("OPS-2", signal);
    expect(mocks.get).toHaveBeenCalledWith(
      { param: { key: "OPS-2" } },
      { init: { signal } },
    );
  });
});
