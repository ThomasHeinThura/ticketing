import { beforeEach, describe, expect, it, vi } from "vitest";
import activateWorkspace from "./activate-workspace";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("@taskdesk/libs", () => ({
  client: {
    workspace: {
      ":workspaceId": {
        activate: {
          $post: mocks.post,
        },
      },
    },
  },
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    $store: {
      notify: mocks.notify,
    },
  },
}));

describe("activateWorkspace", () => {
  beforeEach(() => {
    mocks.post.mockReset();
    mocks.notify.mockReset();
  });

  it("posts to the native activate route with the workspaceId param", async () => {
    mocks.post.mockResolvedValue({
      ok: true,
      json: async () => ({ workspaceId: "workspace-1" }),
    });

    const result = await activateWorkspace("workspace-1");

    expect(mocks.post).toHaveBeenCalledWith({
      param: { workspaceId: "workspace-1" },
    });
    expect(result).toEqual({ workspaceId: "workspace-1" });
  });

  it("notifies the better-auth $sessionSignal on success, so useSession() stays reactive", async () => {
    mocks.post.mockResolvedValue({
      ok: true,
      json: async () => ({ workspaceId: "workspace-1" }),
    });

    await activateWorkspace("workspace-1");

    expect(mocks.notify).toHaveBeenCalledWith("$sessionSignal");
  });

  it("does not notify the session signal when the request fails", async () => {
    mocks.post.mockResolvedValue({
      ok: false,
      text: async () => "You don't have access to this workspace",
    });

    await expect(activateWorkspace("workspace-1")).rejects.toThrow(
      "don't have access",
    );
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("falls back to a readable message when the failed response body is EMPTY", async () => {
    mocks.post.mockResolvedValue({ ok: false, text: async () => "" });

    await expect(activateWorkspace("workspace-1")).rejects.toThrow(
      "Failed to switch workspace",
    );
  });
});
