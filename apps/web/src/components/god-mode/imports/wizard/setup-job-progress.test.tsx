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
});
