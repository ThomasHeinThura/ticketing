import { describe, expect, it } from "vitest";
import {
  parseWorkItemFilterText,
  printWorkItemFilterText,
  type WorkItemFilter,
} from "./work-item-filter";

const LEAVES: WorkItemFilter[] = [
  { field: "state.group", op: "eq", value: "started" },
  { field: "state.group", op: "in", value: ["started", "completed"] },
  { field: "priority", op: "gte", value: "high" },
  { field: "priority", op: "in", value: ["high", "urgent"] },
  { field: "assignee", op: "eq", value: "@me" },
  { field: "watcher", op: "contains", value: "@me" },
  { field: "dueDate", op: "lt", value: "7d" },
  { field: "createdAt", op: "gt", value: "2026-01-01" },
  { field: "project", op: "eq", value: "OPS, Platform" },
  { field: "type", op: "eq", value: "incident" },
  { field: "label", op: "eq", value: "urgent" },
];

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function generatedTree(seed: number): WorkItemFilter {
  const random = seededRandom(seed);
  const makeNode = (depth: number): WorkItemFilter => {
    if (depth >= 3 || random() < 0.45)
      return structuredClone(
        LEAVES[Math.floor(random() * LEAVES.length)] ?? LEAVES[0],
      );
    const count = 1 + Math.floor(random() * 3);
    const op = random() < 0.5 ? "and" : "or";
    return {
      op,
      clauses: Array.from({ length: count }, () => makeNode(depth + 1)),
    };
  };
  return makeNode(0);
}

function textList(values: string[]) {
  return values.join(",");
}

describe("work-item filter text AST contract", () => {
  it("round-trips deterministic bounded ASTs with exact group structure and leaf order", () => {
    for (let seed = 1; seed <= 400; seed++) {
      const ast = generatedTree(seed);
      const text = printWorkItemFilterText(ast);
      expect(parseWorkItemFilterText(text), `seed ${seed}: ${text}`).toEqual(
        ast,
      );
    }
  });

  const structuralCases: Array<[string, WorkItemFilter]> = [
    ["standalone leaf", { field: "assignee", op: "eq", value: "@me" }],
    [
      "unary AND",
      { op: "and", clauses: [{ field: "assignee", op: "eq", value: "@me" }] },
    ],
    [
      "unary OR",
      { op: "or", clauses: [{ field: "assignee", op: "eq", value: "@me" }] },
    ],
    [
      "nested same-operator groups",
      {
        op: "and",
        clauses: [
          {
            op: "and",
            clauses: [{ field: "priority", op: "eq", value: "high" }],
          },
          {
            op: "or",
            clauses: [{ field: "dueDate", op: "gte", value: "3650d" }],
          },
        ],
      },
    ],
  ];
  it.each(structuralCases)(
    "retains explicit structure for %s",
    (_name, ast) => {
      expect(parseWorkItemFilterText(printWorkItemFilterText(ast))).toEqual(
        ast,
      );
    },
  );

  it("prints group operators explicitly and still accepts legacy infix input", () => {
    const unaryOr: WorkItemFilter = {
      op: "or",
      clauses: [{ field: "assignee", op: "eq", value: "@me" }],
    };
    expect(printWorkItemFilterText(unaryOr)).toBe("OR(assignee:@me)");
    expect(parseWorkItemFilterText("(assignee:@me AND due:>=7d)")).toEqual({
      op: "and",
      clauses: [
        { field: "assignee", op: "eq", value: "@me" },
        { field: "dueDate", op: "gte", value: "7d" },
      ],
    });
  });

  it.each([
    "state:in()",
    "state:in(started,)",
    "state:in(,started)",
    "state:in(started,,completed)",
    "state:",
    "state:unknown",
    "priority:in(high,)",
    "priority:in(high,medium,low,urgent,high)",
    "priority:very-high",
    "priority:contains(high)",
    "assignee:person-1",
    "assignee:contains(@me)",
    "watcher:contains(other)",
    "due:0d",
    "due:3651d",
    "due:2026-02-30",
    "created:7d",
    "created:2026-02-29",
    'project:""',
    "AND()",
    "OR(assignee:@me,)",
    "AND(,assignee:@me)",
  ])("rejects invalid known values or malformed syntax: %s", (text) => {
    expect(() => parseWorkItemFilterText(text)).toThrow();
  });

  it("enforces field-specific IN bounds and accepts their valid edges", () => {
    const stateValues = [
      "backlog",
      "unstarted",
      "started",
      "completed",
      "cancelled",
      ...Array.from({ length: 15 }, () => "started"),
    ];
    expect(
      parseWorkItemFilterText(`state:in(${textList(stateValues)})`),
    ).toMatchObject({
      op: "in",
      value: stateValues,
    });
    expect(() =>
      parseWorkItemFilterText(
        `state:in(${textList([...stateValues, "started"])})`,
      ),
    ).toThrow("1–20");
    expect(
      parseWorkItemFilterText("priority:in(low,medium,high,urgent)"),
    ).toMatchObject({ op: "in", value: ["low", "medium", "high", "urgent"] });
  });

  it("checks API tree depth, clause, leaf, and text-size bounds", () => {
    const tooManyClauses = `AND(${Array.from({ length: 33 }, () => "assignee:@me").join(",")})`;
    expect(() => parseWorkItemFilterText(tooManyClauses)).toThrow("32 clauses");

    const tooDeep = `${"AND(".repeat(8)}assignee:@me${")".repeat(8)}`;
    expect(() => parseWorkItemFilterText(tooDeep)).toThrow("maximum depth 8");

    const group32 = `AND(${Array.from({ length: 32 }, () => "assignee:@me").join(",")})`;
    const tooManyLeaves = `AND(${group32},${group32},assignee:@me)`;
    expect(() => parseWorkItemFilterText(tooManyLeaves)).toThrow(
      "maximum 64 leaves",
    );
    expect(() => parseWorkItemFilterText("x".repeat(8193))).toThrow(
      "8192 characters",
    );
  });

  it("retains documented unavailable and unknown fields for their API responses", () => {
    expect(parseWorkItemFilterText("label:urgent")).toEqual({
      field: "label",
      op: "eq",
      value: "urgent",
    });
    expect(parseWorkItemFilterText("futureField:value")).toEqual({
      field: "futureField",
      op: "eq",
      value: "value",
    });
  });

  it("validates calendar dates and preserves quoted punctuation and escapes", () => {
    expect(parseWorkItemFilterText("created:>2024-02-29")).toEqual({
      field: "createdAt",
      op: "gt",
      value: "2024-02-29",
    });
    const ast: WorkItemFilter = {
      field: "project",
      op: "eq",
      value: 'OPS, "Platform" \\ queue',
    };
    expect(parseWorkItemFilterText(printWorkItemFilterText(ast))).toEqual(ast);
  });
});
