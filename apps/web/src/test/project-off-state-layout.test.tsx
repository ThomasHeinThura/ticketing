import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a href="/">{children}</a>,
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useParams: () => ({
      projectKey: "HELP",
      projectId: "p1",
      workspaceId: "w1",
    }),
    useSearch: () => ({}),
  }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: "/" }),
}));
vi.mock("react-i18next", async () => ({
  ...(await vi.importActual<typeof import("react-i18next")>("react-i18next")),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@/components/common/header/workspace-crumb-select", () => ({
  default: () => null,
}));
vi.mock("@/components/common/sidebar-toggle", () => ({ default: () => null }));
vi.mock("@/components/common/canonical-project-realtime", () => ({
  default: () => null,
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: { session: { activeOrganizationId: "w-other" } },
      isPending: false,
    }),
  },
}));
vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: () => ({
    isLoading: false,
    isSuccess: true,
    isError: false,
    data: { id: "p1", workspaceId: "w1", name: "Help", slug: "HELP" },
  }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({
    isLoading: false,
    data: [{ id: "p1", workspaceId: "w1", slug: "HELP" }],
  }),
}));
// Keep the real shell in its initial frame without scheduling deferred controls or sidebar.
vi.mock("@/lib/after-primary-content", () => ({
  afterPrimaryContent: () => new Promise(() => {}),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/agile/use-can-manage-project-features", () => ({
  useCanManageProjectFeatures: () => false,
  useCanManageProjectFeaturesById: () => false,
}));
vi.mock("@/hooks/queries/agile/use-project-by-key", () => ({
  default: () => ({
    project: { id: "p1", workspaceId: "w1", slug: "HELP" },
    workspaceId: "w1",
    isLoading: false,
  }),
}));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => vi.fn(),
}));
vi.mock("@/fetchers/agile", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/fetchers/agile")>();
  const off = () => Promise.reject(new original.FeatureDisabledError());
  return {
    ...original,
    getCycle: off,
    getCycles: off,
    getModules: off,
    getModule: off,
    getResolvedFeatures: () => Promise.resolve([]),
  };
});
vi.mock("@/fetchers/pages", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/fetchers/pages")>();
  return {
    ...original,
    getPages: () => Promise.reject(new original.PagesDisabledError()),
    getPage: () => Promise.reject(new original.PagesDisabledError()),
  };
});

import { CycleDetailScreen } from "@/components/agile/cycle-detail";
import { CyclesList } from "@/components/agile/cycles-list";
import { ModuleDetailScreen } from "@/components/agile/module-detail";
import { ModulesList } from "@/components/agile/modules-list";
import ProjectLayout from "@/components/common/project-layout";
import { PageDetail } from "@/components/pages/page-detail";
import { PagesFeatureGate } from "@/components/pages/pages-feature-gate";
import { PagesList } from "@/components/pages/pages-list";
import { Route as CanonicalCalendarRoute } from "@/routes/agent/_layout/_authenticated/agent/projects/$projectKey/calendar";
import { Route as TimelineRoute } from "@/routes/agent/_layout/_authenticated/agent/projects/$projectKey/timeline";
import { Route as LegacyCalendarRoute } from "@/routes/agent/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/calendar";
import { Route as GanttRoute } from "@/routes/agent/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/gantt";

const Timeline = (TimelineRoute as unknown as { component: ComponentType })
  .component;
const CanonicalCalendar = (
  CanonicalCalendarRoute as unknown as { component: ComponentType }
).component;
const LegacyCalendar = (
  LegacyCalendarRoute as unknown as { component: ComponentType }
).component;
const Gantt = (GanttRoute as unknown as { component: ComponentType }).component;

beforeAll(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
});

afterAll(() => vi.unstubAllGlobals());
afterEach(cleanup);

function renderPage(children: ReactNode, inheritedFrame = true) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {inheritedFrame ? (
        <ProjectLayout projectId="p1" workspaceId="w1" realtimeMode="page">
          {children}
        </ProjectLayout>
      ) : (
        children
      )}
    </QueryClientProvider>,
  );
}

describe("project feature-off heading inside the real project layout", () => {
  it.each([
    [
      "cycle detail",
      <CycleDetailScreen
        key="CycleDetailScreen"
        projectKey="HELP"
        cycleId="c1"
        search={{}}
      />,
      "cycles",
      true,
    ],
    [
      "cycle list",
      <CyclesList key="CyclesList" projectKey="HELP" />,
      "cycles",
      true,
    ],
    [
      "module detail",
      <ModuleDetailScreen
        key="ModuleDetailScreen"
        projectKey="HELP"
        moduleId="m1"
        search={{}}
      />,
      "modules",
      true,
    ],
    [
      "module list",
      <ModulesList key="ModulesList" projectKey="HELP" />,
      "modules",
      true,
    ],
    [
      "pages list",
      <PagesList key="PagesList" projectKey="HELP" />,
      "pages",
      true,
    ],
    [
      "page detail",
      <PageDetail key="PageDetail" projectKey="HELP" pageId="pg1" />,
      "pages",
      true,
    ],
    [
      "pages gate",
      <PagesFeatureGate key="PagesFeatureGate" projectKey="HELP">
        <p>content</p>
      </PagesFeatureGate>,
      "pages",
      true,
    ],
    ["timeline", <Timeline key="Timeline" />, "timeline", true],
    [
      "calendar",
      <CanonicalCalendar key="CanonicalCalendar" />,
      "calendar",
      false,
    ],
    [
      "legacy calendar gate",
      <LegacyCalendar key="LegacyCalendar" />,
      "calendar",
      false,
    ],
    ["gantt gate", <Gantt key="Gantt" />, "timeline", false],
  ])("%s", async (_name, page, feature, inheritedFrame) => {
    renderPage(page, inheritedFrame);
    const off = await screen.findByTestId(`feature-off-${feature}`);
    const headings = screen.getAllByRole("heading", { level: 1, hidden: true });
    expect(headings).toHaveLength(1);
    expect(within(off).getByRole("heading", { level: 1 })).toBe(headings[0]);
    expect(document.querySelector("header")).toBeInTheDocument();
  });
});
