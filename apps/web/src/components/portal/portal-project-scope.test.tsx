import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  type AnyRoute,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
  useNavigate,
} from "@tanstack/react-router";
import { Button } from "@taskdesk/ui";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import PortalProjectSelector from "./portal-project-selector";

const getPortalProjects = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/portal/projects", () => ({ getPortalProjects }));
vi.mock("@/lib/i18n/portal-translation", () => ({
  usePortalTranslation: () => ({ t: (key: string) => key, i18n: {} }),
}));

type RouteOptions = {
  validateSearch?: (raw: unknown) => Record<string, unknown>;
  search?: { middlewares?: unknown[] };
};

/** The real portal routes by full path, from the generated portal route tree. */
const portalRoutes = new Map<string, RouteOptions>();

beforeAll(async () => {
  const { routeTree } = await import("@/routeTree.portal.gen");
  // Building the router resolves each file route's full path; nothing is loaded or rendered.
  const router = createRouter({
    routeTree,
    history: createMemoryHistory(),
  });
  for (const [path, route] of Object.entries(
    router.routesByPath as unknown as Record<string, AnyRoute>,
  ))
    portalRoutes.set(path, route.options as RouteOptions);
}, 60_000);

// Signed-in portal screens: each renders the shell, so each must keep `?project=`.
const SHELL_PATHS = [
  "/",
  "/requests",
  "/approvals",
  "/catalogue",
  "/kb",
  "/kb/$id",
  "/notifications",
  "/releases",
  "/releases/$id",
  "/account",
  "/submissions/$ref",
];

describe("portal project scope registration", () => {
  it("registers ?project= on every signed-in portal route", () => {
    for (const path of SHELL_PATHS) {
      const options = portalRoutes.get(path);
      expect(options, path).toBeDefined();
      expect(
        options?.validateSearch?.({ project: "ACME", other: "x" }),
        path,
      ).toMatchObject({ project: "ACME" });
      expect(
        options?.validateSearch?.({ project: "../x" }),
        path,
      ).not.toHaveProperty("project");
      expect(options?.search?.middlewares?.length, path).toBeGreaterThan(0);
    }
  });

  it("drops the scope on the sign-in and invitation frames", () => {
    for (const path of ["/sign-in", "/invite/$id"])
      expect(portalRoutes.get(path)?.search?.middlewares, path).toBeUndefined();
  });
});

function Frame() {
  const navigate = useNavigate();
  return (
    <>
      <PortalProjectSelector />
      <Link to="/approvals">Approvals link</Link>
      <Link to="/">Dashboard link</Link>
      <Button
        onClick={() =>
          void navigate({ to: "/requests", search: { cursor: "older_1" } })
        }
      >
        Older page
      </Button>
      <Button onClick={() => void navigate({ to: "/sign-in" })}>
        Sign out
      </Button>
      <Outlet />
    </>
  );
}

/** A router built from the real portal routes' search options, with a light frame. */
function renderPortal(initial: string) {
  const root = createRootRoute({ component: Frame });
  const child = (path: string) => {
    const options = portalRoutes.get(path) ?? {};
    return createRoute({
      getParentRoute: () => root,
      path,
      ...(options.validateSearch
        ? { validateSearch: options.validateSearch }
        : {}),
      ...(options.search ? { search: options.search } : {}),
      component: () => <p>{path}</p>,
    } as never);
  };
  const router = createRouter({
    routeTree: root.addChildren(
      ["/", "/requests", "/approvals", "/sign-in"].map(child),
    ),
    history: createMemoryHistory({ initialEntries: [initial] }),
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  return router;
}

async function choose(name: string) {
  // The previous choice's menu finishes closing before the trigger is pressed again.
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  fireEvent.click(
    await screen.findByRole("button", { name: "shell.projectSelector.label" }),
  );
  fireEvent.click(await screen.findByRole("menuitemradio", { name }));
}

describe("portal project selector", () => {
  it("keeps the chosen project on /requests and across portal navigation", async () => {
    getPortalProjects.mockResolvedValue({
      data: [
        { key: "ALPHA", name: "Alpha" },
        { key: "BETA", name: "Beta" },
      ],
    });
    const router = renderPortal("/requests?view=backlog");
    await screen.findByText("/requests");

    await choose("Beta");
    await waitFor(() =>
      expect(router.state.location.search).toEqual({
        view: "backlog",
        project: "BETA",
      }),
    );
    expect(router.state.location.pathname).toBe("/requests");
    expect(
      await screen.findByRole("button", {
        name: "shell.projectSelector.label",
      }),
    ).toHaveTextContent("Beta");

    // Sidebar-style links and in-page navigations that do not name `project` keep it.
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "Approvals link" }),
      ).toHaveAttribute("href", "/approvals?project=BETA"),
    );
    expect(
      screen.getByRole("link", { name: "Dashboard link" }),
    ).toHaveAttribute("href", "/?project=BETA");
    fireEvent.click(screen.getByText("Older page"));
    await waitFor(() =>
      expect(router.state.location.search).toEqual({
        cursor: "older_1",
        project: "BETA",
      }),
    );
    fireEvent.click(screen.getByRole("link", { name: "Approvals link" }));
    await screen.findByText("/approvals");
    expect(router.state.location.search).toEqual({ project: "BETA" });

    // "All projects" clears the scope.
    await choose("shell.projectSelector.all");
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(router.state.location.pathname).toBe("/approvals");
  });

  it("drops the scope when leaving for the sign-in frame", async () => {
    getPortalProjects.mockResolvedValue({
      data: [
        { key: "ALPHA", name: "Alpha" },
        { key: "BETA", name: "Beta" },
      ],
    });
    const router = renderPortal("/requests?project=ALPHA");
    await screen.findByText("/requests");
    expect(router.state.location.search).toEqual({ project: "ALPHA" });
    fireEvent.click(screen.getByText("Sign out"));
    await screen.findByText("/sign-in");
    expect(router.state.location.search).not.toHaveProperty("project");
  });
});
