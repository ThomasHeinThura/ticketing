import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "./command";

afterEach(() => {
  cleanup();
});

describe("Command", () => {
  it("filters the visible items as the input value changes, and shows the empty state", () => {
    render(
      <Command items={["Apple", "Banana"]}>
        <CommandInput aria-label="Search" />
        <CommandList>
          {(item: string) => <CommandItem key={item}>{item}</CommandItem>}
        </CommandList>
        <CommandEmpty>No results</CommandEmpty>
      </Command>,
    );

    expect(screen.getByText("Apple")).toBeInTheDocument();
    expect(screen.getByText("Banana")).toBeInTheDocument();
    expect(screen.queryByText("No results")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "zzz" },
    });

    expect(screen.queryByText("Apple")).not.toBeInTheDocument();
    expect(screen.getByText("No results")).toBeInTheDocument();
  });

  it("calls onClick on the item when it is selected by pointer", () => {
    const onSelectBanana = vi.fn();
    render(
      <Command>
        <CommandInput aria-label="Search" />
        <CommandList>
          <CommandItem value="apple">Apple</CommandItem>
          <CommandItem onClick={onSelectBanana} value="banana">
            Banana
          </CommandItem>
        </CommandList>
      </Command>,
    );

    fireEvent.click(screen.getByText("Banana"));
    expect(onSelectBanana).toHaveBeenCalledTimes(1);
  });

  it("reports the item reached by keyboard highlight", () => {
    const onItemHighlighted = vi.fn();
    render(
      <Command
        items={["Projects", "Search"]}
        onItemHighlighted={onItemHighlighted}
      >
        <CommandInput aria-label="Search commands" autoFocus={false} />
        <CommandList>
          {(item: string) => (
            <CommandItem key={item} value={item}>
              {item}
            </CommandItem>
          )}
        </CommandList>
      </Command>,
    );

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });

    expect(onItemHighlighted).toHaveBeenLastCalledWith(
      "Search",
      expect.objectContaining({ reason: "keyboard" }),
    );
  });

  it("has no accessibility violations", async () => {
    const { baseElement } = render(
      <Command items={["Apple", "Banana"]}>
        <CommandInput aria-label="Search" />
        <CommandList>
          {(item: string) => <CommandItem key={item}>{item}</CommandItem>}
        </CommandList>
        <CommandEmpty>No results</CommandEmpty>
      </Command>,
    );

    await expectNoA11yViolations(baseElement);
  });

  it("keeps a command dialog mounted while closed without exposing it to assistive technology", () => {
    const { rerender } = render(
      <CommandDialog open={false}>
        <CommandDialogPopup keepMounted>
          <Command>
            <CommandInput aria-label="Search commands" autoFocus={false} />
            <CommandList>
              <CommandItem value="projects">Projects</CommandItem>
            </CommandList>
          </Command>
        </CommandDialogPopup>
      </CommandDialog>,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(document.activeElement).not.toBe(
      screen.getByLabelText("Search commands"),
    );

    rerender(
      <CommandDialog open>
        <CommandDialogPopup keepMounted>
          <Command>
            <CommandInput aria-label="Search commands" autoFocus={false} />
            <CommandList>
              <CommandItem value="projects">Projects</CommandItem>
            </CommandList>
          </Command>
        </CommandDialogPopup>
      </CommandDialog>,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      document.querySelector('[data-slot="command-dialog-backdrop"]'),
    ).toHaveClass("backdrop-blur-sm");
  });

  it("preserves the dim backdrop when full-screen blur is disabled", () => {
    render(
      <CommandDialog open>
        <CommandDialogPopup blurBackdrop={false}>
          <Command>
            <CommandInput aria-label="Search commands" autoFocus={false} />
            <CommandList>
              <CommandItem value="projects">Projects</CommandItem>
            </CommandList>
          </Command>
        </CommandDialogPopup>
      </CommandDialog>,
    );

    const backdrop = document.querySelector(
      '[data-slot="command-dialog-backdrop"]',
    );
    expect(backdrop).toHaveClass("bg-black/32", "backdrop-blur-none");
    expect(backdrop).not.toHaveClass("backdrop-blur-sm");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
