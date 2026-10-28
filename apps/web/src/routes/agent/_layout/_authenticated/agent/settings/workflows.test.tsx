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
  getWorkflows: vi.fn(),
  getWorkflow: vi.fn(),
  createWorkflow: vi.fn(),
  createWorkflowVersion: vi.fn(),
  previewWorkflowPublication: vi.fn(),
  publishWorkflowVersion: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useSearch: () => mocks.search,
    fullPath: "/agent/settings/workflows",
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
  default: () => ({ data: { id: "ws-1" } }),
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
    canManageWorkspaceSettings: () => true,
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
  return render(
    <QueryClientProvider client={client}>
      <Page />
    </QueryClientProvider>,
  );
}

describe("workflow settings (WF-9)", () => {
  beforeEach(() => {
    mocks.search = { workflowId: "wf-1" };
    mocks.navigate.mockReset();
    mocks.getWorkflows.mockReset().mockResolvedValue([workflow]);
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

  it("lists the work items a publish would strand, each linking to the item", async () => {
    renderPage();
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
  });
});
