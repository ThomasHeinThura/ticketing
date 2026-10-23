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

  it("requests deletion via the native workspace route using workspaceId as the param name", async () => {
    mocks.del.mockResolvedValue(
      Response.json({ pendingActionId: "pa-1" }, { status: 202 }),
    );

    const result = await deleteWorkspace({ id: "workspace-1" });

    expect(mocks.del).toHaveBeenCalledWith({
      param: { workspaceId: "workspace-1" },
    });
    expect(result).toEqual({ pendingActionId: "pa-1" });
  });

  it("throws the response body text when the request fails", async () => {
    mocks.del.mockResolvedValue(
      new Response("Workspace not found", { status: 404 }),
    );

    await expect(deleteWorkspace({ id: "missing" })).rejects.toThrow(
      "Workspace not found",
    );
  });

  it("does not treat a direct 200 as a requested deletion", async () => {
    mocks.del.mockResolvedValue(Response.json({ id: "workspace-1" }));

    await expect(deleteWorkspace({ id: "workspace-1" })).rejects.toMatchObject({
      status: 200,
    });
  });
});
