import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Command,
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
});
