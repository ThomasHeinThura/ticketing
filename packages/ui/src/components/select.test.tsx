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

    it("names the listbox from the trigger's aria-labelledby", async () => {
      render(
        <div>
          <span id="region-label">Region label</span>
          <label htmlFor="region">Ignored native label</label>
          <Select items={items}>
            <SelectTrigger aria-labelledby="region-label" id="region">
              <SelectValue placeholder="Pick" />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="low">Low</SelectItem>
            </SelectPopup>
          </Select>
        </div>,
      );

      fireEvent.click(screen.getByRole("combobox", { name: "Region label" }));
      const listbox = await screen.findByRole("listbox", {
        name: "Region label",
      });
      expect(listbox).toHaveAttribute("aria-labelledby", "region-label");
    });

    it("names an open listbox after its own trigger when aria-controls is not yet paired and another Select is on the page", async () => {
      render(
        <div>
          <Select items={items}>
            <SelectTrigger aria-label="First field">
              <SelectValue placeholder="Pick" />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="low">Low</SelectItem>
            </SelectPopup>
          </Select>
          <Select items={items}>
            <SelectTrigger
              aria-controls="not-the-list"
              aria-label="Second field"
            >
              <SelectValue placeholder="Pick" />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="high">High</SelectItem>
            </SelectPopup>
          </Select>
        </div>,
      );

      fireEvent.click(screen.getByRole("combobox", { name: "Second field" }));
      expect(
        await screen.findByRole("listbox", { name: "Second field" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("listbox", { name: "First field" }),
      ).not.toBeInTheDocument();
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
