import { beforeEach, describe, expect, it, vi } from "vitest";
import deleteWorkspace from "./delete-workspace";

const mocks = vi.hoisted(() => ({
  del: vi.fn(),
}));

vi.mock("@taskdesk/libs", () => ({
  client: {
    workspace: {
      ":workspaceId": {
        $delete: mocks.del,
      },
    },
  },
}));

describe("deleteWorkspace", () => {
  beforeEach(() => {
    mocks.del.mockReset();
  });

  it("deletes via the native workspace route using workspaceId as the param name", async () => {
    mocks.del.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "workspace-1" }),
    });

    const result = await deleteWorkspace({ id: "workspace-1" });

    expect(mocks.del).toHaveBeenCalledWith({
      param: { workspaceId: "workspace-1" },
    });
    expect(result).toEqual({ id: "workspace-1" });
  });

  it("throws the response body text when the request fails", async () => {
    mocks.del.mockResolvedValue({
      ok: false,
      text: async () => "Workspace not found",
    });

    await expect(deleteWorkspace({ id: "missing" })).rejects.toThrow(
      "Workspace not found",
    );
  });
});
