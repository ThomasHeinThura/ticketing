import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * UAT role sweep: with `feature.knowledge_base` off, `/agent/kb` sent three KB requests that each
 * answered 404 and showed error text. The gate reads the resolved switch first; while it is off
 * the KB screens never mount, so no KB fetcher runs, and one calm notice is shown.
 */
const mocks = vi.hoisted(() => ({
  resolved: vi.fn(),
  workspace: { data: { id: "ws-1" }, isLoading: false } as {
    data: { id: string } | undefined;
    isLoading: boolean;
  },
  getKbSettings: vi.fn(),
  getKbArticles: vi.fn(),
  getKbCategories: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/fetchers/feature-flags", () => ({
  getWorkspaceResolvedFeatures: mocks.resolved,
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => mocks.workspace,
}));
vi.mock("@/fetchers/kb", () => ({
  getKbSettings: mocks.getKbSettings,
  getKbArticles: mocks.getKbArticles,
  getKbCategories: mocks.getKbCategories,
}));

import {
  useKbArticles,
  useKbCategories,
  useKbSettings,
} from "@/hooks/queries/kb";
import { KbFeatureGate } from "./kb-feature-gate";

/** Stands in for the KB list: the same three reads the real list starts on mount. */
function KbReads() {
  useKbSettings("ws-1");
  useKbCategories("ws-1");
  useKbArticles({ workspaceId: "ws-1", limit: 25, offset: 0 });
  return <p data-testid="kb-content">content</p>;
}

function renderGate(children: ReactNode = <KbReads />) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <KbFeatureGate>{children}</KbFeatureGate>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.workspace = { data: { id: "ws-1" }, isLoading: false };
  mocks.getKbSettings.mockResolvedValue({});
  mocks.getKbArticles.mockResolvedValue({ articles: [], total: 0 });
  mocks.getKbCategories.mockResolvedValue({ categories: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("KbFeatureGate", () => {
  it("shows the calm off notice and sends no KB request when the feature is off", async () => {
    mocks.resolved.mockResolvedValue([
      { key: "feature.knowledge_base", enabled: false },
      { key: "feature.reports", enabled: true },
    ]);
    renderGate();
    expect(
      await screen.findByTestId("feature-off-knowledge-base"),
    ).toBeTruthy();
    expect(screen.getByText("kb:featureOff.title")).toBeTruthy();
    expect(screen.queryByTestId("kb-content")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.getKbSettings).not.toHaveBeenCalled();
    expect(mocks.getKbArticles).not.toHaveBeenCalled();
    expect(mocks.getKbCategories).not.toHaveBeenCalled();
  });

  it("treats a missing switch as off (every P5 flag is off by default)", async () => {
    mocks.resolved.mockResolvedValue([]);
    renderGate();
    expect(
      await screen.findByTestId("feature-off-knowledge-base"),
    ).toBeTruthy();
    expect(mocks.getKbArticles).not.toHaveBeenCalled();
  });

  it("renders the KB screen once the feature resolves on", async () => {
    mocks.resolved.mockResolvedValue([
      { key: "feature.knowledge_base", enabled: true },
    ]);
    renderGate();
    expect(await screen.findByTestId("kb-content")).toBeTruthy();
    await waitFor(() => expect(mocks.getKbArticles).toHaveBeenCalled());
    expect(mocks.resolved).toHaveBeenCalledWith("ws-1");
  });

  it("shows a loading state, not the off notice, while the workspace is pending", () => {
    mocks.workspace = { data: undefined, isLoading: true };
    renderGate();
    expect(
      screen.getByRole("status", { name: "kb:list.loading" }),
    ).toBeTruthy();
    expect(screen.queryByTestId("feature-off-knowledge-base")).toBeNull();
    expect(mocks.resolved).not.toHaveBeenCalled();
  });

  it("offers Retry when the switch read fails, without claiming the feature is off", async () => {
    mocks.resolved.mockRejectedValueOnce(new Error("network"));
    mocks.resolved.mockResolvedValueOnce([
      { key: "feature.knowledge_base", enabled: true },
    ]);
    renderGate();
    expect(await screen.findByTestId("kb-feature-error")).toBeTruthy();
    expect(screen.queryByTestId("feature-off-knowledge-base")).toBeNull();
    expect(mocks.getKbArticles).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: /common:actions.retry/ }),
    );
    expect(await screen.findByTestId("kb-content")).toBeTruthy();
  });
});
