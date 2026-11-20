import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./general";

const mocks = vi.hoisted(() => ({
  workspace: { id: "ws", name: "Original", description: "" },
  edit: true,
  history: true,
  update: vi.fn(),
  historyRequest: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: () => null,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { id: "u1" } }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: mocks.workspace }),
}));
vi.mock("@/hooks/queries/workspace/use-get-full-workspace", () => ({
  default: () => ({ data: { members: [] } }),
}));
vi.mock("@/hooks/mutations/workspace/use-update-workspace", () => ({
  default: () => ({ mutateAsync: mocks.update }),
}));
vi.mock("@/hooks/mutations/workspace/use-delete-workspace", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/mutations/workspace/use-transfer-workspace-ownership", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => vi.fn(),
}));
vi.mock("@/hooks/use-step-up-action", () => ({ useStepUpAction: () => ({}) }));
vi.mock("@/components/settings/workspace-project-defaults-panel", () => ({
  WorkspaceProjectDefaultsPanel: () => null,
}));
vi.mock("@/components/settings/settings-history", () => ({
  SettingsHistory: () => {
    mocks.historyRequest();
    return <div>History</div>;
  },
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageWorkspace: () => mocks.edit,
    canManageWorkspaceSettings: () => mocks.history,
    canDeleteWorkspace: () => false,
    isOwner: false,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/components/settings/settings-access", () => ({
  isForbiddenError: () => false,
  useCapabilityCheckFailed: () => false,
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
const Page = (Route as unknown as { component: ComponentType }).component;

beforeEach(() => {
  vi.useFakeTimers();
  mocks.workspace = { id: "ws", name: "Original", description: "" };
  mocks.edit = true;
  mocks.history = true;
  mocks.update.mockReset();
  mocks.historyRequest.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("workspace general", () => {
  it("keeps a newer draft after an older save and refetch, then saves the queued value", async () => {
    let resolveFirst!: () => void;
    mocks.update
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(undefined);
    const view = render(<Page />);
    await act(async () => {
      await Promise.resolve();
    });
    const input = screen.getByLabelText(
      "settings:workspaceGeneral.nameLabel",
    ) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "First" } });
    });
    await act(async () => {
      fireEvent.change(input, { target: { value: "First name" } });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mocks.update).toHaveBeenCalledWith({
      workspaceId: "ws",
      name: "First name",
    });
    await act(async () => {
      fireEvent.change(input, { target: { value: "Latest name" } });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(input.value).toBe("Latest name");
    mocks.workspace = { ...mocks.workspace, name: "First name" };
    await act(async () => {
      view.rerender(<Page />);
    });
    expect(input.value).toBe("Latest name");
    await act(async () => {
      resolveFirst();
      await Promise.resolve();
    });
    expect(input.value).toBe("Latest name");
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.update).toHaveBeenLastCalledWith({
      workspaceId: "ws",
      name: "Latest name",
    });
  });
  it("isolates drafts, queued saves and late responses across workspace switches", async () => {
    let resolveOld!: () => void;
    let resolveNew!: () => void;
    mocks.update
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveNew = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const view = render(<Page />);
    let input = screen.getByLabelText(
      "settings:workspaceGeneral.nameLabel",
    ) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "Old save" } });
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mocks.update).toHaveBeenCalledWith({
      workspaceId: "ws",
      name: "Old save",
    });
    await act(async () => {
      fireEvent.change(input, { target: { value: "Old queued" } });
      await vi.advanceTimersByTimeAsync(1000);
    });
    mocks.workspace = { id: "ws2", name: "Second", description: "" };
    await act(async () => {
      view.rerender(<Page />);
    });
    input = screen.getByLabelText(
      "settings:workspaceGeneral.nameLabel",
    ) as HTMLInputElement;
    expect(input.value).toBe("Second");
    await act(async () => {
      fireEvent.change(input, { target: { value: "New save" } });
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mocks.update).toHaveBeenLastCalledWith({
      workspaceId: "ws2",
      name: "New save",
    });
    await act(async () => {
      fireEvent.change(input, { target: { value: "New queued" } });
      await vi.advanceTimersByTimeAsync(1000);
    });
    await act(async () => {
      resolveOld();
      await Promise.resolve();
    });
    expect(input.value).toBe("New queued");
    expect(mocks.update).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolveNew();
      await Promise.resolve();
    });
    expect(mocks.update).toHaveBeenCalledTimes(3);
    expect(mocks.update).toHaveBeenLastCalledWith({
      workspaceId: "ws2",
      name: "New queued",
    });
    expect(input.value).toBe("New queued");
  });
  it("cancels a pending debounce on workspace switch", async () => {
    const view = render(<Page />);
    const input = screen.getByLabelText("settings:workspaceGeneral.nameLabel");
    await act(async () => {
      fireEvent.change(input, { target: { value: "Old draft" } });
    });
    mocks.workspace = { id: "ws2", name: "Second", description: "" };
    await act(async () => {
      view.rerender(<Page />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(
      (
        screen.getByLabelText(
          "settings:workspaceGeneral.nameLabel",
        ) as HTMLInputElement
      ).value,
    ).toBe("Second");
  });
  it("shows history for a history-only grant without enabling edits", () => {
    mocks.edit = false;
    render(<Page />);
    expect(screen.getByText("History")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(mocks.historyRequest).toHaveBeenCalled();
  });
  it("does not request history for an edit-only grant", () => {
    mocks.history = false;
    render(<Page />);
    expect(
      screen.getByRole("textbox", {
        name: "settings:workspaceGeneral.nameLabel",
      }),
    ).toBeTruthy();
    expect(mocks.historyRequest).not.toHaveBeenCalled();
  });
});
