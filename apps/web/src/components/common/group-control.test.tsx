import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import GroupControl from "./group-control";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, options),
  }),
}));

afterEach(cleanup);

describe("GroupControl (VW-13)", () => {
  it("reads as ungrouped for the default and names the active grouping otherwise", () => {
    const { rerender } = render(
      <GroupControl
        group="state"
        onGroupChange={vi.fn()}
        groups={["state", "assignee", "priority"]}
      />,
    );
    expect(screen.getByRole("button", { name: "Group" })).toBeInTheDocument();
    rerender(
      <GroupControl
        group="assignee"
        onGroupChange={vi.fn()}
        groups={["state", "assignee", "priority"]}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Assignee" }),
    ).toBeInTheDocument();
  });

  it("offers exactly the groupings it is given and reports the chosen one", async () => {
    const onGroupChange = vi.fn();
    render(
      <GroupControl
        group="state"
        onGroupChange={onGroupChange}
        groups={["state", "assignee"]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Group" }));
    expect(await screen.findAllByRole("menuitem")).toHaveLength(2);
    expect(screen.queryByRole("menuitem", { name: "Priority" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Assignee" }));
    expect(onGroupChange).toHaveBeenCalledWith("assignee");
  });
});
