import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { translate } from "@/test/en-translation";
import WorkItemRelations from "./work-item-relations";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  canEdit: true,
  location: {
    pathname: "/agent/work-items/OPS-1",
    search: {} as Record<string, unknown>,
    searchStr: "?activity=public",
    hash: "",
  },
  get: vi.fn(),
  candidates: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  openPending: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useLocation: () => mocks.location,
}));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => mocks.openPending,
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canUpdateTasks: () => mocks.canEdit }),
}));
vi.mock("@/fetchers/work-item/relations", () => ({
  getWorkItemRelations: mocks.get,
  getRelationCandidates: mocks.candidates,
  createWorkItemRelation: mocks.create,
  requestWorkItemRelationRemoval: mocks.remove,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(
        typeof options?.count === "number"
          ? `${key}_${options.count === 1 ? "one" : "other"}`
          : key,
        options,
      ),
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
const peer = {
  id: "peer",
  key: "PLAT-2",
  title: "Linked work",
  stateName: "In progress",
  stateCategory: "started",
  assigneeName: "Ada Lovelace",
};
const relation = {
  id: "relation-1",
  type: "blocks",
  label: "blocked_by",
  item: peer,
  blockingCycle: true,
  canRemove: true,
};
function mount(itemKey = "OPS-1", canEdit = true) {
  mocks.canEdit = canEdit;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <WorkItemRelations
        itemKey={itemKey}
        workspaceId="ws-1"
        projectId="project-1"
      />
    </QueryClientProvider>,
  );
  return { ...view, client };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.location = {
    pathname: "/agent/work-items/OPS-1",
    search: {},
    searchStr: "?activity=public",
    hash: "",
  };
  mocks.get.mockResolvedValue({ data: [relation], hiddenCount: 1 });
  mocks.candidates.mockResolvedValue({
    data: [{ ...peer, projectId: "project-peer" }],
    page: { hasMore: false, nextCursor: null },
  });
});
afterEach(cleanup);
describe("canonical Kaneo relations section", () => {
  it("renders real inverse groups, reachable peer links and anonymous hidden counts", async () => {
    mount();
    expect(
      await screen.findByRole("link", { name: "Linked work" }),
    ).toHaveAttribute("href", "/agent/work-items/PLAT-2");
    expect(screen.getByText("blocked by")).toBeVisible();
    expect(screen.getByText("Blocking cycle")).toBeVisible();
    expect(screen.getByText("1 related item you cannot see")).toBeVisible();
    expect(mocks.candidates).not.toHaveBeenCalled();
  });
  it("preserves other URL state when opening the picker or collapsing", async () => {
    mount();
    await screen.findByText("Linked work");
    fireEvent.click(screen.getByRole("button", { name: "Add relation" }));
    const open = mocks.navigate.mock.calls.at(-1)?.[0];
    const params = new URL(open.href, "https://example.test").searchParams;
    expect(params.get("activity")).toBe("public");
    expect(JSON.parse(params.get("relations") ?? "{}")).toEqual({
      itemKey: "OPS-1",
      picker: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Relations" }));
    const collapsed = mocks.navigate.mock.calls.at(-1)?.[0];
    expect(
      JSON.parse(
        new URL(collapsed.href, "https://example.test").searchParams.get(
          "relations",
        ) ?? "{}",
      ),
    ).toEqual({ itemKey: "OPS-1", collapsed: true });
  });
  it("restores the real scoped picker and submits its selected inverse type", async () => {
    mocks.location.search = {
      relations: {
        itemKey: "OPS-1",
        picker: true,
        query: "Linked",
        type: "blocked_by",
      },
    };
    mocks.create.mockResolvedValue({ id: "new" });
    mount();
    const option = await screen.findByRole("option", {
      name: /PLAT-2\s*Linked work/,
    });
    expect(mocks.candidates).toHaveBeenCalledWith({
      key: "OPS-1",
      q: "Linked",
      cursor: undefined,
    });
    fireEvent.click(option);
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        sourceKey: "OPS-1",
        targetKey: "PLAT-2",
        type: "blocked_by",
      }),
    );
  });
  it("does not navigate back to a previous item when an in-flight link completes", async () => {
    mocks.location.search = { relations: { itemKey: "OPS-1", picker: true } };
    let complete: (value: { id: string }) => void = () => {};
    const request = new Promise<{ id: string }>((resolve) => {
      complete = resolve;
    });
    mocks.create.mockReturnValue(request);
    const view = mount();
    fireEvent.click(
      await screen.findByRole("option", { name: /PLAT-2\s*Linked work/ }),
    );
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    mocks.location = {
      pathname: "/agent/work-items/OPS-9",
      search: {},
      searchStr: "",
      hash: "",
    };
    view.rerender(
      <QueryClientProvider client={view.client}>
        <WorkItemRelations
          itemKey="OPS-9"
          workspaceId="ws-1"
          projectId="project-1"
        />
      </QueryClientProvider>,
    );
    await act(async () => {
      complete({ id: "new" });
      await request;
    });
    await waitFor(() => expect(view.client.isMutating()).toBe(0));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("continues scoped candidate pages and keeps loaded options when an extra page needs retry", async () => {
    mocks.location.search = {
      relations: { itemKey: "OPS-1", picker: true, query: "Linked" },
    };
    mocks.candidates
      .mockReset()
      .mockResolvedValueOnce({
        data: [{ ...peer, projectId: "peer-project" }],
        page: { hasMore: true, nextCursor: "opaque-next" },
      })
      .mockRejectedValueOnce(new HttpError(503, "Temporary failure"))
      .mockResolvedValueOnce({
        data: [
          {
            ...peer,
            id: "peer-3",
            key: "PLAT-3",
            title: "Linked next",
            projectId: "peer-project",
          },
        ],
        page: { hasMore: false, nextCursor: null },
      });
    mount();
    expect(
      await screen.findByRole("option", { name: /PLAT-2\s*Linked work/ }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Work items could not be searched",
    );
    expect(
      screen.getByRole("option", { name: /PLAT-2\s*Linked work/ }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(
      await screen.findByRole("option", { name: /PLAT-3\s*Linked next/ }),
    ).toBeVisible();
    expect(mocks.candidates).toHaveBeenLastCalledWith({
      key: "OPS-1",
      q: "Linked",
      cursor: "opaque-next",
    });
  });
  it("requests removal but keeps the relation while opening the approval dialog in place", async () => {
    mocks.remove.mockResolvedValue({ pendingActionId: "pending-1" });
    mount();
    fireEvent.contextMenu(await screen.findByText("Linked work"));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Remove relation" }),
    );
    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledWith({
        key: "OPS-1",
        id: "relation-1",
      }),
    );
    await waitFor(() =>
      expect(mocks.openPending).toHaveBeenCalledWith({
        pendingActionId: "pending-1",
      }),
    );
    expect(
      screen.queryByRole("link", { name: "View removal request" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Linked work" })).toBeVisible();
  });
  it("ignores a different item's saved picker and does not grant controls without update", async () => {
    mocks.location.search = { relations: { itemKey: "OTHER-9", picker: true } };
    mount("OPS-1", false);
    await screen.findByText("Linked work");
    expect(
      screen.queryByRole("button", { name: "Add relation" }),
    ).not.toBeInTheDocument();
    expect(mocks.candidates).not.toHaveBeenCalled();
  });
  it("shows loading without empty-state or fabricated rows", () => {
    mocks.get.mockReturnValue(new Promise(() => {}));
    const view = mount();
    expect(
      view.container.querySelector('[data-slot="skeleton"]'),
    ).not.toBeNull();
    expect(screen.queryByText("No related tasks")).not.toBeInTheDocument();
    expect(screen.queryByText("Linked work")).not.toBeInTheDocument();
  });
  it("surfaces scoped picker failure without stale candidate options", async () => {
    mocks.location.search = {
      relations: { itemKey: "OPS-1", picker: true, query: "SSO" },
    };
    mocks.candidates.mockRejectedValue(new HttpError(403, "Denied"));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Work items could not be searched",
    );
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });
  it("respects each relation's server-reported removal permission", async () => {
    mocks.get.mockResolvedValue({
      data: [{ ...relation, canRemove: false }],
      hiddenCount: 0,
    });
    mount();
    fireEvent.contextMenu(await screen.findByText("Linked work"));
    expect(
      await screen.findByRole("menuitem", { name: "Open task" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("menuitem", { name: "Remove relation" }),
    ).not.toBeInTheDocument();
  });
  it.each([403, 404])(
    "shows denial %i without retained peer data",
    async (status) => {
      mocks.get.mockRejectedValue(new HttpError(status, "Unavailable"));
      mount();
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Relations could not be loaded",
      );
      expect(screen.queryByText("Linked work")).not.toBeInTheDocument();
    },
  );
});
