import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  engineRun,
  i18nMock,
  mappingOf,
  renderWithQuery,
  setupJob,
} from "./test-support";

const mocks = vi.hoisted(() => ({ discover: vi.fn(), mapping: vi.fn() }));

vi.mock("react-i18next", () => i18nMock());
vi.mock("@/fetchers/god-mode/imports", async (original) => ({
  ...(await original<typeof import("@/fetchers/god-mode/imports")>()),
  discoverImportRun: (...args: unknown[]) => mocks.discover(...args),
  getImportMapping: (...args: unknown[]) => mocks.mapping(...args),
}));

import { DiscoverStep } from "./discover-step";

beforeEach(() => {
  mocks.discover.mockReset();
  mocks.mapping.mockReset();
});
afterEach(cleanup);

describe("DiscoverStep", () => {
  it("starts discovery once, shows its progress, then summarises what was found", async () => {
    const onDiscovered = vi.fn();
    mocks.discover.mockResolvedValue({
      status: "accepted",
      job: setupJob(),
      run: engineRun({ phase: "created", job: setupJob() }),
    });
    mocks.mapping.mockResolvedValue({
      ...mappingOf([]),
      discovery: {
        totalRecords: 48391,
        counts: { issue: 40000, epic: 8391 },
        unreadable: { unreadable_item: 2, missing_title: 1 },
        facets: [
          { domain: "state", value: "Open", count: 100 },
          { domain: "state", value: "Done", count: 200 },
          { domain: "type", value: "Bug", count: 50 },
        ],
      },
    });
    const view = renderWithQuery(
      <DiscoverStep
        run={engineRun({ phase: "created" })}
        onDiscovered={onDiscovered}
      />,
    );
    expect(await screen.findByText("Nothing discovered yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Run discovery" }));
    await waitFor(() =>
      expect(mocks.discover).toHaveBeenCalledWith("run-1", expect.any(String)),
    );
    // The polled run reports the background job: progress, and no second start while it runs.
    view.rerender(
      <DiscoverStep
        run={engineRun({
          phase: "created",
          job: setupJob({ pagesRead: 3, recordsProcessed: 1500 }),
        })}
        onDiscovered={onDiscovered}
      />,
    );
    expect(
      await screen.findByText("Pages read: 3. Records: 1500."),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Run discovery",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(mocks.discover).toHaveBeenCalledTimes(1);
    view.rerender(
      <DiscoverStep
        run={engineRun({
          phase: "discovered",
          job: setupJob({ status: "completed", pagesRead: 97 }),
        })}
        onDiscovered={onDiscovered}
      />,
    );
    expect(await screen.findByText("48391")).toBeTruthy();
    expect(screen.getByText("issue")).toBeTruthy();
    expect(screen.getByText("State: 2 · Records: 300")).toBeTruthy();
    expect(
      screen.getByText("Some source items cannot be imported"),
    ).toBeTruthy();
    expect(
      screen.getByText("Items the source listed but did not return: 2"),
    ).toBeTruthy();
    expect(screen.getByText("Items without a title: 1")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to mapping" }),
    );
    expect(onDiscovered).toHaveBeenCalled();
  });

  it("explains a failed background discovery by its fixed code", async () => {
    mocks.mapping.mockResolvedValue(mappingOf([]));
    renderWithQuery(
      <DiscoverStep
        run={engineRun({
          phase: "created",
          job: setupJob({ status: "failed", failure: "auth_failed" }),
        })}
        onDiscovered={vi.fn()}
      />,
    );
    expect(await screen.findByText("Discovery failed")).toBeTruthy();
    expect(screen.getByText("The source refused the credential.")).toBeTruthy();
  });

  it("reports a failed discovery without a credential or detail", async () => {
    mocks.discover.mockRejectedValue(new Error("Source connection failed"));
    renderWithQuery(
      <DiscoverStep
        run={engineRun({ phase: "created" })}
        onDiscovered={vi.fn()}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Run discovery" }),
    );
    expect(await screen.findByText("Discovery failed")).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByText("Source connection failed")).toBeNull(),
    );
  });
});
