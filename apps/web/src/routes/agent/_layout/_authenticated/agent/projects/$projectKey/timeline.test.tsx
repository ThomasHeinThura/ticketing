import { render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectTimelineSearch } from "@/components/project/project-timeline";
import { Route } from "./timeline";

const state = vi.hoisted(() => ({
  project: undefined as
    | { id: string; workspaceId: string; slug: string }
    | undefined,
  isLoading: false,
  timelineOn: true as boolean | undefined,
  search: {} as Record<string, unknown>,
  navigate: vi.fn(),
  featureProjectIds: [] as Array<string | undefined>,
  timelineProps: undefined as
    | {
        workspaceId: string;
        projectId: string;
        search: ProjectTimelineSearch;
        onSearchChange: (
          update: (previous: ProjectTimelineSearch) => ProjectTimelineSearch,
        ) => void;
      }
    | undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    ...options,
    useParams: () => ({ projectKey: "ENG" }),
    useSearch: () => state.search,
  }),
  useNavigate: () => state.navigate,
}));
vi.mock("@/hooks/queries/agile/use-project-by-key", () => ({
  default: () => ({ project: state.project, isLoading: state.isLoading }),
}));
vi.mock("@/hooks/queries/feature-flag/use-project-pages-feature", () => ({
  useProjectFeatureState: (projectId: string | undefined, feature: string) => {
    state.featureProjectIds.push(projectId);
    return feature === "feature.timeline" ? state.timelineOn : false;
  },
}));
vi.mock("@/components/agile/feature-off", () => ({
  FeatureOff: ({ feature }: { feature: string }) => (
    <div data-testid={`feature-off-${feature}`} />
  ),
}));
vi.mock("@/components/project/project-not-found", () => ({
  default: () => <div data-testid="project-not-found" />,
}));
vi.mock("@/components/project/project-timeline", () => ({
  default: (props: NonNullable<typeof state.timelineProps>) => {
    state.timelineProps = props;
    return <div data-testid="project-timeline" />;
  },
}));

const TimelineRoute = (Route as unknown as { component: ComponentType })
  .component;

beforeEach(() => {
  state.project = { id: "project-1", workspaceId: "workspace-1", slug: "ENG" };
  state.isLoading = false;
  state.timelineOn = true;
  state.search = {};
  state.navigate.mockReset();
  state.featureProjectIds = [];
  state.timelineProps = undefined;
});

describe("/agent/projects/{key}/timeline", () => {
  it("renders the Timeline in place for the project resolved by key", () => {
    state.search = { group: "assignee", deps: "1" };
    render(<TimelineRoute />);
    expect(screen.getByTestId("project-timeline")).toBeInTheDocument();
    expect(state.featureProjectIds).toContain("project-1");
    expect(state.timelineProps).toMatchObject({
      workspaceId: "workspace-1",
      projectId: "project-1",
      search: { group: "assignee", deps: "1" },
    });
  });

  it("writes the view state to the canonical URL, replacing the entry", () => {
    render(<TimelineRoute />);
    const update = (
      previous: ProjectTimelineSearch,
    ): ProjectTimelineSearch => ({
      ...previous,
      deps: "1",
    });
    state.timelineProps?.onSearchChange(update);
    expect(state.navigate).toHaveBeenCalledWith({
      to: "/agent/projects/$projectKey/timeline",
      params: { projectKey: "ENG" },
      search: update,
      replace: true,
    });
  });

  it("keeps the view state in the URL search", () => {
    const validate = (
      Route as unknown as {
        options: { validateSearch: (raw: unknown) => ProjectTimelineSearch };
      }
    ).options.validateSearch;
    expect(
      validate({ group: "assignee", deps: "1", taskId: "ENG-7", q: "api" }),
    ).toMatchObject({
      group: "assignee",
      deps: "1",
      taskId: "ENG-7",
      q: "api",
    });
  });

  it("shows the feature-off state while feature.timeline is off (P4R1-M2)", () => {
    state.timelineOn = false;
    render(<TimelineRoute />);
    expect(screen.getByTestId("feature-off-timeline")).toBeInTheDocument();
    expect(screen.queryByTestId("project-timeline")).not.toBeInTheDocument();
  });

  it("waits for the feature flag before rendering the Timeline", () => {
    state.timelineOn = undefined;
    render(<TimelineRoute />);
    expect(screen.queryByTestId("project-timeline")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("feature-off-timeline"),
    ).not.toBeInTheDocument();
  });

  it("answers an unknown or out-of-reach project key with the project denial", () => {
    state.project = undefined;
    render(<TimelineRoute />);
    expect(screen.getByTestId("project-not-found")).toBeInTheDocument();
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it("shows a placeholder while the project is loading", () => {
    state.project = undefined;
    state.isLoading = true;
    render(<TimelineRoute />);
    expect(screen.queryByTestId("project-not-found")).not.toBeInTheDocument();
    expect(screen.queryByTestId("project-timeline")).not.toBeInTheDocument();
  });
});
