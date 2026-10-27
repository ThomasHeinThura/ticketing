import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prefetchWorkListData } from "./work-list-prefetch";

const mocks = vi.hoisted(() => ({
  getWorkspaces: vi.fn(),
  getProjects: vi.fn(),
  getProjectStates: vi.fn(),
  getWorkItems: vi.fn(),
}));

vi.mock("@/fetchers/workspace/get-workspaces", () => ({
  default: () => mocks.getWorkspaces(),
}));
vi.mock("@/fetchers/project/get-projects", () => ({
  default: (...args: unknown[]) => mocks.getProjects(...args),
}));
vi.mock("@/fetchers/project/get-project-states", () => ({
  default: (...args: unknown[]) => mocks.getProjectStates(...args),
}));
vi.mock("@/fetchers/work-item/get-work-items", () => ({
  default: (...args: unknown[]) => mocks.getWorkItems(...args),
}));

const session = { session: { activeOrganizationId: "ws-1" } };
const listSearch = { layout: "list", sort: "key", dir: "asc" } as const;
const page = { items: [], hasPartialFailure: false, hasMore: false };

function settle() {
  return vi.waitFor(() => expect(mocks.getWorkItems).toHaveBeenCalled());
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getWorkspaces.mockResolvedValue([{ id: "ws-1" }]);
  mocks.getProjects.mockResolvedValue([
    { id: "project-1", slug: "WLP", workspaceId: "ws-1" },
  ]);
  mocks.getProjectStates.mockResolvedValue([]);
  mocks.getWorkItems.mockResolvedValue(page);
});

describe("prefetchWorkListData", () => {
  it("fills the exact cache entries the list hooks read", async () => {
    const queryClient = new QueryClient();
    prefetchWorkListData(queryClient, {
      session,
      projectKey: "WLP",
      search: listSearch,
    });
    await settle();
    await vi.waitFor(() =>
      expect(
        queryClient.getQueryData([
          "work-items",
          "project-1",
          "list",
          "key",
          "asc",
        ]),
      ).toEqual({ pages: [page], pageParams: [undefined] }),
    );

    expect(mocks.getProjects).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      includeArchived: undefined,
      includeDeleted: undefined,
    });
    expect(mocks.getWorkItems).toHaveBeenCalledWith("project-1", "key", "asc", {
      cursor: undefined,
    });
    expect(queryClient.getQueryData(["workspaces"])).toEqual([{ id: "ws-1" }]);
    expect(
      queryClient.getQueryData(["projects", "ws-1", undefined, undefined]),
    ).toHaveLength(1);
    expect(
      queryClient.getQueryData(["projects", "project-1", "states"]),
    ).toEqual([]);
  });

  it("never refetches what is already cached", async () => {
    const queryClient = new QueryClient();
    prefetchWorkListData(queryClient, {
      session,
      projectKey: "WLP",
      search: listSearch,
    });
    await settle();
    await vi.waitFor(() =>
      expect(mocks.getProjectStates).toHaveBeenCalledOnce(),
    );
    prefetchWorkListData(queryClient, {
      session,
      projectKey: "WLP",
      search: listSearch,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.getWorkspaces).toHaveBeenCalledOnce();
    expect(mocks.getProjects).toHaveBeenCalledOnce();
    expect(mocks.getProjectStates).toHaveBeenCalledOnce();
    expect(mocks.getWorkItems).toHaveBeenCalledOnce();
  });

  it("reads nothing without a signed-in workspace or outside the list layout", async () => {
    const queryClient = new QueryClient();
    prefetchWorkListData(queryClient, {
      session: null,
      projectKey: "WLP",
      search: listSearch,
    });
    prefetchWorkListData(queryClient, {
      session,
      projectKey: "WLP",
      search: { ...listSearch, layout: "board" },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.getWorkspaces).not.toHaveBeenCalled();
    expect(mocks.getProjects).not.toHaveBeenCalled();
  });

  it("leaves structured searches and unknown projects to the screen", async () => {
    const queryClient = new QueryClient();
    prefetchWorkListData(queryClient, {
      session,
      projectKey: "WLP",
      search: { ...listSearch, filter: "state = Open" },
    });
    await vi.waitFor(() =>
      expect(mocks.getProjectStates).toHaveBeenCalledOnce(),
    );
    prefetchWorkListData(queryClient, {
      session,
      projectKey: "NOPE",
      search: listSearch,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.getWorkItems).not.toHaveBeenCalled();
    expect(mocks.getProjectStates).toHaveBeenCalledOnce();
  });
});
