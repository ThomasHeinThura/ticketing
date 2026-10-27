import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { i18nMock, renderWithQuery, setupJob } from "./test-support";

vi.mock("react-i18next", () => i18nMock());

import {
  SETUP_JOB_STALE_MS,
  SetupJobProgress,
  setupJobIsStale,
} from "./setup-job-progress";

afterEach(cleanup);

describe("SetupJobProgress", () => {
  it("shows pages and records, with a percentage once the total is known", () => {
    renderWithQuery(
      <SetupJobProgress
        job={setupJob({
          kind: "dry_run",
          pagesRead: 2,
          recordsProcessed: 500,
          totalRecords: 1000,
        })}
        continuing={false}
        onContinue={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Records: 500 of 1000 (50%). Pages read: 2."),
    ).toBeTruthy();
    expect(
      screen.getByRole("progressbar", { name: "Dry run progress" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  });

  it("offers to continue a step that stopped reporting progress", () => {
    const old = new Date(Date.now() - SETUP_JOB_STALE_MS - 1000).toISOString();
    const job = setupJob({
      updatedAt: old,
      pagesRead: 7,
      recordsProcessed: 70,
    });
    expect(setupJobIsStale(job)).toBe(true);
    expect(setupJobIsStale(setupJob())).toBe(false);
    const onContinue = vi.fn();
    renderWithQuery(
      <SetupJobProgress job={job} continuing={false} onContinue={onContinue} />,
    );
    expect(screen.getByText("Pages read: 7. Records: 70.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("never shows a live job as stalled while its lease heartbeat is fresh (P6-R2-02)", () => {
    const now = Date.now();
    const old = new Date(now - SETUP_JOB_STALE_MS - 60_000).toISOString();
    // Slow discovery: no progress for minutes, but the worker still holds and renews the lease.
    const live = setupJob({
      updatedAt: old,
      heartbeatAt: new Date(now - 5_000).toISOString(),
      pagesRead: 1,
      recordsProcessed: 0,
    });
    expect(setupJobIsStale(live, now)).toBe(false);
    renderWithQuery(
      <SetupJobProgress job={live} continuing={false} onContinue={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();

    // Both stamps old: the worker is gone and the job is stalled.
    expect(
      setupJobIsStale(setupJob({ updatedAt: old, heartbeatAt: old }), now),
    ).toBe(true);
    // A finished or failed job is never stalled, however old.
    expect(
      setupJobIsStale(
        setupJob({ status: "completed", updatedAt: old, heartbeatAt: old }),
        now,
      ),
    ).toBe(false);
    expect(
      setupJobIsStale(
        setupJob({ status: "failed", updatedAt: old, heartbeatAt: null }),
        now,
      ),
    ).toBe(false);
  });
});
