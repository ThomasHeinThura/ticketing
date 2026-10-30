import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import { TimeField } from "./time-field";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
afterEach(cleanup);

async function chooseTime(name: "Hour" | "Minute", value: string) {
  const trigger = screen.getByRole("combobox", { name });
  trigger.focus();
  fireEvent.click(trigger);
  await waitFor(() =>
    expect(document.activeElement).toHaveAttribute("role", "option"),
  );
  const option = screen.getByRole("option", { name: value });
  fireEvent.pointerDown(option, {
    pointerType: "mouse",
    button: 0,
    buttons: 1,
  });
  fireEvent.mouseDown(option, { button: 0, buttons: 1 });
  option.focus();
  fireEvent.pointerUp(option, { pointerType: "mouse", button: 0 });
  fireEvent.mouseUp(option, { button: 0 });
  fireEvent.click(option, { button: 0, detail: 1 });
  await waitFor(() => expect(trigger).toHaveFocus());
}

describe("calendar-local time field", () => {
  it.each([
    { value: 540, hour: "23", minute: "59", next: 1439 },
    { value: 1439, hour: "00", minute: "00", next: 0 },
  ])(
    "commits exact minutes $next only on save",
    async ({ value, hour, minute, next }) => {
      const onChange = vi.fn();
      const { container } = render(
        <TimeField
          id="start"
          label="Starts"
          value={value}
          onChange={onChange}
        />,
      );
      const trigger = screen.getByRole("button", { name: "Starts" });
      trigger.focus();
      fireEvent.click(trigger);
      await waitFor(() =>
        expect(screen.getByRole("combobox", { name: "Hour" })).toHaveFocus(),
      );
      await chooseTime("Hour", hour);
      await chooseTime("Minute", minute);
      expect(onChange).not.toHaveBeenCalled();
      expect(container.querySelector('input[type="time"]')).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(onChange).toHaveBeenCalledExactlyOnceWith(next);
    },
  );

  it("cancels on Escape with focus restored, and closes a stale or disabled popup", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <TimeField id="start" label="Starts" value={540} onChange={onChange} />,
    );
    const trigger = screen.getByRole("button", { name: "Starts" });
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Hour" })).toHaveFocus(),
    );
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Starts" }), {
      key: "Escape",
      code: "Escape",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
    fireEvent.click(trigger);
    rerender(
      <TimeField id="start" label="Starts" value={600} onChange={onChange} />,
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(trigger);
    rerender(
      <TimeField
        id="start"
        label="Starts"
        value={600}
        onChange={onChange}
        disabled
      />,
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toBeDisabled();
    rerender(
      <TimeField id="start" label="Starts" value={600} onChange={onChange} />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
