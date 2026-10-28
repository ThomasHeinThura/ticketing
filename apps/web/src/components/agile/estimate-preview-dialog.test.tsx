import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EstimatePreview } from "@/fetchers/agile";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));

import { EstimatePreviewDialog } from "./estimate-preview-dialog";

const preview: EstimatePreview = {
  fromSystem: "points",
  toSystem: "categories",
  mapping: [
    {
      fromPointId: "p1",
      fromValue: "1",
      toKey: null,
      toValue: null,
      itemCount: 4,
    },
    {
      fromPointId: "p2",
      fromValue: "M",
      toKey: "k3",
      toValue: "M",
      itemCount: 2,
    },
    {
      fromPointId: "p3",
      fromValue: "21",
      toKey: null,
      toValue: null,
      itemCount: 0,
    },
  ],
  mappedItems: 2,
  clearedItems: 4,
  activeCycles: [{ id: "c1", name: "Sprint 4" }],
};

afterEach(cleanup);

describe("EstimatePreviewDialog", () => {
  it("lists what maps and what clears, only for points in use", () => {
    render(
      <EstimatePreviewDialog
        preview={preview}
        busy={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId("estimate-preview-totals").textContent).toContain(
      '"mapped":2,"cleared":4',
    );
    const rows = screen.getAllByRole("row");
    // header + the two points that have work items
    expect(rows).toHaveLength(3);
    expect(rows[1]?.textContent).toContain("estimates.preview.cleared");
    expect(rows[2]?.textContent).toContain("M");
  });

  it("warns about a change in the middle of a cycle and about cleared estimates", () => {
    render(
      <EstimatePreviewDialog
        preview={preview}
        busy={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId("estimate-preview-cycles").textContent).toContain(
      "Sprint 4",
    );
    expect(screen.getByText(/estimates.preview.clearWarning/)).toBeTruthy();
  });

  it("confirms only on the explicit button", () => {
    const onConfirm = vi.fn();
    render(
      <EstimatePreviewDialog
        preview={preview}
        busy={false}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "estimates.preview.confirm" }),
    );
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
