import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkQueries, queryReadViolations } from "./check-queries.mjs";

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

test("check:queries detects optional and computed read-member calls", () => {
  const source = [
    "db?.select().from(table);",
    "db.select?.().from(table);",
    'db["select"]().from(table);',
    'tx?.["query"].person.findFirst?.();',
    "db.query.user['findMany']();",
    "db['selectDistinct']().from(table);",
  ].join("\n");

  assert.deepEqual(
    queryReadViolations(source, "example.ts").map(({ line, method }) => [
      line,
      method,
    ]),
    [
      [1, "select"],
      [2, "select"],
      [3, "select"],
      [4, "findFirst"],
      [5, "findMany"],
      [6, "selectDistinct"],
    ],
  );
});

test("check:queries decodes escaped static member names and aliases", () => {
  const source = String.raw`
db["sel\u0065ct"]().from(table);
db['\x73elect']().from(table);
db["\u{73}elect"]().from(table);
db["sel\"ect"]();
db["sele\
ct"]().from(table);
db.\u0073elect().from(table);
const { ["\u0073elect"]: read } = db;
read().from(table);
const { find\u004dany: list } = db.query.person;
list();
`;
  // biome-ignore lint/suspicious/noTemplateCurlyInString: Template source is fixture input.
  const templateSource = 'const rendered = `value ${db["\\u0066indFirst"]()}`;';
  assert.deepEqual(
    queryReadViolations(source + templateSource, "example.ts").map(
      ({ method }) => method,
    ),
    [
      "select",
      "select",
      "select",
      "select",
      "select",
      "select",
      "findMany",
      "findFirst",
    ],
  );

  // These spellings are valid JS and resolve to the same property at runtime.
  const runtime = { select: () => "selected" };
  assert.equal(runtime["sel\u0065ct"](), "selected");
  assert.equal(runtime.\u0073elect(), "selected");
});

test("check:queries detects receiver and simple method aliases", () => {
  const source = [
    "const executorAlias = tx;",
    "executorAlias.query.person.findFirst();",
    "const read = db.select;",
    "read().from(table);",
    "const boundRead = db.select.bind(db);",
    "boundRead().from(table);",
    "const { findMany: list } = db.query.person;",
    "list();",
  ].join("\n");

  assert.deepEqual(
    queryReadViolations(source, "example.ts").map(({ line, method }) => [
      line,
      method,
    ]),
    [
      [2, "findFirst"],
      [4, "select"],
      [6, "select"],
      [8, "findMany"],
    ],
  );
});

test("check:queries parses dotted, computed, escaped, and forwarded references uniformly", () => {
  const memberForms = [
    ".select",
    '["select"]',
    String.raw`["sel\u0065ct"]`,
    String.raw`["\u{73}elect"]`,
    String.raw`['\x73elect']`,
    String.raw`.\u0073elect`,
  ];
  const cases = memberForms.flatMap((member) => [
    { name: `${member} direct`, source: `db${member}()` },
    {
      name: `${member} optional direct`,
      source: `db?.${member.startsWith("[") ? member : member.slice(1)}?.()`,
    },
    {
      name: `${member} bare alias`,
      source: `const read = db${member}; read()`,
    },
    {
      name: `${member} bound alias`,
      source: `const read = db${member}.bind(db); read()`,
    },
    {
      name: `${member} computed bind alias`,
      source: `const read = db${member}["bind"](db); read()`,
    },
    { name: `${member} call forwarding`, source: `db${member}.call(db)` },
    { name: `${member} apply forwarding`, source: `db${member}.apply(db, [])` },
    {
      name: `${member} immediate bound invocation`,
      source: `db${member}.bind(db)()`,
    },
    {
      name: `${member} alias forwarding`,
      source: `const read = db${member}.bind(db); read.call(db)`,
    },
    {
      name: `${member} alias apply forwarding`,
      source: `const read = db${member}.bind(db); read.apply(db, [])`,
    },
    {
      name: `${member} alias bound invocation`,
      source: `const read = db${member}; read.bind(db)()`,
    },
  ]);

  for (const { name, source } of cases) {
    assert.deepEqual(
      queryReadViolations(`${source};`, "example.ts").map(
        ({ method }) => method,
      ),
      ["select"],
      name,
    );
  }

  for (const property of [
    '"select"',
    String.raw`"sel\u0065ct"`,
    String.raw`"\u{73}elect"`,
    String.raw`'\x73elect'`,
  ]) {
    const source = `const { [${property}]: read } = db; read();`;
    assert.deepEqual(
      queryReadViolations(source, "example.ts").map(({ method }) => method),
      ["select"],
      source,
    );
  }

  assert.deepEqual(
    queryReadViolations(
      "const read = db[methodName]; read(); db.execute(sql`SELECT 1`);",
      "example.ts",
    ),
    [],
  );

  assert.deepEqual(
    queryReadViolations(
      'const first = db["select"]; const second = first; second();',
      "example.ts",
    ).map(({ method }) => method),
    ["select"],
  );

  const runtime = { select: () => "selected" };
  const bound = runtime["sel\u0065ct"].bind(runtime);
  assert.equal(bound(), "selected");
  assert.equal(runtime["sel\u0065ct"].call(runtime), "selected");
  assert.equal(runtime["sel\u0065ct"].apply(runtime, []), "selected");
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

test("check:queries scans nested executable template substitutions", () => {
  const source =
    "const rendered = `outer $" +
    "{sql`SELECT $" +
    "{db.select().from(t)}}`" +
    "} end`;";

  assert.deepEqual(
    queryReadViolations(source, "example.ts").map(({ method }) => method),
    ["select"],
  );
});

test("check:queries scope is Drizzle read methods, not raw SQL transport", () => {
  const source = "await db.execute(sql`SELECT * FROM work_item`);";

  assert.deepEqual(queryReadViolations(source, "example.ts"), []);
});

test("check:queries exempts only nested repository.ts modules", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taskdesk-query-gate-"));
  t.after(async () => rm(root, { recursive: true, force: true }));

  const sourceRoot = path.join(root, "apps/api/src");
  await mkdir(path.join(sourceRoot, "feature"), { recursive: true });
  await writeFile(
    path.join(sourceRoot, "repository.ts"),
    "db.select().from(table);",
  );
  await writeFile(
    path.join(sourceRoot, "feature/repository.ts"),
    "db.select().from(table);",
  );
  await writeFile(
    path.join(sourceRoot, "feature/controller.ts"),
    String.raw`const read = db["sel\u0065ct"].bind(db); read();`,
  );

  assert.deepEqual(
    (await checkQueries(root)).map(({ file, method }) => [file, method]),
    [
      ["apps/api/src/feature/controller.ts", "select"],
      ["apps/api/src/repository.ts", "select"],
    ],
  );
});
