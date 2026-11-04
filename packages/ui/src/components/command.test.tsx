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

    fireEvent.change(screen.getByRole("combobox", { name: "Search" }), {
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
      screen.getByRole("combobox", { name: "Search commands", hidden: true }),
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

  // UAT re-audit: the command palette was an unnamed `role="dialog"` (axe aria-dialog-name) with
  // an unnamed listbox (axe aria-input-field-name). With no name of their own, both take the
  // input's label, and a name the caller passes still wins.
  it.each([
    ["aria-label", { "aria-label": "Search commands" }],
    ["placeholder", { placeholder: "Search commands" }],
  ])(
    "names the dialog and its list from the input's %s",
    async (_, inputProps) => {
      const { baseElement } = render(
        <CommandDialog open>
          <CommandDialogPopup>
            <Command items={["Projects", "Search"]}>
              <CommandInput autoFocus={false} {...inputProps} />
              <CommandList>
                {(item: string) => (
                  <CommandItem key={item} value={item}>
                    {item}
                  </CommandItem>
                )}
              </CommandList>
            </Command>
          </CommandDialogPopup>
        </CommandDialog>,
      );

      expect(
        await screen.findByRole("dialog", { name: "Search commands" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("listbox", { name: "Search commands" }),
      ).toBeInTheDocument();
      await expectNoA11yViolations(baseElement);
    },
  );

  it("names a list outside a dialog from its input", () => {
    render(
      <Command items={["Apple", "Banana"]}>
        <CommandInput aria-label="Search fruit" autoFocus={false} />
        <CommandList>
          {(item: string) => <CommandItem key={item}>{item}</CommandItem>}
        </CommandList>
      </Command>,
    );

    expect(
      screen.getByRole("listbox", { name: "Search fruit" }),
    ).toBeInTheDocument();
  });

  it("keeps the names a caller gives the dialog and the list", async () => {
    render(
      <CommandDialog open>
        <CommandDialogPopup aria-label="Command palette">
          <Command items={["Projects"]}>
            <CommandInput aria-label="Search commands" autoFocus={false} />
            <CommandList aria-label="Commands">
              {(item: string) => (
                <CommandItem key={item} value={item}>
                  {item}
                </CommandItem>
              )}
            </CommandList>
          </Command>
        </CommandDialogPopup>
      </CommandDialog>,
    );

    expect(
      await screen.findByRole("dialog", { name: "Command palette" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("listbox", { name: "Commands" }),
    ).toBeInTheDocument();
  });

  it("keeps the dialog named by its own input when a nested command has another", async () => {
    render(
      <CommandDialog open>
        <CommandDialogPopup>
          <Command items={["Projects"]}>
            <CommandInput autoFocus={false} placeholder="Search commands" />
            <CommandList>
              {(item: string) => (
                <CommandItem key={item} value={item}>
                  {item}
                </CommandItem>
              )}
            </CommandList>
            <Command items={["Low"]}>
              <CommandInput autoFocus={false} placeholder="Filter priority" />
              <CommandList>
                {(item: string) => (
                  <CommandItem key={item} value={item}>
                    {item}
                  </CommandItem>
                )}
              </CommandList>
            </Command>
          </Command>
        </CommandDialogPopup>
      </CommandDialog>,
    );

    expect(
      await screen.findByRole("dialog", { name: "Search commands" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("listbox", { name: "Filter priority" }),
    ).toBeInTheDocument();
  });

  it("names a kept-mounted dialog on its first open", async () => {
    const tree = (open: boolean) => (
      <CommandDialog open={open}>
        <CommandDialogPopup keepMounted>
          <Command items={["Projects"]}>
            <CommandInput autoFocus={false} placeholder="Search commands" />
            <CommandList>
              {(item: string) => (
                <CommandItem key={item} value={item}>
                  {item}
                </CommandItem>
              )}
            </CommandList>
          </Command>
        </CommandDialogPopup>
      </CommandDialog>
    );
    const { baseElement, rerender } = render(tree(false));
    rerender(tree(true));

    expect(
      await screen.findByRole("dialog", { name: "Search commands" }),
    ).toBeInTheDocument();
    await expectNoA11yViolations(baseElement);
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
