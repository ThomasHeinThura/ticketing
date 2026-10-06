import assert from "node:assert/strict";
import test from "node:test";
import { queryReadViolations } from "./check-queries.mjs";

test("check:queries detects fluent and relational Drizzle reads", () => {
  const source = [
    "const rows = await db.select().from(workItemTable);",
    "const row = await tx.query.workItemTable.findFirst({ where: eq(workItemTable.id, id) });",
    "const rows2 = await db.selectDistinctOn([table.id]).from(table);",
  ].join("\n");

  assert.deepEqual(
    queryReadViolations(source, "apps/api/src/example.ts").map((row) => [
      row.line,
      row.method,
    ]),
    [
      [1, "select"],
      [2, "findFirst"],
      [3, "selectDistinctOn"],
    ],
  );
});

test("check:queries ignores comments, string contents, regexes, and template text", () => {
  const source = [
    "// db.select().from(table)",
    "const text = 'db.select().from(table)';",
    'const other = "tx.query.workItem.findFirst()";',
    "const pattern = /db\\.select\\(\\)/u;",
    "const template = `db.select().from(table)`;",
  ].join("\n");

  assert.deepEqual(queryReadViolations(source, "example.ts"), []);
});

test("check:queries scans executable template substitutions", () => {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: This source string is fixture input.
  const source = "const rendered = `" + "${await db.select().from(table)}`;";

  assert.deepEqual(
    queryReadViolations(source, "example.ts").map(({ line, method }) => [
      line,
      method,
    ]),
    [[1, "select"]],
  );
});
