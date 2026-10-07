import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SavedViewRoute } from "./views/$id";

const mocks = vi.hoisted(() => ({
  directQuery: vi.fn(),
  infiniteOptions: undefined as unknown,
  snapshotComplete: true,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({
    fullPath: "/agent/views/$id",
    useParams: () => ({ id: "view-1" }),
    useSearch: () => ({
      workspaceId: "workspace-1",
      scope: "workspace",
      scopeId: mocks.snapshotComplete ? "workspace-1" : undefined,
      layout: "list",
      filter: "status:open",
    }),
  }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="#test-link">{children}</a>
  ),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: unknown[] }) =>
    options.queryKey[0] === "saved-view"
      ? { data: undefined, isLoading: false, isError: true }
      : { data: [], isLoading: false, isError: false },
  useInfiniteQuery: (options: unknown) => {
    mocks.infiniteOptions = options;
    return {
      data: {
        pages: [
          {
            items: [{ key: "HELP-77", title: "Reachable shared result" }],
            hasPartialFailure: false,
          },
        ],
        pageParams: [undefined],
      },
      isLoading: false,
      isError: false,
      hasNextPage: false,
      refetch: vi.fn(),
    };
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { id: "viewer-1" } }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canShareSavedViews: () => false,
    canManageWorkspaceSettings: () => false,
  }),
}));
vi.mock("@/fetchers/saved-views", () => ({
  getSavedView: vi.fn(),
  getSavedViews: vi.fn(),
  getShareableViewTeams: vi.fn(),
  runSavedView: vi.fn(),
  runSavedViewUrlQuery: (...args: unknown[]) => mocks.directQuery(...args),
  createSavedView: vi.fn(),
  toggleSavedViewPin: vi.fn(),
}));
vi.mock("@/fetchers/project/get-projects", () => ({ default: vi.fn() }));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/work-item/work-item-filter-editor", () => ({
  default: () => null,
}));
vi.mock("@/components/work-item/work-item-list", () => ({
  default: ({ workItems }: { workItems: Array<{ title: string }> }) => (
    <div>{workItems.map((item) => item.title)}</div>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@taskdesk/ui", () => {
  const passthrough = ({
    children,
    ...props
  }: React.PropsWithChildren<Record<string, unknown>>) => (
    <div {...props}>{children}</div>
  );
  return {
    Button: passthrough,
    Card: passthrough,
    CardContent: passthrough,
    Input: passthrough,
    Select: passthrough,
    SelectItem: passthrough,
    SelectPopup: passthrough,
    SelectTrigger: passthrough,
    SelectValue: passthrough,
    Skeleton: passthrough,
  };
});

describe("SavedViewRoute shared URL fallback", () => {
  beforeEach(() => {
    mocks.directQuery.mockReset();
    mocks.infiniteOptions = undefined;
    mocks.snapshotComplete = true;
  });
  afterEach(cleanup);

  it("SV-19: executes a complete URL query for the current viewer when the saved view is unreadable", async () => {
    mocks.directQuery.mockResolvedValue({
      items: [{ key: "HELP-77", title: "Reachable shared result" }],
      hasPartialFailure: false,
      hasMore: false,
      nextCursor: null,
      total: 1,
    });
    render(<SavedViewRoute />);
    expect(screen.getByText("Reachable shared result")).toBeInTheDocument();
    expect(screen.queryByText("loadError")).toBeNull();
    const options = mocks.infiniteOptions as
      | {
          enabled: boolean;
          queryFn: (context: { pageParam: undefined }) => Promise<unknown>;
        }
      | undefined;
    expect(options).toBeDefined();
    expect(options?.enabled).toBe(true);
    await options?.queryFn({ pageParam: undefined });
    expect(mocks.directQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        filter: "status:open",
      }),
    );
  });

  it("does not enable the URL query for an incomplete snapshot when the saved view is unreadable", () => {
    mocks.snapshotComplete = false;
    render(<SavedViewRoute />);
    const options = mocks.infiniteOptions as { enabled: boolean } | undefined;
    expect(options?.enabled).toBe(false);
  });
});
