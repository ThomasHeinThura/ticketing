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
  canManage: false,
  projectId: "p-1",
  historyRequest: vi.fn(),
  checking: false,
  capabilityFailed: false,
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
  useParams: () => ({ projectId: mocks.projectId }),
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
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { id: "u1" } }),
}));
vi.mock("@/components/settings/settings-history", () => ({
  SettingsHistory: (props: unknown) => {
    mocks.historyRequest(props);
    return <div>History</div>;
  },
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
    canManageProjectSettings: () => mocks.canManage,
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
  mocks.capabilityFailed = false;
  mocks.canUpdate = true;
  mocks.canManage = false;
  mocks.projectId = "p-1";
  mocks.historyRequest.mockReset();
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

describe("project icon control", () => {
  it("draws the saved icon and a localized label, never the raw identifier", () => {
    mocks.project = { ...mocks.project, icon: "Headset" } as Project;
    renderPage();
    const trigger = screen.getByRole("button", {
      name: "settings:projectGeneral.pickIconTitle",
    });
    expect(trigger.querySelector("svg.lucide-headset")).not.toBeNull();
    expect(trigger).not.toHaveTextContent("Headset");
  });
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
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "settings:projectGeneral.title",
    );
    mocks.capabilityFailed = true;
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <GeneralSettings />
      </QueryClientProvider>,
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "common:actions.retry" }),
    ).toBeEnabled();
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

  it("uses the project history grant independently of edit permission", () => {
    mocks.canUpdate = false;
    mocks.canManage = true;
    renderPage();
    expect(mocks.historyRequest).toHaveBeenCalledWith({
      type: "project",
      id: "p-1",
      userId: "u1",
    });
    expect(
      screen.queryByPlaceholderText(NAME_PLACEHOLDER),
    ).not.toBeInTheDocument();
  });

  it("does not request history for an edit-only grant", () => {
    mocks.canUpdate = true;
    mocks.canManage = false;
    renderPage();
    expect(screen.getByPlaceholderText(NAME_PLACEHOLDER)).toBeInTheDocument();
    expect(mocks.historyRequest).not.toHaveBeenCalled();
  });

  it("keeps the latest draft while an earlier save is pending and saves it next", async () => {
    vi.useFakeTimers();
    let resolveFirst!: () => void;
    mocks.updateProject
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue({});
    const client = new QueryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <GeneralSettings />
      </QueryClientProvider>,
    );
    const input = screen.getByPlaceholderText(
      NAME_PLACEHOLDER,
    ) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "First project" } });
      await vi.advanceTimersByTimeAsync(900);
    });
    await act(async () => {
      fireEvent.change(input, { target: { value: "Latest project" } });
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(mocks.updateProject).toHaveBeenCalledTimes(1);
    mocks.project = { ...mocks.project, name: "First project" } as Project;
    await act(async () => {
      view.rerender(
        <QueryClientProvider client={client}>
          <GeneralSettings />
        </QueryClientProvider>,
      );
    });
    expect(input.value).toBe("Latest project");
    await act(async () => {
      resolveFirst();
    });
    expect(input.value).toBe("Latest project");
    expect(mocks.updateProject).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "p-1", name: "Latest project" }),
    );
  });

  it("does not carry drafts or queued writes to a different project", async () => {
    vi.useFakeTimers();
    let resolveOld!: () => void;
    let resolveNew!: () => void;
    mocks.updateProject
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveNew = resolve;
          }),
      )
      .mockResolvedValue({});
    const view = renderPage();
    const oldInput = screen.getByPlaceholderText(NAME_PLACEHOLDER);
    await act(async () => {
      fireEvent.change(oldInput, { target: { value: "Old save" } });
      await vi.advanceTimersByTimeAsync(900);
    });
    await act(async () => {
      fireEvent.change(oldInput, { target: { value: "Old queued" } });
      await vi.advanceTimersByTimeAsync(900);
    });
    mocks.projectId = "p-2";
    mocks.project = {
      id: "p-2",
      workspaceId: "ws-1",
      slug: "NEW",
      name: "Second project",
      description: "",
      icon: "Layout",
    };
    await act(async () => {
      view.rerender(
        <QueryClientProvider client={new QueryClient()}>
          <GeneralSettings />
        </QueryClientProvider>,
      );
    });
    const newInput = screen.getByPlaceholderText(
      NAME_PLACEHOLDER,
    ) as HTMLInputElement;
    expect(newInput.value).toBe("Second project");
    await act(async () => {
      fireEvent.change(newInput, { target: { value: "New save" } });
      await vi.advanceTimersByTimeAsync(900);
    });
    await act(async () => {
      fireEvent.change(newInput, { target: { value: "New queued" } });
      await vi.advanceTimersByTimeAsync(900);
    });
    await act(async () => {
      resolveOld();
    });
    expect(newInput.value).toBe("New queued");
    expect(mocks.updateProject).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: "p-1", name: "New queued" }),
    );
    await act(async () => {
      resolveNew();
    });
    expect(mocks.updateProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p-2", name: "New queued" }),
    );
    expect(newInput.value).toBe("New queued");
  });

  it.each(["autosave first", "rename first"])(
    "serializes %s without reverting the server key",
    async (order) => {
      vi.useFakeTimers();
      const server = { slug: "HELP", name: "Help desk" };
      const pending: Array<() => void> = [];
      mocks.updateProject.mockReset().mockImplementation(
        (payload: { slug?: string; name?: string }) =>
          new Promise<void>((resolve) => {
            pending.push(() => {
              if (payload.slug !== undefined) server.slug = payload.slug;
              if (payload.name !== undefined) server.name = payload.name;
              resolve();
            });
          }),
      );
      renderPage();
      const name = screen.getByPlaceholderText(NAME_PLACEHOLDER);
      const key = screen.getByPlaceholderText(KEY_PLACEHOLDER);
      if (order === "autosave first") {
        await act(async () => {
          fireEvent.change(name, { target: { value: "First name" } });
          await vi.advanceTimersByTimeAsync(900);
        });
      }
      await act(async () => {
        fireEvent.change(key, { target: { value: "NEW" } });
      });
      fireEvent.click(
        screen.getByRole("button", {
          name: "settings:projectGeneral.keyRenameAction",
        }),
      );
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", {
            name: "settings:projectGeneral.keyRenameConfirm",
          }),
        );
      });
      if (order === "rename first") {
        await act(async () => {
          fireEvent.change(name, { target: { value: "Latest name" } });
          await vi.advanceTimersByTimeAsync(900);
        });
      }
      expect(mocks.updateProject).toHaveBeenCalledTimes(1);
      expect(mocks.updateProject.mock.calls[0][0].slug).toBe(
        order === "autosave first" ? undefined : "NEW",
      );
      await act(async () => {
        pending.shift()?.();
      });
      expect(mocks.updateProject).toHaveBeenCalledTimes(2);
      expect(mocks.updateProject.mock.calls[1][0].slug).toBe(
        order === "autosave first" ? "NEW" : undefined,
      );
      await act(async () => {
        pending.shift()?.();
      });
      expect(server).toEqual({
        slug: "NEW",
        name: order === "autosave first" ? "First name" : "Latest name",
      });
    },
  );

  it("does not reuse an old key from a late project refetch after a rename", async () => {
    vi.useFakeTimers();
    const client = new QueryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <GeneralSettings />
      </QueryClientProvider>,
    );
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(KEY_PLACEHOLDER), {
        target: { value: "NEW" },
      });
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:projectGeneral.keyRenameAction",
      }),
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: "settings:projectGeneral.keyRenameConfirm",
        }),
      );
    });
    mocks.project = { ...mocks.project, slug: "HELP" } as Project;
    await act(async () => {
      view.rerender(
        <QueryClientProvider client={client}>
          <GeneralSettings />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(NAME_PLACEHOLDER), {
        target: { value: "Later edit" },
      });
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(mocks.updateProject).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "p-1", name: "Later edit" }),
    );
  });

  it("does not replay an older queued draft after confirming a newer rename", async () => {
    vi.useFakeTimers();
    const server = { slug: "HELP", name: "Help desk" };
    const pending: Array<() => void> = [];
    mocks.updateProject.mockReset().mockImplementation(
      (payload: { slug?: string; name?: string }) =>
        new Promise<void>((resolve) => {
          pending.push(() => {
            if (payload.slug !== undefined) server.slug = payload.slug;
            if (payload.name !== undefined) server.name = payload.name;
            resolve();
          });
        }),
    );
    renderPage();
    const name = screen.getByPlaceholderText(NAME_PLACEHOLDER);
    await act(async () => {
      fireEvent.change(name, { target: { value: "First edit" } });
      await vi.advanceTimersByTimeAsync(900);
    });
    await act(async () => {
      fireEvent.change(name, { target: { value: "Queued edit" } });
      await vi.advanceTimersByTimeAsync(900);
    });
    await act(async () => {
      fireEvent.change(name, { target: { value: "Newest edit" } });
      fireEvent.change(screen.getByPlaceholderText(KEY_PLACEHOLDER), {
        target: { value: "NEW" },
      });
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:projectGeneral.keyRenameAction",
      }),
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: "settings:projectGeneral.keyRenameConfirm",
        }),
      );
    });
    await act(async () => {
      pending.shift()?.();
    });
    expect(mocks.updateProject.mock.calls[1][0]).toMatchObject({
      slug: "NEW",
      name: "Newest edit",
    });
    await act(async () => {
      pending.shift()?.();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(server).toEqual({ slug: "NEW", name: "Newest edit" });
    expect(mocks.updateProject).toHaveBeenCalledTimes(2);
  });

  it("finishes a confirmed rename and queued flush on the original project after a switch", async () => {
    vi.useFakeTimers();
    const server = new Map([
      ["p-1", { slug: "HELP", name: "Help desk" }],
      ["p-2", { slug: "NEW", name: "Second project" }],
    ]);
    const pending: Array<() => void> = [];
    mocks.updateProject.mockReset().mockImplementation(
      (payload: { id: string; slug?: string; name?: string }) =>
        new Promise<void>((resolve) => {
          pending.push(() => {
            server.set(payload.id, {
              slug: payload.slug ?? server.get(payload.id)?.slug ?? "",
              name: payload.name ?? server.get(payload.id)?.name ?? "",
            });
            resolve();
          });
        }),
    );
    const view = renderPage();
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(NAME_PLACEHOLDER), {
        target: { value: "Old edit" },
      });
      await vi.advanceTimersByTimeAsync(900);
    });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(KEY_PLACEHOLDER), {
        target: { value: "OLDNEW" },
      });
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:projectGeneral.keyRenameAction",
      }),
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: "settings:projectGeneral.keyRenameConfirm",
        }),
      );
    });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(NAME_PLACEHOLDER), {
        target: { value: "Old latest" },
      });
    });
    mocks.projectId = "p-2";
    mocks.project = {
      id: "p-2",
      workspaceId: "ws-1",
      slug: "NEW",
      name: "Second project",
      description: "",
      icon: "Layout",
    };
    await act(async () => {
      view.rerender(
        <QueryClientProvider client={new QueryClient()}>
          <GeneralSettings />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      pending.shift()?.();
    });
    expect(mocks.updateProject.mock.calls[1][0]).toMatchObject({
      id: "p-1",
      slug: "OLDNEW",
    });
    await act(async () => {
      pending.shift()?.();
    });
    expect(mocks.updateProject.mock.calls[2][0]).toMatchObject({
      id: "p-1",
      name: "Old latest",
    });
    await act(async () => {
      pending.shift()?.();
    });
    expect(server.get("p-1")).toEqual({ slug: "OLDNEW", name: "Old latest" });
    expect(server.get("p-2")).toEqual({ slug: "NEW", name: "Second project" });
    expect(screen.getByPlaceholderText(NAME_PLACEHOLDER)).toHaveValue(
      "Second project",
    );
  });

  it("accepts a 15-letter rename and rejects a 16-letter key", async () => {
    renderPage();
    const key = screen.getByPlaceholderText(KEY_PLACEHOLDER);
    fireEvent.change(key, { target: { value: "ABCDEFGHIJKLMNOP" } });
    expect(await screen.findByText(KEY_FORMAT)).toBeInTheDocument();
    fireEvent.change(key, { target: { value: "ABCDEFGHIJKLMNO" } });
    await waitFor(() =>
      expect(screen.queryByText(KEY_FORMAT)).not.toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:projectGeneral.keyRenameAction",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:projectGeneral.keyRenameConfirm",
      }),
    );
    await waitFor(() =>
      expect(mocks.updateProject).toHaveBeenCalledWith(
        expect.objectContaining({ id: "p-1", slug: "ABCDEFGHIJKLMNO" }),
      ),
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
    });
  });
});

vi.mock("@/components/settings/settings-access", async (original) => ({
  ...(await original<typeof import("@/components/settings/settings-access")>()),
  useCapabilityCheckFailed: () => mocks.capabilityFailed,
}));
