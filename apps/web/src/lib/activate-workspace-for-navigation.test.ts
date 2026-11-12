import { beforeEach, describe, expect, it, vi } from "vitest";
import { activateWorkspaceForNavigation } from "./activate-workspace-for-navigation";

const state = vi.hoisted(() => ({
  activate: vi.fn(),
  refetch: vi.fn(),
  data: { session: { activeOrganizationId: "workspace-a" } },
  error: null as Error | null,
}));

vi.mock("@/fetchers/workspace/activate-workspace", () => ({
  default: state.activate,
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    $store: {
      atoms: {
        session: {
          get: () => ({
            data: state.data,
            error: state.error,
            refetch: state.refetch,
          }),
        },
      },
    },
  },
}));

beforeEach(() => {
  state.activate.mockReset().mockResolvedValue(undefined);
  state.refetch.mockReset();
  state.data = { session: { activeOrganizationId: "workspace-a" } };
  state.error = null;
});

describe("activateWorkspaceForNavigation", () => {
  it("waits for the session to reflect the activated workspace", async () => {
    let finishRefresh: (() => void) | undefined;
    state.refetch.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = () => {
            state.data.session.activeOrganizationId = "workspace-b";
            resolve();
          };
        }),
    );
    const completed = vi.fn();
    const pending =
      activateWorkspaceForNavigation("workspace-b").then(completed);
    await vi.waitFor(() => expect(finishRefresh).toBeDefined());
    expect(completed).not.toHaveBeenCalled();
    finishRefresh?.();
    await pending;
    expect(completed).toHaveBeenCalledOnce();
  });

  it("rejects on activation failure or an unconfirmed session refresh", async () => {
    state.activate.mockRejectedValueOnce(new Error("403"));
    await expect(activateWorkspaceForNavigation("workspace-b")).rejects.toThrow(
      "403",
    );
    expect(state.refetch).not.toHaveBeenCalled();
    state.refetch.mockResolvedValue(undefined);
    await expect(activateWorkspaceForNavigation("workspace-b")).rejects.toThrow(
      "Workspace session refresh failed",
    );
    state.error = new Error("network");
    state.data.session.activeOrganizationId = "workspace-b";
    await expect(activateWorkspaceForNavigation("workspace-b")).rejects.toThrow(
      "Workspace session refresh failed",
    );
  });
});
