import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./canned-responses";

const mocks = vi.hoisted(() => ({
  search: {} as { id?: string; action?: string; q?: string },
  session: { user: { id: "u1" }, session: { id: "s1" } } as unknown,
  save: vi.fn(),
  remove: vi.fn(),
  openPending: vi.fn(),
  refresh: vi.fn(),
  guard: vi.fn(),
  history: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({
    ...options,
    useSearch: () => mocks.search,
    fullPath: "/x",
  }),
  useNavigate: () => vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/activity/comment-editor", () => ({
  default: () => <div>editor</div>,
}));
vi.mock("@/components/settings/settings-access", () => ({
  isForbiddenError: () => false,
  useSettingsAccess: () => "allowed",
}));
vi.mock("@/components/settings/settings-history", () => ({
  SettingsHistory: (props: { type: string; id: string; userId: string }) => {
    mocks.history(props);
    return <div>History</div>;
  },
}));
vi.mock("@/components/settings/refresh-settings-history", () => ({
  refreshSettingsHistory: mocks.refresh,
}));
vi.mock("@/lib/profile-session-guard", () => ({
  profileSessionGuard: (...args: unknown[]) => mocks.guard(...args),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: mocks.session }) },
}));
vi.mock("@/fetchers/canned-response/manage-canned-responses", () => ({
  getCannedResponseLibrary: async () => [
    {
      id: "c1",
      name: "Greeting",
      body: { type: "doc", content: [] },
      visibilityDefault: "public",
    },
  ],
  saveCannedResponse: mocks.save,
  removeCannedResponse: mocks.remove,
}));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => mocks.openPending,
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    workspace: { id: "ws" },
    canManageWorkspaceSettings: () => true,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/lib/toast", () => ({ toast: mocks.toast }));
const Page = (Route as unknown as { component: ComponentType }).component;

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Page />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  mocks.search = {};
  mocks.session = { user: { id: "u1" }, session: { id: "s1" } };
  for (const fn of [
    mocks.save,
    mocks.remove,
    mocks.openPending,
    mocks.refresh,
    mocks.guard,
    mocks.history,
    mocks.toast.success,
    mocks.toast.error,
  ])
    fn.mockReset();
  mocks.guard.mockReturnValue(async () => {});
});
afterEach(cleanup);

describe("canned responses history", () => {
  it("mounts History only for a loaded selected snippet, with the session user", async () => {
    mocks.search = { id: "new" };
    mount();
    await screen.findByText("settings:cannedResponses.create", {
      selector: "[role=dialog] *",
    });
    expect(mocks.history).not.toHaveBeenCalled();
    cleanup();
    mocks.search = { id: "missing" };
    mount();
    await screen.findByText("settings:cannedResponses.notFound");
    expect(mocks.history).not.toHaveBeenCalled();
    cleanup();
    mocks.search = { id: "c1" };
    mount();
    await screen.findByText("History");
    expect(mocks.history).toHaveBeenCalledWith({
      type: "canned_response",
      id: "c1",
      userId: "u1",
    });
  });

  it("does not mount History for the delete confirmation", async () => {
    mocks.search = { id: "c1", action: "delete" };
    mount();
    await screen.findByText("common:actions.delete");
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it("refreshes the exact captured key after a successful save", async () => {
    mocks.search = { id: "c1" };
    mocks.save.mockResolvedValue({ id: "c1" });
    mount();
    fireEvent.click(await screen.findByText("settings:cannedResponses.save"));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(mocks.refresh.mock.calls[0]?.[1]).toEqual([
      "settings-history",
      "canned_response",
      "c1",
      "agent",
      "u1",
      "s1",
    ]);
    expect(mocks.guard).toHaveBeenCalledWith("u1", "s1");
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled());
  });

  it("uses the created id for a new snippet", async () => {
    mocks.search = { id: "new" };
    mocks.save.mockResolvedValue({ id: "c9" });
    mount();
    fireEvent.change(
      await screen.findByLabelText("settings:cannedResponses.name"),
      {
        target: { value: "Hello" },
      },
    );
    fireEvent.click(screen.getByText("settings:cannedResponses.save"));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(mocks.refresh.mock.calls[0]?.[1]?.[2]).toBe("c9");
  });

  it("does not refresh or report success when the save fails", async () => {
    mocks.search = { id: "c1" };
    mocks.save.mockRejectedValue(new Error("nope"));
    mount();
    fireEvent.click(await screen.findByText("settings:cannedResponses.save"));
    await screen.findByText("nope");
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it("keeps a saved change successful when the refresh helper is nonblocking-failing", async () => {
    mocks.search = { id: "c1" };
    mocks.save.mockResolvedValue({ id: "c1" });
    mocks.refresh.mockImplementation(() => undefined);
    mount();
    fireEvent.click(await screen.findByText("settings:cannedResponses.save"));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled());
  });

  it("skips the refresh without a session and still saves", async () => {
    mocks.search = { id: "c1" };
    mocks.session = null;
    mocks.save.mockResolvedValue({ id: "c1" });
    mount();
    fireEvent.click(await screen.findByText("settings:cannedResponses.save"));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled());
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it("requesting deletion opens the pending action and refreshes nothing", async () => {
    mocks.remove.mockResolvedValue({ pendingActionId: "p1" });
    mount();
    fireEvent.click(
      await screen.findByLabelText("settings:cannedResponses.deleteNamed"),
    );
    await waitFor(() =>
      expect(mocks.openPending).toHaveBeenCalledWith({ pendingActionId: "p1" }),
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });
});
