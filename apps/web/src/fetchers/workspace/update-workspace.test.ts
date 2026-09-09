import { beforeEach, describe, expect, it, vi } from "vitest";
import updateWorkspace from "./update-workspace";

const mocks = vi.hoisted(() => ({
  patch: vi.fn(),
}));

vi.mock("@taskdesk/libs", () => ({
  client: {
    workspace: {
      ":workspaceId": {
        $patch: mocks.patch,
      },
    },
  },
}));

describe("updateWorkspace", () => {
  beforeEach(() => {
    mocks.patch.mockReset();
  });

  it("patches the native workspace route with the workspaceId param and the updated fields", async () => {
    mocks.patch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "workspace-1", name: "New Name" }),
    });

    const result = await updateWorkspace({
      id: "workspace-1",
      name: "New Name",
      description: "New description",
      logo: "https://example.com/logo.png",
      slug: "new-slug",
    });

    expect(mocks.patch).toHaveBeenCalledWith({
      param: { workspaceId: "workspace-1" },
      json: {
        name: "New Name",
        slug: "new-slug",
        logo: "https://example.com/logo.png",
        description: "New description",
      },
    });
    expect(result).toEqual({ id: "workspace-1", name: "New Name" });
  });

  it("throws the response body text when the request fails", async () => {
    mocks.patch.mockResolvedValue({
      ok: false,
      text: async () => "That workspace slug is already taken",
    });

    await expect(
      updateWorkspace({ id: "workspace-1", name: "New Name" }),
    ).rejects.toThrow("already taken");
  });
});
