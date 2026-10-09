import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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

  it("GM observability: duplicate Select labels stay scoped to the opened listbox", () => {
    const onFirstDebug = vi.fn();
    const onSecondDebug = vi.fn();
    render(
      <>
        <Select defaultValue="error">
          <SelectTrigger aria-label="First level">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="error">error</SelectItem>
            <SelectItem onClick={onFirstDebug} value="debug">
              debug
            </SelectItem>
          </SelectPopup>
        </Select>
        <Select defaultValue="error">
          <SelectTrigger aria-label="Second level">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="error">error</SelectItem>
            <SelectItem onClick={onSecondDebug} value="debug">
              debug
            </SelectItem>
          </SelectPopup>
        </Select>
      </>,
    );

    const firstTrigger = screen.getByRole("combobox", { name: "First level" });
    const secondTrigger = screen.getByRole("combobox", {
      name: "Second level",
    });

    fireEvent.click(firstTrigger);
    const firstListboxId = firstTrigger.getAttribute("aria-controls");
    expect(firstListboxId).not.toBeNull();
    if (firstListboxId === null) {
      throw new Error("Opened first select has no controlled listbox");
    }
    const firstListbox = document.getElementById(firstListboxId);
    expect(firstListbox).toHaveAttribute("role", "listbox");
    if (!(firstListbox instanceof HTMLElement)) {
      throw new Error("First select's controlled listbox is missing");
    }

    fireEvent.click(
      within(firstListbox).getByRole("option", { name: "debug" }),
    );
    expect(onFirstDebug).toHaveBeenCalledTimes(1);
    expect(onSecondDebug).not.toHaveBeenCalled();
    expect(firstTrigger).toHaveTextContent("error");
    expect(secondTrigger).toHaveTextContent("error");

    fireEvent.click(secondTrigger);
    const secondListboxId = secondTrigger.getAttribute("aria-controls");
    expect(secondListboxId).not.toBeNull();
    if (secondListboxId === null) {
      throw new Error("Opened second select has no controlled listbox");
    }
    const secondListbox = document.getElementById(secondListboxId);
    expect(secondListbox).toHaveAttribute("role", "listbox");
    if (!(secondListbox instanceof HTMLElement)) {
      throw new Error("Second select's controlled listbox is missing");
    }

    fireEvent.click(
      within(secondListbox).getByRole("option", { name: "debug" }),
    );
    expect(onSecondDebug).toHaveBeenCalledTimes(1);
    expect(firstTrigger).toHaveTextContent("error");
    expect(secondTrigger).toHaveTextContent("error");
  });
});
