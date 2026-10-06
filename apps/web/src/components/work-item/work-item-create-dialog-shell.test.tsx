import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("./create-work-item-dialog", async () => {
  const React = await import("react");
  const DelayedForm = React.lazy(() => new Promise<never>(() => {}));

  return {
    CreateWorkItemDialogContent: () =>
      React.createElement(
        React.Suspense,
        {
          fallback: React.createElement(
            "p",
            { role: "status" },
            "Loading form",
          ),
        },
        React.createElement(DelayedForm),
      ),
  };
});

import WorkItemCreateDialogShell from "./work-item-create-dialog-shell";

afterEach(cleanup);

describe("WorkItemCreateDialogShell", () => {
  it("opens the dialog while the intent-lazy form is still loading", () => {
    render(
      <WorkItemCreateDialogShell
        onClose={vi.fn()}
        projectId="project-1"
        workspaceId="workspace-1"
      />,
    );

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Loading form");
  });
});
