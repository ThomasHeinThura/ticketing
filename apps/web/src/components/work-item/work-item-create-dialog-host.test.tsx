import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkItemCreateDialogHost from "./work-item-create-dialog-host";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  toastError: vi.fn(),
  shellProps: undefined as undefined | Record<string, unknown>,
}));

vi.mock("./work-item-create-dialog-shell-loader", () => ({
  loadWorkItemCreateDialogShell: () => mocks.load(),
}));
vi.mock("@/lib/toast", () => ({
  toast: { error: (...args: unknown[]) => mocks.toastError(...args) },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function ShellStub(props: Record<string, unknown>) {
  mocks.shellProps = props;
  return <div data-testid="create-work-item-dialog" />;
}

beforeEach(() => {
  mocks.load.mockReset();
  mocks.toastError.mockReset();
  mocks.shellProps = undefined;
  mocks.load.mockResolvedValue({ default: ShellStub });
});
afterEach(() => cleanup());

function renderHost(
  overrides: Partial<Parameters<typeof WorkItemCreateDialogHost>[0]> = {},
) {
  const props = {
    projectId: "p1",
    workspaceId: "w1",
    onClose: vi.fn(),
    finalFocus: vi.fn(() => false as const),
    onReady: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<WorkItemCreateDialogHost {...props} />) };
}

describe("WorkItemCreateDialogHost", () => {
  it("shows nothing until the shared dialog code arrives, then opens it for the project", async () => {
    let arrive: (module: { default: unknown }) => void = () => {};
    mocks.load.mockReturnValue(
      new Promise((resolve) => {
        arrive = resolve;
      }),
    );
    const { props } = renderHost();
    expect(screen.queryByTestId("create-work-item-dialog")).toBeNull();
    expect(props.onReady).not.toHaveBeenCalled();

    await act(async () => arrive({ default: ShellStub }));

    expect(await screen.findByTestId("create-work-item-dialog")).toBeVisible();
    expect(props.onReady).toHaveBeenCalledOnce();
    expect(mocks.shellProps).toEqual({
      projectId: "p1",
      workspaceId: "w1",
      onClose: props.onClose,
      finalFocus: props.finalFocus,
    });
  });

  it("tells the person and closes when the dialog code cannot be loaded", async () => {
    mocks.load.mockRejectedValue(new Error("chunk failed"));
    const { props } = renderHost();

    await waitFor(() => expect(props.onClose).toHaveBeenCalledOnce());
    expect(mocks.toastError).toHaveBeenCalledWith(
      "workItems:create.loadFailed",
    );
    expect(props.onReady).not.toHaveBeenCalled();
    expect(screen.queryByTestId("create-work-item-dialog")).toBeNull();
  });

  it("does nothing when it is closed before the code arrives", async () => {
    let arrive: (module: { default: unknown }) => void = () => {};
    mocks.load.mockReturnValue(
      new Promise((resolve) => {
        arrive = resolve;
      }),
    );
    const { props, unmount } = renderHost();
    unmount();

    await act(async () => arrive({ default: ShellStub }));

    expect(props.onReady).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(mocks.shellProps).toBeUndefined();
  });
});
