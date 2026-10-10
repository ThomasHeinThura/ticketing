import { describe, expect, it } from "vitest";
import {
  collectExportPages,
  exportColumns,
  workItemsCsv,
} from "../../apps/api/src/work-item/search/csv";

describe("work item CSV export", () => {
  it("uses chosen columns and quotes commas, quotes, and line breaks", () => {
    expect(
      exportColumns({ entity: "work_item", columns: ["key", "title"] }),
    ).toEqual(["key", "title"]);
    expect(
      workItemsCsv(
        [
          {
            key: "OPS-1",
            title: 'hello, "world"\nnext',
            stateName: null,
            assigneeName: null,
            priority: null,
            dueDate: null,
          },
        ],
        ["key", "title"],
      ),
    ).toBe('"Key","Title"\r\n"OPS-1","hello, ""world""\nnext"\r\n');
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
});
