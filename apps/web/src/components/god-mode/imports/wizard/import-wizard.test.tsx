import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { engineRun, i18nMock, renderWithQuery } from "./test-support";

const mocks = vi.hoisted(() => ({ engine: vi.fn() }));

vi.mock("react-i18next", () => i18nMock());
vi.mock("@/lib/format", () => ({ formatDateTime: (value: string) => value }));
vi.mock("@/fetchers/god-mode/imports", async (original) => ({
  ...(await original<typeof import("@/fetchers/god-mode/imports")>()),
  getEngineImportRun: (...args: unknown[]) => mocks.engine(...args),
}));
vi.mock("./discover-step", () => ({
  DiscoverStep: () => <p>discover panel</p>,
}));
vi.mock("./mapping-table", () => ({ MappingStep: () => <p>mapping panel</p> }));
vi.mock("./dry-run-report", () => ({ DryRunStep: () => <p>dry-run panel</p> }));
vi.mock("./execute-progress", () => ({
  ExecuteStep: () => <p>execute panel</p>,
}));
vi.mock("./reconcile-step", () => ({
  ReconcileStep: () => <p>reconcile panel</p>,
}));

import { ImportWizard } from "./import-wizard";

beforeEach(() => {
  mocks.engine.mockReset();
});
afterEach(cleanup);

const tab = (name: string) =>
  screen.getByRole("tab", { name: new RegExp(`${name}$`) }) as HTMLElement;
const unavailable = (element: HTMLElement) =>
  element.hasAttribute("disabled") ||
  element.getAttribute("aria-disabled") === "true" ||
  element.hasAttribute("data-disabled");

describe("ImportWizard", () => {
  it("opens the step the phase belongs on and disables steps that are not reachable yet", async () => {
    mocks.engine.mockResolvedValue(engineRun({ phase: "discovered" }));
    renderWithQuery(<ImportWizard runId="run-1" onStepChange={vi.fn()} />);
    expect(await screen.findByText("mapping panel")).toBeTruthy();
    expect(tab("Map").getAttribute("aria-selected")).toBe("true");
    expect(unavailable(tab("Import"))).toBe(true);
    expect(unavailable(tab("Reconcile"))).toBe(true);
  });

  it("clamps a step from the URL to what the phase allows and reports step changes", async () => {
    mocks.engine.mockResolvedValue(engineRun({ phase: "discovered" }));
    const onStepChange = vi.fn();
    renderWithQuery(
      <ImportWizard
        runId="run-1"
        step="reconcile"
        onStepChange={onStepChange}
      />,
    );
    expect(await screen.findByText("dry-run panel")).toBeTruthy();
    fireEvent.click(tab("Discover"));
    expect(onStepChange).toHaveBeenCalledWith("discover");
  });

  it("shows a forbidden message without a retry loop", async () => {
    mocks.engine.mockImplementation(async () => {
      throw new HttpError(403, "no");
    });
    renderWithQuery(<ImportWizard runId="run-1" onStepChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Access denied")).toBeTruthy());
  });
});
