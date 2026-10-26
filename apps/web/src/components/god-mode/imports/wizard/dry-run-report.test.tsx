import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  completeness,
  dryRunReport,
  engineRun,
  i18nMock,
  renderWithQuery,
} from "./test-support";

const mocks = vi.hoisted(() => ({ get: vi.fn(), run: vi.fn() }));

vi.mock("react-i18next", () => i18nMock());
vi.mock("@/fetchers/god-mode/imports", async (original) => ({
  ...(await original<typeof import("@/fetchers/god-mode/imports")>()),
  getImportDryRun: (...args: unknown[]) => mocks.get(...args),
  runImportDryRun: (...args: unknown[]) => mocks.run(...args),
}));

import { DryRunReportView, DryRunStep, dryRunBlockers } from "./dry-run-report";

beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue(null);
  mocks.run.mockReset();
});
afterEach(cleanup);

describe("DryRunReportView", () => {
  it("renders outcomes per type, losses per code and the digest", () => {
    renderWithQuery(
      <DryRunReportView report={dryRunReport()} run={{ mappingVersion: 3 }} />,
    );
    expect(screen.getByText("Ready to import")).toBeTruthy();
    expect(screen.getByText("b".repeat(64))).toBeTruthy();
    expect(screen.getByText("Rich text converted with loss")).toBeTruthy();
    expect(screen.getByText("table")).toBeTruthy();
    expect(screen.getByText("Records affected: 12")).toBeTruthy();
    expect(screen.getByText("invalid_target_record")).toBeTruthy();
    expect(screen.getByText("By record type")).toBeTruthy();
  });

  it("lists blocking reasons when the mapping is incomplete or stale", () => {
    const report = dryRunReport({
      complete: false,
      mappingVersion: 2,
      completeness: completeness({
        complete: false,
        unmapped: 1,
        blocking: [
          {
            domain: "state",
            value: "Resolved",
            status: "unmapped",
            affected: 4000,
          },
        ],
      }),
    });
    renderWithQuery(
      <DryRunReportView report={report} run={{ mappingVersion: 3 }} />,
    );
    expect(
      screen.getByText("The import cannot start from this report"),
    ).toBeTruthy();
    expect(screen.getByText("The mapping is incomplete.")).toBeTruthy();
    expect(
      screen.getByText("The mapping changed after this dry run. Run it again."),
    ).toBeTruthy();
    expect(
      screen.getByText('State "Resolved": records affected 4000'),
    ).toBeTruthy();
    expect(dryRunBlockers(report, { mappingVersion: 3 })).toEqual([
      "incomplete",
      "stale",
    ]);
  });
});

describe("DryRunStep", () => {
  it("shows an empty state, runs the dry run once with an idempotency key and then allows continuing", async () => {
    const onContinue = vi.fn();
    mocks.run.mockResolvedValue(dryRunReport());
    renderWithQuery(
      <DryRunStep
        run={engineRun({ phase: "discovered" })}
        onContinue={onContinue}
      />,
    );
    expect(await screen.findByText("No dry run yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Run dry run" }));
    expect(await screen.findByText("Ready to import")).toBeTruthy();
    expect(mocks.run).toHaveBeenCalledWith("run-1", expect.any(String));
    fireEvent.click(screen.getByRole("button", { name: "Continue to import" }));
    expect(onContinue).toHaveBeenCalled();
  });

  it("does not let a stale report continue", async () => {
    mocks.get.mockResolvedValue(dryRunReport({ mappingVersion: 2 }));
    renderWithQuery(
      <DryRunStep
        run={engineRun({ phase: "discovered" })}
        onContinue={vi.fn()}
      />,
    );
    await screen.findByText("The import cannot start from this report");
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Continue to import",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true),
    );
  });
});
