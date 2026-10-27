import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import {
  completeness,
  engineRun,
  i18nMock,
  mappingOf,
  renderWithQuery,
} from "./test-support";

const mocks = vi.hoisted(() => ({
  mapping: vi.fn(),
  execute: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  engine: vi.fn(),
  dryRun: vi.fn(),
  openPending: vi.fn(),
}));

vi.mock("react-i18next", () => i18nMock());
vi.mock("@/fetchers/god-mode/imports", async (original) => ({
  ...(await original<typeof import("@/fetchers/god-mode/imports")>()),
  getImportMapping: (...args: unknown[]) => mocks.mapping(...args),
  executeImportRun: (...args: unknown[]) => mocks.execute(...args),
  pauseImportRun: (...args: unknown[]) => mocks.pause(...args),
  resumeImportRun: (...args: unknown[]) => mocks.resume(...args),
  getEngineImportRun: (...args: unknown[]) => mocks.engine(...args),
  runImportDryRun: (...args: unknown[]) => mocks.dryRun(...args),
}));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => mocks.openPending,
}));

import {
  ExecuteStep,
  executeBlockers,
  pauseRecovery,
} from "./execute-progress";
import { ENGINE_POLL_MS, useEngineRun } from "./use-engine-run";

beforeEach(() => {
  mocks.mapping.mockReset().mockResolvedValue(mappingOf([]));
  mocks.execute.mockReset();
  mocks.pause.mockReset();
  mocks.resume.mockReset();
  mocks.engine.mockReset();
  mocks.dryRun.mockReset();
  mocks.openPending.mockReset();
});
afterEach(cleanup);

function renderStep(
  run = engineRun(),
  handlers: { onNeedDryRun?: () => void } = {},
) {
  renderWithQuery(
    <ExecuteStep
      run={run}
      onNeedDryRun={handlers.onNeedDryRun ?? vi.fn()}
      onCompleted={vi.fn()}
    />,
  );
}

