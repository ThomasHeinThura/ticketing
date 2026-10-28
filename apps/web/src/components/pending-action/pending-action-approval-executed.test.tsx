import { Dialog } from "@taskdesk/ui";
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
  factor: {
    enabled: false,
    required: false,
    availableMethods: ["password"],
  },
  approve: vi.fn(),
  proof: vi.fn(),
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
      : queryKey[0] === "god-mode"
        ? {
            data: mocks.factor,
            isLoading: false,
            isError: false,
          }
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
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string, options?: { count?: number }) =>
      key.includes("countRecords") ||
      key.includes("countLinks") ||
      key.includes("confirmRecords") ||
      key.includes("confirmLinks") ||
      (key.startsWith("pendingActions:importRun.") &&
        options?.count !== undefined)
        ? `${key}:${options?.count ?? ""}`
        : key,
  }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/fetchers/god-mode/instance-users", () => ({
  getCurrentFactorStatus: vi.fn(),
  getInstanceUser: vi.fn(),
}));
vi.mock("@/fetchers/pending-actions", () => ({
  approveOwnPendingAction: (value: unknown) => mocks.approve(value),
  cancelOwnPendingAction: vi.fn(),
  createPendingActionProof: (value: unknown) => mocks.proof(value),
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

describe("WI-23 single work-item deletion dialog content", () => {
  afterEach(cleanup);
  it("shows the customer requester, deleting actor, portal impact and retention", () => {
    mocks.action.current = workItemAction({
      summary: {
        key: "WLP-1",
        title: "One",
        projectName: "Help desk",
        customerRequesterName: "Casey Customer",
        requestedByName: "Riley Staff",
        customerVisibility: "organisation",
        recoveryDays: 30,
        childrenAffected: 0,
      },
    });
    render(<PendingActionApproval id="pa-1" layout="page" />);
    expect(screen.getByText(/WLP-1 · One/)).toBeInTheDocument();
    expect(screen.getByText("workItems:deletion.project")).toBeInTheDocument();
    expect(
      screen.getByText("workItems:deletion.customerRequester"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("workItems:deletion.requestedBy"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("workItems:deletion.portalVisibility"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("workItems:deletion.portalRemoval.organisation"),
    ).toBeInTheDocument();
    expect(screen.queryByText("workItems:deletion.recovery")).toBeNull();
    expect(
      screen.getByText("workItems:deletion.retention"),
    ).toBeInTheDocument();
  });
});

describe("MCP import chunk pending-action confirmation", () => {
  beforeEach(() => {
    mocks.approve.mockReset().mockResolvedValue({ state: "executed" });
    mocks.proof.mockReset().mockResolvedValue("step-up-proof");
    mocks.invalidate.mockReset().mockResolvedValue(undefined);
    mocks.action.current = {
      id: "pa-import",
      action: "mcp_destructive",
      targetType: "import_chunk",
      targetIds: ["opaque-chunk-id"],
      confirmation: "typed_count_step_up",
      approvalSupported: true,
      state: "pending",
      origin: "mcp",
      expiresAt: "2026-10-26T00:00:00.000Z",
      summary: {
        kind: "mcp_import_chunk",
        operation: "records",
        recordCount: 3,
        pluginId: "import.mcp",
      },
    };
  });
  afterEach(cleanup);

  it("requires the exact count and fresh authentication, then approves the chunk", async () => {
    render(<PendingActionApproval id="pa-import" layout="page" />);

    expect(
      screen.getByText("pendingActions:importChunk.countRecords:3"),
    ).toBeInTheDocument();
    const countInput = screen.getByRole("textbox", {
      name: "pendingActions:importChunk.confirmRecords:3",
    });
    const password = screen.getByLabelText(
      "pendingActions:dynamic.accountPassword",
    );
    const approveButton = screen.getByRole("button", {
      name: "pendingActions:importChunk.approveRecords",
    });

    fireEvent.change(password, { target: { value: "fresh-password" } });
    fireEvent.change(countInput, { target: { value: "2" } });
    expect(approveButton).toBeDisabled();
    expect(mocks.proof).not.toHaveBeenCalled();

    fireEvent.change(countInput, { target: { value: "3" } });
    expect(countInput).toHaveValue("3");
    expect(password).toHaveValue("fresh-password");
    expect(screen.queryByText("pendingActions:copy.02c7fa45ff1a")).toBeNull();
    await waitFor(() => expect(approveButton).toBeEnabled());
    fireEvent.click(approveButton);

    await waitFor(() =>
      expect(mocks.approve).toHaveBeenCalledWith({
        id: "pa-import",
        typedCount: "3",
        stepUpToken: "step-up-proof",
      }),
    );
    expect(mocks.proof).toHaveBeenCalledWith({
      pendingActionId: "pa-import",
      method: "password",
      secret: "fresh-password",
    });
    expect(screen.queryByText("opaque-chunk-id")).toBeNull();
  });

  it("labels import-link batches distinctly while keeping their targets hidden", () => {
    const summary = mocks.action.current.summary as Record<string, unknown>;
    mocks.action.current = {
      ...mocks.action.current,
      summary: { ...summary, operation: "links" },
    };
    render(<PendingActionApproval id="pa-import" layout="page" />);

    expect(
      screen.getByText("pendingActions:importChunk.actionLinks"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("pendingActions:importChunk.countLinks:3"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", {
        name: "pendingActions:importChunk.confirmLinks:3",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("opaque-chunk-id")).toBeNull();
  });

  it("hides malformed expanded import metadata and blocks approval", () => {
    const summary = mocks.action.current.summary as Record<string, unknown>;
    mocks.action.current = {
      ...mocks.action.current,
      summary: { ...summary, sourceRef: "private-source" },
    };
    render(
      <Dialog open>
        <PendingActionApproval id="pa-import" layout="dialog" />
      </Dialog>,
    );

    expect(
      screen.getByText("pendingActions:importChunk.hidden"),
    ).toBeInTheDocument();
    expect(screen.queryByText("private-source")).toBeNull();
    expect(screen.queryByText("opaque-chunk-id")).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "pendingActions:importChunk.approveRecords",
      }),
    ).toBeNull();
  });
});

describe("import run pending-action confirmation", () => {
  const runAction = (summary: Record<string, unknown> | undefined) => ({
    id: "pa-run",
    action: "mcp_destructive",
    targetType: "import_run",
    targetIds: ["run-1"],
    confirmation: "typed_count_step_up",
    approvalSupported: true,
    state: "pending",
    origin: "agent",
    expiresAt: "2026-10-26T00:00:00.000Z",
    summary,
  });
  beforeEach(() => {
    mocks.approve.mockReset().mockResolvedValue({ state: "executed" });
    mocks.proof.mockReset().mockResolvedValue("step-up-proof");
    mocks.invalidate.mockReset().mockResolvedValue(undefined);
    mocks.action.current = runAction({
      kind: "import_run",
      pluginId: "import.jira",
      totalCount: 120,
      writes: 80,
      mappingVersion: 2,
    });
  });
  afterEach(cleanup);

  it("shows the run, requires the exact total count and step-up, then approves", async () => {
    render(<PendingActionApproval id="pa-run" layout="page" />);

    expect(
      screen.getByText("pendingActions:importRun.count:120"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("pendingActions:importRun.writes:80"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("pendingActions:importRun.open"),
    ).toBeInTheDocument();
    const countInput = screen.getByRole("textbox", {
      name: "pendingActions:importRun.confirm:120",
    });
    const password = screen.getByLabelText(
      "pendingActions:dynamic.accountPassword",
    );
    const approveButton = screen.getByRole("button", {
      name: "pendingActions:importRun.approve",
    });

    fireEvent.change(password, { target: { value: "fresh-password" } });
    fireEvent.change(countInput, { target: { value: "80" } });
    expect(approveButton).toBeDisabled();
    expect(mocks.proof).not.toHaveBeenCalled();

    fireEvent.change(countInput, { target: { value: "120" } });
    await waitFor(() => expect(approveButton).toBeEnabled());
    fireEvent.click(approveButton);

    await waitFor(() => expect(mocks.approve).toHaveBeenCalledTimes(1));
    expect(mocks.proof).toHaveBeenCalledWith(
      expect.objectContaining({ pendingActionId: "pa-run" }),
    );
    expect(mocks.approve).toHaveBeenCalledWith({
      id: "pa-run",
      typedCount: "120",
      stepUpToken: "step-up-proof",
    });
  });

  it("fails closed when the run summary is not the closed contract", () => {
    mocks.action.current = runAction({ kind: "import_run", sourceRef: "x" });
    render(<PendingActionApproval id="pa-run" layout="page" />);

    expect(
      screen.getByText("pendingActions:importRun.hidden"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "pendingActions:importRun.approve",
      }),
    ).toBeNull();
  });
});

describe("PR-20 project deletion confirmation", () => {
  afterEach(cleanup);
  it("uses the project key and explains the server-counted impact", () => {
    mocks.action.current = {
      id: "pa-project",
      action: "delete",
      targetType: "project",
      targetIds: ["project-1"],
      confirmation: "typed_name_step_up",
      approvalSupported: true,
      state: "pending",
      summary: {
        name: "WLP",
        projectName: "Help desk",
        recoveryDays: 30,
        impact: {
          workItems: 3,
          legacyTasks: 6,
          members: 2,
          attachments: 4,
          workflowRules: 1,
          sourceLinks: 5,
        },
      },
    };
    render(<PendingActionApproval id="pa-project" layout="page" />);
    expect(
      screen.getByText("pendingActions:registered.confirmProjectKey"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("pendingActions:registered.projectImpact"),
    ).toHaveTextContent("pendingActions:registered.projectSourceLinks");
    expect(
      screen.getByLabelText("pendingActions:registered.projectImpact"),
    ).toHaveTextContent("pendingActions:registered.projectRecovery");
  });
});

describe("personal API-key deletion confirmation", () => {
  afterEach(cleanup);

  it("renders the key's server name and exact-name confirmation", () => {
    mocks.action.current = {
      id: "pa-api-key",
      action: "delete",
      targetType: "api_key",
      targetIds: ["key-1"],
      confirmation: "typed_name_step_up",
      approvalSupported: true,
      state: "pending",
      origin: "web",
      expiresAt: "2026-10-25T00:00:00.000Z",
      summary: { name: "Retired local credential", kind: "personal" },
    };
    render(<PendingActionApproval id="pa-api-key" layout="page" />);
    expect(
      screen.getAllByText("Retired local credential").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText("pendingActions:registered.confirmName"),
    ).toBeInTheDocument();
  });
});

describe("executed role deletion", () => {
  beforeEach(() => {
    mocks.approve.mockReset().mockResolvedValue({ state: "executed" });
    mocks.navigate.mockReset().mockResolvedValue(undefined);
    mocks.invalidate.mockReset().mockResolvedValue(undefined);
    mocks.pathname.current = "/agent/settings/roles/role-1";
    mocks.action.current = workItemAction({
      targetType: "workspace_role",
      targetIds: ["role-1"],
      summary: { roleId: "role-1", name: "Service desk lead" },
    });
  });
  afterEach(() => cleanup());

  it("names the role (not its slug) and returns to the roles list", async () => {
    await approve();
    expect(screen.getByText("Service desk lead")).toBeTruthy();
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/agent/settings/roles",
    });
  });
});
