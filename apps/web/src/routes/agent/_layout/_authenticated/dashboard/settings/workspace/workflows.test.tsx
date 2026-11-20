import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./workflows";

const mocks = vi.hoisted(() => ({
  search: {} as { workflowId?: string },
  navigate: vi.fn(),
  canManage: true,
  workspaceId: "ws-1",
  getWorkflows: vi.fn(),
  getWorkflow: vi.fn(),
  createWorkflow: vi.fn(),
  createWorkflowVersion: vi.fn(),
  previewWorkflowPublication: vi.fn(),
  publishWorkflowVersion: vi.fn(),
  history: vi.fn(),
  session: { user: { id: "u1" }, session: { id: "s1" } },
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: mocks.session }),
    getSession: vi.fn(async () => ({ data: mocks.session })),
  },
}));
vi.mock("@/fetchers/settings/settings-history", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/fetchers/settings/settings-history")
  >()),
  getSettingsHistory: mocks.history,
}));
vi.mock("@/lib/format", () => ({ formatDateTime: (date: string) => date }));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({
    history: { canGoBack: () => true, back: vi.fn() },
    navigate: vi.fn(),
  }),
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useSearch: () => mocks.search,
    fullPath: "/dashboard/settings/workspace/workflows",
  }),
  useNavigate: () => mocks.navigate,
  Link: ({
    children,
    params,
    to: _to,
    ...rest
  }: {
    children?: ReactNode;
    params?: { key: string };
    to?: string;
  }) => (
    <a href={`/agent/work-items/${params?.key ?? ""}`} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/fetchers/workflow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fetchers/workflow")>()),
  getWorkflows: mocks.getWorkflows,
  getWorkflow: mocks.getWorkflow,
  createWorkflow: mocks.createWorkflow,
  createWorkflowVersion: mocks.createWorkflowVersion,
  previewWorkflowPublication: mocks.previewWorkflowPublication,
  publishWorkflowVersion: mocks.publishWorkflowVersion,
}));
vi.mock("@/fetchers/service-management", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fetchers/service-management")>()),
  getCabTemplateStatus: vi.fn().mockResolvedValue({
    applied: false,
    workflowId: null,
    approvedStateTemplateId: null,
    adoptedProjectIds: [],
    changeTypeCount: 1,
  }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: mocks.workspaceId } }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: [{ id: "proj-1" }] }),
}));
vi.mock("@/hooks/queries/project/use-get-project-state-templates", () => ({
  default: () => ({
    data: [
      { id: "tpl-open", name: "Open" },
      { id: "tpl-done", name: "Done" },
    ],
  }),
}));
vi.mock("@/hooks/queries/workspace/use-workspace-roles", () => ({
  default: () => ({ data: [{ id: "role-1", role: "agent" }] }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageWorkflows: () => mocks.canManage,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.count !== undefined || options?.number !== undefined
        ? `${key}:${options.count ?? options.number}`
        : key,
  }),
}));

const guard = { type: "children_closed" as const };
function transition(id: string, to: string, from: string | null = null) {
  return {
    id,
    versionId: "v2",
    fromStateTemplateId: from,
    toStateTemplateId: to,
    roleId: null,
    notePolicy: "none" as const,
    noteVisibility: "internal" as const,
    requiresApproval: false,
    approvalPolicy: null,
    requiresCab: false,
    isReopen: false,
    guards: [guard],
    effects: [],
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
  };
}
const workflow = {
  id: "wf-1",
  workspaceId: "ws-1",
  key: "SERVICE",
  name: "Service flow",
  activeVersionId: "v1",
  version: 1,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  versions: [
    {
      id: "v1",
      workflowId: "wf-1",
      number: 1,
      publishedAt: "2026-10-01T00:00:00Z",
      publishedBy: "u1",
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:00:00Z",
      transitions: [transition("t0", "tpl-open")],
    },
    {
      id: "v2",
      workflowId: "wf-1",
      number: 2,
      publishedAt: null,
      publishedBy: null,
      createdAt: "2026-10-02T00:00:00Z",
      updatedAt: "2026-10-02T00:00:00Z",
      transitions: [
        transition("t1", "tpl-done", "tpl-open"),
        transition("t2", "tpl-open", "tpl-done"),
      ],
    },
  ],
};

