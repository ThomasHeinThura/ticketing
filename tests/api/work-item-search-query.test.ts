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
    "cf.severity",
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
