import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useProjectStore from "@/store/project";
import type { ProjectWithTasks } from "@/types/project";
import { PendingActionApproval } from "./pending-action-approval";

const mocks = vi.hoisted(() => ({
  action: { current: {} as Record<string, unknown> },
  approve: vi.fn(),
  navigate: vi.fn(),
  pathname: { current: "" },
  invalidate: vi.fn(),
  remove: vi.fn(),
  cachedTask: { current: undefined as unknown },
  cachedProject: { current: undefined as unknown },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: mocks.pathname.current }),
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="/">{children}</a>
  ),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) =>
    queryKey[0] === "me"
      ? { data: mocks.action.current, isLoading: false, isError: false }
      : { data: undefined, isLoading: false, isError: false },
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidate,
    removeQueries: mocks.remove,
    getQueryData: (key: unknown[]) =>
      key[0] === "projects"
        ? mocks.cachedProject.current
        : mocks.cachedTask.current,
  }),
  useMutation: ({
    mutationFn,
  }: {
    mutationFn: (v: unknown) => Promise<unknown>;
  }) => ({
    isPending: false,
    mutateAsync: (value: unknown) => mutationFn(value),
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" }, t: (key: string) => key }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/fetchers/god-mode/instance-users", () => ({
  getCurrentFactorStatus: vi.fn(),
  getInstanceUser: vi.fn(),
}));
vi.mock("@/fetchers/pending-actions", () => ({
  approveOwnPendingAction: (value: unknown) => mocks.approve(value),
  cancelOwnPendingAction: vi.fn(),
  createPendingActionProof: vi.fn(),
  getOwnPendingAction: vi.fn(),
}));
vi.mock("@/hooks/queries/god-mode/use-instance-users", () => ({
  instanceUsersKey: ["instance-users"],
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-1" } }),
}));

const task = (id: string, number: number) => ({ id, number }) as never;
const project = {
  id: "project-1",
  slug: "WLP",
  columns: [{ id: "to-do", tasks: [task("t-1", 1), task("t-2", 2)] }],
  plannedTasks: [task("t-3", 3)],
  archivedTasks: [],
} as unknown as ProjectWithTasks;

function workItemAction(over: Record<string, unknown>) {
  return {
    id: "pa-1",
    action: "delete",
    targetType: "work_item",
    targetIds: ["WLP-1"],
    summary: { key: "WLP-1", title: "One" },
    approvalSupported: true,
    confirmation: "click",
    state: "pending",
    origin: "web",
    expiresAt: "2026-10-12T00:00:00.000Z",
    ...over,
  };
}

async function approve() {
  render(<PendingActionApproval id="pa-1" layout="page" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "common:actions.delete" }),
  );
  await waitFor(() => expect(mocks.approve).toHaveBeenCalled());
  await waitFor(() => expect(mocks.invalidate).toHaveBeenCalled());
}

describe("executed work-item deletion", () => {
  beforeEach(() => {
    mocks.approve.mockReset().mockResolvedValue({ state: "executed" });
    mocks.navigate.mockReset().mockResolvedValue(undefined);
    mocks.invalidate.mockReset().mockResolvedValue(undefined);
    mocks.remove.mockReset();
    mocks.pathname.current =
      "/dashboard/workspace/workspace-1/project/project-1/task/t-1";
    mocks.cachedTask.current = { number: 1 };
    mocks.cachedProject.current = undefined;
    mocks.action.current = workItemAction({});
    useProjectStore.setState({ project });
  });
  afterEach(() => {
    cleanup();
    useProjectStore.setState({ project: undefined });
  });

  it("leaves the deleted task page for the board and clears its caches and store entry", async () => {
    await approve();
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
      params: { workspaceId: "workspace-1", projectId: "project-1" },
      replace: true,
    });
    expect(mocks.remove).toHaveBeenCalledWith({ queryKey: ["task", "t-1"] });
    expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey: ["tasks"] });
    expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey: ["work-items"] });
    const stored = useProjectStore.getState().project;
    expect(stored?.columns[0]?.tasks.map((entry) => entry.id)).toEqual(["t-2"]);
    expect(stored?.plannedTasks.map((entry) => entry.id)).toEqual(["t-3"]);
  });

  it("leaves the legacy page using the project query, without a seeded project store", async () => {
    useProjectStore.setState({ project: undefined });
    mocks.cachedProject.current = { slug: "WLP" };
    await approve();
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
      params: { workspaceId: "workspace-1", projectId: "project-1" },
      replace: true,
    });
    expect(mocks.remove).toHaveBeenCalledWith({ queryKey: ["task", "t-1"] });
    expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey: ["tasks"] });
    expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey: ["work-items"] });
  });

  it("returns from the canonical work-item page to the project board", async () => {
    mocks.pathname.current = "/agent/work-items/WLP-1";
    useProjectStore.setState({ project: undefined });
    await approve();
    expect(mocks.navigate).toHaveBeenCalledWith({
      href: expect.stringMatching(/^\/agent\/projects\/WLP\/work\?/),
      replace: true,
    });
    expect(mocks.remove).toHaveBeenCalledWith({
      queryKey: ["work-items", "detail", "WLP-1"],
    });
  });

  it("handles a bulk deletion the same way and keeps unrelated tasks", async () => {
    mocks.action.current = workItemAction({
      action: "bulk_delete",
      confirmation: "typed_count",
      targetIds: ["WLP-1", "WLP-3"],
      summary: {
        affectedCount: 2,
        selection: { keys: ["WLP-1", "WLP-3"] },
      },
    });
    mocks.approve.mockResolvedValue({ state: "executed" });
    render(<PendingActionApproval id="pa-1" layout="page" />);
    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "2" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.delete" }),
    );
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
    const stored = useProjectStore.getState().project;
    expect(stored?.columns[0]?.tasks.map((entry) => entry.id)).toEqual(["t-2"]);
    expect(stored?.plannedTasks).toEqual([]);
  });

  it("stays put when the deleted item is not the open task page", async () => {
    mocks.cachedTask.current = { number: 2 };
    await approve();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledWith({ queryKey: ["task", "t-1"] });
    expect(mocks.remove).not.toHaveBeenCalledWith({
      queryKey: ["task", "t-2"],
    });
  });

  it("does nothing to the task caches when the approval was not executed", async () => {
    mocks.approve.mockResolvedValue({ state: "pending" });
    await approve();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(useProjectStore.getState().project).toBe(project);
  });
});
