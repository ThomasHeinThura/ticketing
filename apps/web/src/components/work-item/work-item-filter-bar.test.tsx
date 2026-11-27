import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import WorkItemFilterBar from "./work-item-filter-bar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, options),
  }),
}));

vi.mock("@/components/work-item/work-item-filter-editor", () => ({
  default: () => <div data-testid="filter-editor" />,
}));

afterEach(() => {
  cleanup();
});

function renderBar(filter: string) {
  const onApply = vi.fn();
  render(
    <WorkItemFilterBar
      filter={filter}
      mode="visual"
      onModeChange={vi.fn()}
      onApply={onApply}
    />,
  );
  return onApply;
}

describe("WorkItemFilterBar (SV-11 chips)", () => {
  it("shows one chip per condition and never rewrites untouched text", () => {
    const onApply = renderBar("priority:in(high,urgent) assignee:@me");
    const chips = screen.getAllByTestId("work-item-filter-chip");
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "Priority: high, urgent",
      "Assignee: @me",
    ]);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("applies a picked value live and keeps the other chips", async () => {
    const onApply = renderBar("priority:high state:started");
    fireEvent.click(
      screen.getAllByTestId("work-item-filter-chip")[0] as HTMLElement,
    );
    fireEvent.click(await screen.findByRole("option", { name: "urgent" }));
    expect(onApply).toHaveBeenCalledWith(
      "AND(priority:in(high,urgent),state:started)",
    );
  });

  it("removes a chip and clears the filter with the last one", () => {
    const onApply = renderBar("priority:high state:started");
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Priority filter" }),
    );
    expect(onApply).toHaveBeenCalledWith("state:started");
    cleanup();
    const last = renderBar("priority:high");
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Priority filter" }),
    );
    expect(last).toHaveBeenCalledWith("");
  });

  it("adds a field from the + Filter list and applies Me at once", async () => {
    const onApply = renderBar("priority:high");
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(await screen.findByRole("option", { name: "Assignee" }));
    expect(onApply).toHaveBeenCalledWith("AND(priority:high,assignee:@me)");
  });

  it("adds a valued field as a pending chip that applies with its first value and stays open", async () => {
    const onApply = renderBar("");
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(await screen.findByRole("option", { name: "Priority" }));
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("option", { name: "high" }));
    expect(onApply).toHaveBeenCalledWith("priority:high");
  });

  it("shows a filter it cannot chip as one Advanced filter chip that opens the editor", async () => {
    const onApply = renderBar("priority:high OR state:started");
    expect(screen.queryByRole("button", { name: "Filter" })).toBeNull();
    const chip = screen.getByTestId("work-item-filter-chip");
    expect(chip).toHaveTextContent("Advanced filter");
    fireEvent.click(chip);
    expect(await screen.findByTestId("filter-editor")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Advanced filter filter" }),
    );
    expect(onApply).toHaveBeenCalledWith("");
  });

  it("opens the Advanced editor from the Advanced button", async () => {
    renderBar("");
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    expect(await screen.findByTestId("filter-editor")).toBeInTheDocument();
  });
});
