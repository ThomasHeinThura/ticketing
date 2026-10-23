import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import WorkItemActions from "./work-item-actions";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  openPending: vi.fn(),
  canDelete: true,
}));
vi.mock("@/fetchers/work-item/request-work-item-deletion", () => ({
  default: mocks.request,
}));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => mocks.openPending,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init() {} },
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    isCheckingPermissions: false,
    canDeleteTasks: () => mocks.canDelete,
  }),
}));

const item = { key: "HELP-4", workspaceId: "ws", projectId: "project" };
function mount(onAccessLost = vi.fn(), variant: "menu" | "delete" = "menu") {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <WorkItemActions
        item={item}
        onAccessLost={onAccessLost}
        variant={variant}
      />
    </QueryClientProvider>,
  );
}
async function chooseDelete() {
  fireEvent.click(
    screen.getByRole("button", { name: "workItems:deletion.actions" }),
  );
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "tasks:actions.delete" }),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.canDelete = true;
});
it("opens confirmation for the accepted intent without removing the item locally", async () => {
  mocks.request.mockResolvedValue({ pendingActionId: "pa-4" });
  mount();
  await chooseDelete();
  await waitFor(() =>
    expect(mocks.openPending).toHaveBeenCalledWith({
      pendingActionId: "pa-4",
    }),
  );
  expect(mocks.request).toHaveBeenCalledWith("HELP-4", expect.anything());
});
it("hides destructive actions without delete authority", () => {
  mocks.canDelete = false;
  mount();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
it("handles reach loss without opening a confirmation", async () => {
  const onAccessLost = vi.fn();
  mocks.request.mockRejectedValue(new HttpError(404, "gone"));
  mount(onAccessLost);
  await chooseDelete();
  await waitFor(() => expect(onAccessLost).toHaveBeenCalledOnce());
  expect(mocks.openPending).not.toHaveBeenCalled();
});
it("does not open the approval when an in-flight request finishes after unmount", async () => {
  let finish!: (value: { pendingActionId: string }) => void;
  mocks.request.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = mount();
  await chooseDelete();
  await waitFor(() => expect(mocks.request).toHaveBeenCalled());
  view.unmount();
  finish({ pendingActionId: "pa-4" });
  await waitFor(() =>
    expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
  );
  expect(mocks.openPending).not.toHaveBeenCalled();
});

it("uses the same persisted pending-action request from the Kaneo sheet trash button", async () => {
  mocks.request.mockResolvedValue({ pendingActionId: "pa-sheet" });
  mount(vi.fn(), "delete");
  expect(
    screen.queryByRole("button", { name: "workItems:deletion.actions" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "tasks:actions.delete" }));
  await waitFor(() =>
    expect(mocks.openPending).toHaveBeenCalledWith({
      pendingActionId: "pa-sheet",
    }),
  );
  expect(mocks.request).toHaveBeenCalledWith("HELP-4", expect.anything());
});
