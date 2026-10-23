import { describe, expect, it } from "vitest";
import {
  createChecklistTemplateBody,
  createWorkItemTemplateBody,
  updateChecklistTemplateBody,
  updateWorkItemTemplateBody,
} from "../../../apps/api/src/work-item/templates/schema";

describe("work item template bodies (WI-5)", () => {
  const valid = { name: "Bug", typeId: "type-1", title: "Bug: " };

  it("accepts a minimal template and defaults nothing the template must not carry", () => {
    const parsed = createWorkItemTemplateBody.parse(valid);
    expect(parsed).toEqual(valid);
    expect("assigneeId" in parsed).toBe(false);
  });

  it("rejects assignee and date fields by omission from the shape", () => {
    const parsed = createWorkItemTemplateBody.parse({
      ...valid,
      assigneeId: "p",
      dueDate: "2026-01-01",
    });
    expect(parsed).not.toHaveProperty("assigneeId");
    expect(parsed).not.toHaveProperty("dueDate");
  });

  it("rejects NUL bytes, empty names and duplicate labels", () => {
    expect(() =>
      createWorkItemTemplateBody.parse({ ...valid, name: "a\u0000b" }),
    ).toThrow();
    expect(() =>
      createWorkItemTemplateBody.parse({ ...valid, name: "  " }),
    ).toThrow();
    expect(() =>
      createWorkItemTemplateBody.parse({ ...valid, labelIds: ["a", "a"] }),
    ).toThrow();
    expect(() =>
      createWorkItemTemplateBody.parse({
        ...valid,
        description: { text: "x\u0000" },
      }),
    ).toThrow();
  });

  it("requires at least one field to update, and lets the checklist link be cleared", () => {
    expect(() => updateWorkItemTemplateBody.parse({})).toThrow();
    expect(
      updateWorkItemTemplateBody.parse({ checklistTemplateId: null }),
    ).toEqual({ checklistTemplateId: null });
  });
});

describe("checklist template bodies (WI-5)", () => {
  it("bounds the item list and trims items", () => {
    expect(
      createChecklistTemplateBody.parse({ name: "C", items: ["  one  "] }),
    ).toEqual({ name: "C", items: ["one"] });
    expect(() =>
      createChecklistTemplateBody.parse({
        name: "C",
        items: Array.from({ length: 101 }, () => "x"),
      }),
    ).toThrow();
    expect(() =>
      createChecklistTemplateBody.parse({ name: "C", items: [""] }),
    ).toThrow();
  });

  it("requires something to update", () => {
    expect(() => updateChecklistTemplateBody.parse({})).toThrow();
    expect(updateChecklistTemplateBody.parse({ items: [] })).toEqual({
      items: [],
    });
  });
});
