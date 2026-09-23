import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Autocomplete,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
} from "./autocomplete";

afterEach(() => {
  cleanup();
});

describe("Autocomplete", () => {
  it("filters the visible items as the input value changes", () => {
    render(
      <Autocomplete inline items={["Apple", "Banana", "Cherry"]} open>
        <AutocompleteInput aria-label="Search fruit" />
        <AutocompleteList>
          {(item: string) => (
            <AutocompleteItem key={item}>{item}</AutocompleteItem>
          )}
        </AutocompleteList>
      </Autocomplete>,
    );

    expect(screen.getByText("Apple")).toBeInTheDocument();
    expect(screen.getByText("Banana")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search fruit"), {
      target: { value: "Ban" },
    });

    expect(screen.queryByText("Apple")).not.toBeInTheDocument();
    expect(screen.getByText("Banana")).toBeInTheDocument();
  });

  it("calls onClick on the item when it is selected by pointer", () => {
    const onSelectBanana = vi.fn();
    render(
      <Autocomplete inline open>
        <AutocompleteInput aria-label="Search fruit" />
        <AutocompleteList>
          <AutocompleteItem value="apple">Apple</AutocompleteItem>
          <AutocompleteItem onClick={onSelectBanana} value="banana">
            Banana
          </AutocompleteItem>
        </AutocompleteList>
      </Autocomplete>,
    );

    fireEvent.click(screen.getByText("Banana"));
    expect(onSelectBanana).toHaveBeenCalledTimes(1);
  });
});
