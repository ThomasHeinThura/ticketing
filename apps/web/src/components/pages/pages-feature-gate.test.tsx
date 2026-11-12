import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * UAT role sweep: lead and viewer opened project Pages and `GET /api/projects/{key}/pages`
 * answered 404. The gate first finds the project in the reach-filtered project list and reads
 * `feature.pages`; an unreachable project or a switched-off feature shows its notice and the
 * Pages screen never mounts, so no page request is sent.
 */
const mocks = vi.hoisted(() => ({
  project: {
    project: { id: "p-1", slug: "ACME" } as
      | { id: string; slug: string }
      | undefined,
    workspaceId: "ws-1",
    isLoading: false,
  },
  resolved: vi.fn(),
  getPages: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/queries/agile/use-project-by-key", () => ({
  default: () => mocks.project,
}));
vi.mock("@/fetchers/agile", () => ({
  getResolvedFeatures: mocks.resolved,
}));
// The feature-off state's "Open feature settings" action is covered by feature-off.test.tsx.
vi.mock("@/components/agile/use-can-manage-project-features", () => ({
  useCanManageProjectFeatures: () => false,
}));

import { useQuery } from "@tanstack/react-query";
import { PagesFeatureGate } from "./pages-feature-gate";

/** Stands in for the Pages list: the page read the real list starts on mount. */
function PagesRead() {
  useQuery({ queryKey: ["pages-probe"], queryFn: () => mocks.getPages() });
  return <p data-testid="pages-content">content</p>;
}

function renderGate() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PagesFeatureGate projectKey="ACME">
        <PagesRead />
      </PagesFeatureGate>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.project = {
    project: { id: "p-1", slug: "ACME" },
    workspaceId: "ws-1",
    isLoading: false,
  };
  mocks.getPages.mockResolvedValue({ pages: [], canEdit: false });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PagesFeatureGate", () => {
  it("shows the feature-off state and sends no page request when Pages are off", async () => {
    mocks.resolved.mockResolvedValue([
      { key: "feature.pages", enabled: false },
    ]);
    renderGate();
    expect(await screen.findByTestId("feature-off-pages")).toBeTruthy();
    expect(screen.queryByTestId("pages-content")).toBeNull();
    expect(mocks.resolved).toHaveBeenCalledWith("p-1");
    expect(mocks.getPages).not.toHaveBeenCalled();
  });

  it("shows not found and sends no request for a project the caller does not reach", () => {
    mocks.project = {
      project: undefined,
      workspaceId: "ws-1",
      isLoading: false,
    };
    renderGate();
    expect(screen.getByTestId("pages-project-not-found")).toBeTruthy();
    expect(screen.getByText("list.notFound")).toBeTruthy();
    expect(mocks.resolved).not.toHaveBeenCalled();
    expect(mocks.getPages).not.toHaveBeenCalled();
  });

  it("waits for the project and the switch before deciding", () => {
    mocks.project = { project: undefined, workspaceId: "", isLoading: true };
    renderGate();
    expect(screen.getByRole("status", { name: "common.loading" })).toBeTruthy();
    expect(screen.queryByTestId("pages-project-not-found")).toBeNull();
    expect(screen.queryByTestId("feature-off-pages")).toBeNull();
  });

  it("renders the Pages screen when the feature is on", async () => {
    mocks.resolved.mockResolvedValue([{ key: "feature.pages", enabled: true }]);
    renderGate();
    expect(await screen.findByTestId("pages-content")).toBeTruthy();
    await waitFor(() => expect(mocks.getPages).toHaveBeenCalled());
  });
});
