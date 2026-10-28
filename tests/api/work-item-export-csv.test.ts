import { describe, expect, it } from "vitest";
import {
  checkAndRecordExportRateLimit,
  collectExportPages,
  EXPORT_MAX_ROWS,
  EXPORT_RATE_LIMIT_MAX,
  exportColumns,
  resetWorkItemExportRateLimitsForTest,
  workItemsCsv,
  workItemsCsvHeader,
  workItemsCsvRows,
} from "../../apps/api/src/work-item/search/csv";

describe("work item CSV export", () => {
  it("uses chosen columns and quotes commas, quotes, and line breaks", () => {
    expect(
      exportColumns({ entity: "work_item", columns: ["key", "title"] }),
    ).toEqual(["key", "title"]);
    const rows = [
      {
        key: "OPS-1",
        title: 'hello, "world"\nnext',
        stateName: null,
        assigneeName: null,
        priority: null,
        dueDate: null,
      },
    ];
    expect(workItemsCsv(rows, ["key", "title"])).toBe(
      '"Key","Title"\r\n"OPS-1","hello, ""world""\nnext"\r\n',
    );
    expect(
      workItemsCsvHeader(["key", "title"]) +
        workItemsCsvRows(rows, ["key", "title"]),
    ).toBe('"Key","Title"\r\n"OPS-1","hello, ""world""\nnext"\r\n');
    expect(workItemsCsvRows([], ["key", "title"])).toBe("");
  });

  it("exports selected custom fields by their registered name and escapes formulas", () => {
    const fields = [
      {
        key: "severity",
        name: "Severity",
        format: "select",
        options: [
          { key: "high", label: "High" },
          { key: "low", label: "Low" },
        ],
      },
      {
        key: "note",
        name: "Customer note",
        format: "text",
        options: [],
      },
    ] as const;
    const rows = [
      {
        key: "OPS-1",
        title: "Task",
        stateName: null,
        assigneeName: null,
        priority: null,
        dueDate: null,
        customFieldValues: { severity: "high", note: "=SUM(A1:A2)" },
      },
    ];
    expect(workItemsCsv(rows, ["key", "cf.severity", "cf.note"], fields)).toBe(
      '"Key","Severity","Customer note"\r\n"OPS-1","High","\'=SUM(A1:A2)"\r\n',
    );
  });

  it("resolves custom user values only with project-bound names", () => {
    const fields = [
      {
        key: "owner",
        name: "Owner",
        format: "user",
        options: [],
      },
    ] as const;
    const people = [
      { projectId: "project-a", personId: "person-1", name: "Morgan" },
    ];
    const rows = [
      {
        key: "OPS-1",
        projectId: "project-a",
        title: "Task A",
        stateName: null,
        assigneeName: null,
        priority: null,
        dueDate: null,
        customFieldValues: { owner: "person-1" },
      },
      {
        key: "OPS-2",
        projectId: "project-b",
        title: "Task B",
        stateName: null,
        assigneeName: null,
        priority: null,
        dueDate: null,
        customFieldValues: { owner: "person-1" },
      },
    ];
    expect(workItemsCsv(rows, ["cf.owner"], fields, people)).toBe(
      '"Owner"\r\n"Morgan"\r\n""\r\n',
    );
  });

  it.each(["=1+1", "  =1+1", "\t@SUM(A1:A2)", "\n-2+3", "+cmd"])(
    "prefixes formula-shaped cell %j as text",
    (title) => {
      const csv = workItemsCsv(
        [
          {
            key: "OPS-1",
            title,
            stateName: null,
            assigneeName: null,
            priority: null,
            dueDate: null,
          },
        ],
        ["title"],
      );
      expect(csv).toContain(`"'${title.replaceAll('"', '""')}"`);
    },
  );

  it("reads every result page without truncation", async () => {
    const calls: (string | undefined)[] = [];
    const result = await collectExportPages(async (cursor) => {
      calls.push(cursor);
      const first = cursor === undefined;
      return {
        data: Array.from({ length: first ? 200 : 1 }, (_, index) =>
          first ? index : 200 + index,
        ),
        page: { hasMore: first, nextCursor: first ? "next" : null },
        meta: { total: 201 },
      };
    });
    expect(calls).toEqual([undefined, "next"]);
    expect(result.total).toBe(201);
    expect(result.rows).toHaveLength(201);
    expect(result.rows[200]).toBe(200);
  });

  it("enforces the 10,000-row cap and 5 exports/min rate limit per user", () => {
    expect(EXPORT_MAX_ROWS).toBe(10_000);
    expect(EXPORT_RATE_LIMIT_MAX).toBe(5);
    resetWorkItemExportRateLimitsForTest();

    const now = 1_700_000_000_000;
    for (let i = 0; i < EXPORT_RATE_LIMIT_MAX; i += 1) {
      expect(checkAndRecordExportRateLimit("user-rate-1", now + i)).toBe(true);
    }
    expect(checkAndRecordExportRateLimit("user-rate-1", now + 100)).toBe(false);
    expect(checkAndRecordExportRateLimit("user-rate-2", now + 100)).toBe(true);
    expect(checkAndRecordExportRateLimit("user-rate-1", now + 60_001)).toBe(
      true,
    );
  });
});
