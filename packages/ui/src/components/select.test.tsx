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

  it("GM observability: duplicate Select labels resolve without aria-controls", () => {
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
    const getOpenOption = (trigger: HTMLElement) => {
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      const listboxes = screen.getAllByRole("listbox");
      expect(listboxes).toHaveLength(1);
      const listbox = listboxes[0];
      if (!listbox) {
        throw new Error("Opened select has no accessible listbox");
      }
      const listboxId = trigger.getAttribute("aria-controls");
      if (listboxId !== null) {
        expect(document.getElementById(listboxId)).toBe(listbox);
      }
      return within(listbox).getByRole("option", { name: "debug" });
    };

    fireEvent.click(firstTrigger);
    firstTrigger.removeAttribute("aria-controls");
    expect(firstTrigger).not.toHaveAttribute("aria-controls");
    expect(screen.getAllByRole("option", { name: "debug" })).toHaveLength(1);

    fireEvent.click(getOpenOption(firstTrigger));
    expect(onFirstDebug).toHaveBeenCalledTimes(1);
    expect(onSecondDebug).not.toHaveBeenCalled();
    expect(firstTrigger).toHaveTextContent("error");
    expect(secondTrigger).toHaveTextContent("error");
    expect(secondTrigger).toHaveAttribute("aria-expanded", "false");
  });
});
