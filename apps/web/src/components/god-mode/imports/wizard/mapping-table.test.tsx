import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MappingEntry } from "@/fetchers/god-mode/imports";
import { HttpError } from "@/lib/http-error";
import {
  engineRun,
  i18nMock,
  mappingOf,
  renderWithQuery,
} from "./test-support";

const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));

vi.mock("react-i18next", () => i18nMock());
vi.mock("@/fetchers/god-mode/imports", async (original) => ({
  ...(await original<typeof import("@/fetchers/god-mode/imports")>()),
  getImportMapping: (...args: unknown[]) => mocks.get(...args),
  saveImportMapping: (...args: unknown[]) => mocks.save(...args),
}));
vi.mock("./use-target-catalogue", () => ({
  useTargetCatalogue: () => ({
    catalogue: { type: [{ id: "type-bug", name: "Bug" }] },
    failed: [],
    loading: false,
  }),
}));

import { MappingStep } from "./mapping-table";

const entry = (
  domain: MappingEntry["domain"],
  value: string,
  status: MappingEntry["status"],
  target: MappingEntry["target"],
  affected: number,
): MappingEntry => ({ domain, value, status, target, affected });

const initial = () => [
  entry("type", "Bug", "unmapped", null, 4000),
  entry(
    "state",
    "Done",
    "proposed",
    { kind: "group", group: "completed" },
    120,
  ),
  entry(
    "priority",
    "High",
    "confirmed",
    { kind: "priority", value: "high" },
    15,
  ),
];
const confirmed = (version: number) =>
  mappingOf(
    [
      entry(
        "type",
        "Bug",
        "confirmed",
        { kind: "target", id: "type-bug" },
        4000,
      ),
      entry(
        "state",
        "Done",
        "confirmed",
        { kind: "group", group: "completed" },
        120,
      ),
      entry(
        "priority",
        "High",
        "confirmed",
        { kind: "priority", value: "high" },
        15,
      ),
    ],
    version,
  );

beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue(mappingOf(initial(), 3));
  mocks.save.mockReset();
});
afterEach(cleanup);

function renderStep(onContinue = vi.fn()) {
  renderWithQuery(
    <MappingStep
      run={engineRun({ phase: "discovered" })}
      onContinue={onContinue}
    />,
  );
  return { onContinue };
}

const continueButton = () =>
  screen.getByRole("button", {
    name: "Continue to dry run",
  }) as HTMLButtonElement;

describe("MappingStep", () => {
  it("highlights unmapped rows with their affected count and blocks continuing until every row is confirmed", async () => {
    const { onContinue } = renderStep();
    const bug = (await screen.findByText("Bug", { selector: "td" })).closest(
      "tr",
    );
    expect(bug?.getAttribute("data-status")).toBe("unmapped");
    expect(bug?.textContent).toContain("4000");
    expect(screen.getByText("Mapping is incomplete")).toBeTruthy();
    expect(continueButton().disabled).toBe(true);
    fireEvent.click(continueButton());
    expect(onContinue).not.toHaveBeenCalled();

    // Choosing a target saves with the version the screen was loaded at.
    mocks.save.mockResolvedValue(
      mappingOf(
        [
          entry(
            "type",
            "Bug",
            "confirmed",
            { kind: "target", id: "type-bug" },
            4000,
          ),
          entry(
            "state",
            "Done",
            "proposed",
            { kind: "group", group: "completed" },
            120,
          ),
          entry(
            "priority",
            "High",
            "confirmed",
            { kind: "priority", value: "high" },
            15,
          ),
        ],
        4,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Target for Bug" }));
    fireEvent.click(await screen.findByRole("button", { name: "Bug" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0]?.[1]).toEqual({
      expectedMappingVersion: 3,
      entries: [
        {
          domain: "type",
          value: "Bug",
          target: { kind: "target", id: "type-bug" },
        },
      ],
    });
    expect(mocks.save.mock.calls[0]?.[2]).toEqual(expect.any(String));
    // The proposal still needs a decision, so execution stays blocked.
    await waitFor(() => expect(screen.getByText("Confirmed: 2")).toBeTruthy());
    expect(continueButton().disabled).toBe(true);

    // One deliberate click accepts every proposal.
    mocks.save.mockResolvedValue(confirmed(5));
    fireEvent.click(screen.getByRole("button", { name: "Confirm proposals" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[1]?.[1]).toEqual({
      expectedMappingVersion: 4,
      entries: [],
      confirmProposals: true,
    });
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    fireEvent.click(continueButton());
    expect(onContinue).toHaveBeenCalled();
  });

  it("rolls back a rejected edit on a version conflict and retries it against the newer version with a new key", async () => {
    renderStep();
    await screen.findByText("Bug", { selector: "td" });
    mocks.save.mockRejectedValueOnce(new HttpError(409, "conflict"));
    mocks.get.mockReset().mockResolvedValue(mappingOf(initial(), 4));
    fireEvent.click(screen.getByRole("button", { name: "Target for Bug" }));
    fireEvent.click(await screen.findByRole("button", { name: "Bug" }));

    expect(
      await screen.findByText("The mapping changed elsewhere"),
    ).toBeTruthy();
    // Optimistic change was rolled back.
    const bug = screen.getByText("Bug", { selector: "td" }).closest("tr");
    expect(bug?.getAttribute("data-status")).toBe("unmapped");
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());

    mocks.save.mockResolvedValue(confirmed(5));
    const retry = await screen.findByRole("button", { name: "Retry edit" });
    await waitFor(() =>
      expect((retry as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[0]?.[1].expectedMappingVersion).toBe(3);
    expect(mocks.save.mock.calls[1]?.[1].expectedMappingVersion).toBe(4);
    expect(mocks.save.mock.calls[1]?.[1].entries).toEqual(
      mocks.save.mock.calls[0]?.[1].entries,
    );
    expect(mocks.save.mock.calls[1]?.[2]).not.toBe(
      mocks.save.mock.calls[0]?.[2],
    );
    await waitFor(() =>
      expect(screen.queryByText("The mapping changed elsewhere")).toBeNull(),
    );
  });

  it("can show only the rows that still need a decision", async () => {
    renderStep();
    await screen.findByText("Bug", { selector: "td" });
    expect(screen.getByText("High", { selector: "td" })).toBeTruthy();
    fireEvent.click(
      screen.getByRole("switch", { name: "Only rows that need a decision" }),
    );
    expect(screen.queryByText("High", { selector: "td" })).toBeNull();
    expect(screen.getByText("Done", { selector: "td" })).toBeTruthy();
  });
});
