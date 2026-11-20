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
  save: vi.fn(),
  remove: vi.fn(),
  openPending: vi.fn(),
  history: vi.fn(),
  historyRows: 0,
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
  SettingsHistory: (props: { target: unknown }) => {
    mocks.history(props);
    return (
      <div>
        History
        {Array.from({ length: mocks.historyRows }, (_, i) => i + 1).map(
          (id) => (
            <div key={id}>History row {id}</div>
          ),
        )}
      </div>
    );
  },
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
  return client;
}
/** The History targets the last write declared through its mutation meta. */
const declaredTargets = (client: QueryClient) => {
  const mutation = client.getMutationCache().getAll().at(-1);
  return mutation?.meta?.audits?.targets(
    mutation.state.variables as never,
    mutation.state.data as never,
  );
};
beforeEach(() => {
  mocks.search = {};
  mocks.historyRows = 0;
  for (const fn of [
    mocks.save,
    mocks.remove,
    mocks.openPending,
    mocks.history,
    mocks.toast.success,
    mocks.toast.error,
  ])
    fn.mockReset();
});
afterEach(cleanup);

describe("canned responses history", () => {
  it("keeps the editor body scrollable and actions in the footer with 200 history rows", async () => {
    mocks.search = { id: "c1" };
    mocks.historyRows = 200;
    mount();
    const lastRow = await screen.findByText("History row 200");
    const panel = lastRow.closest('[data-slot="dialog-panel"]');
    const viewport = panel?.closest('[data-slot="scroll-area-viewport"]');
    const save = screen.getByText("settings:cannedResponses.save");
    const cancel = screen.getByText("common:actions.cancel");
    const footer = save.closest('[data-slot="dialog-footer"]');
    expect(screen.getAllByText(/^History row \d+$/)).toHaveLength(200);
    expect(viewport).not.toBeNull();
    expect(
      panel?.contains(screen.getByLabelText("settings:cannedResponses.name")),
    ).toBe(true);
    expect(footer?.contains(cancel)).toBe(true);
    expect(viewport?.contains(footer ?? null)).toBe(false);
    expect(footer?.parentElement).toBe(viewport?.closest("form"));
  });
  it("mounts History only for a loaded selected snippet, with the workspace target", async () => {
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
      target: {
        kind: "entity",
        type: "canned_response",
        id: "c1",
        scope: { kind: "workspace", workspaceId: "ws" },
      },
    });
  });

  it("does not mount History for the delete confirmation", async () => {
    mocks.search = { id: "c1", action: "delete" };
    mount();
    await screen.findByText("common:actions.delete");
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it("declares the saved snippet as the audited target", async () => {
    mocks.search = { id: "c1" };
    mocks.save.mockResolvedValue({ id: "c1" });
    const client = mount();
    fireEvent.click(await screen.findByText("settings:cannedResponses.save"));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled());
    expect(declaredTargets(client)).toEqual([
      {
        kind: "entity",
        type: "canned_response",
        id: "c1",
        scope: { kind: "workspace", workspaceId: "ws" },
      },
    ]);
  });

  it("declares the created id for a new snippet", async () => {
    mocks.search = { id: "new" };
    mocks.save.mockResolvedValue({ id: "c9" });
    const client = mount();
    fireEvent.change(
      await screen.findByLabelText("settings:cannedResponses.name"),
      {
        target: { value: "Hello" },
      },
    );
    fireEvent.click(screen.getByText("settings:cannedResponses.save"));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled());
    expect(declaredTargets(client)).toMatchObject([{ id: "c9" }]);
  });

  it("does not report success when the save fails", async () => {
    mocks.search = { id: "c1" };
    mocks.save.mockRejectedValue(new Error("nope"));
    mount();
    fireEvent.click(await screen.findByText("settings:cannedResponses.save"));
    await screen.findByText("nope");
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it("requesting deletion opens the pending action and declares no History target", async () => {
    mocks.remove.mockResolvedValue({ pendingActionId: "p1" });
    const client = mount();
    fireEvent.click(
      await screen.findByLabelText("settings:cannedResponses.deleteNamed"),
    );
    await waitFor(() =>
      expect(mocks.openPending).toHaveBeenCalledWith({ pendingActionId: "p1" }),
    );
    expect(declaredTargets(client)).toEqual([]);
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });
});
