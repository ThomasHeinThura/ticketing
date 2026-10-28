import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      `${key} ${JSON.stringify(options)}`,
  }),
}));

import ColumnCountBadge from "./column-count-badge";

afterEach(cleanup);

describe("ColumnCountBadge (VW-12)", () => {
  it("shows the plain count without a limit", () => {
    render(<ColumnCountBadge total={4} state="Doing" />);
    const badge = screen.getByRole("img");
    expect(badge.textContent).toBe("4");
    expect(badge.getAttribute("aria-label")).toContain(
      "workItems:board.columnCount ",
    );
  });

  it("shows count / limit within the limit, not amber", () => {
    render(<ColumnCountBadge total={3} limit={3} state="Doing" />);
    const badge = screen.getByRole("img");
    expect(badge.textContent).toBe("3 / 3");
    expect(badge.getAttribute("data-wip-exceeded")).toBe("false");
  });

  it("turns amber past the limit with a non-colour cue in the accessible name", () => {
    render(<ColumnCountBadge total={5} limit={3} state="Doing" />);
    const badge = screen.getByRole("img");
    expect(badge.getAttribute("data-wip-exceeded")).toBe("true");
    expect(badge.getAttribute("aria-label")).toContain(
      "workItems:board.columnCountOverLimit",
    );
    expect(badge.querySelector("svg")).not.toBeNull();
    expect(badge.className).toContain("text-warning-foreground");
  });
});
