import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import WorkItemHierarchy from "./work-item-hierarchy";

const fake = vi.hoisted(() => ({ query: {} as Record<string, unknown> }));
vi.mock("@/hooks/queries/work-item/use-get-hierarchy-children", () => ({
  useGetHierarchyChildren: () => fake.query,
}));
vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({
    pathname: "/agent/work-items/TD-1",
    search: {},
    searchStr: "",
    hash: "",
  }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
afterEach(cleanup);
const cached = {
  pages: [
    {
      parent: {
        id: "private-id",
        key: "TD-1",
        title: "Private cached title",
        parentId: null,
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
