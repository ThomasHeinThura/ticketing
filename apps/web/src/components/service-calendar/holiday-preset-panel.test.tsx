import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceCalendar } from "@/fetchers/service-calendar";

const mocks = vi.hoisted(() => ({ apply: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}));
vi.mock("@/lib/format", () => ({ formatDateMedium: (value: string) => value }));
vi.mock("@/hooks/queries/service-management", () => ({
  useHolidayPresets: () => ({
    data: {
      datasetVersion: "2026.10.1",
      presets: [
        { country: "GB", name: "United Kingdom", notIncluded: "Scotland" },
        { country: "US", name: "United States", notIncluded: "State days" },
      ],
    },
  }),
}));
vi.mock("@/fetchers/service-management", () => ({
  applyHolidayPreset: (...args: unknown[]) => mocks.apply(...args),
}));

import { HolidayPresetPanel } from "./holiday-preset-panel";

const calendar = { id: "c1", version: 4 } as unknown as ServiceCalendar;

const preview = {
  datasetVersion: "2026.10.1",
  country: "GB",
  year: 2026,
  notIncluded: "Scotland and Northern Ireland differences",
  holidays: [
    { date: "2026-04-03", name: "Good Friday", existing: false },
    { date: "2026-12-25", name: "Christmas Day", existing: true },
  ],
  applied: false,
  importedCount: 0,
  duplicateCount: 1,
  affectedWorkItemCount: 0,
  calendar: null,
};

function setup(onImported = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <HolidayPresetPanel calendar={calendar} onImported={onImported} />
    </QueryClientProvider>,
  );
  return onImported;
}

async function choose(name: string) {
  fireEvent.click(screen.getByRole("combobox"));
  fireEvent.click(await screen.findByRole("option", { name }));
}

beforeEach(() => {
  mocks.apply.mockResolvedValue(preview);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("HolidayPresetPanel", () => {
  it("needs a country before it previews", () => {
    setup();
    expect(
      (
        screen.getByRole("button", {
          name: "presets.preview",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("previews first, says it is a starting point and what it leaves out, and saves nothing", async () => {
    setup();
    await choose("United Kingdom (GB)");
    fireEvent.click(screen.getByRole("button", { name: "presets.preview" }));
    expect(await screen.findByText("presets.startingPointTitle")).toBeTruthy();
    expect(screen.getByText(/Scotland and Northern Ireland/u)).toBeTruthy();
    expect(screen.getByText(/2026.10.1/u)).toBeTruthy();
    expect(screen.getByText("presets.existing")).toBeTruthy();
    expect(mocks.apply).toHaveBeenCalledTimes(1);
    expect(mocks.apply).toHaveBeenCalledWith("c1", {
      country: "GB",
      year: new Date().getFullYear(),
      preview: true,
    });
  });

  it("appends only after confirmation, with the loaded version, and hands the holidays back", async () => {
    const onImported = setup();
    await choose("United Kingdom (GB)");
    fireEvent.click(screen.getByRole("button", { name: "presets.preview" }));
    await screen.findByText("presets.startingPointTitle");
    mocks.apply.mockResolvedValueOnce({
      ...preview,
      applied: true,
      importedCount: 1,
      duplicateCount: 1,
      affectedWorkItemCount: 2,
      calendar: { holidays: [{ date: "2026-04-03" }], version: 5 },
    });
    fireEvent.click(screen.getByRole("button", { name: /presets.confirm/u }));
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    expect(mocks.apply).toHaveBeenLastCalledWith(
      "c1",
      { country: "GB", year: new Date().getFullYear(), preview: false },
      4,
    );
    expect(await screen.findByText("presets.appliedTitle")).toBeTruthy();
    expect(screen.getByText(/presets.retroactive/u)).toBeTruthy();
  });

  it("rejects an out-of-range year without calling the API", async () => {
    setup();
    await choose("United States (US)");
    fireEvent.change(screen.getByLabelText("presets.year"), {
      target: { value: "1500" },
    });
    expect(
      (
        screen.getByRole("button", {
          name: "presets.preview",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(mocks.apply).not.toHaveBeenCalled();
  });
});
