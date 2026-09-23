import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "./select";

afterEach(() => {
  cleanup();
});

describe("Select", () => {
  it("does not render the popup options when closed", () => {
    render(
      <Select items={[{ value: "low", label: "Low" }]}>
        <SelectTrigger>
          <SelectValue placeholder="Pick a priority" />
        </SelectTrigger>
        <SelectPopup>
          <SelectItem value="low">Low</SelectItem>
        </SelectPopup>
      </Select>,
    );

    expect(screen.getByText("Pick a priority")).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Low" }),
    ).not.toBeInTheDocument();
  });

  it("opens on trigger click and calls onClick when an option is picked", () => {
    const onSelectHigh = vi.fn();
    render(
      <Select items={[{ value: "low", label: "Low" }]}>
        <SelectTrigger>
          <SelectValue placeholder="Pick a priority" />
        </SelectTrigger>
        <SelectPopup>
          <SelectItem value="low">Low</SelectItem>
          <SelectItem onClick={onSelectHigh} value="high">
            High
          </SelectItem>
        </SelectPopup>
      </Select>,
    );

    fireEvent.click(screen.getByRole("combobox"));
    const option = screen.getByRole("option", { name: "High" });
    expect(option).toBeInTheDocument();

    fireEvent.click(option);
    expect(onSelectHigh).toHaveBeenCalledTimes(1);
  });
});
