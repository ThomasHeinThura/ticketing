import { describe, expect, it } from "vitest";
import {
  assigneeDisplayText,
  resolveAssigneeDisplay,
} from "./work-item-assignee-display";

const labels = {
  unassigned: "Unassigned",
  inactive: "(inactive)",
  notOnProject: "(no longer on this project)",
};
const base = { assigneeId: "p1", assigneeName: "Jane Smith" };

describe("AS-8 assignee display", () => {
  it("unassigned", () => {
    const display = resolveAssigneeDisplay({
      assigneeId: null,
      assigneeName: null,
    });
    expect(assigneeDisplayText(display, labels)).toBe("Unassigned");
  });

  it("keeps the unresolvable-name fallback", () => {
    const display = resolveAssigneeDisplay({ ...base, assigneeName: null });
    expect(assigneeDisplayText(display, labels)).toBe("(inactive)");
  });

  it("an active assignee on the project shows just the name", () => {
    const display = resolveAssigneeDisplay({
      ...base,
      assigneeActive: true,
      assigneeOnProject: true,
    });
    expect(assigneeDisplayText(display, labels)).toBe("Jane Smith");
  });

  it("a deactivated assignee shows 'Jane Smith (inactive)'", () => {
    const display = resolveAssigneeDisplay({
      ...base,
      assigneeActive: false,
      assigneeOnProject: true,
    });
    expect(assigneeDisplayText(display, labels)).toBe("Jane Smith (inactive)");
  });

  it("an assignee who left the project shows the roster suffix, even when also inactive", () => {
    for (const active of [true, false]) {
      const display = resolveAssigneeDisplay({
        ...base,
        assigneeActive: active,
        assigneeOnProject: false,
      });
      expect(assigneeDisplayText(display, labels)).toBe(
        "Jane Smith (no longer on this project)",
      );
    }
  });

  it("a producer without the facts renders the name, never a guessed status", () => {
    const display = resolveAssigneeDisplay(base);
    expect(assigneeDisplayText(display, labels)).toBe("Jane Smith");
  });
});
