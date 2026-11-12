import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";

type Project = {
  id: string;
  workspaceId: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
};

const mocks = vi.hoisted(() => ({
  canUpdate: true,
  checking: false,
  back: vi.fn(),
  project: undefined as Project | undefined,
  projectLoading: false,
  projectError: null as unknown,
  refetchProject: vi.fn(),
  workspace: { id: "ws-1" } as { id: string } | undefined,
  workspaceLoading: false,
  workspaceError: null as unknown,
  refetchWorkspace: vi.fn(),
  getProject: vi.fn(),
  getTasks: vi.fn(),
  updateProject: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({
    ...(options as Record<string, unknown>),
  }),
  useParams: () => ({ projectId: "p-1" }),
  useRouter: () => ({
    history: { canGoBack: () => true, back: mocks.back },
    navigate: vi.fn(),
  }),
  Link: ({ children, to }: { children?: ReactNode; to?: string }) => (
    <a href={to}>{children}</a>
  ),
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
    return {
      data: mocks.project,
      isLoading: mocks.projectLoading,
      isError: Boolean(mocks.projectError),
      error: mocks.projectError,
      refetch: mocks.refetchProject,
    };
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
  default: () => ({
    data: mocks.workspace,
    isLoading: mocks.workspaceLoading,
    isError: Boolean(mocks.workspaceError),
    error: mocks.workspaceError,
    refetch: mocks.refetchWorkspace,
  }),
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
    canUpdateProjects: () => mocks.canUpdate,
    isCheckingPermissions: mocks.checking,
    canDeleteProjects: () => false,
    canExportTasks: () => true,
  }),
}));
vi.mock("@/components/project/project-engagement-settings", () => ({
  default: ({ projectId }: { projectId: string }) => (
    <div data-project-id={projectId} data-testid="engagement" />
  ),
}));
vi.mock("@/components/project/project-planning-settings", () => ({
  default: ({ projectId }: { projectId: string }) => (
    <div data-project-id={projectId} data-testid="planning" />
  ),
}));
vi.mock("@/components/project/default-comment-visibility-setting", () => ({
  default: ({ projectId }: { projectId: string }) => (
    <div data-project-id={projectId} data-testid="comment-visibility" />
  ),
}));
vi.mock("@/components/project/tasks-import-export", () => ({
  TasksImportExport: ({
    project,
  }: {
    project: { workspaceId: string; slug: string };
  }) => (
    <div
      data-slug={project.slug}
      data-testid="export"
      data-workspace-id={project.workspaceId}
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
  mocks.canUpdate = true;
  mocks.checking = false;
  mocks.project = {
    id: "p-1",
    workspaceId: "ws-1",
    slug: "HELP",
    name: "Help desk",
    description: "Front line",
    icon: "Layout",
  };
  mocks.projectLoading = false;
  mocks.projectError = null;
  mocks.workspace = { id: "ws-1" };
  mocks.workspaceLoading = false;
  mocks.workspaceError = null;
  mocks.updateProject.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("project General settings load the project itself", () => {
  it("hides editing when project update is not permitted", () => {
    mocks.canUpdate = false;
    renderPage();
    expect(
      screen.queryByPlaceholderText(NAME_PLACEHOLDER),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Help desk")).toBeInTheDocument();
  });
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

  it("renders a loading skeleton and no editable inputs while the project is loading", () => {
    mocks.project = undefined;
    mocks.projectLoading = true;
    renderPage();
    expect(screen.getByTestId("project-general-loading")).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(NAME_PLACEHOLDER),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("engagement")).not.toBeInTheDocument();
    expect(screen.queryByTestId("export")).not.toBeInTheDocument();
  });

  it("renders ProjectNotFound instead of an editable empty form when the project is missing or 404, without saving on unmount", () => {
    mocks.project = undefined;
    mocks.projectError = new HttpError(404, "Not found");
    const { unmount } = renderPage();
    expect(screen.getByTestId("project-not-found")).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(NAME_PLACEHOLDER),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("engagement")).not.toBeInTheDocument();
    unmount();
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });

  it("shows the shared no-access heading and Back action on 403, without saving on unmount", () => {
    mocks.project = undefined;
    mocks.projectError = new HttpError(403, "Forbidden");
    const { unmount } = renderPage();
    expect(
      screen.getByRole("heading", { level: 1, name: "states.noAccess.title" }),
    ).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "states.back" }));
    expect(mocks.back).toHaveBeenCalledOnce();
    expect(
      screen.queryByPlaceholderText(NAME_PLACEHOLDER),
    ).not.toBeInTheDocument();
    unmount();
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });

  it("waits for a pending capability check before showing a 403 denial", () => {
    mocks.project = undefined;
    mocks.projectError = new HttpError(403, "Forbidden");
    mocks.checking = true;
    const { rerender } = renderPage();
    expect(
      screen.getByRole("status", { name: "settings:accessDenied.checking" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("settings-access-denied"),
    ).not.toBeInTheDocument();
    mocks.checking = false;
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <GeneralSettings />
      </QueryClientProvider>,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "states.noAccess.title" }),
    ).toHaveFocus();
  });

  it("renders ErrorDisplay with retry on transient server failure instead of an empty form", () => {
    mocks.project = undefined;
    mocks.projectError = new HttpError(500, "Upstream unavailable");
    renderPage();
    expect(
      screen.queryByPlaceholderText(NAME_PLACEHOLDER),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "common:error.tryAgain" }),
    );
    expect(mocks.refetchProject).toHaveBeenCalledOnce();
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
