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
  useGetWorkflowRules: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/hooks/mutations/workflow-rule/use-upsert-workflow-rule", () => ({
  useUpsertWorkflowRule: () => ({ mutateAsync: vi.fn() }),
}));

afterEach(cleanup);

describe("WorkflowEditor accessibility", () => {
  it("gives every rule its own accessible column picker name", () => {
    render(<WorkflowEditor projectId="project-1" />);

    const pickers = screen.getAllByRole("combobox");
    expect(pickers).toHaveLength(10);
    const names = pickers.map((picker) => picker.getAttribute("aria-label"));
    expect(names).toContain("GitHub: target column for PR Merged");
    expect(names).toContain("Gitea: target column for PR Merged");
    expect(new Set(names).size).toBe(10);
  });
});
