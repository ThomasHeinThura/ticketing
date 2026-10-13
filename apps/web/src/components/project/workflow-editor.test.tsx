import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import WorkflowEditor from "./workflow-editor";

vi.mock("react-i18next", () => ({
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

vi.mock("@/hooks/mutations/workflow-rule/use-upsert-workflow-rule", () => ({
  useUpsertWorkflowRule: () => ({ mutateAsync: vi.fn() }),
}));

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
