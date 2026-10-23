import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CreateTaskModal from "./create-task-modal";

const useLocation = vi.fn();
const createTask = vi.fn(async (input: Record<string, unknown>) => ({
  id: "task-1",
  title: input.title,
  status: input.status,
  projectId: input.projectId,
  number: 7,
  createdAt: "2026-08-05T00:00:00.000Z",
  version: 1,
}));
const metadataQueries = vi.hoisted(() => ({
  labels: vi.fn(),
  projects: vi.fn(),
  users: vi.fn(),
}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.clearAllMocks();
  editor.upload.mockReset();
  projectStore.project = null;
});

vi.mock("@tanstack/react-router", () => ({
  useLocation: () => useLocation(),
}));

const editor = vi.hoisted(() => ({
  onFilesSelected: undefined as ((files: File[]) => void) | undefined,
  taskId: undefined as string | undefined,
  ensureTaskId: undefined as unknown,
  disabled: undefined as boolean | undefined,
  upload: vi.fn(),
}));

vi.mock("@/components/task/task-description-editor", () => ({
  default: (props: {
    onFilesSelected?: (files: File[]) => void;
    taskId?: string;
    ensureTaskId?: unknown;
    disabled?: boolean;
  }) => {
    editor.disabled = props.disabled;
    editor.onFilesSelected = props.onFilesSelected;
    editor.taskId = props.taskId;
    editor.ensureTaskId = props.ensureTaskId;
    return <div data-testid="description-editor" />;
  },
}));

vi.mock("@/fetchers/attachment/work-item-attachments", () => ({
  resumeWorkItemAttachment: (...args: unknown[]) => editor.upload(...args),
}));

vi.mock("@/hooks/mutations/label/use-create-label", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/mutations/task/use-create-task", () => ({
  default: () => ({ mutateAsync: createTask }),
}));

vi.mock("@/hooks/mutations/task/use-delete-task", () => ({
  useDeleteTask: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/mutations/task/use-update-task", () => ({
  useUpdateTask: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/queries/label/use-get-labels-by-workspace", () => ({
  default: (...args: unknown[]) => {
    metadataQueries.labels(...args);
    return { data: [] };
  },
}));

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-1", name: "WS" } }),
}));

vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({
    useGetActiveWorkspaceUsers: (...args: unknown[]) => {
      metadataQueries.users(...args);
      return { data: { members: [] } };
    },
  }),
);

vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: (...args: unknown[]) => {
    metadataQueries.projects(...args);
    return {
      data: [
        { id: "project-1", name: "Alpha", slug: "alp" },
        { id: "project-2", name: "Beta", slug: "bet" },
      ],
    };
  },
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canCreateTasks: () => true,
    canCreateLabels: () => true,
  }),
}));

const projectStore = vi.hoisted(() => ({
  project: null as { id: string; slug: string } | null,
}));

vi.mock("@/store/project", () => ({
  default: () => ({ project: projectStore.project, setProject: vi.fn() }),
}));

