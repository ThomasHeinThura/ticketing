import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CycleList } from "@/fetchers/agile";

const mocks = vi.hoisted(() => ({ getCycles: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="/">{children}</a>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/fetchers/agile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fetchers/agile")>()),
  getCycles: (...args: unknown[]) => mocks.getCycles(...args),
}));

import { FeatureDisabledError } from "@/fetchers/agile";
import { CyclesList } from "./cycles-list";

const bucket = { count: 0, points: 0 };
function listOf(): CycleList {
  return {
    data: [
      {
        id: "c1",
        workspaceId: "w1",
        projectId: "p1",
        name: "Sprint 4",
        startDate: "2026-10-05",
        endDate: "2026-10-19",
        status: "active",
        completedAt: null,
        version: 1,
        summary: {
          unit: "points",
          total: { count: 3, points: 10 },
          completed: { count: 1, points: 4 },
          inProgress: bucket,
          notStarted: bucket,
          cancelled: bucket,
          unestimated: { count: 1, share: 0.33 },
        },
      },
    ],
    meta: {
      unit: "points",
      velocity: {
        status: "insufficient_data",
        cycles: 1,
        reason: "fewer_than_three",
      },
      incompletePolicy: "backlog",
      canManage: true,
      today: "2026-10-10",
    },
  } as unknown as CycleList;
}

function renderList() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <CyclesList projectKey="HELP" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  mocks.getCycles.mockReset();
});

describe("CyclesList", () => {
  it("shows insufficient data, never a velocity from fewer than three cycles", async () => {
    const list = listOf();
    mocks.getCycles.mockResolvedValue({
      ...list,
      meta: {
        unit: "points",
        velocity: {
          status: "insufficient_data",
          cycles: 1,
          reason: "fewer_than_three",
        },
        incompletePolicy: "backlog",
        canManage: true,
        today: "2026-10-10",
      },
    });
    renderList();
    expect(await screen.findByTestId("velocity-insufficient")).toBeTruthy();
    expect(screen.queryByTestId("velocity-value")).toBeNull();
    expect(screen.getByText("cycles.status.active")).toBeTruthy();
    expect(screen.getByText(/summary.unestimated/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /cycles.create/ })).toBeTruthy();
  });

  it("shows the velocity once three cycles have completed", async () => {
    mocks.getCycles.mockResolvedValue({
      data: [],
      meta: {
        unit: "points",
        velocity: { status: "ok", unit: "points", value: 21.5, cycles: 3 },
        incompletePolicy: "backlog",
        canManage: false,
        today: "2026-10-10",
      },
    });
    renderList();
    expect((await screen.findByTestId("velocity-value")).textContent).toContain(
      "21.5",
    );
    expect(screen.getByTestId("cycles-empty")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /cycles.create/ })).toBeNull();
  });

  it("shows the off state when the feature is disabled", async () => {
    mocks.getCycles.mockRejectedValue(new FeatureDisabledError());
    renderList();
    expect(await screen.findByTestId("feature-off-cycles")).toBeTruthy();
  });
});
