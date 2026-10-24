import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addCycleWorkItems: vi.fn(),
  addModuleWorkItems: vi.fn(),
  getCycles: vi.fn(),
  getModules: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));
vi.mock("@/fetchers/agile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fetchers/agile")>()),
  addCycleWorkItems: (...args: unknown[]) => mocks.addCycleWorkItems(...args),
  addModuleWorkItems: (...args: unknown[]) => mocks.addModuleWorkItems(...args),
  getCycles: (...args: unknown[]) => mocks.getCycles(...args),
  getModules: (...args: unknown[]) => mocks.getModules(...args),
}));

import {
  BULK_CHUNK,
  BulkAgileDialog,
  chunkKeys,
  mergeOutcomes,
} from "./bulk-agile-dialog";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const cycleResult = (overrides = {}) => ({
  added: [],
  alreadyInCycle: [],
  movedFromOtherCycle: [],
  refused: [],
  ...overrides,
});

function renderDialog(
  features = { cycles: true, modules: true },
  keys = ["A-1", "A-2"],
) {
  mocks.getCycles.mockResolvedValue({
    data: [
      { id: "c1", name: "Sprint 4", status: "active" },
      { id: "c0", name: "Sprint 3", status: "completed" },
    ],
  });
  mocks.getModules.mockResolvedValue({
    data: [{ id: "m1", name: "Checkout" }],
  });
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <BulkAgileDialog
        projectKey="PRJ"
        features={features}
        selectedKeys={keys}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe("bulk helpers", () => {
  it("chunks keys at the API limit", () => {
    const keys = Array.from({ length: BULK_CHUNK * 2 + 1 }, (_, i) => `K-${i}`);
    expect(chunkKeys(keys).map((chunk) => chunk.length)).toEqual([200, 200, 1]);
  });

  it("merges per-call results for cycles and modules", () => {
    expect(
      mergeOutcomes([
        cycleResult({ added: ["A"], alreadyInCycle: ["B"] }),
        cycleResult({
          added: ["C"],
          movedFromOtherCycle: ["C"],
          refused: [{ key: "Z", reason: "not_found" }],
        }),
      ]),
    ).toEqual({
      added: ["A", "C"],
      already: ["B"],
      moved: ["C"],
      refused: [{ key: "Z", reason: "not_found" }],
    });
    expect(
      mergeOutcomes([
        {
          added: [],
          alreadyInModule: ["M"],
          movedFromOtherModule: ["N"],
          refused: [],
        },
      ]),
    ).toMatchObject({ already: ["M"], moved: ["N"] });
  });
});

describe("BulkAgileDialog (CY-5)", () => {
  it("offers only open cycles, adds the selection and shows the per-item outcome", async () => {
    mocks.addCycleWorkItems.mockResolvedValue(
      cycleResult({
        added: ["A-1", "A-2"],
        movedFromOtherCycle: ["A-2"],
        refused: [{ key: "A-9", reason: "not_found" }],
      }),
    );
    renderDialog();
    expect(await screen.findByRole("radio", { name: "Sprint 4" })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "Sprint 3" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Sprint 4" }));
    fireEvent.click(screen.getByRole("button", { name: "bulk.confirm" }));
    const outcome = await screen.findByTestId("bulk-agile-outcome");
    expect(mocks.addCycleWorkItems).toHaveBeenCalledWith("c1", ["A-1", "A-2"]);
    expect(outcome.textContent).toContain("bulk.outcome.added");
    expect(outcome.textContent).toContain("bulk.outcome.moved.cycle");
    expect(outcome.textContent).toContain("A-9: not_found");
  });

  it("switches to modules when both features are on", async () => {
    mocks.addModuleWorkItems.mockResolvedValue({
      added: ["A-1"],
      alreadyInModule: ["A-2"],
      movedFromOtherModule: [],
      refused: [],
    });
    renderDialog();
    fireEvent.click(
      await screen.findByRole("radio", { name: "bulk.kind.module" }),
    );
    fireEvent.click(await screen.findByRole("radio", { name: "Checkout" }));
    fireEvent.click(screen.getByRole("button", { name: "bulk.confirm" }));
    const outcome = await screen.findByTestId("bulk-agile-outcome");
    expect(mocks.addModuleWorkItems).toHaveBeenCalledWith("m1", ["A-1", "A-2"]);
    expect(outcome.textContent).toContain("bulk.outcome.already.module");
  });

  it("sends a large selection in chunks of 200", async () => {
    mocks.addCycleWorkItems.mockResolvedValue(cycleResult({ added: ["x"] }));
    const keys = Array.from({ length: 250 }, (_, i) => `K-${i}`);
    renderDialog({ cycles: true, modules: false }, keys);
    fireEvent.click(await screen.findByRole("radio", { name: "Sprint 4" }));
    fireEvent.click(screen.getByRole("button", { name: "bulk.confirm" }));
    await waitFor(() =>
      expect(mocks.addCycleWorkItems).toHaveBeenCalledTimes(2),
    );
    expect(mocks.addCycleWorkItems.mock.calls[0]?.[1]).toHaveLength(200);
    expect(mocks.addCycleWorkItems.mock.calls[1]?.[1]).toHaveLength(50);
  });

  it("keeps Add disabled until a target is chosen and hides the kind picker for one feature", async () => {
    renderDialog({ cycles: true, modules: false });
    await screen.findByRole("radio", { name: "Sprint 4" });
    expect(
      (
        screen.getByRole("button", {
          name: "bulk.confirm",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.queryByRole("radio", { name: "bulk.kind.module" }),
    ).toBeNull();
  });
});
