import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createCycle: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/fetchers/agile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fetchers/agile")>()),
  createCycle: (...args: unknown[]) => mocks.createCycle(...args),
}));

import { CycleOverlapError } from "@/fetchers/agile";
import { CycleFormDialog } from "./cycle-form-dialog";

function renderDialog() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <CycleFormDialog projectKey="HELP" onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

function fill(start: string, end: string) {
  fireEvent.change(screen.getByLabelText("cycles.form.name"), {
    target: { value: "Sprint 5" },
  });
  fireEvent.change(screen.getByLabelText("cycles.form.start"), {
    target: { value: start },
  });
  fireEvent.change(screen.getByLabelText("cycles.form.end"), {
    target: { value: end },
  });
}

afterEach(() => {
  cleanup();
  mocks.createCycle.mockReset();
});

describe("CycleFormDialog", () => {
  it("names the conflicting cycle when the dates overlap (CY-2)", async () => {
    mocks.createCycle.mockRejectedValue(
      new CycleOverlapError({
        id: "c1",
        name: "Sprint 4",
        startDate: "2026-10-05",
        endDate: "2026-10-19",
      }),
    );
    renderDialog();
    fill("2026-10-10", "2026-10-24");
    fireEvent.click(screen.getByRole("button", { name: "cycles.form.create" }));
    const error = await screen.findByTestId("cycle-overlap-error");
    expect(error.textContent).toContain("Sprint 4");
    expect(mocks.createCycle).toHaveBeenCalledWith("HELP", {
      name: "Sprint 5",
      startDate: "2026-10-10",
      endDate: "2026-10-24",
    });
  });

  it("does not submit an end date before the start date", async () => {
    renderDialog();
    fill("2026-10-10", "2026-10-01");
    expect(screen.getByText("cycles.form.endBeforeStart")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "cycles.form.create",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await waitFor(() => expect(mocks.createCycle).not.toHaveBeenCalled());
  });
});
