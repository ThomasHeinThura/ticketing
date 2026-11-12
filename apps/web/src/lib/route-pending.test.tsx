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
  expect(placeholder.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(
    2,
  );
  expect(placeholder.querySelector('[data-slot="skeleton"]')).toHaveClass(
    "motion-reduce:animate-none",
  );
  await act(async () => {
    finish();
  });
  await screen.findByText("Loaded");
});
