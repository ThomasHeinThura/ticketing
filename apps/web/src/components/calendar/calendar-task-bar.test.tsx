import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import CalendarTaskBar from "./calendar-task-bar";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

// Formats from local parts, so the expected label does not move with the
// runner's timezone the way toISOString would.
vi.mock("@/lib/format", () => ({
  formatDateShort: (value: Date) =>
    [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, "0"),
      String(value.getDate()).padStart(2, "0"),
    ].join("-"),
}));

/**
 * Resolves against the real en-US bundle and applies i18next-style
 * interpolation, so the assertions fail if the key stops passing a value the
 * source string expects.
 */
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, options),
  }),
}));

const segment = {
  task: {
    id: "t1",
    title: "Design review",
    number: 12,
    status: "in-review",
    scheduleStart: new Date(2026, 7, 10),
    scheduleEnd: new Date(2026, 7, 12),
  },
  lane: 0,
  columnStart: 1,
  columnEnd: 4,
  continuesBefore: false,
  continuesAfter: false,
};

describe("CalendarTaskBar", () => {
  it("announces the task title and its scheduled range", () => {
    render(
      <CalendarTaskBar
        segment={segment}
        projectSlug="KAN"
        onOpenTask={vi.fn()}
      />,
    );

    expect(screen.getByRole("button")).toHaveAccessibleName(
      translate("tasks:calendar.taskAriaLabel", {
        title: "Design review",
        range: "2026-08-10 – 2026-08-12",
      }),
    );
  });

  it("leaves no interpolation placeholder unresolved", () => {
    render(
      <CalendarTaskBar
        segment={segment}
        projectSlug="KAN"
        onOpenTask={vi.fn()}
      />,
    );

    const label = screen.getByRole("button").getAttribute("aria-label") ?? "";

    expect(label).not.toMatch(/\{\{\w+\}\}/);
  });

  it.each([
    ["completed", "bg-success/15", /Completed$/],
    ["cancelled", "bg-muted/60", /Cancelled$/],
    ["open", "bg-info/15", /Open$/],
    [undefined, "bg-info/15", null],
  ] as const)(
    "colours and names stateCategory=%s by category, not state name",
    (stateCategory, expectedClass, label) => {
      render(
        <CalendarTaskBar
          segment={{
            ...segment,
            task: { ...segment.task, status: "custom-status", stateCategory },
          }}
          projectSlug="KAN"
          onOpenTask={vi.fn()}
        />,
      );

      const taskBar = screen.getByRole("button");
      expect(taskBar).toHaveClass(expectedClass);
      if (label) expect(taskBar.getAttribute("aria-label")).toMatch(label);
      else expect(taskBar.getAttribute("aria-label")).not.toMatch(/Open$/);
    },
  );

  it("keeps the change-calendar frozen colour and adds no state label", () => {
    render(
      <CalendarTaskBar
        segment={{
          ...segment,
          task: {
            ...segment.task,
            status: "frozen",
            changeKind: "frozen",
            stateCategory: "open",
          },
        }}
        projectSlug="KAN"
        onOpenTask={vi.fn()}
      />,
    );

    expect(screen.getByRole("button")).toHaveClass("bg-red-500/15");
    expect(screen.getByRole("button").getAttribute("aria-label")).not.toMatch(
      /Open$/,
    );
  });

  it.each(["freeze", "frozen", "conflict"])(
    "ignores a project state named %s without an explicit change kind",
    (status) => {
      render(
        <CalendarTaskBar
          segment={{
            ...segment,
            task: { ...segment.task, status, stateCategory: "completed" },
          }}
          projectSlug="KAN"
          onOpenTask={vi.fn()}
        />,
      );

      const taskBar = screen.getByRole("button");
      expect(taskBar).toHaveClass("bg-success/15");
      expect(taskBar.getAttribute("aria-label")).toMatch(/Completed$/);
    },
  );

  it("insets continuing bars and squares only the continuing side", () => {
    render(
      <CalendarTaskBar
        segment={{ ...segment, continuesBefore: true, continuesAfter: false }}
        projectSlug="KAN"
        onOpenTask={vi.fn()}
      />,
    );

    const taskBar = screen.getByRole("button");
    expect(taskBar).toHaveClass("mx-1", "rounded-l-none", "rounded-r-md");
    expect(taskBar).not.toHaveClass("border-l-0");
  });

  it("is a toggle named for the work item while selection mode is on (VW-3)", () => {
    render(
      <CalendarTaskBar
        segment={segment}
        projectSlug="KAN"
        onOpenTask={vi.fn()}
        selectionMode
        isSelected
      />,
    );

    const taskBar = screen.getByRole("button", { name: "Select KAN-12" });
    expect(taskBar).toHaveAttribute("aria-pressed", "true");
    expect(taskBar).toHaveClass("ring-2");
  });

  it("is not a toggle outside selection mode", () => {
    render(
      <CalendarTaskBar
        segment={segment}
        projectSlug="KAN"
        onOpenTask={vi.fn()}
      />,
    );

    expect(screen.getByRole("button")).not.toHaveAttribute("aria-pressed");
  });
});
