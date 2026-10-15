import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { API } from "typescript/unstable/sync";
import { analyzeQueryOwnership, isRepositoryPath } from "./check-queries.mjs";
import { repoRoot } from "./lib/repo.mjs";

test("query ownership checker kills syntactic/type-resolved escapes and keeps valid repository work", async () => {
  const base = path.join(repoRoot, "apps/api/src");
  const dir = mkdtempSync(path.join(base, "query-check-fixture-"));
  const fixtureFiles = new Map([
    [
      "controllers/direct.ts",
      `import db from "../../database"; export const run = () => db.select();`,
    ],
    [
      "controllers/alias.ts",
      `import db from "../../database"; const handle = db; const { select: read } = handle; export const run = () => read();`,
    ],
    [
      "controllers/handle-alias.ts",
      `import db from "../../database"; const renamed = db; export const run = () => renamed.select();`,
    ],
    [
      "controllers/computed.ts",
      `import db from "../../database"; export const run = () => db?.["select"]().from(({} as never));`,
    ],
    [
      "controllers/multiline.ts",
      `import db from "../../database"; export const run = () => (\n  db\n    .select\n)().from(({} as never));`,
    ],
    [
      "controllers/reflect.ts",
      `import db from "../../database"; export const run = () => Reflect.apply(db.select, db, []);`,
    ],
    [
      "controllers/bound.ts",
      `import db from "../../database"; const read = db.select.bind(db); export const run = () => read();`,
    ],
    [
      "controllers/transaction.ts",
      `import db from "../../database"; export const open = () => db.transaction(async (tx) => { await tx.insert(({} as never)); });`,
    ],
    [
      "database/outside-allowlist.ts",
      `import db from "../../database"; export const run = () => db.select();`,
    ],
    [
      "controllers/raw-sql.ts",
      `import { sql as fragment } from "drizzle-orm"; export const raw = fragment\`select 1\`;`,
    ],
    [
      "controllers/pg-pool.ts",
      `import { Pool } from "pg"; const pool = new Pool(); const { query: run } = pool; const again = run; export const raw = () => { pool.query("select 2"); return again("select 1"); };`,
    ],
    [
      "controllers/pg-connect.ts",
      `import { Pool } from "pg"; const pool = new Pool(); export const get = () => pool.connect();`,
    ],
    [
      "controllers/pg-client.ts",
      `import { Pool } from "pg"; const pool = new Pool(); export async function run() { const client = await pool.connect(); return client.query("select 1"); }`,
    ],
    [
      "controllers/relational-query.ts",
      `import db from "../../database"; export const run = () => db.query.userTable.findMany();`,
    ],
    [
      "controllers/typed-handle.ts",
      `import db from "../../database"; import { userTable } from "../../database/schema"; type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]; export const run = (executor: Tx) => executor.select().from(userTable);`,
    ],
    [
      "controllers/unresolved.ts",
      "declare const executor: any; export const run = () => executor.select();",
    ],
    [
      "controllers/type-error.ts",
      "const shouldBeText: string = 42; export { shouldBeText };",
    ],
    ["controllers/syntax-error.ts", "export const broken = ;"],
    [
      "controllers/transaction-open.ts",
      `import db from "../../database"; export const open = () => db.transaction(async () => 1);`,
    ],
    [
      "database/users.repository.ts",
      `import db from "../../database"; import { userTable } from "../../database/schema"; export async function listUsers() { return await db.select().from(userTable); }`,
    ],
    [
      "database/transaction.repository.ts",
      `import db from "../../database"; import { userTable } from "../../database/schema"; type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]; export async function listUsersInTransaction(tx: Tx) { return await tx.select().from(userTable); }`,
    ],
    [
      "database/escape.repository.ts",
      `import db from "../../database"; export const escape = () => db.select();`,
    ],
  ]);
  const absoluteFiles = [];
  for (const [relative, source] of fixtureFiles) {
    const absolute = path.join(dir, relative);
    const parent = path.dirname(absolute);
    mkdirSync(parent, { recursive: true });
    writeFileSync(absolute, source);
    absoluteFiles.push(absolute);
  }

  const api = new API({ cwd: repoRoot });
  let snapshot;
  try {
    snapshot = api.updateSnapshot({
      openProjects: [path.join(repoRoot, "apps/api/tsconfig.json")],
      openFiles: absoluteFiles,
    });
    const violations = analyzeQueryOwnership({
      files: absoluteFiles,
      snapshot,
      root: repoRoot,
    });
    const byFile = new Map();
    for (const item of violations) {
      const [file, message] = item.trimStart().split("\n");
      const relative = file.replaceAll("\\", "/");
      byFile.set(relative, `${byFile.get(relative) ?? ""}\n${message}`);
    }
    const key = (relative) =>
      path.relative(repoRoot, path.join(dir, relative)).replaceAll("\\", "/");
    const expectedViolations = new Map([
      [
        "controllers/direct.ts",
        /line 1: database operation select is outside an allowed repository/,
      ],
      [
        "controllers/alias.ts",
        /line 1: database operation read is outside an allowed repository/,
      ],
      [
        "controllers/handle-alias.ts",
        /database operation select is outside an allowed repository/,
      ],
      [
        "controllers/computed.ts",
        /line 1: database operation select is outside an allowed repository/,
      ],
      [
        "controllers/multiline.ts",
        /database operation select is outside an allowed repository/,
      ],
      [
        "controllers/reflect.ts",
        /query function invoked through call\/apply\/bind outside an allowed repository/,
      ],
      [
        "controllers/bound.ts",
        /database operation read is outside an allowed repository/,
      ],
      [
        "controllers/transaction.ts",
        /database operation insert is outside an allowed repository/,
      ],
      [
        "database/outside-allowlist.ts",
        /database operation select is outside an allowed repository/,
      ],
      [
        "controllers/raw-sql.ts",
        /raw SQL fragment construction is outside an allowed repository/,
      ],
      [
        "controllers/pg-pool.ts",
        /database operation again is outside an allowed repository/,
      ],
      [
        "controllers/pg-connect.ts",
        /database operation connect is outside an allowed repository/,
      ],
      [
        "controllers/pg-client.ts",
        /database operation query is outside an allowed repository/,
      ],
      ["controllers/relational-query.ts", /outside an allowed repository/],
      [
        "controllers/typed-handle.ts",
        /database operation select is outside an allowed repository/,
      ],
    ]);
    for (const [relative, expected] of expectedViolations) {
      assert.match(
        byFile.get(key(relative)) ?? "",
        expected,
        `${relative} should produce its specific ownership violation`,
      );
    }
    assert.match(
      byFile.get(key("controllers/unresolved.ts")) ?? "",
      /unresolved query-like receiver/,
      "an any-typed handle fails closed separately from the ownership finding",
    );
    assert.match(
      byFile.get(key("controllers/type-error.ts")) ?? "",
      /TypeScript could not prove this file's types/,
      "semantic type failures fail closed",
    );
    assert.match(
      byFile.get(key("controllers/syntax-error.ts")) ?? "",
      /TypeScript parse error/,
      "syntax failures fail closed",
    );
    assert.equal(
      byFile.has(key("controllers/transaction-open.ts")),
      false,
      "opening an empty transaction remains permitted orchestration",
    );
    assert.equal(
      byFile.has(key("database/users.repository.ts")),
      false,
      "awaited repository query should pass",
    );
    assert.equal(
      byFile.has(key("database/transaction.repository.ts")),
      false,
      "a repository can query through an explicitly typed transaction handle",
    );
    assert.match(
      byFile.get(key("database/escape.repository.ts")) ?? "",
      /returns a query builder/,
      "an exported builder escape must be rejected even inside a repository",
    );
  } finally {
    snapshot?.dispose();
    api.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("repository scope is the static exact list, with no database-directory wildcard", () => {
  const infrastructure = [
    "schema.ts",
    "relations.ts",
    "index.ts",
    "executor.ts",
    "resolve-database-url.ts",
    "wait-for-database.ts",
    "prepare-database-startup.ts",
    "migration-schema.ts",
    "migrate-membership-provenance.ts",
    "ensure-application-role.ts",
    "assert-application-role-is-not-privileged.ts",
    "assert-no-migration-url-in-api-process.ts",
    "append-only-tables.ts",
    "scram-sha-256.ts",
  ];
  assert.equal(infrastructure.length, 14);
  for (const file of infrastructure)
    assert.equal(isRepositoryPath(`apps/api/src/database/${file}`), true, file);
  assert.equal(isRepositoryPath("apps/api/src/database/new-file.ts"), false);
  assert.equal(isRepositoryPath("apps/api/src/database/helper.ts"), false);
  assert.equal(isRepositoryPath("apps/api/src/example/repository.ts"), true);
  assert.equal(
    isRepositoryPath("apps/api/src/example/identity.repository.ts"),
    true,
  );
  assert.equal(
    isRepositoryPath("apps/api/src/example/repository/nested/query.ts"),
    true,
  );
});
