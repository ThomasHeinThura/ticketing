import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import type { Project } from "@/types/project";

const mocks = vi.hoisted(() => ({
  downloadWorkItemsCsv: vi.fn(),
  canExport: true,
  toast: {
    loading: vi.fn(),
    dismiss: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/toast", () => ({ toast: mocks.toast }));
vi.mock("@/fetchers/work-item/export-work-items", () => ({
  downloadWorkItemsCsv: (...args: unknown[]) =>
    mocks.downloadWorkItemsCsv(...args),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canExportTasks: () => mocks.canExport }),
}));

import { TasksImportExport } from "./tasks-import-export";

const project = {
  id: "proj-help",
  slug: "HELP",
  workspaceId: "ws-1",
} as unknown as Project;

function renderPanel() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <TasksImportExport project={project} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.canExport = true;
  mocks.downloadWorkItemsCsv.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("project settings export (A-16)", () => {
  it("exports the project's work items through the work-item export", async () => {
    renderPanel();
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:tasksImportExport.exportTasks",
      }),
    );
    await waitFor(() =>
      expect(mocks.downloadWorkItemsCsv).toHaveBeenCalledOnce(),
    );
    expect(mocks.downloadWorkItemsCsv).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      projectSlug: "HELP",
      sort: "key",
      dir: "asc",
    });
    expect(mocks.toast.success).toHaveBeenCalled();
  });

  it("offers no export to people without work_item:export", () => {
    mocks.canExport = false;
    const { container } = renderPanel();
    expect(
      screen.queryByRole("button", {
        name: "settings:tasksImportExport.exportTasks",
      }),
    ).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("no longer offers the legacy import that wrote outside work items", () => {
    renderPanel();
    expect(
      screen.queryByRole("button", {
        name: "settings:tasksImportExport.importTasks",
      }),
    ).toBeNull();
    expect(
      screen.queryByText("settings:tasksImportExport.dialogTitle"),
    ).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("reports a failed export", async () => {
    mocks.downloadWorkItemsCsv.mockRejectedValue(new Error("boom"));
    renderPanel();
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:tasksImportExport.exportTasks",
      }),
    );
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "settings:tasksImportExport.exportError",
      ),
    );
  });

  it.each([
    [422, "workItems:list.exportLimitExceeded"],
    [429, "workItems:list.exportRateLimited"],
  ])("shows the translated error for status %i", async (status, message) => {
    mocks.downloadWorkItemsCsv.mockRejectedValue(
      new HttpError(status, "error"),
    );
    renderPanel();
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:tasksImportExport.exportTasks",
      }),
    );
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(message),
    );
  });
});
