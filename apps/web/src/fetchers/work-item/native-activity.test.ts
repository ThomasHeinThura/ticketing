import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActivity: vi.fn(),
  postComment: vi.fn(),
  patchComment: vi.fn(),
  listCanned: vi.fn(),
}));

vi.mock("@taskdesk/libs", () => ({
  client: {
    "work-items": {
      ":key": {
        activity: { $get: mocks.getActivity },
        comments: { $post: mocks.postComment },
      },
    },
    comments: {
      ":id": { $patch: mocks.patchComment },
    },
    "canned-responses": { $get: mocks.listCanned },
  },
}));

import listCannedResponses from "../canned-response/list-canned-responses";
import createWorkItemComment from "./create-work-item-comment";
import getWorkItemActivity from "./get-work-item-activity";
import updateWorkItemComment from "./update-work-item-comment";

beforeEach(() => {
  vi.clearAllMocks();
  for (const request of Object.values(mocks)) {
    request.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [],
          page: { nextCursor: null, hasMore: false },
        }),
      ),
    );
  }
});

describe("native activity fetchers", () => {
  it("requests the combined cursor-paginated work-item stream", async () => {
    await getWorkItemActivity({ key: "SUP-123", cursor: "opaque/cursor" });
    expect(mocks.getActivity).toHaveBeenCalledWith({
      param: { key: "SUP-123" },
      query: { limit: "50", cursor: "opaque/cursor" },
    });
  });

  it("posts a Tiptap JSON body with explicit visibility", async () => {
    const body = { type: "doc", content: [{ type: "paragraph" }] };
    await createWorkItemComment({
      key: "SUP-123",
      body,
      visibility: "internal",
    });
    expect(mocks.postComment).toHaveBeenCalledWith({
      param: { key: "SUP-123" },
      json: { body, visibility: "internal" },
    });
  });

  it("uses native comment update and workspace-scoped canned response routes", async () => {
    const body = { type: "doc", content: [{ type: "paragraph" }] };
    await updateWorkItemComment({ id: "comment-1", body });
    await listCannedResponses("workspace-1");
    expect(mocks.patchComment).toHaveBeenCalledWith({
      param: { id: "comment-1" },
      json: { body },
    });
    expect(mocks.listCanned).toHaveBeenCalledWith({
      query: { workspaceId: "workspace-1" },
    });
  });

  it("preserves server permission failures instead of masking them", async () => {
    mocks.postComment.mockResolvedValueOnce(
      new Response("forbidden", { status: 403 }),
    );
    await expect(
      createWorkItemComment({
        key: "SUP-123",
        body: { type: "doc", content: [{ type: "paragraph" }] },
        visibility: "public",
      }),
    ).rejects.toMatchObject({ name: "HttpError", status: 403 });
  });
});
