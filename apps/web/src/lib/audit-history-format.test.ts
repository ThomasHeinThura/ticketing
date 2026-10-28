import { describe, expect, it } from "vitest";
import {
  auditActionLabel,
  auditFieldLabel,
  auditValueLabel,
  humanizeKey,
  richTextToPlain,
} from "./audit-history-format";

// A catalogue-less translator: the defaultValue is the label.
const t = (_key: string, options?: Record<string, unknown>) =>
  String(options?.defaultValue ?? _key);

const lookups = {
  states: new Map([["st_1", "In progress"]]),
  people: new Map([["p_1", "Ada Lovelace"]]),
  unknown: "Unavailable",
  empty: "(empty)",
  none: "None",
  priority: (value: string) => `P:${value}`,
};

describe("audit history labels", () => {
  it("never shows a raw dotted action or field key", () => {
    expect(humanizeKey("work_item.transitioned")).toBe(
      "Work item transitioned",
    );
    expect(auditActionLabel("work_item.transitioned", t)).toBe(
      "Work item transitioned",
    );
    expect(auditFieldLabel("due_date", t)).toBe("Due date");
  });

  it("resolves state and person ids to names and hides unresolved ids", () => {
    expect(auditValueLabel("stateId", "st_1", lookups)).toBe("In progress");
    expect(auditValueLabel("stateId", "st_gone", lookups)).toBe("Unavailable");
    expect(auditValueLabel("assigneeId", "p_1", lookups)).toBe("Ada Lovelace");
    expect(auditValueLabel("assigneeId", "p_x", lookups)).toBe("Unavailable");
    expect(auditValueLabel("project", "cuid123", lookups)).toBe("Unavailable");
    expect(auditValueLabel("assigneeId", null, lookups)).toBe("None");
    expect(auditValueLabel("priority", "high", lookups)).toBe("P:high");
  });

  it("shows rich text as truncated plain text", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
        { type: "paragraph", content: [{ type: "text", text: "world" }] },
      ],
    });
    expect(richTextToPlain(doc)).toBe("Hello world");
    expect(auditValueLabel("description", doc, lookups)).toBe("Hello world");
    const long = JSON.stringify({
      type: "doc",
      content: [{ type: "text", text: "x".repeat(500) }],
    });
    const shown = auditValueLabel("description", long, lookups);
    expect(shown.length).toBeLessThanOrEqual(120);
    expect(shown.endsWith("…")).toBe(true);
    expect(
      auditValueLabel("description", JSON.stringify({ type: "doc" }), lookups),
    ).toBe("(empty)");
  });
});