vi.mock("@/lib/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

describe("CreateTaskModal", () => {
  it("defers workspace option reads until the modal opens", () => {
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1/project/project-1/board",
    });

    render(<CreateTaskModal open={false} onClose={vi.fn()} />);

    expect(metadataQueries.users).toHaveBeenCalledWith("workspace-1", false);
    expect(metadataQueries.labels).toHaveBeenCalledWith("workspace-1", false);
    expect(metadataQueries.projects).toHaveBeenCalledWith(
      { workspaceId: "workspace-1" },
      false,
    );
  });

  it("keeps unsaved input while discard confirmation is open", async () => {
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1/project/project-1/board",
    });
    const onClose = vi.fn();

    render(<CreateTaskModal open onClose={onClose} />);

    const titleInput = screen.getByPlaceholderText(
      "common:modals.createTask.taskTitlePlaceholder",
    );
    fireEvent.change(titleInput, { target: { value: "Unsaved task" } });

    const backdrop = document.querySelector('[data-slot="dialog-backdrop"]');
    expect(backdrop).not.toBeNull();
    fireEvent.pointerDown(backdrop as Element);
    fireEvent.pointerUp(backdrop as Element);
    fireEvent.click(backdrop as Element);

    expect(onClose).not.toHaveBeenCalled();
    expect(
      await screen.findByText("common:modals.createTask.discardTitle"),
    ).toBeTruthy();
    expect(titleInput).toHaveValue("Unsaved task");

    fireEvent.keyDown(document, { key: "Enter", ctrlKey: true });

    expect(createTask).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes after the user confirms discarding unsaved input", async () => {
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1/project/project-1/board",
    });
    const onClose = vi.fn();

    render(<CreateTaskModal open onClose={onClose} />);

    fireEvent.change(
      screen.getByPlaceholderText(
        "common:modals.createTask.taskTitlePlaceholder",
      ),
      { target: { value: "Unsaved task" } },
    );
    const backdrop = document.querySelector('[data-slot="dialog-backdrop"]');
    fireEvent.pointerDown(backdrop as Element);
    fireEvent.pointerUp(backdrop as Element);
    fireEvent.click(backdrop as Element);

    await screen.findByText("common:modals.createTask.discardTitle");

    fireEvent.click(screen.getByText("common:modals.createTask.discardButton"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("treats a selected project as unsaved input", async () => {
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1",
    });

    render(<CreateTaskModal open onClose={vi.fn()} />);

    fireEvent.click(screen.getByText("common:modals.createTask.selectProject"));
    fireEvent.click(await screen.findByText("Beta"));
    const backdrop = document.querySelector('[data-slot="dialog-backdrop"]');
    fireEvent.pointerDown(backdrop as Element);
    fireEvent.pointerUp(backdrop as Element);
    fireEvent.click(backdrop as Element);

    expect(
      await screen.findByText("common:modals.createTask.discardTitle"),
    ).toBeTruthy();
  });

  it("shows a project picker and creates the task in the chosen project", async () => {
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1",
    });

    render(<CreateTaskModal open onClose={vi.fn()} />);

    const pickerTrigger = screen.getByText(
      "common:modals.createTask.selectProject",
    );
    fireEvent.click(pickerTrigger);
    fireEvent.click(await screen.findByText("Beta"));

    fireEvent.change(
      screen.getByPlaceholderText(
        "common:modals.createTask.taskTitlePlaceholder",
      ),
      { target: { value: "Picked project task" } },
    );
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);

    await vi.waitFor(() => {
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Picked project task",
          projectId: "project-2",
        }),
      );
    });
  });

  describe("images and files added while writing", () => {
    const inProject = () =>
      useLocation.mockReturnValue({
        pathname: "/dashboard/workspace/workspace-1/project/project-1/board",
      });
    const stage = (name: string) => {
      expect(editor.onFilesSelected).toBeTypeOf("function");
      act(() =>
        editor.onFilesSelected?.([
          new File(["x"], name, { type: "image/png" }),
        ]),
      );
    };

    it("never creates a draft task just because a file was pasted", () => {
      inProject();
      render(<CreateTaskModal open onClose={vi.fn()} />);
      stage("shot.png");
      expect(editor.ensureTaskId).toBeUndefined();
      expect(editor.taskId).toBeUndefined();
      expect(screen.getByText("shot.png")).toBeTruthy();
      expect(createTask).not.toHaveBeenCalled();
    });

    it("leaves nothing behind when a staged draft is discarded", async () => {
      inProject();
      const onClose = vi.fn();
      render(<CreateTaskModal open onClose={onClose} />);
      stage("shot.png");
      const backdrop = document.querySelector('[data-slot="dialog-backdrop"]');
      fireEvent.pointerDown(backdrop as Element);
      fireEvent.pointerUp(backdrop as Element);
      fireEvent.click(backdrop as Element);
      fireEvent.click(
        await screen.findByText("common:modals.createTask.discardButton"),
      );
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(createTask).not.toHaveBeenCalled();
      expect(editor.upload).not.toHaveBeenCalled();
    });

    it("uploads staged files only after the task exists", async () => {
      inProject();
      editor.upload.mockResolvedValue(undefined);
      render(<CreateTaskModal open onClose={vi.fn()} />);
      stage("shot.png");
      fireEvent.change(
        screen.getByPlaceholderText(
          "common:modals.createTask.taskTitlePlaceholder",
        ),
        { target: { value: "With image" } },
      );
      expect(editor.upload).not.toHaveBeenCalled();
      fireEvent.submit(document.querySelector("form") as HTMLFormElement);
      await vi.waitFor(() => expect(editor.upload).toHaveBeenCalledTimes(1));
      expect(createTask).toHaveBeenCalledTimes(1);
      expect(editor.upload.mock.calls[0]?.[0]).toBe("alp-7");
    });

    it("uploads to the created task's own project even when the store holds another project", async () => {
      inProject();
      projectStore.project = { id: "project-2", slug: "bet" };
      editor.upload.mockResolvedValue(undefined);
      render(<CreateTaskModal open onClose={vi.fn()} />);
      stage("shot.png");
      fireEvent.change(
        screen.getByPlaceholderText(
          "common:modals.createTask.taskTitlePlaceholder",
        ),
        { target: { value: "Stale store" } },
      );
      fireEvent.submit(document.querySelector("form") as HTMLFormElement);
      await vi.waitFor(() => expect(editor.upload).toHaveBeenCalledTimes(1));
      expect(editor.upload.mock.calls[0]?.[0]).toBe("alp-7");
    });

    it("blocks a second submit and closing while the task is being created", async () => {
      inProject();
      const onClose = vi.fn();
      let finish!: (task: Record<string, unknown>) => void;
      createTask.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve as typeof finish;
          }) as never,
      );
      render(<CreateTaskModal open onClose={onClose} />);
      fireEvent.change(
        screen.getByPlaceholderText(
          "common:modals.createTask.taskTitlePlaceholder",
        ),
        { target: { value: "Once only" } },
      );
      const form = document.querySelector("form") as HTMLFormElement;
      fireEvent.submit(form);
      fireEvent.submit(form);
      fireEvent.keyDown(document, { key: "Enter", ctrlKey: true });
      expect(createTask).toHaveBeenCalledTimes(1);
      expect(
        screen.getByText("common:actions.cancel").closest("button"),
      ).toBeDisabled();
      expect(
        screen
          .getByText("common:modals.createTask.createButton")
          .closest("button"),
      ).toBeDisabled();
      const backdrop = document.querySelector('[data-slot="dialog-backdrop"]');
      fireEvent.pointerDown(backdrop as Element);
      fireEvent.pointerUp(backdrop as Element);
      fireEvent.click(backdrop as Element);
      expect(onClose).not.toHaveBeenCalled();
      expect(
        screen.queryByText("common:modals.createTask.discardTitle"),
      ).toBeNull();
      await act(async () =>
        finish({
          id: "task-1",
          title: "Once only",
          status: "to-do",
          projectId: "project-1",
          number: 7,
          createdAt: "2026-08-05T00:00:00.000Z",
          version: 1,
        }),
      );
      expect(createTask).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("locks the form after a partial upload failure and offers retry or close, never a discard", async () => {
      inProject();
      const onClose = vi.fn();
      editor.upload.mockRejectedValue(new Error("boom"));
      render(<CreateTaskModal open onClose={onClose} />);
      stage("shot.png");
      const title = screen.getByPlaceholderText(
        "common:modals.createTask.taskTitlePlaceholder",
      );
      fireEvent.change(title, { target: { value: "Created once" } });
      fireEvent.submit(document.querySelector("form") as HTMLFormElement);
      await vi.waitFor(() =>
        expect(
          screen.getByText("workItems:create.attachments.retry"),
        ).toBeTruthy(),
      );
      expect(createTask).toHaveBeenCalledTimes(1);
      expect(title).toBeDisabled();
      expect(editor.onFilesSelected).toBeUndefined();
      expect(editor.disabled).toBe(true);
      expect(screen.getByTestId("create-task-partial")).toBeTruthy();

      // A retry uploads only: it never creates a second task.
      fireEvent.submit(document.querySelector("form") as HTMLFormElement);
      await vi.waitFor(() => expect(editor.upload).toHaveBeenCalledTimes(2));
      expect(createTask).toHaveBeenCalledTimes(1);

      // The failed file can be removed, and closing keeps the created task.
      await vi.waitFor(() =>
        expect(
          screen.getByLabelText("workItems:create.attachments.remove"),
        ).toBeTruthy(),
      );
      fireEvent.click(
        screen.getByLabelText("workItems:create.attachments.remove"),
      );
      expect(screen.queryByText("shot.png")).toBeNull();
      fireEvent.click(
        screen.getByText("workItems:create.attachments.createdClose"),
      );
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByText("common:modals.createTask.discardTitle"),
      ).toBeNull();
    });

    it("warns that staged files are dropped when the draft is discarded", async () => {
      inProject();
      render(<CreateTaskModal open onClose={vi.fn()} />);
      stage("shot.png");
      const backdrop = document.querySelector('[data-slot="dialog-backdrop"]');
      fireEvent.pointerDown(backdrop as Element);
      fireEvent.pointerUp(backdrop as Element);
      fireEvent.click(backdrop as Element);
      expect(
        await screen.findByText(
          "common:modals.createTask.discardWithFilesDescription",
        ),
      ).toBeTruthy();
    });
  });

  it("hides the picker when a project is in scope from the route", () => {
    useLocation.mockReturnValue({
      pathname: "/dashboard/workspace/workspace-1/project/project-1/board",
    });

    render(<CreateTaskModal open onClose={vi.fn()} />);

    expect(
      screen.queryByText("common:modals.createTask.selectProject"),
    ).toBeNull();
  });
});
