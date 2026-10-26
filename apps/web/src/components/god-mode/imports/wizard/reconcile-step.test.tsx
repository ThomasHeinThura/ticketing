import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { engineRun, i18nMock, renderWithQuery } from "./test-support";

const mocks = vi.hoisted(() => ({
  losses: vi.fn(),
  reconciliation: vi.fn(),
  recompute: vi.fn(),
}));

vi.mock("react-i18next", () => i18nMock());
vi.mock("@/fetchers/god-mode/imports", async (original) => ({
  ...(await original<typeof import("@/fetchers/god-mode/imports")>()),
  getImportLosses: (...args: unknown[]) => mocks.losses(...args),
  getImportReconciliation: (...args: unknown[]) =>
    mocks.reconciliation(...args),
  recomputeImportReconciliation: (...args: unknown[]) =>
    mocks.recompute(...args),
}));

import { ReconcileStep } from "./reconcile-step";

const page = (cursor: string | null, id: string) => ({
  runId: "run-1",
  summary: [
    {
      sourceType: "issue",
      code: "attachment_too_large",
      detailCode: "",
      count: 3,
    },
  ],
  losses: [
    {
      id,
      sourceType: "issue",
      sourceId: `ISSUE-${id}`,
      code: "attachment_too_large",
      detailCode: "",
      sourceUrl: "https://example.com/a",
      createdAt: "2026-10-26T10:00:00.000Z",
    },
  ],
  nextCursor: cursor,
});

beforeEach(() => {
  mocks.losses.mockReset();
  mocks.reconciliation.mockReset();
  mocks.reconciliation.mockResolvedValue({
    runId: "run-1",
    reconciliation: null,
  });
  mocks.recompute.mockReset();
});
afterEach(cleanup);

const finished = engineRun({
  state: "completed",
  phase: "completed",
  stats: { created: 70, updated: 20, skipped: 8, rejected: 2 },
});

describe("ReconcileStep", () => {
  it("compares run counts with the dry run and lists losses with paging", async () => {
    mocks.losses
      .mockResolvedValueOnce(page("c1", "l1"))
      .mockResolvedValueOnce(page(null, "l2"));
    renderWithQuery(<ReconcileStep run={finished} />);
    expect(
      (await screen.findAllByText("Attachment too large")).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("issue · ISSUE-l1")).toBeTruthy();
    expect(screen.queryByText(/records were processed but/)).toBeNull();
    expect(screen.queryByText("Match")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByText("issue · ISSUE-l2");
    expect(mocks.losses.mock.calls[1]?.[1]).toEqual({
      cursor: "c1",
      limit: 100,
    });
  });

  it("warns when processed records differ from the dry run", async () => {
    mocks.losses.mockResolvedValue({
      runId: "run-1",
      summary: [],
      losses: [],
      nextCursor: null,
    });
    renderWithQuery(
      <ReconcileStep run={{ ...finished, stats: { created: 70 } }} />,
    );
    expect(
      await screen.findByText(
        "70 records were processed but the dry run expected 100.",
      ),
    ).toBeTruthy();
    expect(await screen.findByText("Nothing was lost.")).toBeTruthy();
  });

  it("renders the optional reconciliation counts when supplied", async () => {
    mocks.losses.mockResolvedValue({
      runId: "run-1",
      summary: [],
      losses: [],
      nextCursor: null,
    });
    renderWithQuery(
      <ReconcileStep
        run={finished}
        reconciliation={{
          rows: [
            { key: "issues", label: "Work items", source: 100, target: 98 },
            { key: "comments", label: "Comments", source: 40, target: 40 },
          ],
        }}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText("Source compared with target")).toBeTruthy(),
    );
    expect(screen.getByText("Differs")).toBeTruthy();
    expect(screen.getByText("Match")).toBeTruthy();
  });

  it("loads the stored reconciliation and recomputes it with an idempotency key", async () => {
    mocks.losses.mockResolvedValue({
      runId: "run-1",
      summary: [],
      losses: [],
      nextCursor: null,
    });
    mocks.reconciliation.mockResolvedValue({
      runId: "run-1",
      reconciliation: {
        rows: [{ key: "total", label: "Total", source: 10, target: 9 }],
      },
    });
    mocks.recompute.mockResolvedValue({
      runId: "run-1",
      reconciliation: {
        rows: [{ key: "total", label: "Total", source: 10, target: 10 }],
      },
    });
    renderWithQuery(<ReconcileStep run={finished} />);
    expect(await screen.findByText("Differs")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Recompute" }));
    expect(await screen.findByText("Match")).toBeTruthy();
    expect(mocks.recompute.mock.calls[0]?.[0]).toBe("run-1");
    expect(typeof mocks.recompute.mock.calls[0]?.[1]).toBe("string");
  });

  it("offers Recompute when nothing is stored yet", async () => {
    mocks.losses.mockResolvedValue({
      runId: "run-1",
      summary: [],
      losses: [],
      nextCursor: null,
    });
    renderWithQuery(<ReconcileStep run={finished} />);
    expect(await screen.findByText(/Not computed yet/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Recompute" })).toBeTruthy();
  });
});