const Page = (Route as unknown as { component: ComponentType }).component;
function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <Page />
      </QueryClientProvider>,
    ),
  };
}

describe("workflow settings (WF-9)", () => {
  it("hides history when the active workspace changes with the workflow id retained", async () => {
    const view = renderPage();
    await screen.findByRole("button", { name: /settings:history.title/ });
    mocks.workspaceId = "ws-2";
    view.rerender(
      <QueryClientProvider client={view.client}>
        <Page />
      </QueryClientProvider>,
    );
    expect(
      screen.queryByRole("button", { name: /settings:history.title/ }),
    ).toBeNull();
  });

  beforeEach(() => {
    mocks.canManage = true;
    mocks.workspaceId = "ws-1";
    mocks.search = { workflowId: "wf-1" };
    mocks.navigate.mockReset();
    mocks.session = { user: { id: "u1" }, session: { id: "s1" } };
    mocks.history
      .mockReset()
      .mockResolvedValue({ lastChanged: null, rows: [] });
    mocks.getWorkflows.mockReset().mockResolvedValue([workflow]);
    mocks.createWorkflow.mockReset().mockResolvedValue(workflow);
    mocks.getWorkflow.mockReset().mockResolvedValue(workflow);
    mocks.createWorkflowVersion.mockReset().mockResolvedValue({ number: 3 });
    mocks.previewWorkflowPublication.mockReset().mockResolvedValue({
      valid: false,
      affected: { people: 3, workItems: 2, projects: 1 },
      unreachableStateTemplateIds: [],
      noOutboundStateTemplateIds: ["tpl-done"],
      rolesWithNoLegalTransition: [],
      projects: [
        {
          projectId: "proj-1",
          valid: false,
          errors: [],
          refusedStateTemplateIds: [],
          stuckWorkItemKeys: ["HELP-3", "HELP-12"],
        },
      ],
    });
    mocks.publishWorkflowVersion.mockReset().mockResolvedValue({ number: 2 });
  });
  afterEach(() => cleanup());

  it.each(["viewer", "member", "lead"])(
    "keeps the workflow readable and hides editing from a %s",
    async () => {
      mocks.canManage = false;
      renderPage();
      await screen.findByRole("heading", { level: 1, name: "Service flow" });
      await waitFor(() =>
        expect(mocks.history).toHaveBeenCalledWith(
          "workflow",
          "wf-1",
          expect.any(AbortSignal),
        ),
      );
      expect(
        screen.getByRole("button", { name: "settings:history.title" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", {
          name: "settings:workflows.transitions.add",
        }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", {
          name: "settings:workflows.versions.validate",
        }),
      ).toBeNull();
    },
  );

  it("refreshes the selected target after a draft without waiting for History", async () => {
    mocks.history
      .mockResolvedValueOnce({ lastChanged: null, rows: [] })
      .mockImplementation(() => new Promise(() => {}));
    renderPage();
    await screen.findByRole("button", { name: "settings:history.title" });
    await waitFor(() => expect(mocks.history).toHaveBeenCalledTimes(1));
    const removes = await screen.findAllByRole("button", {
      name: "settings:workflows.transitions.remove",
    });
    fireEvent.click(removes[0] as HTMLElement);
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:workflows.transitions.saveDraft",
      }),
    );
    await waitFor(() => expect(mocks.history).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText("common:actions.saved", {
        selector: "span:not([aria-hidden])",
      }),
    ).toBeInTheDocument();
  });

  it("does not refresh History after a failed draft", async () => {
    mocks.createWorkflowVersion.mockRejectedValue(new Error("failed"));
    renderPage();
    await screen.findByRole("button", { name: "settings:history.title" });
    const removes = await screen.findAllByRole("button", {
      name: "settings:workflows.transitions.remove",
    });
    fireEvent.click(removes[0] as HTMLElement);
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:workflows.transitions.saveDraft",
      }),
    );
    await screen.findByText("settings:workflows.errorTitle");
    expect(mocks.history).toHaveBeenCalledTimes(1);
  });

  it("refreshes only the saved workflow and captured session after a switch", async () => {
    let finish!: (value: { number: number }) => void;
    mocks.createWorkflowVersion.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { client, rerender } = renderPage();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const removes = await screen.findAllByRole("button", {
      name: "settings:workflows.transitions.remove",
    });
    fireEvent.click(removes[0] as HTMLElement);
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:workflows.transitions.saveDraft",
      }),
    );
    await waitFor(() =>
      expect(mocks.createWorkflowVersion).toHaveBeenCalledTimes(1),
    );
    mocks.session = { user: { id: "u2" }, session: { id: "s2" } };
    mocks.search = { workflowId: "wf-2" };
    mocks.getWorkflow.mockResolvedValue({
      ...workflow,
      id: "wf-2",
      name: "Second flow",
    });
    rerender(
      <QueryClientProvider client={client}>
        <Page />
      </QueryClientProvider>,
    );
    await screen.findByRole("heading", { name: "Second flow" });
    finish({ number: 3 });
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["settings-history", "workflow", "wf-1", "agent", "u1", "s1"],
        exact: true,
        refetchType: "none",
      }),
    );
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: ["settings-history", "workflow", "wf-2", "agent", "u2", "s2"],
      exact: true,
      refetchType: "none",
    });
  });

  it("preserves a newer draft edit when an older save completes", async () => {
    let finish!: (value: { number: number }) => void;
    mocks.createWorkflowVersion.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderPage();
    const removes = await screen.findAllByRole("button", {
      name: "settings:workflows.transitions.remove",
    });
    fireEvent.click(removes[0] as HTMLElement);
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:workflows.transitions.saveDraft",
      }),
    );
    await waitFor(() =>
      expect(mocks.createWorkflowVersion).toHaveBeenCalledTimes(1),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:workflows.transitions.remove",
      }),
    );
    finish({ number: 3 });
    await waitFor(() =>
      expect(mocks.previewWorkflowPublication).toHaveBeenCalledWith({
        id: "wf-1",
        number: 3,
      }),
    );
    expect(
      screen.getByText("settings:workflows.transitions.unsaved"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("common:actions.saved", {
        selector: "span:not([aria-hidden])",
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "settings:workflows.transitions.remove",
      }),
    ).toBeNull();
    fireEvent.click(await screen.findByText("common:actions.close"));
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:workflows.transitions.saveDraft",
      }),
    );
    await screen.findByText("common:actions.saved", {
      selector: "span:not([aria-hidden])",
    });
    expect(
      screen.queryByText("settings:workflows.transitions.unsaved"),
    ).toBeNull();
  });

  it("shows no access on a forbidden workflow read", async () => {
    mocks.getWorkflow.mockRejectedValue(
      Object.assign(new Error("Forbidden"), { status: 403 }),
    );
    renderPage();
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "states.noAccess.title",
      }),
    ).toHaveFocus();
  });

  it("lists the work items a publish would strand, each linking to the item", async () => {
    const { client } = renderPage();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(
      await screen.findByRole("button", {
        name: "settings:workflows.versions.validate",
      }),
    );
    const dialog = await screen.findByTestId("workflow-validation");
    expect(
      within(dialog).getByText("settings:workflows.validation.impact"),
    ).toBeVisible();
    const stuck = within(dialog).getByRole("table", {
      name: "settings:workflows.validation.stuckTitle:2",
    });
    expect(within(stuck).getByRole("link", { name: "HELP-3" })).toHaveAttribute(
      "href",
      "/agent/work-items/HELP-3",
    );
    expect(within(stuck).getByRole("link", { name: "HELP-12" })).toBeVisible();
    expect(
      within(dialog).getByText("settings:workflows.validation.noOutbound"),
    ).toBeVisible();
    expect(mocks.previewWorkflowPublication).toHaveBeenCalledWith({
      id: "wf-1",
      number: 2,
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:workflows.validation.publishAnyway:2",
      }),
    );
    await waitFor(() =>
      expect(mocks.publishWorkflowVersion).toHaveBeenCalledWith({
        id: "wf-1",
        number: 2,
      }),
    );
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["settings-history", "workflow", "wf-1", "agent", "u1", "s1"],
        exact: true,
        refetchType: "none",
      }),
    );
  });

  it("refreshes the newly created workflow", async () => {
    mocks.search = {};
    const { client } = renderPage();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(
      await screen.findByRole("button", { name: "settings:workflows.new" }),
    );
    fireEvent.change(screen.getByLabelText("settings:workflows.create.name"), {
      target: { value: "Service flow" },
    });
    fireEvent.change(screen.getByLabelText("settings:workflows.create.key"), {
      target: { value: "SERVICE" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "settings:workflows.create.submit" }),
    );
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["settings-history", "workflow", "wf-1", "agent", "u1", "s1"],
        exact: true,
        refetchType: "none",
      }),
    );
  });

  it("does not refresh history when creation fails", async () => {
    mocks.search = {};
    mocks.createWorkflow.mockRejectedValue(new Error("failed"));
    const { client } = renderPage();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(
      await screen.findByRole("button", { name: "settings:workflows.new" }),
    );
    fireEvent.change(screen.getByLabelText("settings:workflows.create.name"), {
      target: { value: "Service flow" },
    });
    fireEvent.change(screen.getByLabelText("settings:workflows.create.key"), {
      target: { value: "SERVICE" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "settings:workflows.create.submit" }),
    );
    await screen.findByText("settings:workflows.create.error");
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("does not refresh history when publication fails", async () => {
    mocks.publishWorkflowVersion.mockRejectedValue(new Error("failed"));
    const { client } = renderPage();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(
      await screen.findByRole("button", {
        name: "settings:workflows.versions.validate",
      }),
    );
    await screen.findByTestId("workflow-validation");
    fireEvent.click(
      await screen.findByRole("button", {
        name: "settings:workflows.validation.publishAnyway:2",
      }),
    );
    await screen.findByText("settings:workflows.errorTitle");
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: ["settings-history", "workflow", "wf-1", "agent", "u1", "s1"],
      exact: true,
      refetchType: "none",
    });
  });

  it("saves a removed transition as a new draft and keeps the guards it did not touch", async () => {
    renderPage();
    // The mocked `t` returns the key, so both rows' remove buttons share one name.
    const removes = await screen.findAllByRole("button", {
      name: "settings:workflows.transitions.remove",
    });
    fireEvent.click(removes[0] as HTMLElement);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "settings:workflows.transitions.saveDraft",
      }),
    );
    await waitFor(() =>
      expect(mocks.createWorkflowVersion).toHaveBeenCalledTimes(1),
    );
    const sent = mocks.createWorkflowVersion.mock.calls[0]?.[0];
    expect(sent.id).toBe("wf-1");
    expect(sent.transitions).toHaveLength(1);
    expect(sent.transitions[0]).toMatchObject({
      fromStateTemplateId: "tpl-done",
      toStateTemplateId: "tpl-open",
      guards: [guard],
    });
    expect(sent.transitions[0]).not.toHaveProperty("id");
    expect(sent.transitions[0]).not.toHaveProperty("versionId");
    // A saved draft is validated straight away.
    await waitFor(() =>
      expect(mocks.previewWorkflowPublication).toHaveBeenCalledWith({
        id: "wf-1",
        number: 3,
      }),
    );
    expect(
      await screen.findByText("common:actions.saved", {
        selector: "span:not([aria-hidden])",
      }),
    ).toBeInTheDocument();
  });
});
