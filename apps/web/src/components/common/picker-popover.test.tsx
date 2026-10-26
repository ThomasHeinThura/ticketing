import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import { PickerPopover } from "./picker-popover";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, options),
  }),
}));

afterEach(cleanup);

const options = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    value: `v${index}`,
    label: `Option ${index}`,
  }));

describe("PickerPopover", () => {
  it("renders a plain option list for up to 8 options and selects one", () => {
    const onChange = vi.fn();
    render(
      <PickerPopover
        value="v1"
        options={options(8)}
        onChange={onChange}
        ariaLabel="Pick"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pick" }));
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Option 3" }));
    expect(onChange).toHaveBeenCalledWith("v3");
  });

  it("switches to a searchable list above 8 options, filters, and selects", async () => {
    const onChange = vi.fn();
    render(
      <PickerPopover
        value="v1"
        options={options(12)}
        onChange={onChange}
        ariaLabel="Pick"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pick" }));
    const search = await screen.findByRole("combobox", {
      name: "Search options",
    });
    fireEvent.change(search, { target: { value: "Option 11" } });
    expect(screen.queryByText("Option 2")).toBeNull();
    fireEvent.click(screen.getByText("Option 11"));
    expect(onChange).toHaveBeenCalledWith("v11");
  });

  it("shows the empty state when nothing matches", async () => {
    render(
      <PickerPopover
        value={undefined}
        options={options(12)}
        onChange={vi.fn()}
        ariaLabel="Pick"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pick" }));
    fireEvent.change(
      await screen.findByRole("combobox", { name: "Search options" }),
      {
        target: { value: "zzz" },
      },
    );
    expect(screen.getByText("No matching options")).toBeInTheDocument();
  });
});
