import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentGlobalSearch } from "@/lib/routes";

const mocks = vi.hoisted(() => ({
  search: {} as AgentGlobalSearch,
  navigate: vi.fn(),
  redirect: vi.fn(),
  workspace: undefined as { id: string } | undefined,
  isLoading: false,
  searchProps: undefined as
    | {
        workspaceId: string;
        search: AgentGlobalSearch;
        onSearchChange: (next: AgentGlobalSearch) => void;
      }
    | undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    useSearch: () => mocks.search,
  }),
  Navigate: (props: Record<string, unknown>) => {
    mocks.redirect(props);
    return null;
  },
  useNavigate: () => mocks.navigate,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: mocks.workspace, isLoading: mocks.isLoading }),
}));
vi.mock("@/components/search/workspace-search", () => ({
  default: (props: NonNullable<typeof mocks.searchProps>) => {
    mocks.searchProps = props;
    return <div data-testid="workspace-search" />;
  },
}));

const { Route } = await import("./search");

function renderRoute() {
  const Component = (Route as unknown as { options: { component: () => null } })
    .options.component;
  return render(<Component />);
}

beforeEach(() => {
  mocks.search = {};
  mocks.navigate.mockReset();
  mocks.redirect.mockReset();
  mocks.workspace = { id: "w1" };
  mocks.isLoading = false;
  mocks.searchProps = undefined;
});

afterEach(cleanup);

describe("/agent/search", () => {
  it("shows the workspace search on /agent/search instead of redirecting to /dashboard", () => {
    mocks.search = { q: "HELP-24", scope: "work-items" };
    renderRoute();
    expect(screen.getByTestId("workspace-search")).toBeTruthy();
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.searchProps).toMatchObject({
      workspaceId: "w1",
      search: { q: "HELP-24", scope: "work-items" },
    });
  });

  it("keeps q and scope in the /agent/search URL, replacing history", () => {
    renderRoute();
    mocks.searchProps?.onSearchChange({ q: "printer", scope: "projects" });
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/agent/search",
      search: { q: "printer", scope: "projects" },
      replace: true,
    });
  });

  it("waits for the active workspace before searching", () => {
    mocks.workspace = undefined;
    mocks.isLoading = true;
    renderRoute();
    expect(screen.queryByTestId("workspace-search")).toBeNull();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("sends a user without a workspace to /agent, never /dashboard", () => {
    mocks.workspace = undefined;
    renderRoute();
    expect(mocks.redirect).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/agent", replace: true }),
    );
  });
});
