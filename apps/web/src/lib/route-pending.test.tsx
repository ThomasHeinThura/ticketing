import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { routePendingOptions } from "./route-pending";

it("uses the shared page placeholder for a pending route", async () => {
  let finish!: () => void;
  const wait = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const root = createRootRoute({ component: () => <Outlet /> });
  const home = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => <div>Home</div>,
  });
  const slow = createRoute({
    getParentRoute: () => root,
    path: "/slow",
    loader: () => wait,
    component: () => <div>Loaded</div>,
  });
  const router = createRouter({
    routeTree: root.addChildren([home, slow]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
    ...routePendingOptions,
  });
  render(<RouterProvider router={router} />);
  await screen.findByText("Home");
  void router.navigate({ to: "/slow" });
  const placeholder = await screen.findByTestId("page-loading");
  expect(placeholder).toHaveAttribute("role", "status");
  expect(placeholder).toHaveAttribute("aria-busy", "true");
  expect(placeholder).toHaveAttribute("aria-live", "polite");
  expect(placeholder).toHaveAccessibleName();
  expect(placeholder.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(
    2,
  );
  expect(placeholder.querySelector('[data-slot="skeleton"]')).toHaveClass(
    "motion-reduce:animate-none",
  );
  expect(placeholder.querySelector('[data-slot="skeleton"]')).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await act(async () => {
    finish();
  });
  await screen.findByText("Loaded");
});

it("keeps one live announcer across a placeholder handoff", async () => {
  const { PageLoadingAnnouncer } = await import(
    "@/components/page-loading-announcer"
  );
  const { PageLoading } = await import("@/components/page-loading");
  const view = render(
    <PageLoadingAnnouncer>
      <PageLoading key="pending" />
    </PageLoadingAnnouncer>,
  );
  const announcer = screen.getByTestId("loading-announcer");
  expect(announcer).toHaveAttribute("aria-live", "polite");
  const firstText = announcer.textContent;
  expect(firstText).toBeTruthy();
  view.rerender(
    <PageLoadingAnnouncer>
      <PageLoading key="data" />
    </PageLoadingAnnouncer>,
  );
  expect(screen.getByTestId("loading-announcer")).toBe(announcer);
  expect(announcer.textContent).toBe(firstText);
  expect(screen.getAllByRole("status")).toHaveLength(1);
});
