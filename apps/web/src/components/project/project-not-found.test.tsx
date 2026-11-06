import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { afterPrimaryContent } from "@/lib/after-primary-content";
import { translate } from "@/test/en-translation";
import ProjectNotFound from "./project-not-found";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => translate(key) }),
}));
vi.mock("@/lib/i18n/after-first-paint", () => ({
  afterFirstPaint: () => Promise.resolve(),
}));

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

async function renderDenial() {
  const rootRoute = createRootRoute({ component: () => <ProjectNotFound /> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
  return screen.findByTestId("project-not-found");
}

describe("ProjectNotFound", () => {
  it("marks the denial as the screen's primary content", async () => {
    const denial = await renderDenial();
    expect(denial).toHaveAttribute("data-primary-content-ready", "true");
  });

  it("releases deferred UI on an unknown Project's work list without the fallback timer", async () => {
    window.history.replaceState(null, "", "/agent/projects/NOPE/work");
    await renderDenial();
    const onReady = vi.fn();
    let resolved = false;
    // A long timeout proves readiness comes from the marker, not the fallback timer.
    void afterPrimaryContent({
      timeoutMs: 60_000,
      onPrimaryContentReady: onReady,
    }).then(() => {
      resolved = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resolved).toBe(true);
    expect(onReady).toHaveBeenCalledTimes(1);
  });
});
