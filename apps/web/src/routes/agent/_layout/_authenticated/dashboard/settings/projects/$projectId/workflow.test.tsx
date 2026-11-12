import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";

const mocks = vi.hoisted(() => ({
  workspace: { id: "ws-1" } as { id: string } | undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({
    ...(options as Record<string, unknown>),
    useParams: () => ({ projectId: "p-1" }),
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, options),
  }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: mocks.workspace }),
}));
vi.mock("@/components/project/project-states-editor", () => ({
  default: ({
    projectId,
    workspaceId,
  }: {
    projectId: string;
    workspaceId: string;
  }) => (
    <div
      data-testid="states-editor"
      data-project-id={projectId}
      data-workspace-id={workspaceId}
    />
  ),
}));
// The old Kaneo board columns and the GitHub automation rules are not part of this page.
vi.mock("@/components/project/column-editor", () => ({
  default: () => <div data-testid="column-editor" />,
}));
vi.mock("@/components/project/workflow-editor", () => ({
  default: () => <div data-testid="workflow-editor" />,
}));

import { Route } from "./workflow";

const WorkflowSettings = (Route as unknown as { component: ComponentType })
  .component;

beforeEach(() => {
  mocks.workspace = { id: "ws-1" };
});
afterEach(cleanup);

describe("project Workflow settings", () => {
  it("shows the canonical States editor for the project", () => {
    render(<WorkflowSettings />);
    expect(screen.getByRole("heading", { name: "States" })).toBeInTheDocument();
    expect(screen.getByTestId("states-editor")).toHaveAttribute(
      "data-project-id",
      "p-1",
    );
    expect(screen.getByTestId("states-editor")).toHaveAttribute(
      "data-workspace-id",
      "ws-1",
    );
  });

  it("no longer shows the old board Columns or the GitHub Automation sections", () => {
    render(<WorkflowSettings />);
    expect(screen.queryByTestId("column-editor")).not.toBeInTheDocument();
    expect(screen.queryByTestId("workflow-editor")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Columns" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Automation Rules" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/original .* board/i)).not.toBeInTheDocument();
  });

  it("describes the page by the states work items move through", () => {
    render(<WorkflowSettings />);
    expect(screen.getByText(/Choose the states/)).toBeInTheDocument();
    expect(screen.queryByText(/board columns/i)).not.toBeInTheDocument();
  });

  it("waits for the active workspace before showing the States editor", () => {
    mocks.workspace = undefined;
    render(<WorkflowSettings />);
    expect(screen.queryByTestId("states-editor")).not.toBeInTheDocument();
  });
});