describe("ExecuteStep", () => {
  it("binds the dry-run digest, total and mapping version when starting", async () => {
    mocks.execute.mockResolvedValue({
      status: "started",
      run: engineRun({ state: "running" }),
    });
    renderStep();
    const start = await screen.findByRole("button", { name: "Start import" });
    await waitFor(() =>
      expect((start as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(start);
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1));
    expect(mocks.execute).toHaveBeenCalledWith(
      "run-1",
      { dryRunDigest: "a".repeat(64), mappingVersion: 3, totalCount: 100 },
      expect.any(String),
    );
  });

  it("blocks starting while the mapping is incomplete or the dry run is stale", async () => {
    mocks.mapping.mockResolvedValue({
      ...mappingOf([]),
      completeness: completeness({ complete: false, unmapped: 2 }),
    });
    renderStep(engineRun({ mappingVersion: 4 }));
    expect(await screen.findByText("The import cannot start")).toBeTruthy();
    expect(screen.getByText("The mapping is incomplete.")).toBeTruthy();
    expect(
      screen.getByText("The mapping changed after the dry run. Run it again."),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Start import",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(executeBlockers(engineRun({ dryRun: null }), true)).toContain(
      "noDryRun",
    );
  });

  it("explains pending approval and opens the pending action", async () => {
    mocks.execute.mockResolvedValue({
      status: "pending_approval",
      pendingActionId: "action-7",
      run: engineRun(),
    });
    renderStep();
    const start = await screen.findByRole("button", { name: "Start import" });
    await waitFor(() =>
      expect((start as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(start);
    expect(await screen.findByText("Approval required")).toBeTruthy();
    expect(screen.getByText(/needs your explicit approval first/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review approval" }));
    expect(mocks.openPending).toHaveBeenCalledWith({
      pendingActionId: "action-7",
    });
  });

  it("shows approval from the run itself after a reload", async () => {
    renderStep(
      engineRun({
        approval: {
          required: true,
          approved: false,
          digest: null,
          totalCount: null,
          mappingVersion: null,
          pendingActionId: "action-9",
        },
      }),
    );
    expect(await screen.findByText("Approval required")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review approval" }));
    expect(mocks.openPending).toHaveBeenCalledWith({
      pendingActionId: "action-9",
    });
  });

  it("shows progress while running and pauses", async () => {
    mocks.pause.mockResolvedValue(engineRun({ state: "paused" }));
    renderStep(
      engineRun({
        state: "running",
        phase: "executing",
        stats: { created: 20, updated: 5 },
      }),
    );
    expect(await screen.findByText("Records: 25 of 100 (25%)")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "25",
    );
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() =>
      expect(mocks.pause).toHaveBeenCalledWith("run-1", expect.any(String)),
    );
  });

  it("resumes a paused run and names why it paused", async () => {
    mocks.resume.mockResolvedValue(
      engineRun({ state: "running", phase: "executing" }),
    );
    renderStep(
      engineRun({
        state: "paused",
        phase: "executing",
        pausedReason: "operator",
      }),
    );
    expect(await screen.findByText("Paused by an operator.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() =>
      expect(mocks.resume).toHaveBeenCalledWith("run-1", expect.any(String)),
    );
  });

  it("offers the recovery that fits each pause reason", () => {
    expect(pauseRecovery("approved_count_exceeded")).toBe("dryRun");
    expect(pauseRecovery("approval_invalid")).toBe("dryRun");
    expect(pauseRecovery("mapping_changed")).toBe("dryRun");
    expect(pauseRecovery("authority_lost")).toBe("takeOver");
    for (const reason of [
      "operator",
      "project_reach_lost",
      "source_error",
      "chunk_failed",
      "conflict",
    ] as const)
      expect(pauseRecovery(reason)).toBe("resume");
  });

  it.each(["approved_count_exceeded", "approval_invalid"] as const)(
    "returns a run paused for %s to the dry run instead of resuming",
    async (pausedReason) => {
      mocks.dryRun.mockResolvedValue({
        status: "accepted",
        job: null,
        run: engineRun({ phase: "discovered" }),
      });
      const onNeedDryRun = vi.fn();
      renderStep(
        engineRun({ state: "paused", phase: "executing", pausedReason }),
        { onNeedDryRun },
      );
      expect(
        await screen.findByText(
          /Resuming cannot fix this\. Return to the dry run/,
        ),
      ).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: "Return to dry run" }),
      );
      await waitFor(() =>
        expect(mocks.dryRun).toHaveBeenCalledWith("run-1", expect.any(String)),
      );
      await waitFor(() => expect(onNeedDryRun).toHaveBeenCalled());
      expect(mocks.resume).not.toHaveBeenCalled();
    },
  );

  it("lets another administrator take over a run whose executor lost authority", async () => {
    mocks.resume.mockResolvedValue(engineRun({ state: "running" }));
    renderStep(
      engineRun({
        state: "paused",
        phase: "executing",
        pausedReason: "authority_lost",
      }),
    );
    expect(await screen.findByText(/It then continues as you/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Take over and resume" }),
    );
    await waitFor(() =>
      expect(mocks.resume).toHaveBeenCalledWith("run-1", expect.any(String)),
    );
  });

  it("sends the user back to the dry run when a resume is refused", async () => {
    mocks.resume.mockRejectedValue(new HttpError(409, "needs dry run"));
    mocks.dryRun.mockResolvedValue({
      status: "accepted",
      job: null,
      run: engineRun({ phase: "discovered" }),
    });
    const onNeedDryRun = vi.fn();
    renderStep(
      engineRun({
        state: "paused",
        phase: "executing",
        pausedReason: "operator",
      }),
      { onNeedDryRun },
    );
    fireEvent.click(await screen.findByRole("button", { name: "Resume" }));
    expect(await screen.findByText("Cannot resume yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Go to dry run" }));
    await waitFor(() => expect(onNeedDryRun).toHaveBeenCalled());
    expect(mocks.dryRun).toHaveBeenCalledTimes(1);
  });
});

function Poller() {
  const run = useEngineRun("run-1");
  return <output aria-label="done">{run.data?.stats.created ?? "-"}</output>;
}

describe("useEngineRun", () => {
  it("polls the engine DTO every few seconds while the import is running", async () => {
    expect(ENGINE_POLL_MS).toBe(3000);
    mocks.engine
      .mockResolvedValueOnce(
        engineRun({
          state: "running",
          phase: "executing",
          stats: { created: 10 },
        }),
      )
      .mockResolvedValue(
        engineRun({
          state: "running",
          phase: "executing",
          stats: { created: 60 },
        }),
      );
    renderWithQuery(<Poller />);
    await waitFor(() =>
      expect(screen.getByLabelText("done").textContent).toBe("10"),
    );
    await waitFor(
      () => expect(screen.getByLabelText("done").textContent).toBe("60"),
      {
        timeout: 6000,
      },
    );
    expect(mocks.engine.mock.calls.length).toBeGreaterThanOrEqual(2);
  }, 12000);

  it("does not poll an idle run", async () => {
    mocks.engine.mockResolvedValue(engineRun());
    renderWithQuery(<Poller />);
    await waitFor(() => expect(mocks.engine).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 3400));
    expect(mocks.engine).toHaveBeenCalledTimes(1);
  }, 8000);
});
