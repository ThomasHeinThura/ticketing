import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkspaceCrumbSelect from "./workspace-crumb-select";

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  activateWorkspace: vi.fn((_workspaceId: string) =>
    Promise.resolve({ id: "workspace-2" }),
  ),
  activeWorkspace: { id: "workspace-1", name: "A long workspace name" },
  workspaces: [
    { id: "workspace-1", name: "A long workspace name" },
    { id: "workspace-2", name: "Ops Workspace" },
  ],
  activeOrganizationId: "workspace-1" as string | null,
  toastError: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => state.navigate,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key === "navigation:sidebar.overview"
        ? "Overview"
        : key === "navigation:workspaceSwitcher.switchFailed"
          ? "Could not switch workspace. Check your access and try again."
          : "Select workspace",
  }),
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    error: (message: string) => state.toastError(message),
  },
}));

vi.mock("@/lib/activate-workspace-for-navigation", () => ({
  activateWorkspaceForNavigation: (workspaceId: string) =>
    state.activateWorkspace(workspaceId),
}));

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({
    data: state.activeWorkspace,
  }),
}));

vi.mock("@/hooks/queries/workspace/use-get-workspaces", () => ({
  default: () => ({
    data: state.workspaces,
  }),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: state.activeOrganizationId
        ? { session: { activeOrganizationId: state.activeOrganizationId } }
        : { session: {} },
    }),
  },
}));

beforeEach(() => {
  state.navigate.mockReset();
  state.activateWorkspace.mockReset();
  state.activateWorkspace.mockImplementation((_workspaceId: string) =>
    Promise.resolve({ id: "workspace-2" }),
  );
  state.toastError.mockReset();
  state.activeOrganizationId = "workspace-1";
});

afterEach(() => {
  cleanup();
});

describe("WorkspaceCrumbSelect", () => {
  it("constrains the crumb while retaining its full accessible name", () => {
    render(<WorkspaceCrumbSelect />);

    const crumb = screen.getByRole("button", {
      name: "Overview: A long workspace name",
    });
    expect(crumb).toHaveClass("min-w-0", "max-w-32", "shrink");
    expect(screen.getByText("A long workspace name")).toHaveClass("truncate");
  });

  it("displays the project's own workspace and activates it before opening /agent when non-active", async () => {
    render(<WorkspaceCrumbSelect workspaceId="workspace-2" />);

    const crumb = screen.getByRole("button", {
      name: "Overview: Ops Workspace",
    });
    fireEvent.click(crumb);

    await waitFor(() => {
      expect(state.activateWorkspace).toHaveBeenCalledWith("workspace-2");
      expect(state.navigate).toHaveBeenCalledWith({ to: "/agent" });
    });
    expect(state.activateWorkspace.mock.invocationCallOrder[0]).toBeLessThan(
      state.navigate.mock.invocationCallOrder[0],
    );
  });

  it("shows a translated error toast and stays on the current route when activation rejects", async () => {
    state.activateWorkspace.mockRejectedValueOnce(new Error("403 Forbidden"));
    render(<WorkspaceCrumbSelect workspaceId="workspace-2" />);

    fireEvent.click(
      screen.getByRole("button", { name: "Overview: Ops Workspace" }),
    );

    await waitFor(() => {
      expect(state.activateWorkspace).toHaveBeenCalledWith("workspace-2");
      expect(state.toastError).toHaveBeenCalledWith(
        "Could not switch workspace. Check your access and try again.",
      );
    });
    expect(state.navigate).not.toHaveBeenCalled();
  });
});
