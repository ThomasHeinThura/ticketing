import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CycleDetail } from "@/fetchers/agile";

const mocks = vi.hoisted(() => ({ completeCycle: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/fetchers/agile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fetchers/agile")>()),
  completeCycle: (...args: unknown[]) => mocks.completeCycle(...args),
}));

import { CompleteCycleDialog } from "./complete-cycle-dialog";

function cycle(
  preview: Partial<CycleDetail["completionPreview"]> = {},
): CycleDetail {
  return {
    id: "c1",
    name: "Sprint 4",
    completionPreview: {
      defaultPolicy: "backlog",
      incompleteCount: 3,
      nextCycle: null,
      ...preview,
    },
  } as unknown as CycleDetail;
}

function renderDialog(detail: CycleDetail) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <CompleteCycleDialog cycle={detail} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

const result = (movedCount: number, leftCount = 0) => ({
  dryRun: true,
  cycle: {},
  policy: "backlog",
  destinationCycle: null,
  movedCount,
  leftCount,
});

afterEach(() => {
  cleanup();
  mocks.completeCycle.mockReset();
});

describe("CompleteCycleDialog", () => {
  it("pre-selects the project's default and previews it with a dry run", async () => {
    mocks.completeCycle.mockResolvedValue(result(3));
    renderDialog(cycle({ defaultPolicy: "leave" }));
    const leave = await screen.findByRole("radio", {
      name: /complete.policy.leave.label/,
    });
    expect(leave.getAttribute("aria-checked")).toBe("true");
    await waitFor(() =>
      expect(mocks.completeCycle).toHaveBeenCalledWith("c1", {
        incompletePolicy: "leave",
        dryRun: true,
      }),
    );
    expect(await screen.findByTestId("complete-summary")).toBeTruthy();
  });

  it("does not offer the next cycle when there is none", async () => {
    mocks.completeCycle.mockResolvedValue(result(3));
    renderDialog(cycle({ defaultPolicy: "next_cycle", nextCycle: null }));
    const next = await screen.findByRole("radio", {
      name: /complete.policy.next_cycle.label/,
    });
    expect(
      next.hasAttribute("disabled") ||
        next.getAttribute("aria-disabled") === "true",
    ).toBe(true);
    // The default fell back to the backlog rather than a disabled choice.
    const backlog = screen.getByRole("radio", {
      name: /complete.policy.backlog.label/,
    });
    expect(backlog.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("complete.noNextCycle")).toBeTruthy();
  });

  it("completes with the chosen policy", async () => {
    mocks.completeCycle.mockResolvedValue(result(3));
    renderDialog(cycle());
    await screen.findByTestId("complete-summary");
    fireEvent.click(
      screen.getByRole("radio", { name: /complete.policy.leave.label/ }),
    );
    await waitFor(() =>
      expect(mocks.completeCycle).toHaveBeenCalledWith("c1", {
        incompletePolicy: "leave",
        dryRun: true,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "complete.confirm" }));
    await waitFor(() =>
      expect(mocks.completeCycle).toHaveBeenCalledWith("c1", {
        incompletePolicy: "leave",
      }),
    );
  });
});
