import { Button } from "@taskdesk/ui";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PropertyRadioMenu } from "./property-radio-menu";

afterEach(cleanup);

function Picker({ onChange }: { onChange: (value: string) => void }) {
  const [value, setValue] = useState("medium");
  return (
    <PropertyRadioMenu
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onChange(next);
      }}
      options={["low", "medium", "high"].map((option) => ({
        value: option,
        label: option,
        content: <span>{option}</span>,
      }))}
      trigger={
        <Button data-testid="priority-trigger" aria-label="Priority">
          {value}
        </Button>
      }
    />
  );
}

describe("PropertyRadioMenu", () => {
  it("exposes the options as a radio menu with the current one checked", async () => {
    render(<Picker onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("priority-trigger"));
    const menu = await screen.findByRole("menu", { name: "Priority" });
    expect(menu).toBeVisible();
    const options = screen.getAllByRole("menuitemradio");
    expect(options.map((option) => option.getAttribute("aria-label"))).toEqual([
      "low",
      "medium",
      "high",
    ]);
    expect(
      screen.getByRole("menuitemradio", { name: "medium" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "low" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("moves through the options with the arrow keys, selects with Enter and returns focus", async () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    const trigger = screen.getByTestId("priority-trigger");
    trigger.focus();
    // APG menu button: ArrowDown on the trigger opens the menu on the first option.
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const low = await screen.findByRole("menuitemradio", { name: "low" });
    await waitFor(() => expect(low).toHaveFocus());
    fireEvent.keyDown(low, { key: "ArrowDown" });
    const medium = screen.getByRole("menuitemradio", { name: "medium" });
    await waitFor(() => expect(medium).toHaveFocus());
    fireEvent.keyDown(medium, { key: "ArrowDown" });
    const high = screen.getByRole("menuitemradio", { name: "high" });
    await waitFor(() => expect(high).toHaveFocus());
    await act(async () => {
      fireEvent.keyDown(high, { key: "Enter" });
      fireEvent.click(high);
    });
    expect(onChange).toHaveBeenCalledWith("high");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveTextContent("high");
  });
});
