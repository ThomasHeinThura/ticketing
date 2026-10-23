import { Button } from "@taskdesk/ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const formState = vi.hoisted(() => ({ loaded: false }));

vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: [{ id: "project-1", slug: "HELP" }] }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("./create-work-item-dialog", async () => {
  const React = await import("react");
  const DelayedForm = React.lazy(() => new Promise<never>(() => {}));

  return {
    CreateWorkItemDialogContent: (props: {
      onDraftStateChange?: (state: {
        dirty: boolean;
        busy: boolean;
        createdKey?: string;
      }) => void;
      onCancel?: () => void;
      onClose: () => void;
    }) =>
      formState.loaded
        ? React.createElement(
            React.Fragment,
            null,
            React.createElement(
              Button,
              {
                onClick: () =>
                  props.onDraftStateChange?.({ dirty: true, busy: false }),
              },
              "Enter draft",
            ),
            React.createElement(
              Button,
              {
                onClick: () =>
                  props.onDraftStateChange?.({ dirty: true, busy: true }),
              },
              "Begin save",
            ),
            React.createElement(
              Button,
              {
                onClick: () =>
                  props.onDraftStateChange?.({
                    dirty: true,
                    busy: false,
                    createdKey: "HELP-1",
                  }),
              },
              "Created with failed upload",
            ),
            React.createElement(
              Button,
              { onClick: props.onCancel },
              "Cancel draft",
            ),
            React.createElement(
              Button,
              { onClick: props.onClose },
              "Saved successfully",
            ),
          )
        : React.createElement(
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
    CreateWorkItemDialogLoadError: () =>
      React.createElement("div", { role: "alert" }, "Failed to load form"),
  };
});

import WorkItemCreateDialogShell from "./work-item-create-dialog-shell";

beforeEach(() => {
  formState.loaded = false;
});
afterEach(cleanup);

describe("WorkItemCreateDialogShell", () => {
  it("opens the dialog while the intent-lazy form is still loading", () => {
    render(
      <>
        <Button type="button">Trigger</Button>
        <WorkItemCreateDialogShell
          onClose={vi.fn()}
          projectId="project-1"
          workspaceId="workspace-1"
          finalFocus={() => false}
        />
      </>,
    );

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByRole("dialog")).toHaveClass(
      "max-w-2xl",
      "max-h-[90vh]",
      "flex",
      "flex-col",
      "overflow-hidden",
    );
    expect(screen.getByText("HELP")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "workItems:create.close" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading form");
  });
});

describe("original create discard lifecycle", () => {
  function mount() {
    formState.loaded = true;
    const onClose = vi.fn();
    render(
      <WorkItemCreateDialogShell
        onClose={onClose}
        projectId="project-1"
        workspaceId="workspace-1"
        finalFocus={() => false}
      />,
    );
    return onClose;
  }
  it("retains a dirty draft until the original discard dialog is confirmed", () => {
    const onClose = mount();
    fireEvent.click(screen.getByRole("button", { name: "Enter draft" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel draft" }));
    expect(screen.getByRole("alertdialog")).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.cancel" }),
    );
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel draft" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "common:modals.createTask.discardButton",
      }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("does not discard an in-flight creation or reopen confirmation after successful save", () => {
    const onClose = mount();
    fireEvent.click(screen.getByRole("button", { name: "Begin save" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel draft" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Saved successfully" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("closes a persisted partial result without presenting it as an unsaved discard", () => {
    const onClose = mount();
    fireEvent.click(
      screen.getByRole("button", { name: "Created with failed upload" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel draft" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
