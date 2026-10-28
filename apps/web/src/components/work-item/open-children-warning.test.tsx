import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkItemBlockedBadge } from "./work-item-blocked-badge";

const getHierarchyChildren = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/work-item/get-hierarchy-children", () => ({
  getHierarchyChildren,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { fetchOpenChildren, isClosingCategory } from "./open-children-warning";

afterEach(() => {
  cleanup();
  getHierarchyChildren.mockReset();
});

const child = (key: string, stateCategory: string) => ({
  key,
  title: `Title ${key}`,
  stateName: stateCategory,
  stateCategory,
});

describe("RH-10 / WI-18 open children warning data", () => {
  it("only a move into completed or cancelled counts as closing", () => {
    expect(isClosingCategory("completed")).toBe(true);
    expect(isClosingCategory("cancelled")).toBe(true);
    expect(isClosingCategory("started")).toBe(false);
    expect(isClosingCategory(undefined)).toBe(false);
  });

  it("lists the open direct children and reports the subtree total", async () => {
    getHierarchyChildren.mockResolvedValue({
      data: [child("A-1", "started"), child("A-2", "completed")],
      progress: { total: 3, completed: 1 },
    });
    expect(await fetchOpenChildren("A-0")).toEqual({
      openInSubtree: 2,
      listed: [{ key: "A-1", title: "Title A-1", stateName: "started" }],
    });
  });

  it("returns null when everything below is closed, so closing is not interrupted", async () => {
    getHierarchyChildren.mockResolvedValue({
      data: [child("A-1", "completed")],
      progress: { total: 1, completed: 1 },
    });
    expect(await fetchOpenChildren("A-0")).toBeNull();
  });

  it("never blocks the transition when the hierarchy cannot be read", async () => {
    getHierarchyChildren.mockRejectedValue(new Error("network"));
    expect(await fetchOpenChildren("A-0")).toBeNull();
  });
});

describe("RH-17 blocked badge", () => {
  it("renders only for a positive open-blocker count", () => {
    const { rerender } = render(
      <WorkItemBlockedBadge blockedByOpenCount={undefined} />,
    );
    expect(screen.queryByTestId("work-item-blocked-badge")).toBeNull();
    rerender(<WorkItemBlockedBadge blockedByOpenCount={0} />);
    expect(screen.queryByTestId("work-item-blocked-badge")).toBeNull();
    rerender(<WorkItemBlockedBadge blockedByOpenCount={2} />);
    expect(screen.getByTestId("work-item-blocked-badge")).toHaveTextContent(
      "workItems:blocked.badge",
    );
  });
});
