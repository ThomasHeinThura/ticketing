import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkItemCreateDialogShell from "./work-item-create-dialog-shell";

const permission = vi.hoisted(() => ({
  checking: true,
  allowed: false,
  error: undefined as Error | undefined,
  retry: vi.fn(),
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canCreateTasks: () => permission.allowed,
    isCheckingPermissions: permission.checking,
    isPermissionError: Boolean(permission.error),
    permissionError: permission.error,
    retryPermissionCheck: permission.retry,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

vi.mock("./create-work-item-dialog", () => ({
  CreateWorkItemDialogContent: () => <div data-testid="create-form" />,
}));

function renderShell(onClose = vi.fn()) {
  const view = render(
    <WorkItemCreateDialogShell
      projectId="project-1"
      workspaceId="workspace-1"
      onClose={onClose}
      finalFocus={() => false}
    />,
  );
  return { ...view, onClose };
}

beforeEach(() => {
  permission.checking = true;
  permission.allowed = false;
  permission.error = undefined;
  permission.retry.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("WorkItemCreateDialogShell", () => {
  it("WI-1: exposes the dialog immediately and keeps the open intent during permission loading", async () => {
    const { rerender, onClose } = renderShell();

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "workItems:create.title" }),
    ).toBeVisible();
    expect(screen.getByRole("status")).toBeVisible();
    expect(screen.queryByTestId("create-form")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    permission.checking = false;
    permission.allowed = true;
    rerender(
      <WorkItemCreateDialogShell
        projectId="project-1"
        workspaceId="workspace-1"
        onClose={onClose}
        finalFocus={() => false}
      />,
    );

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(
      screen.getByTestId("create-work-item-content-loading"),
    ).toBeVisible();
    await waitFor(() => {
      expect(screen.getByTestId("create-form")).toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("WI-1: settled denial closes intent without mounting the create form", async () => {
    permission.checking = false;
    const { onClose } = renderShell();

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByTestId("create-form")).not.toBeInTheDocument();
  });

  it("WI-1: terminal capability failure stays fail-closed and exposes retry", () => {
    permission.checking = false;
    permission.error = new Error("capabilities unavailable");
    const { onClose } = renderShell();

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByText("common:error.title")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "common:error.tryAgain" }),
    ).toBeVisible();
    expect(screen.queryByTestId("create-form")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "common:error.tryAgain" }),
    );
    expect(permission.retry).toHaveBeenCalledTimes(1);
  });

  it("WI-1: withholds the form while refreshing even when stale data allowed creation", async () => {
    permission.checking = true;
    permission.allowed = true;
    const { rerender, onClose } = renderShell();

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByRole("status")).toBeVisible();
    expect(screen.queryByTestId("create-form")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    permission.checking = false;
    permission.allowed = false;
    rerender(
      <WorkItemCreateDialogShell
        projectId="project-1"
        workspaceId="workspace-1"
        onClose={onClose}
        finalFocus={() => false}
      />,
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("create-form")).not.toBeInTheDocument();
  });

  it("WI-1: Escape cancels a cold form intent while preserving trigger focus handling", () => {
    const onClose = vi.fn();
    permission.checking = false;
    permission.allowed = true;
    renderShell(onClose);

    expect(screen.getByRole("dialog")).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
