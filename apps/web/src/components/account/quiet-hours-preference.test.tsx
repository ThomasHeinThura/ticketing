import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  invalidate: vi.fn(),
  quietHours: null as { start: string; end: string; timezone: string } | null,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
    isPending: false,
    isError: false,
    mutate: (value: unknown) =>
      void mutationFn(value).then((data) => onSuccess(data, value)),
  }),
}));

import { QuietHoursPreference } from "./quiet-hours-preference";

afterEach(cleanup);
beforeEach(() => {
  mocks.save.mockReset().mockResolvedValue({});
  mocks.invalidate.mockReset().mockResolvedValue(undefined);
  mocks.quietHours = null;
});

describe("quiet hours preference", () => {
  it("does not save on open and needs an explicit save", async () => {
    render(<QuietHoursPreference />);
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("quietHours.start"), {
      target: { value: "21:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "quietHours.save" }));
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

  it("refuses identical start and end times without calling the server", () => {
    mocks.quietHours = { start: "22:00", end: "07:00", timezone: "UTC" };
    render(<QuietHoursPreference />);
    fireEvent.change(screen.getByLabelText("quietHours.end"), {
      target: { value: "22:00" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("quietHours.invalid");
    expect(
      screen.getByRole("button", { name: "quietHours.save" }),
    ).toBeDisabled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("turns quiet hours off with null", async () => {
    mocks.quietHours = { start: "22:00", end: "07:00", timezone: "UTC" };
    render(<QuietHoursPreference />);
    fireEvent.click(screen.getByRole("button", { name: "quietHours.clear" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(null));
  });
});
