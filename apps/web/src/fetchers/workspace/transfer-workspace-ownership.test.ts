import { beforeEach, describe, expect, it, vi } from "vitest";
import transferWorkspaceOwnership from "./transfer-workspace-ownership";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock("@taskdesk/libs", () => ({
  client: {
    workspace: {
      ":workspaceId": {
        "transfer-ownership": {
          $post: mocks.post,
        },
      },
    },
  },
}));

describe("transferWorkspaceOwnership", () => {
  beforeEach(() => {
    mocks.post.mockReset();
  });

  it("posts to the native transfer-ownership route with the workspaceId param and the new owner's userId", async () => {
    mocks.post.mockResolvedValue({
      ok: true,
      json: async () => ({
        workspaceId: "workspace-1",
        previousOwnerUserId: "user-1",
        previousOwnerNewRole: "admin",
        newOwnerUserId: "user-2",
      }),
    });

    const result = await transferWorkspaceOwnership({
      workspaceId: "workspace-1",
      newOwnerUserId: "user-2",
    });

    expect(mocks.post).toHaveBeenCalledWith({
      param: { workspaceId: "workspace-1" },
      json: { newOwnerUserId: "user-2" },
    });
    expect(result).toEqual({
      workspaceId: "workspace-1",
      previousOwnerUserId: "user-1",
      previousOwnerNewRole: "admin",
      newOwnerUserId: "user-2",
    });
  });

  it("throws the response body text when the request fails", async () => {
    mocks.post.mockResolvedValue({
      ok: false,
      text: async () => "You are not this workspace's owner",
    });

    await expect(
      transferWorkspaceOwnership({
        workspaceId: "workspace-1",
        newOwnerUserId: "user-2",
      }),
    ).rejects.toThrow("not this workspace's owner");
  });

  it("falls back to a readable message when the failed response body is EMPTY", async () => {
    mocks.post.mockResolvedValue({ ok: false, text: async () => "" });

    await expect(
      transferWorkspaceOwnership({
        workspaceId: "workspace-1",
        newOwnerUserId: "user-2",
      }),
    ).rejects.toThrow("Failed to transfer workspace ownership");
  });
});
