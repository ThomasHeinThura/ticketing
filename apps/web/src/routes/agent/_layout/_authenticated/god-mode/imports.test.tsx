import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { Button } from "@taskdesk/ui";
import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { Route as ImportsRoute } from "./imports";
import { Route as ImportRunRoute } from "./imports/$id";

vi.mock("@/hooks/use-instance-admin-signal", () => ({
  useInstanceAdminSignal: () => true,
}));

vi.mock("@/components/god-mode/imports/import-runs-panel", () => ({
  ImportRunsPanel: ({
    workspaceId,
    onOpenRun,
  }: {
    workspaceId?: string;
    onOpenRun: (id: string, workspaceId: string) => void;
  }) => (
    <section aria-label="Import run history">
      <output aria-label="Selected workspace">{workspaceId}</output>
      <Button onClick={() => onOpenRun("run-42", workspaceId ?? "")}>
        Open run run-42
      </Button>
      <Button onClick={() => onOpenRun("run-created", "workspace-created")}>
        Open newly created run
      </Button>
    </section>
  ),
}));

vi.mock("@/components/god-mode/imports/import-run-detail-panel", () => ({
  ImportRunDetailPanel: ({
    runId,
    onWorkspaceResolved,
  }: {
    runId: string;
    onWorkspaceResolved?: (workspaceId: string) => void;
  }) => {
    const workspaceId =
      runId === "run-42"
        ? "workspace-selected"
        : runId === "run-created"
          ? "workspace-created"
          : "workspace-deep-link";
    useEffect(
      () => onWorkspaceResolved?.(workspaceId),
      [onWorkspaceResolved, workspaceId],
    );
    return (
      <section aria-label="Import run detail">Details for {runId}</section>
    );
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        title: "Import history",
        description: "Review import runs",
        detailTitle: "Import run details",
        detailDescription: "Review this import run",
        backToHistory: "Back to import history",
      })[key] ?? key,
    i18n: { language: "en-US", resolvedLanguage: "en-US" },
  }),
  I18nextProvider: ({ children }: React.PropsWithChildren) => children,
  I18nContext: {
    Provider: ({ children }: React.PropsWithChildren) => children,
  },
}));

function createImportsTestTree() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const historyRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: ImportsRoute.id,
    path: "/god-mode/imports",
    validateSearch: ImportsRoute.options.validateSearch,
    component: ImportsRoute.options.component,
  });
  const detailRoute = createRoute({
    getParentRoute: () => historyRoute,
    id: ImportRunRoute.id,
    path: "/$id",
    validateSearch: ImportRunRoute.options.validateSearch,
    component: ImportRunRoute.options.component,
  });
  return rootRoute.addChildren([historyRoute.addChildren([detailRoute])]);
}

function createTestRouter(initialPath: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(["workspaces"], []);
  return {
    queryClient,
    router: createRouter({
      routeTree: createImportsTestTree(),
      history: createMemoryHistory({ initialEntries: [initialPath] }),
      context: { user: null, queryClient },
    }),
  };
}

function renderRouter(initialPath: string) {
  const { queryClient, router } = createTestRouter(initialPath);
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe("God Mode import history nested route", () => {
  it("preserves history workspace through detail and created-run navigation", async () => {
    const router = renderRouter(
      "/god-mode/imports?workspaceId=workspace-selected",
    );

    expect(await screen.findByLabelText("Import run history")).toBeTruthy();
    expect(screen.getByLabelText("Selected workspace").textContent).toBe(
      "workspace-selected",
    );
    fireEvent.click(screen.getByRole("button", { name: "Open run run-42" }));
    expect(await screen.findByLabelText("Import run detail")).toHaveTextContent(
      "Details for run-42",
    );
    expect(screen.queryByLabelText("Import run history")).toBeNull();
    expect(router.state.location.search).toMatchObject({
      workspaceId: "workspace-selected",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Back to import history" }),
    );
    expect(await screen.findByLabelText("Import run history")).toBeTruthy();
    expect(screen.queryByLabelText("Import run detail")).toBeNull();
    expect(router.state.location.search).toMatchObject({
      workspaceId: "workspace-selected",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Open newly created run" }),
    );
    expect(await screen.findByLabelText("Import run detail")).toHaveTextContent(
      "Details for run-created",
    );
    expect(router.state.location.search).toMatchObject({
      workspaceId: "workspace-created",
    });
  });

  it("restores resolved workspace when returning from a direct detail URL", async () => {
    const router = renderRouter("/god-mode/imports/run-deep");

    expect(await screen.findByLabelText("Import run detail")).toHaveTextContent(
      "Details for run-deep",
    );
    expect(screen.queryByLabelText("Import run history")).toBeNull();
    expect(router.state.location.search).toMatchObject({
      workspaceId: "workspace-deep-link",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Back to import history" }),
    );
    expect(await screen.findByLabelText("Import run history")).toBeTruthy();
    expect(router.state.location.search).toMatchObject({
      workspaceId: "workspace-deep-link",
    });
  });
});
