import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseWorkItemFilterText } from "@/lib/work-item-filter";
import WorkItemFilterEditor from "./work-item-filter-editor";

function pickOption(option: HTMLElement) {
  fireEvent.pointerDown(option);
  fireEvent.pointerUp(option);
  fireEvent.click(option);
}

function StatefulEditor({
  filter,
  onApply,
}: {
  filter: string;
  onApply: (filter: string) => void;
}) {
  const [mode, setMode] = useState<"visual" | "text">("visual");
  return (
    <WorkItemFilterEditor
      filter={filter}
      mode={mode}
      onApply={onApply}
      onModeChange={setMode}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("work-item filter editor", () => {
  it("SV-11: switches nested @me and relative-date filters losslessly between visual and text modes", async () => {
    const onApply = vi.fn();
    render(
      <StatefulEditor filter="assignee:@me AND due:>=7d" onApply={onApply} />,
    );

    expect(await screen.findByLabelText("Value for Assignee")).toHaveValue(
      "@me",
    );
    expect(screen.getByLabelText("Value for Due date")).toHaveValue("7d");
    fireEvent.click(screen.getByRole("button", { name: "Text" }));
    expect(screen.getByLabelText("Filter work items")).toHaveValue(
      "AND(assignee:@me,due:>=7d)",
    );
    expect(
      parseWorkItemFilterText(
        screen.getByLabelText("Filter work items").getAttribute("value") ?? "",
      ),
    ).toEqual(parseWorkItemFilterText("assignee:@me AND due:>=7d"));
  });

  it("SV-11: adds a nested OR group and submits the matching AST", async () => {
    const onApply = vi.fn();
    render(
      <WorkItemFilterEditor
        filter=""
        mode="visual"
        onApply={onApply}
        onModeChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Add condition/ }));
    const groupsBefore = screen.getAllByTestId("filter-group");
    const rootGroup = groupsBefore.at(0);
    expect(rootGroup).toBeDefined();
    if (!rootGroup) throw new Error("Expected the root filter group.");
    fireEvent.click(
      within(rootGroup).getByRole("button", { name: /Add group/ }),
    );
    const groups = screen.getAllByTestId("filter-group");
    expect(groups).toHaveLength(2);
    const nestedGroup = groups.at(1);
    expect(nestedGroup).toBeDefined();
    if (!nestedGroup) throw new Error("Expected the nested filter group.");

    fireEvent.click(
      within(nestedGroup).getByRole("button", { name: /Add condition/ }),
    );
    const currentNestedGroup = screen.getAllByTestId("filter-group").at(1);
    expect(currentNestedGroup).toBeDefined();
    if (!currentNestedGroup)
      throw new Error("Expected the current nested filter group.");
    fireEvent.click(
      within(currentNestedGroup).getByRole("combobox", {
        name: "Group operator",
      }),
    );
    pickOption(await screen.findByRole("option", { name: "any (OR)" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply filter" }));

    const applied = parseWorkItemFilterText(
      onApply.mock.calls[0]?.[0] as string,
    );
    expect(applied).toEqual({
      op: "and",
      clauses: [
        { field: "state.group", op: "eq", value: "started" },
        {
          op: "or",
          clauses: [
            { field: "state.group", op: "eq", value: "started" },
            { field: "state.group", op: "eq", value: "started" },
          ],
        },
      ],
    });
  });

  it("limits enum in-values to the field's supported choices", async () => {
    const onApply = vi.fn();
    render(
      <WorkItemFilterEditor
        filter="state:started"
        mode="visual"
        onApply={onApply}
        onModeChange={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("combobox", { name: "Operator for State group" }),
    );
    pickOption(await screen.findByRole("option", { name: "is one of" }));
    expect(screen.getByRole("checkbox", { name: "started" })).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "completed" }),
    ).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "completed" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply filter" }));

    expect(
      parseWorkItemFilterText(onApply.mock.calls[0]?.[0] as string),
    ).toEqual({
      field: "state.group",
      op: "in",
      value: ["started", "completed"],
    });
  });

  it("switches a single-leaf filter without inventing a group", () => {
    const onApply = vi.fn();
    render(<StatefulEditor filter="assignee:@me" onApply={onApply} />);

    fireEvent.click(screen.getByRole("button", { name: "Text" }));
    expect(screen.getByLabelText("Filter work items")).toHaveValue(
      "assignee:@me",
    );
    fireEvent.click(screen.getByRole("button", { name: "Visual" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply filter" }));
    expect(onApply).toHaveBeenCalledWith("assignee:@me");
  });

  it("keeps invalid text in text mode and explains why it cannot switch or apply", () => {
    const onApply = vi.fn();
    const onModeChange = vi.fn();
    render(
      <WorkItemFilterEditor
        filter=""
        mode="text"
        onApply={onApply}
        onModeChange={onModeChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Filter work items"), {
      target: { value: "assignee:@me AND" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Visual" }));
    expect(onModeChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Expected a filter term",
    );

    fireEvent.click(screen.getByRole("button", { name: "Apply filter" }));
    expect(onApply).not.toHaveBeenCalled();
  });

  it.each([
    ["403", "Access denied"],
    ["422", "Filter field unavailable: label"],
  ])(
    "shows the API's %s filter error without hiding the query",
    (status, message) => {
      render(
        <WorkItemFilterEditor
          filter="label:urgent"
          mode="text"
          apiError={`${status}: ${message}`}
          onApply={vi.fn()}
          onModeChange={vi.fn()}
        />,
      );
      expect(screen.getByTestId("work-item-search-error")).toHaveTextContent(
        `${status}: ${message}`,
      );
      expect(screen.getByLabelText("Filter work items")).toHaveValue(
        "label:urgent",
      );
    },
  );

  it("keeps an unavailable recognized field visible and removable in visual mode", async () => {
    const onApply = vi.fn();
    render(
      <WorkItemFilterEditor
        filter="label:urgent"
        mode="visual"
        onApply={onApply}
        onModeChange={vi.fn()}
      />,
    );
    const unavailable = await screen.findByTestId("filter-unavailable-field");
    expect(unavailable).toHaveTextContent("Unavailable in P1");
    fireEvent.click(
      within(unavailable).getByRole("button", { name: "Remove label filter" }),
    );
    expect(screen.getByText("No filters are active.")).toBeInTheDocument();
  });
});
