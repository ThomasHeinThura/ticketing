import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";

const state = vi.hoisted(() => ({
  pathname: "/dashboard/settings/projects/p1/general",
  projects: [] as Array<{ id: string; name: string }> | undefined,
  archived: [] as Array<{ id: string; name: string }> | undefined,
  listCalls: [] as Array<{ includeArchived?: boolean; enabled: boolean }>,
  permissionTargets: [] as Array<[string | undefined, string | undefined]>,
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useLocation: () => ({ pathname: state.pathname }),
    useNavigate: () => vi.fn(),
    Outlet: () => <div data-testid="settings-outlet" />,
    Link: ({ children, to }: { children?: ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  };
});
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, options),
  }),
}));
vi.mock("@/components/SettingsSidebar", () => ({
  default: ({ children }: { children: ReactNode }) => (
    <nav data-testid="settings-sidebar">{children}</nav>
  ),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: (workspaceId?: string, projectId?: string) => {
    state.permissionTargets.push([workspaceId, projectId]);
    return {
      workspace: { id: "ws_1", name: "Acme" },
      role: "viewer",
      canManageProjectSettings: () => false,
      canReadBudgets: () => false,
    };
  },
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: (
    { includeArchived }: { includeArchived?: boolean },
    enabled = true,
  ) => {
    state.listCalls.push({ includeArchived, enabled });
    const data = includeArchived ? state.archived : state.projects;
    const loaded = enabled && data !== undefined;
    return { data: enabled ? data : undefined, isSuccess: loaded };
  },
}));

import { Route } from "./projects";

function renderLayout() {
  const Component = Route.options.component as () => React.JSX.Element;
  return render(<Component />);
}

const NOT_FOUND = "This Project does not exist or is out of reach.";

beforeEach(() => {
  state.pathname = "/dashboard/settings/projects/p1/general";
  state.projects = [{ id: "p1", name: "Help desk" }];
  state.archived = [
    { id: "p1", name: "Help desk" },
    { id: "p-old", name: "Old" },
  ];
  state.listCalls = [];
  state.permissionTargets = [];
});

afterEach(cleanup);

describe("project settings layout", () => {
  it("renders the selected project's settings and does not read the archived list", () => {
    renderLayout();
    expect(screen.getByTestId("settings-outlet")).toBeInTheDocument();
    expect(screen.queryByTestId("project-not-found")).toBeNull();
    expect(
      state.listCalls.some((call) => call.includeArchived && call.enabled),
    ).toBe(false);
    expect(state.permissionTargets).toContainEqual(["ws_1", "p1"]);
  });

  it("denies a project id that is neither listed nor archived, without the settings form or nav", () => {
    state.pathname = "/dashboard/settings/projects/missing/general";
    renderLayout();
    const denial = screen.getByTestId("project-not-found");
    expect(denial).toHaveTextContent(NOT_FOUND);
    expect(
      within(denial).getByRole("link", { name: "Back to Projects" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("settings-outlet")).toBeNull();
    const sidebar = screen.getByTestId("settings-sidebar");
    expect(within(sidebar).queryByRole("link")).toBeNull();
    // The missing id is never sent to the capabilities read.
    expect(
      state.permissionTargets.some(([, projectId]) => projectId === "missing"),
    ).toBe(false);
  });

  it("keeps the settings of an archived project reachable", () => {
    state.pathname = "/dashboard/settings/projects/p-old/general";
    renderLayout();
    expect(screen.getByTestId("settings-outlet")).toBeInTheDocument();
    expect(screen.queryByTestId("project-not-found")).toBeNull();
  });

  it("does not deny while the project list is still loading", () => {
    state.pathname = "/dashboard/settings/projects/missing/general";
    state.projects = undefined;
    renderLayout();
    expect(screen.getByTestId("settings-outlet")).toBeInTheDocument();
    expect(screen.queryByTestId("project-not-found")).toBeNull();
  });
});
