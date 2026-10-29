import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import { DateTimePicker } from "./date-time-picker";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, options),
  }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

function setup(value: string | null = "2026-10-30T18:45:27.123Z") {
  const onChange = vi.fn();
  const props = { id: "review-at", label: "Review at", value, onChange };
  return { ...render(<DateTimePicker {...props} />), props, onChange };
}

function chooseTime(name: "Hour" | "Minute", value: string) {
  fireEvent.click(screen.getByRole("combobox", { name }));
  const option = screen.getByRole("option", { name: value });
  fireEvent.pointerDown(option, { pointerType: "mouse", button: 0 });
  fireEvent.click(option);
  expect(screen.getByRole("combobox", { name })).toHaveTextContent(value);
}

describe("DateTimePicker", () => {
  it("uses library controls and keeps seconds when an unchanged minute is saved", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Review at" }));
    expect(screen.getByRole("grid")).toBeInTheDocument();
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull();
    expect(document.querySelector("select")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("converts a complete browser-local choice to UTC only on Save", () => {
    vi.stubEnv("TZ", "Asia/Yangon");
    const { onChange } = setup("2026-10-30T03:15:00.000Z");
    fireEvent.click(screen.getByRole("button", { name: "Review at" }));
    chooseTime("Hour", "18");
    chooseTime("Minute", "42");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(
      "2026-10-30T12:12:00.000Z",
    );
  });

  it("uses the offset of the selected date across a daylight-saving boundary", () => {
    vi.stubEnv("TZ", "America/New_York");
    const { onChange } = setup("2026-11-01T05:30:00.000Z");
    fireEvent.click(screen.getByRole("button", { name: "Review at" }));
    chooseTime("Hour", "02");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(
      "2026-11-01T07:30:00.000Z",
    );
  });

  it("keeps the second occurrence when editing within a repeated hour", () => {
    vi.stubEnv("TZ", "America/New_York");
    const { onChange } = setup("2026-11-01T06:30:00.000Z");
    fireEvent.click(screen.getByRole("button", { name: "Review at" }));
    chooseTime("Minute", "45");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(
      "2026-11-01T06:45:00.000Z",
    );
  });

  it("rejects a nonexistent clock-forward time and accepts a corrected choice", () => {
    vi.stubEnv("TZ", "America/New_York");
    const { onChange } = setup("2026-03-08T06:30:00.000Z");
    fireEvent.click(screen.getByRole("button", { name: "Review at" }));
    chooseTime("Hour", "02");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("This time is skipped");
    chooseTime("Hour", "03");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(
      "2026-03-08T07:30:00.000Z",
    );
  });

  it("discards draft time choices on Cancel", async () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Review at" }));
    chooseTime("Minute", "12");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("grid")).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("cancels on Escape and returns focus to the original trigger", async () => {
    const { onChange } = setup();
    const trigger = screen.getByRole("button", { name: "Review at" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Hour" }), {
      key: "Escape",
    });
    await waitFor(() => expect(screen.queryByRole("grid")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clears an existing value with one complete change", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Review at" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("requires a date before saving an empty value", () => {
    const { onChange } = setup(null);
    fireEvent.click(screen.getByRole("button", { name: "Review at" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not open a disabled control", () => {
    render(
      <DateTimePicker
        id="locked"
        label="Locked"
        value={null}
        onChange={vi.fn()}
        disabled
      />,
    );
    const trigger = screen.getByRole("button", { name: "Locked" });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByRole("grid")).toBeNull();
  });

  it("discards an open draft if the server value changes", async () => {
    const { props, onChange, rerender } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Review at" }));
    chooseTime("Minute", "12");
    rerender(<DateTimePicker {...props} value="2026-11-02T12:00:00.000Z" />);
    await waitFor(() => expect(screen.queryByRole("grid")).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Review at" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("closes an old draft when its target changes or edit permission disappears", async () => {
    const { props, onChange, rerender } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Review at" }));
    rerender(<DateTimePicker {...props} id="another-field" />);
    await waitFor(() => expect(screen.queryByRole("grid")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Review at" }));
    rerender(<DateTimePicker {...props} id="another-field" disabled />);
    await waitFor(() => expect(screen.queryByRole("grid")).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
  });
});
