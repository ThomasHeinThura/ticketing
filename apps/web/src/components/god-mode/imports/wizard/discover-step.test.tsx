import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  engineRun,
  i18nMock,
  mappingOf,
  renderWithQuery,
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
  it("discovers once with an idempotency key and summarises what was found", async () => {
    const onDiscovered = vi.fn();
    mocks.discover.mockResolvedValue({
      ...mappingOf([]),
      discovery: {
        totalRecords: 48391,
        counts: { issue: 40000, epic: 8391 },
        facets: [
          { domain: "state", value: "Open", count: 100 },
          { domain: "state", value: "Done", count: 200 },
          { domain: "type", value: "Bug", count: 50 },
        ],
      },
    });
    renderWithQuery(
      <DiscoverStep
        run={engineRun({ phase: "created" })}
        onDiscovered={onDiscovered}
      />,
    );
    expect(await screen.findByText("Nothing discovered yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Run discovery" }));
    expect(await screen.findByText("48391")).toBeTruthy();
    expect(mocks.discover).toHaveBeenCalledWith("run-1", expect.any(String));
    expect(screen.getByText("issue")).toBeTruthy();
    expect(screen.getByText("State: 2 · Records: 300")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to mapping" }),
    );
    expect(onDiscovered).toHaveBeenCalled();
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
