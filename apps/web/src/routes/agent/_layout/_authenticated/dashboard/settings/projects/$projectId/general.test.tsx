import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Project = {
  id: string;
  workspaceId: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
};

const mocks = vi.hoisted(() => ({
  project: undefined as Project | undefined,
  getProject: vi.fn(),
  getTasks: vi.fn(),
  updateProject: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({
    ...(options as Record<string, unknown>),
  }),
  useParams: () => ({ projectId: "p-1" }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: (...args: unknown[]) => {
    mocks.getProject(...args);
    return { data: mocks.project };
  },
}));
// The old board payload must not be read here: nothing may call it.
vi.mock("@/hooks/queries/task/use-get-tasks", () => ({
  useGetTasks: (...args: unknown[]) => {
    mocks.getTasks(...args);
    return { data: undefined };
  },
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws-1" } }),
}));
vi.mock("@/hooks/mutations/project/use-update-project", () => ({
  default: () => ({ mutateAsync: mocks.updateProject }),
}));
vi.mock("@/hooks/mutations/project/use-delete-project", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => vi.fn(),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageProjects: () => true,
    canDeleteProjects: () => false,
    canExportTasks: () => true,
  }),
}));
vi.mock("@/components/project/project-engagement-settings", () => ({
  default: ({ projectId }: { projectId: string }) => (
    <div data-testid="engagement" data-project-id={projectId} />
  ),
}));
vi.mock("@/components/project/project-planning-settings", () => ({
  default: ({ projectId }: { projectId: string }) => (
    <div data-testid="planning" data-project-id={projectId} />
  ),
}));
vi.mock("@/components/project/default-comment-visibility-setting", () => ({
  default: ({ projectId }: { projectId: string }) => (
    <div data-testid="comment-visibility" data-project-id={projectId} />
  ),
}));
vi.mock("@/components/project/tasks-import-export", () => ({
  TasksImportExport: ({
    project,
  }: {
    project: { workspaceId: string; slug: string };
  }) => (
    <div
      data-testid="export"
      data-workspace-id={project.workspaceId}
      data-slug={project.slug}
    />
  ),
}));

import { Route } from "./general";

const GeneralSettings = (Route as unknown as { component: ComponentType })
  .component;

const NAME_PLACEHOLDER = "settings:projectGeneral.projectNamePlaceholder";
const KEY_PLACEHOLDER = "settings:projectGeneral.keyPlaceholder";
const KEY_FORMAT = "settings:projectGeneral.validation.keyFormat";

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <GeneralSettings />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.project = {
    id: "p-1",
    workspaceId: "ws-1",
    slug: "HELP",
    name: "Help desk",
    description: "Front line",
    icon: "Layout",
  };
  mocks.updateProject.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("project General settings load the project itself", () => {
  it("reads the project by id and active workspace, never the legacy board payload", () => {
    renderPage();
    expect(mocks.getProject).toHaveBeenCalledWith({
      id: "p-1",
      workspaceId: "ws-1",
    });
    expect(mocks.getTasks).not.toHaveBeenCalled();
  });

  it("fills the form from the project and hands its id to the settings sections", () => {
    renderPage();
    expect(screen.getByPlaceholderText(NAME_PLACEHOLDER)).toHaveValue(
      "Help desk",
    );
    expect(screen.getByPlaceholderText(KEY_PLACEHOLDER)).toHaveValue("HELP");
    expect(screen.getByTestId("engagement")).toHaveAttribute(
      "data-project-id",
      "p-1",
    );
    expect(screen.getByTestId("planning")).toHaveAttribute(
      "data-project-id",
      "p-1",
    );
    expect(screen.getByTestId("comment-visibility")).toHaveAttribute(
      "data-project-id",
      "p-1",
    );
    expect(screen.getByTestId("export")).toHaveAttribute(
      "data-workspace-id",
      "ws-1",
    );
    expect(screen.getByTestId("export")).toHaveAttribute("data-slug", "HELP");
  });

  it("shows no settings sections until the project has loaded", () => {
    mocks.project = undefined;
    renderPage();
    expect(screen.queryByTestId("engagement")).not.toBeInTheDocument();
    expect(screen.queryByTestId("export")).not.toBeInTheDocument();
  });

  it("keeps a legacy key valid while it is unchanged and flags a bad new one (PR-13)", async () => {
    mocks.project = { ...mocks.project, slug: "legacy_key" } as Project;
    renderPage();
    const key = screen.getByPlaceholderText(KEY_PLACEHOLDER);
    expect(key).toHaveValue("legacy_key");

    fireEvent.change(key, { target: { value: "bad key" } });
    expect(await screen.findByText(KEY_FORMAT)).toBeInTheDocument();

    fireEvent.change(key, { target: { value: "legacy_key" } });
    await waitFor(() =>
      expect(screen.queryByText(KEY_FORMAT)).not.toBeInTheDocument(),
    );
  });

  it("autosaves a renamed project with its stored key", async () => {
    vi.useFakeTimers();
    renderPage();
    fireEvent.change(screen.getByPlaceholderText(NAME_PLACEHOLDER), {
      target: { value: "Service desk" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(mocks.updateProject).toHaveBeenCalledExactlyOnceWith({
      id: "p-1",
      name: "Service desk",
      slug: "HELP",
      description: "Front line",
      icon: "Layout",
    });
  });
});
