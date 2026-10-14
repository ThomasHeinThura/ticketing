import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
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

  describe("open popup accessibility", () => {
    const items = [
      { value: "low", label: "Low" },
      { value: "high", label: "High" },
    ];

    afterEach(() => {
      document.documentElement.classList.remove("dark");
    });

    it("names the listbox from the trigger's <label for>", async () => {
      render(
        <div>
          <label htmlFor="priority">Priority</label>
          <Select items={items}>
            <SelectTrigger id="priority">
              <SelectValue placeholder="Pick a priority" />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectPopup>
          </Select>
        </div>,
      );

      fireEvent.click(screen.getByRole("combobox", { name: "Priority" }));
      expect(
        await screen.findByRole("listbox", { name: "Priority" }),
      ).toBeInTheDocument();
    });

    it("names the listbox from the trigger's aria-label", async () => {
      render(
        <Select items={items}>
          <SelectTrigger aria-label="Severity">
            <SelectValue placeholder="Pick" />
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="low">Low</SelectItem>
          </SelectPopup>
        </Select>,
      );

      fireEvent.click(screen.getByRole("combobox", { name: "Severity" }));
      expect(
        await screen.findByRole("listbox", { name: "Severity" }),
      ).toBeInTheDocument();
    });

    it("lets a consumer name the listbox explicitly", async () => {
      render(
        <Select items={items}>
          <SelectTrigger aria-label="Severity">
            <SelectValue placeholder="Pick" />
          </SelectTrigger>
          <SelectPopup aria-label="Severity choices">
            <SelectItem value="low">Low</SelectItem>
          </SelectPopup>
        </Select>,
      );

      fireEvent.click(screen.getByRole("combobox"));
      expect(
        await screen.findByRole("listbox", { name: "Severity choices" }),
      ).toBeInTheDocument();
    });

    it.each(["light", "dark"] as const)(
      "has no axe violations while open (%s)",
      async (scheme) => {
        document.documentElement.classList.toggle("dark", scheme === "dark");
        const { baseElement } = render(
          <div>
            <button type="button">Before</button>
            <label htmlFor="priority">Priority</label>
            <Select items={items}>
              <SelectTrigger id="priority">
                <SelectValue placeholder="Pick a priority" />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectPopup>
            </Select>
          </div>,
        );

        fireEvent.click(screen.getByRole("combobox", { name: "Priority" }));
        await screen.findByRole("listbox", { name: "Priority" });
        await expectNoA11yViolations(baseElement);
      },
    );
  });
});
