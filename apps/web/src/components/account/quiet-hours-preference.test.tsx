import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  invalidate: vi.fn(),
  quietHours: null as { start: string; end: string; timezone: string } | null,
  pending: false,
}));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: (namespace = "common") => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key.includes(":") ? key : `${namespace}:${key}`, options),
  }),
}));
vi.mock(
  "@/hooks/queries/notification-preferences/use-get-notification-preferences",
  () => ({
    default: () => ({
      isLoading: false,
      isError: false,
      data: { quietHours: mocks.quietHours },
    }),
  }),
);
vi.mock("@/fetchers/notification-preferences/quiet-hours", () => ({
  saveQuietHours: (value: unknown) => mocks.save(value),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
  useMutation: ({
    mutationFn,
    onSuccess,
  }: {
    mutationFn: (value: unknown) => Promise<unknown>;
    onSuccess: (data: unknown, variables: unknown) => Promise<void>;
  }) => ({
    isPending: mocks.pending,
    isError: false,
    mutate: (value: unknown) =>
      void mutationFn(value).then((data) => onSuccess(data, value)),
  }),
}));

import { QuietHoursPreference } from "./quiet-hours-preference";

async function chooseTime(label: "From" | "Until", value: string) {
  fireEvent.click(screen.getByRole("button", { name: label }));
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "Hour" })).toHaveFocus(),
  );
  for (const [name, part] of [
    ["Hour", value.slice(0, 2)],
    ["Minute", value.slice(3)],
  ]) {
    const trigger = screen.getByRole("combobox", { name });
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute("role", "option"),
    );
    const option = within(screen.getByRole("listbox", { name })).getByRole(
      "option",
      { name: part },
    );
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
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: label })).toBeNull(),
  );
  expect(screen.getByRole("button", { name: label })).toHaveTextContent(value);
}

afterEach(cleanup);
beforeEach(() => {
  mocks.save.mockReset().mockResolvedValue({});
  mocks.invalidate.mockReset().mockResolvedValue(undefined);
  mocks.quietHours = null;
  mocks.pending = false;
});

describe("quiet hours preference", () => {
  it("does not save on open and needs an explicit save", async () => {
    const { container } = render(<QuietHoursPreference />);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(container.querySelector('input[type="time"]')).toBeNull();
    await chooseTime("From", "21:30");
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save quiet hours" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    const saved = mocks.save.mock.calls[0]?.[0] as {
      start: string;
      end: string;
      timezone: string;
    };
    expect(saved.start).toBe("21:30");
    expect(saved.end).toBe("07:00");
    expect(saved.timezone.length).toBeGreaterThan(0);
  });

  it("refuses identical start and end times without calling the server", async () => {
    mocks.quietHours = { start: "22:00", end: "07:00", timezone: "UTC" };
    render(<QuietHoursPreference />);
    await chooseTime("Until", "22:00");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter two different times.",
    );
    expect(
      screen.getByRole("button", { name: "Save quiet hours" }),
    ).toBeDisabled();
    const form = screen
      .getByRole("button", { name: "Save quiet hours" })
      .closest("form");
    if (!form) throw new Error("Quiet hours form missing");
    fireEvent.submit(form);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("turns quiet hours off with null", async () => {
    mocks.quietHours = { start: "22:00", end: "07:00", timezone: "UTC" };
    render(<QuietHoursPreference />);
    fireEvent.click(
      screen.getByRole("button", { name: "Turn off quiet hours" }),
    );
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(null));
  });

  it("preserves the local minute boundaries of an overnight window", async () => {
    mocks.quietHours = { start: "22:00", end: "07:00", timezone: "UTC" };
    render(<QuietHoursPreference />);
    await chooseTime("From", "23:59");
    await chooseTime("Until", "00:00");
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save quiet hours" }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledExactlyOnceWith({
        start: "23:59",
        end: "00:00",
        timezone: "UTC",
      }),
    );
  });

  it("shows an invalid stored time until the person explicitly replaces it", async () => {
    mocks.quietHours = { start: "25:00", end: "07:00", timezone: "UTC" };
    render(<QuietHoursPreference />);
    const start = screen.getByRole("button", { name: "From" });
    expect(start).toHaveTextContent("25:00");
    expect(start).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByRole("button", { name: "Save quiet hours" }),
    ).toBeDisabled();
    await chooseTime("From", "00:00");
    expect(start).not.toHaveAttribute("aria-invalid");
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save quiet hours" }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledExactlyOnceWith({
        start: "00:00",
        end: "07:00",
        timezone: "UTC",
      }),
    );
  });

  it("disables every portaled control and rejects submit while saving", () => {
    mocks.quietHours = { start: "22:00", end: "07:00", timezone: "UTC" };
    mocks.pending = true;
    render(<QuietHoursPreference />);
    for (const label of [
      "From",
      "Until",
      "Save quiet hours",
      "Turn off quiet hours",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeDisabled();
    }
    expect(screen.getByRole("combobox", { name: "Time zone" })).toBeDisabled();
    const form = screen
      .getByRole("button", { name: "Save quiet hours" })
      .closest("form");
    if (!form) throw new Error("Quiet hours form missing");
    fireEvent.submit(form);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
