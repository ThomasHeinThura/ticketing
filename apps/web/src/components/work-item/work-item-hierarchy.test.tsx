import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import WorkItemHierarchy from "./work-item-hierarchy";

const fake = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
  queries: {} as Record<string, Record<string, unknown>>,
  search: {} as Record<string, unknown>,
  navigate: vi.fn(),
  calls: vi.fn(),
}));
vi.mock("@/hooks/queries/work-item/use-get-hierarchy-children", () => ({
  useGetHierarchyChildren: (key: string, enabled = true) => {
    fake.calls(key, enabled);
    return fake.queries[key] ?? fake.query;
  },
}));
vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({
    pathname: "/agent/work-items/TD-1",
    search: fake.search,
    searchStr: "",
    hash: "",
  }),
  useNavigate: () => fake.navigate,
  Link: ({
    children,
    params,
    ...props
  }: React.PropsWithChildren<{
    params: { key: string };
    "aria-label"?: string;
    "aria-current"?: "page";
  }>) => (
    <a
      href={`/agent/work-items/${params.key}`}
      aria-label={props["aria-label"]}
      aria-current={props["aria-current"]}
    >
      {children}
    </a>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
afterEach(() => {
  cleanup();
  fake.query = {};
  fake.queries = {};
  fake.search = {};
  fake.navigate.mockClear();
  fake.calls.mockClear();
});
const cached = {
  pages: [
    {
      parent: {
        id: "private-id",
        key: "TD-1",
        title: "Private cached title",
        parentId: null,
        assigneeId: null,
        assigneeName: null,
        stateName: "Backlog",
        stateCategory: "backlog",
      },
      ancestors: [],
      data: [],
      progress: { completed: 0, total: 0 },
      page: { nextCursor: null, hasMore: false },
      meta: { total: 0 },
    },
  ],
};

describe("hierarchy access loss", () => {
  it.each([403, 404])(
    "discards a stale cached tree after current-item refusal %s",
    (status) => {
      fake.query = {
        data: cached,
        isError: true,
        isPending: false,
        isFetchNextPageError: false,
        error: new HttpError(status, "Not found"),
        refetch: vi.fn(),
      };
      const onAccessLost = vi.fn();
      render(
        <WorkItemHierarchy workItemKey="TD-1" onAccessLost={onAccessLost} />,
      );
      expect(onAccessLost).toHaveBeenCalledOnce();
      expect(screen.queryByText("Private cached title")).toBeNull();
      expect(screen.getByRole("alert")).toBeTruthy();
    },
  );
  it("shows a retryable transport failure without declaring the item inaccessible", () => {
    fake.query = {
      data: cached,
      isError: true,
      isPending: false,
      isFetchNextPageError: false,
      error: new HttpError(503, "Unavailable"),
      refetch: vi.fn(),
    };
    const onAccessLost = vi.fn();
    render(
      <WorkItemHierarchy workItemKey="TD-1" onAccessLost={onAccessLost} />,
    );
    expect(onAccessLost).not.toHaveBeenCalled();
    expect(screen.queryByText("Private cached title")).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});

const child = {
  id: "child-2",
  key: "TD-2",
  title: "Direct child",
  stateName: "In progress",
  stateCategory: "started",
  hasChildren: false,
  assigneeId: "person-2",
  assigneeName: "Thomas Example",
};
function successful(data: unknown) {
  return {
    data,
    isPending: false,
    isError: false,
    isFetchNextPageError: false,
    hasNextPage: false,
    isFetching: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  };
}
function parentPage(
  children: Array<
    Omit<typeof child, "assigneeName"> & { assigneeName: string | null }
  > = [child],
) {
  return {
    ...cached,
    pages: [
      {
        ...cached.pages[0],
        data: children,
        progress: { completed: 0, total: children.length },
        meta: { total: children.length },
      },
    ],
  };
}
describe("original Kaneo direct Sub-tasks composition", () => {
  it("shows direct child completion/state/title/assignee without repeating the current item", () => {
    fake.query = successful(parentPage());
    render(<WorkItemHierarchy workItemKey="TD-1" onAccessLost={vi.fn()} />);
    expect(screen.queryByText("Private cached title")).toBeNull();
    expect(
      screen.getByRole("link", { name: "TD-2 Direct child" }),
    ).toHaveAttribute("href", "/agent/work-items/TD-2");
    expect(
      screen.getByRole("checkbox", { name: "TD-2: In progress" }),
    ).not.toBeChecked();
    expect(screen.getByRole("checkbox")).toHaveAttribute(
      "aria-readonly",
      "true",
    );
    expect(
      screen.getByRole("img", { name: "Thomas Example" }),
    ).toHaveTextContent("TE");
    expect(
      screen.queryByRole("link", { name: /Private cached title/ }),
    ).toBeNull();
  });

  it("distinguishes an assigned person with no readable name from an unassigned child", () => {
    fake.query = successful(parentPage([{ ...child, assigneeName: null }]));
    render(<WorkItemHierarchy workItemKey="TD-1" onAccessLost={vi.fn()} />);
    expect(
      screen.getByRole("img", { name: "tasks:assignee.label" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: "tasks:assignee.unassigned" }),
    ).toBeNull();
  });
  it("renders mapped completed/cancelled progress and child completion without a fake state mutation", () => {
    fake.query = successful(
      parentPage([
        { ...child, stateCategory: "cancelled", stateName: "Won't do" },
      ]),
    );
    render(<WorkItemHierarchy workItemKey="TD-1" onAccessLost={vi.fn()} />);
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByText("Direct child")).toHaveClass("line-through");
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("checkbox")).toBeChecked();
  });
  it("preserves the explicit complete ancestor/current tree in URL mode", () => {
    fake.search = { hierarchy: { itemKey: "TD-1", mode: "tree" } };
    fake.query = successful(parentPage());
    render(<WorkItemHierarchy workItemKey="TD-1" onAccessLost={vi.fn()} />);
    expect(
      screen.getByRole("link", { name: "TD-1 · Private cached title" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("button", { name: "workItems:hierarchy.title" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:hierarchy.title" }),
    );
    const destination = new URL(
      fake.navigate.mock.calls[0]?.[0].href,
      "https://test.invalid",
    );
    expect(
      JSON.parse(destination.searchParams.get("hierarchy") ?? "{}"),
    ).not.toHaveProperty("mode");
  });
  it("offers the full hierarchy explicitly without losing the direct child list", () => {
    fake.query = successful(parentPage());
    render(<WorkItemHierarchy workItemKey="TD-1" onAccessLost={vi.fn()} />);
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:hierarchy.title" }),
    );
    const destination = new URL(
      fake.navigate.mock.calls[0]?.[0].href,
      "https://test.invalid",
    );
    expect(
      JSON.parse(destination.searchParams.get("hierarchy") ?? "{}"),
    ).toMatchObject({ itemKey: "TD-1", mode: "tree" });
  });
  it("keeps deep descendants reachable through existing disclosed child branches", () => {
    fake.search = { hierarchy: { itemKey: "TD-1", expanded: ["TD-2"] } };
    fake.query = successful(parentPage([{ ...child, hasChildren: true }]));
    fake.queries["TD-2"] = successful({
      pages: [
        {
          ...cached.pages[0],
          parent: { ...child, parentId: "private-id" },
          data: [
            { ...child, id: "grandchild", key: "TD-3", title: "Grandchild" },
          ],
          progress: { completed: 0, total: 1 },
        },
      ],
    });
    render(<WorkItemHierarchy workItemKey="TD-1" onAccessLost={vi.fn()} />);
    expect(
      screen.getByRole("link", { name: "TD-3 Grandchild" }),
    ).toBeInTheDocument();
    expect(fake.calls).toHaveBeenCalledWith("TD-2", true);
    expect(screen.queryByText("Private cached title")).toBeNull();
  });
  it("preserves loaded children and exposes retry when an extra page fails", () => {
    fake.query = {
      ...successful(parentPage()),
      isError: true,
      isFetchNextPageError: true,
      error: new HttpError(503, "Unavailable"),
    };
    render(<WorkItemHierarchy workItemKey="TD-1" onAccessLost={vi.fn()} />);
    expect(
      screen.getByRole("link", { name: "TD-2 Direct child" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:hierarchy.retry" }),
    );
    expect(fake.query.fetchNextPage).toHaveBeenCalledOnce();
  });
});
