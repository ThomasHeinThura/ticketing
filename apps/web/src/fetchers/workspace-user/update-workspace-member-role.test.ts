import { beforeEach, describe, expect, it, vi } from "vitest";
import updateWorkspaceMemberRole from "./update-workspace-member-role";

const mocks = vi.hoisted(() => ({
  patch: vi.fn(),
}));

vi.mock("@taskdesk/libs", () => ({
  client: {
    workspace: {
      ":workspaceId": {
        members: {
          ":userId": {
            role: {
              $patch: mocks.patch,
            },
          },
        },
      },
    },
  },
}));

describe("updateWorkspaceMemberRole", () => {
  beforeEach(() => {
    mocks.patch.mockReset();
  });

  it("patches the native member-role route with the workspaceId/userId params and the new role", async () => {
    mocks.patch.mockResolvedValue({
      ok: true,
      json: async () => ({ userId: "user-1", role: "admin" }),
    });

    const result = await updateWorkspaceMemberRole({
      workspaceId: "workspace-1",
      userId: "user-1",
      role: "admin",
    });

    expect(mocks.patch).toHaveBeenCalledWith({
      param: { workspaceId: "workspace-1", userId: "user-1" },
      json: { role: "admin" },
    });
    expect(result).toEqual({ userId: "user-1", role: "admin" });
  });

  it("throws the response body text when the request fails", async () => {
    mocks.patch.mockResolvedValue({
      ok: false,
      text: async () => "That member is the workspace's owner",
    });

    await expect(
      updateWorkspaceMemberRole({
        workspaceId: "workspace-1",
        userId: "user-1",
        role: "admin",
      }),
    ).rejects.toThrow("workspace's owner");
  });

  it("falls back to a readable message when the failed response body is EMPTY", async () => {
    mocks.patch.mockResolvedValue({ ok: false, text: async () => "" });

    await expect(
      updateWorkspaceMemberRole({
        workspaceId: "workspace-1",
        userId: "user-1",
        role: "admin",
      }),
    ).rejects.toThrow("Failed to update workspace member role");
  });
});
