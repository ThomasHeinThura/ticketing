import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ project: "A" }));
const fetchBacklog = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/portal-backlog", () => ({
  getPortalBacklog: fetchBacklog,
  rankPortalBacklogItem: vi.fn(),
}));
vi.mock("@tanstack/react-router", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    createFileRoute: () => (config: { component: React.ComponentType }) =>
      Object.assign(config.component, {
        useRouteContext: () => ({ portalUserId: "customer-a" }),
        useSearch: () => ({ view: "backlog", project: state.project }),
        fullPath: "/requests",
      }),
    useNavigate: () => vi.fn(),
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

afterEach(() => {
  cleanup();
  fetchBacklog.mockReset();
  state.project = "A";
});

it("starts the new project's backlog at the first page after loading more", async () => {
  fetchBacklog.mockImplementation(
    async (cursor: string | undefined, project: string) => ({
      items: [
        {
          id: `${project}-${cursor ?? "first"}`,
          key: `${project}-1`,
          title: `${project} ${cursor ?? "first"}`,
          projectId: project,
          projectKey: project,
          projectName: project,
          stateId: "state",
          stateName: "Backlog",
          statePosition: 0,
          position: "1",
          version: 1,
          sourceRef: "SUB-1",
        },
      ],
      page: {
        nextCursor: project === "A" && !cursor ? "a-next" : null,
        hasMore: project === "A" && !cursor,
      },
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Component = Route as unknown as React.ComponentType;
  const rendered = render(
    <QueryClientProvider client={client}>
      <Component />
    </QueryClientProvider>,
  );
  await screen.findByText("A first");
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  await screen.findByText("A a-next");
  state.project = "B";
  rendered.rerender(
    <QueryClientProvider client={client}>
      <Component />
    </QueryClientProvider>,
  );
  await screen.findByText("B first");
  await waitFor(() =>
    expect(fetchBacklog).toHaveBeenCalledWith(undefined, "B"),
  );
  expect(fetchBacklog).not.toHaveBeenCalledWith("a-next", "B");
  expect(screen.queryByText("A first")).toBeNull();
});
