import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import WorkflowEditor from "./workflow-editor";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: translate }),
}));

vi.mock("@/hooks/queries/column/use-get-columns", () => ({
  useGetColumns: () => ({
    data: [{ id: "column-1", name: "Backlog" }],
    isLoading: false,
  }),
}));

vi.mock("@/hooks/queries/workflow-rule/use-get-workflow-rules", () => ({
  useGetWorkflowRules: () => ({
    data: [
      {
        integrationType: "gitea",
        eventType: "pr_merged",
        columnId: "column-1",
      },
    ],
    isLoading: false,
  }),
}));

const permission = vi.hoisted(() => ({
  checking: false,
  canUpdate: true,
  canManageSettings: true,
}));

vi.mock("@/hooks/mutations/workflow-rule/use-upsert-workflow-rule", () => ({
  useUpsertWorkflowRule: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    isCheckingPermissions: permission.checking,
    canUpdateProjects: () => permission.canUpdate,
    canManageProjectSettings: () => permission.canManageSettings,
  }),
}));

beforeEach(() => {
  permission.checking = false;
  permission.canUpdate = true;
  permission.canManageSettings = true;
});
afterEach(cleanup);

describe("WorkflowEditor accessibility", () => {
  it("names each column picker with section, event and its visible value", () => {
    render(<WorkflowEditor projectId="project-1" />);

    const pickers = screen.getAllByRole("combobox");
    expect(pickers).toHaveLength(10);
    // Visible text is "Backlog" (the selected rule column) or the placeholder.
    expect(
      screen.getByRole("combobox", {
        name: "GitHub Branch Push Select column...",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", {
        name: "Gitea PR Merged Backlog",
      }),
    ).toBeInTheDocument();
    expect(
      new Set(pickers.map((picker) => picker.getAttribute("aria-labelledby")))
        .size,
    ).toBe(10);
  });
});

describe("WorkflowEditor permissions", () => {
  it("offers live column pickers to someone with project:manage_settings", () => {
    render(<WorkflowEditor projectId="project-1" />);
    for (const picker of screen.getAllByRole("combobox"))
      expect(picker).not.toHaveAttribute("data-disabled");
    expect(screen.queryByTestId("workflow-rules-read-only")).toBeNull();
  });

  it("shows the pickers read-only with a hint to a member or viewer without project:manage_settings", () => {
    permission.canUpdate = false;
    permission.canManageSettings = false;
    render(<WorkflowEditor projectId="project-1" />);
    const pickers = screen.getAllByRole("combobox");
    expect(pickers).toHaveLength(10);
    for (const picker of pickers)
      expect(picker).toHaveAttribute("data-disabled");
    expect(screen.getByTestId("workflow-rules-read-only")).toHaveTextContent(
      "Only people who can manage this Project's settings can change automation rules.",
    );
  });

  it("shows the pickers read-only to a lead with project:update but not project:manage_settings (A8-2)", () => {
    permission.canManageSettings = false;
    render(<WorkflowEditor projectId="project-1" />);
    for (const picker of screen.getAllByRole("combobox"))
      expect(picker).toHaveAttribute("data-disabled");
    expect(screen.getByTestId("workflow-rules-read-only")).toBeInTheDocument();
  });

  it("keeps the pickers disabled while the permission check runs, without the hint", () => {
    permission.checking = true;
    permission.canUpdate = false;
    permission.canManageSettings = false;
    render(<WorkflowEditor projectId="project-1" />);
    for (const picker of screen.getAllByRole("combobox"))
      expect(picker).toHaveAttribute("data-disabled");
    expect(screen.queryByTestId("workflow-rules-read-only")).toBeNull();
  });
});
