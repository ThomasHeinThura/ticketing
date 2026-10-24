import { describe, expect, it } from "vitest";
import {
  parseFilterText,
  printFilterText,
  validateWorkItemSearchQuery,
} from "../../apps/api/src/work-item/search/query";

describe("bounded work-item search query", () => {
  it("round-trips nested in/OR terms through the canonical AST", () => {
    const text =
      'state:in(started,completed) OR (assignee:@me AND project:"SUP:Service")';
    const ast = parseFilterText(text);
    expect(parseFilterText(printFilterText(ast))).toEqual(ast);
  });

  it("rejects arbitrary entities, unknown fields, and unavailable backing fields", () => {
    expect(() =>
      validateWorkItemSearchQuery({ entity: "submission" }),
    ).toThrowError(/P1 search supports/);
    expect(() =>
      validateWorkItemSearchQuery({
        entity: "work_item",
        filter: { field: "privateColumn", op: "eq", value: "x" },
      }),
    ).toThrowError(/Unknown filter field/);
    expect(() =>
      validateWorkItemSearchQuery({
        entity: "work_item",
        filter: { field: "label", op: "eq", value: "x" },
      }),
    ).toThrowError(/unavailable: label/);
  });

  it.each([
    "requester",
    "cycle",
    "module",
    "epic",
    "organisation",
    "sla.state",
  ])("returns 422 naming recognised-but-unavailable field %s", (field) => {
    let caught: { status?: number; message?: string } | undefined;
    try {
      validateWorkItemSearchQuery({
        entity: "work_item",
        filter: { field, op: "eq", value: "x" },
      });
    } catch (error) {
      caught = error as { status?: number; message?: string };
    }
    expect(caught?.status).toBe(422);
    expect(caught?.message).toContain(`unavailable: ${field}`);
  });

  it("accepts cf.<key> filters structurally (CF-10) and rejects malformed ones with 400", () => {
    for (const filter of [
      { field: "cf.severity", op: "eq", value: "high" },
      { field: "cf.cost", op: "gte", value: 5 },
      { field: "cf.tags", op: "in", value: ["a", "b"] },
      { field: "cf.note", op: "is_set", value: false },
    ])
      expect(
        validateWorkItemSearchQuery({ entity: "work_item", filter }).filter,
      ).toEqual(filter);
    for (const filter of [
      { field: "cf.bad key", op: "eq", value: "x" },
      { field: "cf.x", op: "like", value: "x" },
      { field: "cf.x", op: "is_set", value: "yes" },
      { field: "cf.x", op: "in", value: [] },
      { field: "cf.x", op: "eq", value: { nested: true } },
    ])
      expect(() =>
        validateWorkItemSearchQuery({ entity: "work_item", filter }),
      ).toThrowError(/cf\./);
  });

  it("round-trips the cf.<key> text grammar, including neq and is_set", () => {
    for (const text of [
      "cf.severity:high",
      "cf.cost:>=5 AND cf.cost:<100",
      "cf.severity:!=low",
      "cf.tags:contains(a)",
      "cf.severity:in(high,low)",
      "cf.note:is_set",
      "cf.note:not_set",
      'cf.note:"is_set"',
      'cf.note:"!= odd"',
    ]) {
      const ast = parseFilterText(text);
      expect(parseFilterText(printFilterText(ast))).toEqual(ast);
    }
    expect(parseFilterText("cf.note:is_set")).toEqual({
      field: "cf.note",
      op: "is_set",
      value: true,
    });
    expect(parseFilterText('cf.note:"is_set"')).toEqual({
      field: "cf.note",
      op: "eq",
      value: "is_set",
    });
    expect(parseFilterText("cf.severity:!=low")).toEqual({
      field: "cf.severity",
      op: "neq",
      value: "low",
    });
  });

  it("keeps genuinely unknown fields at 400", () => {
    let caught: { status?: number } | undefined;
    try {
      validateWorkItemSearchQuery({
        entity: "work_item",
        filter: { field: "nonsense", op: "eq", value: "x" },
      });
    } catch (error) {
      caught = error as { status?: number };
    }
    expect(caught?.status).toBe(400);
  });

  it("rejects unsupported operators, excessive depth, and report clauses", () => {
    expect(() =>
      validateWorkItemSearchQuery({ entity: "work_item", groupBy: ["state"] }),
    ).toThrowError(/not available/);
    expect(() =>
      validateWorkItemSearchQuery({
        entity: "work_item",
        filter: { field: "assignee", op: "eq", value: "person-123" },
      }),
    ).toThrowError(/@me/);
    let filter: unknown = { field: "priority", op: "eq", value: "high" };
    for (let i = 0; i < 9; i++) filter = { op: "and", clauses: [filter] };
    expect(() =>
      validateWorkItemSearchQuery({ entity: "work_item", filter }),
    ).toThrowError(/depth/);
  });
});
