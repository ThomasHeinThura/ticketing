import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCycle: vi.fn(),
  updateCycle: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
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
  updateCycle: (...args: unknown[]) => mocks.updateCycle(...args),
}));

import { type Cycle, CycleOverlapError } from "@/fetchers/agile";
import { CycleFormDialog } from "./cycle-form-dialog";

function renderDialog(cycle?: Cycle) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <CycleFormDialog projectKey="HELP" cycle={cycle} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

async function chooseDate(label: string, date: string) {
  fireEvent.click(screen.getByRole("button", { name: label }));
  const popup = screen.getByRole("dialog", { name: label });
  await waitFor(() => expect(popup).toBeVisible());
  const entry = within(popup).getByPlaceholderText("YYYY-MM-DD");
  fireEvent.change(entry, { target: { value: date } });
  fireEvent.keyDown(entry, { key: "Enter", code: "Enter" });
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: label })).toBeNull(),
  );
}

async function fill(start: string, end: string) {
  fireEvent.change(screen.getByLabelText("cycles.form.name"), {
    target: { value: "Sprint 5" },
  });
  await chooseDate("cycles.form.start", start);
  await chooseDate("cycles.form.end", end);
}

afterEach(() => {
  cleanup();
  mocks.createCycle.mockReset();
  mocks.updateCycle.mockReset();
});

describe("CycleFormDialog", () => {
  it("retains the original version and exact selected dates when editing", async () => {
    mocks.updateCycle.mockResolvedValue({});
    renderDialog({
      id: "cycle-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
      name: "Sprint 5",
      startDate: "2026-10-10",
      endDate: "2026-10-24",
      status: "upcoming",
      completedAt: null,
      version: 4,
      summary: {
        unit: "count",
        total: { count: 0, points: 0 },
        completed: { count: 0, points: 0 },
        inProgress: { count: 0, points: 0 },
        notStarted: { count: 0, points: 0 },
        cancelled: { count: 0, points: 0 },
        unestimated: { count: 0, share: 0 },
      },
    });
    await chooseDate("cycles.form.end", "2026-10-25");
    expect(mocks.updateCycle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() =>
      expect(mocks.updateCycle).toHaveBeenCalledExactlyOnceWith("cycle-1", {
        name: "Sprint 5",
        startDate: "2026-10-10",
        endDate: "2026-10-25",
        version: 4,
      }),
    );
  });

  it("disables both date pickers while a cycle save is pending", async () => {
    mocks.createCycle.mockImplementation(() => new Promise(() => {}));
    renderDialog();
    await fill("2026-10-10", "2026-10-24");
    fireEvent.click(screen.getByRole("button", { name: "cycles.form.create" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "cycles.form.start" }),
      ).toBeDisabled(),
    );
    expect(
      screen.getByRole("button", { name: "cycles.form.end" }),
    ).toBeDisabled();
    expect(mocks.createCycle).toHaveBeenCalledTimes(1);
  });

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
    await fill("2026-10-10", "2026-10-24");
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
    await fill("2026-10-10", "2026-10-01");
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

  it("requires both dates, preserves equal date-only values and can clear a date", async () => {
    mocks.createCycle.mockResolvedValue({});
    const { container } = renderDialog();
    expect(container.querySelector('input[type="date"]')).toBeNull();
    const submit = screen.getByRole("button", { name: "cycles.form.create" });
    expect(submit).toBeDisabled();
    await fill("2024-02-29", "2024-02-29");
    expect(mocks.createCycle).not.toHaveBeenCalled();
    expect(submit).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "cycles.form.start" }));
    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: "cycles.form.start" }),
      ).getByRole("button", { name: "customFields:value.clear" }),
    );
    await waitFor(() => expect(submit).toBeDisabled());
    await chooseDate("cycles.form.start", "2024-02-29");
    fireEvent.click(submit);
    await waitFor(() =>
      expect(mocks.createCycle).toHaveBeenCalledExactlyOnceWith("HELP", {
        name: "Sprint 5",
        startDate: "2024-02-29",
        endDate: "2024-02-29",
      }),
    );
  });

  it("keeps invalid typed dates local and leaves the cycle dialog open on picker Escape", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "cycles.form.start" }));
    const popup = screen.getByRole("dialog", { name: "cycles.form.start" });
    await waitFor(() => expect(popup).toBeVisible());
    const entry = within(popup).getByPlaceholderText("YYYY-MM-DD");
    fireEvent.change(entry, { target: { value: "2025-02-29" } });
    expect(
      within(popup).getByRole("button", { name: "common.save" }),
    ).toBeDisabled();
    fireEvent.keyDown(entry, { key: "Enter", code: "Enter" });
    expect(
      screen.getByRole("dialog", { name: "cycles.form.start" }),
    ).toBeVisible();
    fireEvent.keyDown(entry, { key: "Escape", code: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "cycles.form.start" }),
      ).toBeNull(),
    );
    expect(
      screen.getByRole("dialog", { name: "cycles.form.createTitle" }),
    ).toBeVisible();
    expect(mocks.createCycle).not.toHaveBeenCalled();
  });
});
