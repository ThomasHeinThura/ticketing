import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { headingLevels } from "@/test/headings";

/**
 * UX-1a heading outline: every page has exactly one `h1`. These screens each show the project
 * feature-off state in place of their content; the project shell has no `h1` of its own, so the
 * off state is the page's `h1` (`[1]`) — except where the route already supplies a hidden title,
 * where the off state sits under it (`[1, 2]`). Project layout composition is covered separately
 * in project-off-state-layout.test.tsx; data and permission reads are stubbed here.
 */
const mocks = vi.hoisted(() => ({
  canManageSettings: false,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => vi.fn(),
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useParams: () => ({ projectId: "p1" }),
  }),
}));
vi.mock("react-i18next", async () => ({
  ...(await vi.importActual<typeof import("react-i18next")>("react-i18next")),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("./use-can-manage-project-features", () => ({
  useCanManageProjectFeatures: () => false,
}));
vi.mock("@/hooks/queries/agile/use-project-by-key", () => ({
  default: () => ({ project: undefined, workspaceId: "w1", isLoading: false }),
}));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => vi.fn(),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    workspace: { id: "w1" },
    canManageProjectSettings: () => mocks.canManageSettings,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({
    data: [{ id: "p1", slug: "HELP", workspaceId: "w1" }],
    isLoading: false,
  }),
}));
vi.mock("@/fetchers/agile", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/fetchers/agile")>();
  const off = () => Promise.reject(new original.FeatureDisabledError());
  return {
    ...original,
    getModules: off,
    getCycle: off,
    getModule: off,
    getEstimates: off,
  };
});

import { Route as EstimatesRoute } from "@/routes/agent/_layout/_authenticated/dashboard/settings/projects/$projectId/estimates";
import { CycleDetailScreen } from "./cycle-detail";
import { EstimateSettings } from "./estimate-settings";
import { ModuleDetailScreen } from "./module-detail";
import { ModulesList } from "./modules-list";

afterEach(() => {
  cleanup();
  mocks.canManageSettings = false;
});

function renderWithClient(ui: ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {ui}
    </QueryClientProvider>,
  );
}

describe("project feature-off screens: heading outline (UX-1a)", () => {
  it("modules list: the off state is the page's one h1", async () => {
    renderWithClient(<ModulesList projectKey="HELP" />);
    expect(await screen.findByTestId("feature-off-modules")).toBeTruthy();
    expect(headingLevels()).toEqual([1]);
  });

  it("cycle detail: the off state is the page's one h1", async () => {
    renderWithClient(
      <CycleDetailScreen projectKey="HELP" cycleId="c1" search={{}} />,
    );
    expect(await screen.findByTestId("feature-off-cycles")).toBeTruthy();
    expect(headingLevels()).toEqual([1]);
  });

  it("module detail: the off state is the page's one h1", async () => {
    renderWithClient(
      <ModuleDetailScreen projectKey="HELP" moduleId="m1" search={{}} />,
    );
    expect(await screen.findByTestId("feature-off-modules")).toBeTruthy();
    expect(headingLevels()).toEqual([1]);
  });

  it("estimates settings page: the route's hidden title is the h1, the off state sits under it", async () => {
    const Component = (
      EstimatesRoute as unknown as { component: () => ReactNode }
    ).component;
    renderWithClient(<Component />);
    expect(await screen.findByTestId("feature-off-estimates")).toBeTruthy();
    const [title] = screen.getAllByRole("heading", { level: 1 });
    expect(title).toHaveClass("sr-only");
    expect(headingLevels()).toEqual([1, 2]);
  });

  it("estimate settings alone renders its off state as an h2, to sit under a page title", async () => {
    renderWithClient(<EstimateSettings projectKey="HELP" canManage={false} />);
    expect(await screen.findByTestId("feature-off-estimates")).toBeTruthy();
    expect(headingLevels()).toEqual([2]);
  });
});
