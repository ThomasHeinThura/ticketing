import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CreateWorkItemLabelPicker from "./create-work-item-label-picker";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  permission: vi.fn(),
  manage: true,
}));
vi.mock("@/hooks/mutations/label/use-create-label", () => ({
  default: () => ({ mutateAsync: mocks.create }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: (...args: unknown[]) => {
    mocks.permission(...args);
    return {
      isCheckingPermissions: false,
      canManageLabels: () => mocks.manage,
    };
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const label = {
  id: "existing",
  name: "Existing",
  color: "teal",
  workspaceId: "workspace",
  projectId: null,
  taskId: null,
};
function props(overrides = {}) {
  return {
    workspaceId: "workspace",
    projectId: "project",
    labels: [label],
    labelIds: [],
    onChange: vi.fn(),
    onCreated: vi.fn(),
    onBusyChange: vi.fn(),
    onDraftChange: vi.fn(),
    canUpdate: true,
    disabled: false,
    loading: false,
    error: false,
    ...overrides,
  };
}
async function openCreate() {
  fireEvent.click(screen.getByTestId("create-work-item-labels-trigger"));
  fireEvent.change(
    screen.getByRole("textbox", {
      name: "common:modals.createTask.searchLabels",
    }),
    { target: { value: "New label" } },
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: "common:modals.createTask.createLabel",
    }),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.manage = true;
});
afterEach(cleanup);
describe("original create-new-label workflow", () => {
  it("uses workspace-scoped label management and the genuine persisted definition response", async () => {
    const p = props();
    mocks.create.mockResolvedValue({
      ...label,
      id: "created",
      name: "New label",
      color: "purple",
    });
    render(<CreateWorkItemLabelPicker {...p} />);
    await openCreate();
    fireEvent.click(
      screen.getByRole("button", {
        name: "common:modals.createTask.labelColors.lavender",
      }),
    );
    await waitFor(() =>
      expect(p.onCreated).toHaveBeenCalledWith({
        ...label,
        id: "created",
        name: "New label",
        color: "purple",
      }),
    );
    expect(mocks.permission).toHaveBeenCalledWith("workspace");
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith({
      name: "New label",
      color: "purple",
      workspaceId: "workspace",
    });
  });
  it("lets nonmanagers select existing catalogue entries but never offers new definitions", async () => {
    mocks.manage = false;
    const p = props();
    render(<CreateWorkItemLabelPicker {...p} />);
    fireEvent.click(screen.getByTestId("create-work-item-labels-trigger"));
    fireEvent.click(screen.getByRole("button", { name: "Existing" }));
    expect(p.onChange).toHaveBeenCalledWith(["existing"]);
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "common:modals.createTask.searchLabels",
      }),
      { target: { value: "New label" } },
    );
    expect(
      screen.queryByRole("button", {
        name: "common:modals.createTask.createLabel",
      }),
    ).not.toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not apply a late response to another project intent", async () => {
    let resolve: ((value: typeof label) => void) | undefined;
    mocks.create.mockImplementation(
      () =>
        new Promise((resolvePromise) => {
          resolve = resolvePromise;
        }),
    );
    const p = props();
    const view = render(<CreateWorkItemLabelPicker {...p} />);
    await openCreate();
    fireEvent.click(
      screen.getByRole("button", {
        name: "common:modals.createTask.labelColors.sage",
      }),
    );
    view.rerender(
      <CreateWorkItemLabelPicker {...p} projectId="another-project" />,
    );
    await act(async () => resolve?.({ ...label, id: "late" }));
    expect(p.onCreated).not.toHaveBeenCalled();
    expect(p.onBusyChange).toHaveBeenLastCalledWith(false);
  });
  it("does not apply late responses after losing workspace label authority", async () => {
    let resolve: ((value: typeof label) => void) | undefined;
    mocks.create.mockImplementation(
      () =>
        new Promise((resolvePromise) => {
          resolve = resolvePromise;
        }),
    );
    const p = props();
    const view = render(<CreateWorkItemLabelPicker {...p} />);
    await openCreate();
    fireEvent.click(
      screen.getByRole("button", {
        name: "common:modals.createTask.labelColors.sage",
      }),
    );
    mocks.manage = false;
    view.rerender(<CreateWorkItemLabelPicker {...p} />);
    await act(async () => resolve?.({ ...label, id: "late" }));
    expect(p.onCreated).not.toHaveBeenCalled();
    view.unmount();
  });
  it("does not apply a completed request after the draft unmounts", async () => {
    let resolve: ((value: typeof label) => void) | undefined;
    mocks.create.mockImplementation(
      () =>
        new Promise((resolvePromise) => {
          resolve = resolvePromise;
        }),
    );
    const p = props();
    const view = render(<CreateWorkItemLabelPicker {...p} />);
    await openCreate();
    fireEvent.click(
      screen.getByRole("button", {
        name: "common:modals.createTask.labelColors.sage",
      }),
    );
    view.unmount();
    await act(async () => resolve?.({ ...label, id: "late" }));
    expect(p.onCreated).not.toHaveBeenCalled();
    expect(p.onBusyChange).toHaveBeenLastCalledWith(false);
  });
  it("rejects foreign or task-copy responses rather than inserting them into the draft", async () => {
    const p = props();
    mocks.create.mockResolvedValue({
      ...label,
      id: "foreign",
      workspaceId: "elsewhere",
    });
    render(<CreateWorkItemLabelPicker {...p} />);
    await openCreate();
    fireEvent.click(
      screen.getByRole("button", {
        name: "common:modals.createTask.labelColors.sage",
      }),
    );
    await screen.findByRole("alert");
    expect(p.onCreated).not.toHaveBeenCalled();
  });
});
