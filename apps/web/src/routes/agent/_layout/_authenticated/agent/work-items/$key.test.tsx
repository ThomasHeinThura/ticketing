import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { Route } from "./$key";

const mocks = vi.hoisted(() => ({
  params: { key: "WLP-1" },
  query: {} as Record<string, unknown>,
  titles: [] as string[],
  projectLookups: [] as Array<string | undefined>,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useParams: () => mocks.params,
    useSearch: () => ({}),
    useNavigate: () => vi.fn(),
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/page-title", () => ({
  default: ({ title }: { title: string }) => {
    mocks.titles.push(title);
    return null;
  },
}));
vi.mock("@/hooks/queries/work-item/use-get-work-item", () => ({
  default: () => mocks.query,
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: ({ workspaceId }: { workspaceId: string | undefined }) => {
    mocks.projectLookups.push(workspaceId);
    return { data: [{ id: "proj_1", name: "Worklist", slug: "WLP" }] };
  },
}));
// The detail view is covered by its own tests; this stub exposes exactly what the route
// hands it, and a button that reports access loss the way the real mutations do.
vi.mock("@/components/work-item/load-work-item-detail", () => ({
  default: () =>
    Promise.resolve({
      default: (props: {
        item: { title: string } | undefined;
        project: { name: string } | undefined;
        isNotFound: boolean;
        onAccessLost: () => void;
      }) => (
        <div data-testid="detail-stub">
          <span data-testid="stub-item">{props.item?.title ?? "none"}</span>
          <span data-testid="stub-project">
            {props.project?.name ?? "none"}
          </span>
          <span data-testid="stub-not-found">{String(props.isNotFound)}</span>
          <button type="button" onClick={props.onAccessLost}>
            lose access
          </button>
        </div>
      ),
    }),
}));

const item = {
  key: "WLP-1",
  title: "Fix the thing",
  workspaceId: "ws_1",
  projectId: "proj_1",
};

let queryClient = new QueryClient();

function Page() {
  const Component = (Route as unknown as { component: ComponentType })
    .component;
  return (
    <QueryClientProvider client={queryClient}>
      <Component />
    </QueryClientProvider>
  );
}

const lastTitle = () => mocks.titles[mocks.titles.length - 1];

beforeEach(() => {
  queryClient = new QueryClient();
  mocks.params = { key: "WLP-1" };
  mocks.titles = [];
  mocks.projectLookups = [];
  mocks.query = {
    data: item,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    isRealtimeUnavailable: false,
  };
});

afterEach(cleanup);

describe("work-item detail route access loss", () => {
  it("shows the item's title and its project while the item is reachable", async () => {
    render(<Page />);
    expect(await screen.findByTestId("stub-item")).toHaveTextContent(
      "Fix the thing",
    );
    expect(screen.getByTestId("stub-project")).toHaveTextContent("Worklist");
    expect(lastTitle()).toBe("Fix the thing · WLP-1");
  });

  it("never renders cached item data (title, project lookup) after the read answers 404", async () => {
    // React Query keeps the last good `data` beside a later error.
    mocks.query = {
      ...mocks.query,
      error: new HttpError(404, "Failed to fetch work item"),
      isError: true,
    };
    render(<Page />);
    expect(await screen.findByTestId("stub-not-found")).toHaveTextContent(
      "true",
    );
    expect(screen.getByTestId("stub-item")).toHaveTextContent("none");
    expect(screen.getByTestId("stub-project")).toHaveTextContent("none");
    expect(lastTitle()).toBe("WLP-1");
    expect(mocks.titles).not.toContain("Fix the thing · WLP-1");
    // The project lookup only runs for a visible item.
    expect(mocks.projectLookups).toEqual([]);
  });

  it("shows the not-found state, and drops the cached title, when a mutation reports access loss", async () => {
    render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: "lose access" }));

    expect(await screen.findByTestId("stub-not-found")).toHaveTextContent(
      "true",
    );
    expect(screen.getByTestId("stub-item")).toHaveTextContent("none");
    expect(screen.getByTestId("stub-project")).toHaveTextContent("none");
    expect(lastTitle()).toBe("WLP-1");
  });

  it("does not carry access loss over to a different work item", async () => {
    const view = render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: "lose access" }));
    expect(await screen.findByTestId("stub-not-found")).toHaveTextContent(
      "true",
    );

    mocks.params = { key: "WLP-2" };
    mocks.query = {
      ...mocks.query,
      data: { ...item, key: "WLP-2", title: "Other" },
    };
    view.rerender(<Page />);

    expect(await screen.findByTestId("stub-item")).toHaveTextContent("Other");
    expect(screen.getByTestId("stub-not-found")).toHaveTextContent("false");
    expect(lastTitle()).toBe("Other · WLP-2");
  });

  it("removes the item's cached queries on access loss so returning to the key cannot show the old row", async () => {
    queryClient.setQueryData(["work-items", "detail", "WLP-1"], item);
    queryClient.setQueryData(["work-items", "transitions", "WLP-1"], []);
    queryClient.setQueryData(["work-items", "activity", "WLP-1"], {});
    queryClient.setQueryData(["work-items", "detail", "WLP-2"], item);
    render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: "lose access" }));

    expect(
      queryClient.getQueryData(["work-items", "detail", "WLP-1"]),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData(["work-items", "transitions", "WLP-1"]),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData(["work-items", "activity", "WLP-1"]),
    ).toBeUndefined();
    // Another item's cache is untouched.
    expect(
      queryClient.getQueryData(["work-items", "detail", "WLP-2"]),
    ).toBeDefined();
  });
});
