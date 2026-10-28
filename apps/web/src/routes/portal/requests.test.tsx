import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigate = vi.hoisted(() => vi.fn());
const view = vi.hoisted(() => ({ value: undefined as "backlog" | undefined }));
const rankBacklog = vi.hoisted(() => vi.fn());
const fakeSubmissionsQuery = vi.hoisted(() => ({
  data: {
    page: { hasMore: true, nextCursor: "older-50" },
    submissions: [
      {
        ref: "REQ-101",
        requestTypeName: "Laptop Request",
        state: "submitted",
        customerStatus: "resolved",
        customerVisibility: "organisation",
        createdAt: "2026-10-21T12:00:00.000Z",
      },
    ],
  },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
}));
const fakeBacklogQuery = vi.hoisted(() => ({
  items: [
    {
      id: "item-a",
      key: "CCY-1",
      title: "First accepted request",
      projectId: "project-a",
      projectKey: "CCY",
      projectName: "Customer Work",
      stateId: "state-a",
      stateName: "Backlog",
      statePosition: 0,
      position: "1",
      version: 1,
      sourceRef: "SUB-1",
    },
    {
      id: "item-b",
      key: "CCY-2",
      title: "Second accepted request",
      projectId: "project-a",
      projectKey: "CCY",
      projectName: "Customer Work",
      stateId: "state-a",
      stateName: "Backlog",
      statePosition: 0,
      position: "2",
      version: 1,
      sourceRef: "SUB-2",
    },
  ],
  page: { nextCursor: "older-items", hasMore: true },
}));
const initialBacklogItems = [...fakeBacklogQuery.items];

vi.mock("@/fetchers/intake", () => ({
  getPortalSubmissions: () => fakeSubmissionsQuery.data,
}));
vi.mock("@/fetchers/portal-backlog", () => ({
  getPortalBacklog: () => fakeBacklogQuery,
  rankPortalBacklogItem: rankBacklog,
}));

vi.mock("@tanstack/react-query", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    useQuery: () => fakeSubmissionsQuery,
    useInfiniteQuery: () => ({
      data: { pages: [fakeBacklogQuery] },
      isLoading: false,
      isError: false,
      isFetching: false,
      isFetchingNextPage: false,
      dataUpdatedAt: 1,
      hasNextPage: true,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    }),
    useMutation: (options: {
      mutationFn: (input: unknown) => Promise<unknown>;
      onSuccess?: () => void;
    }) => {
      const [isPending, setIsPending] = React.useState(false);
      return {
        isPending,
        mutateAsync: async (input: unknown) => {
          setIsPending(true);
          try {
            const result = await options.mutationFn(input);
            await options.onSuccess?.();
            return result;
          } finally {
            setIsPending(false);
          }
        },
      };
    },
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock("@tanstack/react-router", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    createFileRoute: () => (config: { component: React.ComponentType }) =>
      Object.assign(config.component, {
        useRouteContext: () => ({ portalUserId: "customer-a" }),
        useSearch: () => ({ ...(view.value ? { view: view.value } : {}) }),
        fullPath: "/requests",
      }),
    useNavigate: () => navigate,
    Link: React.forwardRef<
      HTMLAnchorElement,
      React.PropsWithChildren<{ to: string }>
    >(({ children, to }, ref) => (
      <a href={to} ref={ref}>
        {children}
      </a>
    )),
  };
});

vi.mock("react-i18next", async () => ({
  ...(await vi.importActual<typeof import("react-i18next")>("react-i18next")),
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue || key,
  }),
}));

import { Route } from "./requests";

describe("PortalRequestsPage", () => {
  afterEach(() => {
    cleanup();
    view.value = undefined;
    rankBacklog.mockReset();
    fakeBacklogQuery.items = [...initialBacklogItems];
  });

  it("renders submission rows for the customer", () => {
    const Component = Route as unknown as React.ComponentType;
    render(<Component />);

    expect(screen.getByRole("heading", { name: "My requests" })).toBeTruthy();
    expect(screen.getByText("REQ-101")).toBeTruthy();
    expect(screen.getByText("Laptop Request")).toBeTruthy();
    expect(screen.getByText("request.status.resolved")).toBeTruthy();
    expect(screen.queryByText("submitted")).toBeNull();
  });
  it("follows the server cursor for requests beyond the first page", () => {
    const Component = Route as unknown as React.ComponentType;
    render(<Component />);
    fireEvent.click(screen.getByRole("button", { name: "requests.older" }));
    expect(navigate).toHaveBeenCalledWith({ search: { cursor: "older-50" } });
    expect(
      screen.getByRole("link", { name: "New request" }).querySelector("button"),
    ).toBeNull();
  });

  it("shows the accepted backlog only when the URL opts into backlog mode", () => {
    view.value = "backlog";
    const Component = Route as unknown as React.ComponentType;
    render(<Component />);

    expect(screen.getByRole("heading", { name: "Backlog" })).toBeTruthy();
    expect(screen.getByText("CCY-1")).toBeTruthy();
    expect(screen.getByText("First accepted request")).toBeTruthy();
    expect(screen.getByText("CCY-2")).toBeTruthy();
    expect(screen.queryByText("REQ-101")).toBeNull();
  });

  it("ranks within the visible concrete backlog group with keyboard-accessible controls", async () => {
    view.value = "backlog";
    fakeBacklogQuery.items = [...fakeBacklogQuery.items];
    rankBacklog.mockImplementation(
      async (input: { key: string; beforeId?: string; afterId?: string }) => {
        const movingIndex = fakeBacklogQuery.items.findIndex(
          (item) => item.key === input.key,
        );
        const [moving] = fakeBacklogQuery.items.splice(movingIndex, 1);
        if (!moving) throw new Error("Missing ranked item");
        const neighbourId = input.afterId ?? input.beforeId;
        const neighbourIndex = fakeBacklogQuery.items.findIndex(
          (item) => item.id === neighbourId,
        );
        fakeBacklogQuery.items.splice(
          neighbourIndex + (input.beforeId ? 1 : 0),
          0,
          moving,
        );
        return { key: "CCY-2", position: "0", version: 2 };
      },
    );
    const Component = Route as unknown as React.ComponentType;
    render(<Component />);

    const moveEarlier = screen.getByRole("button", {
      name: "Move SUB-2 earlier",
    });
    moveEarlier.focus();
    fireEvent.click(moveEarlier);
    await vi.waitFor(() => {
      expect(rankBacklog).toHaveBeenCalledWith({
        key: "CCY-2",
        afterId: "item-a",
      });
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Move SUB-2 later" }),
      );
      expect(
        screen.getByRole("button", { name: "Move SUB-2 earlier" }),
      ).toBeDisabled();
    });
  });
});
