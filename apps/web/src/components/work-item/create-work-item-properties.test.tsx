import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CreateWorkItemProperties from "./create-work-item-properties";
import type { CreateWorkItemOptions } from "./use-create-work-item-options";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("./create-work-item-label-picker", () => ({
  default: () => null,
}));

const options: CreateWorkItemOptions = {
  states: [],
  statesLoading: false,
  statesError: false,
  people: [],
  peopleLoading: false,
  peopleError: false,
  labels: [
    {
      id: "label-a",
      name: "Alpha",
      color: "teal",
      workspaceId: "workspace-a",
      taskId: null,
    },
    {
      id: "label-b",
      name: "Beta",
      color: "purple",
      workspaceId: "workspace-a",
      taskId: null,
    },
  ],
  labelsLoading: false,
  labelsError: false,
};

function setup(overrides: { disabled?: boolean; canUpdate?: boolean } = {}) {
  const onLabelsChange = vi.fn();
  const onSubmit = vi.fn();
  function Draft({ disabled = false, canUpdate = true }: typeof overrides) {
    const [labelIds, setLabelIds] = useState(["label-a", "label-b"]);
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <CreateWorkItemProperties
          workspaceId="workspace-a"
          projectId="project-a"
          options={options}
          typeControl={null}
          priorityControl={null}
          startDate={undefined}
          dueDate={undefined}
          assigneeId=""
          labelIds={labelIds}
          onLabelCreated={vi.fn()}
          onLabelBusyChange={vi.fn()}
          onLabelDraftChange={vi.fn()}
          onStartDateChange={vi.fn()}
          onDueDateChange={vi.fn()}
          onAssigneeChange={vi.fn()}
          onLabelsChange={(ids) => {
            onLabelsChange(ids);
            setLabelIds(ids);
          }}
          canUpdate={canUpdate}
          canAssign={false}
          disabled={disabled}
        />
      </form>
    );
  }
  const view = render(<Draft {...overrides} />);
  return {
    onLabelsChange,
    onSubmit,
    lock: () => view.rerender(<Draft disabled />),
  };
}

const labelButton = (name: string) =>
  screen.getByRole("button", {
    name: `common:modals.createTask.labels: ${name}`,
  });

afterEach(cleanup);

describe("selected create-work-item labels", () => {
  it("removes only the chosen label, retains a reachable chip and never submits", () => {
    const { onLabelsChange, onSubmit } = setup();
    const alpha = labelButton("Alpha");
    expect(alpha.tagName).toBe("BUTTON");
    expect(alpha.getAttribute("type")).toBe("button");
    expect(alpha.querySelector("button, a, input")).toBeNull();
    alpha.focus();
    expect(document.activeElement).toBe(alpha);

    fireEvent.click(alpha);

    expect(onLabelsChange).toHaveBeenCalledExactlyOnceWith(["label-b"]);
    expect(
      screen.queryByRole("button", {
        name: "common:modals.createTask.labels: Alpha",
      }),
    ).toBeNull();
    const beta = labelButton("Beta");
    beta.focus();
    expect(document.activeElement).toBe(beta);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each([
    { disabled: true, canUpdate: true },
    { disabled: false, canUpdate: false },
  ])("preserves the removal lock for %j", (authority) => {
    const { onLabelsChange, onSubmit } = setup(authority);
    const alpha = labelButton("Alpha");
    expect(alpha.hasAttribute("disabled")).toBe(true);

    fireEvent.click(alpha);

    expect(onLabelsChange).not.toHaveBeenCalled();
    expect(labelButton("Beta")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("honours a lock arriving while the selected chip is already rendered", () => {
    const { lock, onLabelsChange, onSubmit } = setup();
    expect(labelButton("Alpha").hasAttribute("disabled")).toBe(false);
    lock();
    const alpha = labelButton("Alpha");
    expect(alpha.hasAttribute("disabled")).toBe(true);

    fireEvent.click(alpha);

    expect(onLabelsChange).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
