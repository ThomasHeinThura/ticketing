import enUS from "@i18n/en-US.json";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ScheduleFilterChips, {
  buildScheduleFilterChips,
} from "./schedule-filter-chips";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const [namespace, path] = key.split(":");
      const source = path
        .split(".")
        .reduce<unknown>(
          (accumulator, part) =>
            (accumulator as Record<string, unknown> | undefined)?.[part],
          (enUS as Record<string, unknown>)[namespace],
        );
      if (typeof source !== "string") return key;
      return source.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(options?.[name] ?? `{{${name}}}`),
      );
    },
  }),
}));

afterEach(cleanup);

describe("buildScheduleFilterChips (VW-34)", () => {
  it("returns nothing for an unfiltered view", () => {
    expect(buildScheduleFilterChips({})).toEqual([]);
    expect(buildScheduleFilterChips({ filter: "  " })).toEqual([]);
  });

  it("splits an AND filter into one removable chip per clause", () => {
    const chips = buildScheduleFilterChips({
      filter: "assignee:@me priority:high",
    });
    expect(chips.map((chip) => chip.kind)).toEqual([
      "structured",
      "structured",
    ]);
    expect(
      chips.map((chip) => chip.kind === "structured" && chip.remaining),
    ).toEqual(["priority:high", "assignee:@me"]);
  });

  it("keeps an OR group whole so removing it clears the whole group", () => {
    const chips = buildScheduleFilterChips({
      filter: "assignee:@me OR priority:high",
    });
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ kind: "group", remaining: undefined });
  });

  it("shows unparseable text instead of hiding it", () => {
    const chips = buildScheduleFilterChips({ filter: "state:(" });
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ kind: "group", text: "state:(" });
  });

  it("adds a chip for each legacy facet in the URL", () => {
    const chips = buildScheduleFilterChips({
      status: ["todo", "done"],
      labels: ["a"],
    });
    expect(chips).toMatchObject([
      { kind: "legacy", facet: "status", count: 2 },
      { kind: "legacy", facet: "labels", count: 1 },
    ]);
  });
});

describe("ScheduleFilterChips", () => {
  it("renders nothing when there is no filter", () => {
    const { container } = render(
      <ScheduleFilterChips search={{}} onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("removes one clause and keeps the rest of the filter", () => {
    const onChange = vi.fn();
    render(
      <ScheduleFilterChips
        search={{ filter: "assignee:@me priority:high" }}
        onChange={onChange}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Assignee filter" }),
    );
    expect(onChange).toHaveBeenCalledWith({ filter: "priority:high" });
  });

  it("clears a legacy facet", () => {
    const onChange = vi.fn();
    render(
      <ScheduleFilterChips search={{ status: ["todo"] }} onChange={onChange} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Status filter" }),
    );
    expect(onChange).toHaveBeenCalledWith({ status: undefined });
  });
});
