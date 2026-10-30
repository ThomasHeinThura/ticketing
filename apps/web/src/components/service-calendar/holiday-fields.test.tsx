import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import { HolidayFields } from "./holiday-fields";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: (namespace?: string) => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key.includes(":") ? key : `${namespace}:${key}`, options),
  }),
}));
afterEach(cleanup);

describe("holiday calendar dates", () => {
  it("patches a date-only value through the existing calendar without an instant conversion", async () => {
    const onPatch = vi.fn();
    const { container } = render(
      <HolidayFields
        index={0}
        holiday={{ date: "2026-10-30" }}
        onChange={vi.fn()}
        onPatch={onPatch}
        onRemove={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Date" }));
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Date" })).toBeVisible(),
    );
    fireEvent.click(screen.getByRole("button", { name: /October 31st, 2026/ }));
    expect(onPatch).toHaveBeenCalledExactlyOnceWith({ date: "2026-10-31" });
    expect(container.querySelector('input[type="date"]')).toBeNull();
  });

  it("keeps both inclusive range endpoints disabled for read-only calendars", () => {
    render(
      <HolidayFields
        index={0}
        holiday={{ from: "2026-12-31", to: "2027-01-01" }}
        onChange={vi.fn()}
        onPatch={vi.fn()}
        onRemove={vi.fn()}
        disabled
      />,
    );
    expect(screen.getByRole("button", { name: "From" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Through" })).toBeDisabled();
  });
});
