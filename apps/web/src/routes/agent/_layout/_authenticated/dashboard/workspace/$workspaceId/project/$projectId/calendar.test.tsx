import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./calendar";

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  searchStr: "",
  project: {
    isSuccess: true,
    isError: false,
    data: { id: "project-1", workspaceId: "workspace-1", slug: "RM" },
  } as {
    isSuccess: boolean;
    isError: boolean;
    data?: { id: string; workspaceId: string; slug: string };
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({
    ...(options as Record<string, unknown>),
    useParams: () => ({ workspaceId: "workspace-1", projectId: "project-1" }),
  }),
  useNavigate: () => state.navigate,
  useLocation: () => ({ searchStr: state.searchStr }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: () => state.project,
}));
vi.mock("@/components/common/layout", () => ({
  default: {
    Content: ({ children }: { children: React.ReactNode }) => children,
  },
}));

const OldCalendarRoute = (Route as unknown as { component: ComponentType })
  .component;

beforeEach(() => {
  state.navigate.mockReset();
  state.searchStr = "";
  state.project = {
    isSuccess: true,
    isError: false,
    data: { id: "project-1", workspaceId: "workspace-1", slug: "RM" },
  };
});
afterEach(cleanup);

describe("old Kaneo calendar URL", () => {
  it("redirects to the canonical /agent calendar by project key and replaces history", () => {
    render(<OldCalendarRoute />);
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith({
      href: "/agent/projects/RM/calendar",
      replace: true,
    });
  });

  it("carries the whole query over", () => {
    state.searchStr = "?month=2026-10&q=urgent&taskId=RM-1";
    render(<OldCalendarRoute />);
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith({
      href: "/agent/projects/RM/calendar?month=2026-10&q=urgent&taskId=RM-1",
      replace: true,
    });
  });

  it("opens nothing while the project is still loading", () => {
    state.project = { isSuccess: false, isError: false };
    render(<OldCalendarRoute />);
    expect(state.navigate).not.toHaveBeenCalled();
    expect(
      screen.getByText("workItems:legacyView.opening"),
    ).toBeInTheDocument();
  });

  it("never redirects for a project that belongs to another workspace", () => {
    state.project = {
      isSuccess: true,
      isError: false,
      data: { id: "project-1", workspaceId: "workspace-2", slug: "RM" },
    };
    render(<OldCalendarRoute />);
    expect(state.navigate).not.toHaveBeenCalled();
    expect(
      screen.getByText("workItems:legacyView.unavailable"),
    ).toBeInTheDocument();
  });

  it("shows the unavailable message when the project cannot be read", () => {
    state.project = { isSuccess: false, isError: true };
    render(<OldCalendarRoute />);
    expect(state.navigate).not.toHaveBeenCalled();
    expect(
      screen.getByText("workItems:legacyView.unavailable"),
    ).toBeInTheDocument();
  });
});
