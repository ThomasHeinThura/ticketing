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
  audits: undefined as unknown,
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
    meta,
  }: {
    mutationFn: (value: unknown) => Promise<unknown>;
    onSuccess: (data: unknown, variables: unknown) => Promise<void>;
    meta: { audits: { targets: () => unknown } };
  }) => ({
    isPending: mocks.pending,
    isError: false,
    mutate: (value: unknown) => {
      mocks.audits = meta.audits.targets();
      void mutationFn(value).then((data) => onSuccess(data, value));
    },
  }),
}));

import { QuietHoursForm, QuietHoursPreference } from "./quiet-hours-preference";

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
    expect(mocks.audits).toEqual([
      { kind: "self", audience: "staff", section: "notifications" },
    ]);
    await screen.findByRole("button", { name: "Saved" });
    const announcements = screen
      .getAllByRole("status")
      .filter((node) => node.textContent?.trim());
    expect(announcements).toHaveLength(1);
    expect(announcements[0]).toHaveTextContent("Saved");
    const saved = mocks.save.mock.calls[0]?.[0] as {
      start: string;
      end: string;
      timezone: string;
    };
    expect(saved.start).toBe("21:30");
    expect(saved.end).toBe("07:00");
    expect(saved.timezone.length).toBeGreaterThan(0);
  });

  it("announces one save after refreshed quiet hours remount the form", async () => {
    mocks.invalidate.mockImplementation(async () => {
      mocks.quietHours = {
        start: "21:30",
        end: "07:00",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      };
    });
    render(<QuietHoursPreference />);
    await chooseTime("From", "21:30");
    fireEvent.click(screen.getByRole("button", { name: "Save quiet hours" }));
    await screen.findByRole("button", { name: "Saved" });
    const announcements = screen
      .getAllByRole("status")
      .filter((node) => node.textContent?.trim());
    expect(announcements).toHaveLength(1);
    expect(announcements[0]).toHaveTextContent("Saved");
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
    expect(mocks.audits).toEqual([
      { kind: "self", audience: "staff", section: "notifications" },
    ]);
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

  it("keeps the save focused, blocks activation and disables other controls while saving", () => {
    mocks.quietHours = { start: "22:00", end: "07:00", timezone: "UTC" };
    mocks.pending = true;
    render(<QuietHoursPreference />);
    for (const label of ["From", "Until", "Turn off quiet hours"]) {
      expect(screen.getByRole("button", { name: label })).toBeDisabled();
    }
    expect(screen.getByRole("combobox", { name: "Time zone" })).toBeDisabled();
    const save = screen.getByRole("button", { name: "Save quiet hours" });
    expect(save).toHaveAttribute("aria-disabled", "true");
    save.focus();
    fireEvent.click(save);
    expect(save).toHaveFocus();
    const form = save.closest("form");
    if (!form) throw new Error("Quiet hours form missing");
    fireEvent.submit(form);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});

describe("shared quiet-hours form adapters", () => {
  it("keeps the staff save endpoint and cache by default", async () => {
    render(
      <QuietHoursForm
        saved={null}
        completed={false}
        onStart={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save quiet hours" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.invalidate).toHaveBeenCalledWith({
      queryKey: ["notification-preferences"],
    });
  });

  it("uses the portal adapter and caller-only cache without calling the staff writer", async () => {
    const save = vi.fn().mockResolvedValue(null);
    render(
      <QuietHoursForm
        saved={null}
        completed={false}
        onStart={vi.fn()}
        onSaved={vi.fn()}
        save={save}
        cacheKey={["portal", "customer-1", "canonical-quiet-hours"]}
        note="Customer quiet-hours note"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save quiet hours" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.invalidate).toHaveBeenCalledWith({
      queryKey: ["portal", "customer-1", "canonical-quiet-hours"],
    });
    expect(screen.getByText("Customer quiet-hours note")).toBeVisible();
  });
});
