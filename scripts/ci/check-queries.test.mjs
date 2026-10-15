import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { API } from "typescript/unstable/sync";
import { analyzeQueryOwnership, isRepositoryPath } from "./check-queries.mjs";
import { repoRoot } from "./lib/repo.mjs";

const infrastructureFiles = [
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

test("query ownership checker kills syntactic/type-resolved escapes and keeps valid repository work", async () => {
  const dir = mkdtempSync(
    path.join(repoRoot, "apps/api/.query-check-fixture-"),
  );
  const fixtureConfig = `${dir}.tsconfig.json`;
  writeFileSync(
    fixtureConfig,
    JSON.stringify({
      extends: "../tsconfig.json",
      compilerOptions: { rootDir: "." },
      include: [`./${path.basename(dir)}/**/*.ts`],
    }),
  );
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
    [
      "database/async-escape.repository.ts",
      `import db from "../../database"; export async function escape() { return db.select(); }`,
    ],
    [
      "database/export-list.repository.ts",
      `import db from "../../database"; function build() { return db.select(); } export { build };`,
    ],
    [
      "database/reexport-source.repository.ts",
      `import db from "../../database"; export function build() { return db.select(); }`,
    ],
    [
      "database/reexport.repository.ts",
      `export { build as exposed } from "./reexport-source.repository";`,
    ],
    [
      "database/object-escape.repository.ts",
      `import db from "../../database"; export const repository = { build() { return db.select(); } };`,
    ],
    [
      "database/class-escape.repository.ts",
      `import db from "../../database"; export class Repository { build() { return db.select(); } private internal() { return db.select(); } }`,
    ],
    [
      "database/private-class-method.repository.ts",
      `import db from "../../database"; export class Repository { private internal() { return db.select(); } protected alsoInternal() { return db.select(); } }`,
    ],
    [
      "database/factory-escape.repository.ts",
      `import db from "../../database"; export function createRepository() { return { build: async () => db.select() }; }`,
    ],
    [
      "database/async-assimilated.repository.ts",
      `import { eq } from "drizzle-orm"; import db from "../../database"; import { userTable } from "../../database/schema"; export async function listRows() { return db.select().from(userTable).where(eq(userTable.id, "id")).limit(1); }`,
    ],
    [
      "database/default-async-assimilated.repository.ts",
      `import { eq } from "drizzle-orm"; import db from "../../database"; import { userTable } from "../../database/schema"; export default async function () { return db.select().from(userTable).where(eq(userTable.id, "id")).limit(1); }`,
    ],
    [
      "database/full-select-escape.repository.ts",
      `import { eq } from "drizzle-orm"; import db from "../../database"; import { userTable } from "../../database/schema"; export function buildRows() { return db.select().from(userTable).where(eq(userTable.id, "id")).limit(1); }`,
    ],
    [
      "database/omit-select-escape.repository.ts",
      `import { eq } from "drizzle-orm"; import db from "../../database"; import { userTable } from "../../database/schema"; export function buildRows() { const query = db.select().from(userTable).where(eq(userTable.id, "id")).limit(1); return query as Omit<typeof query, "config">; }`,
    ],
    [
      "database/type-only-export.repository.ts",
      "interface RepositoryShape { readonly label: string } export type { RepositoryShape };",
    ],
    [
      "database/type-only-class-export.repository.ts",
      `import db from "../../database"; class RepositoryShape { read() { return db.select(); } } export type { RepositoryShape };`,
    ],
    [
      "database/recursive-api.repository.ts",
      "interface RepositoryShape { next?: RepositoryShape; listRows: () => Promise<{ id: string }[]> } export const repository = {} as RepositoryShape;",
    ],
    [
      "database/generic-identity.repository.ts",
      "export function identity<T>(value: T): T { return value; }",
    ],
    [
      "database/generic-sql.repository.ts",
      'import type { SQL } from "drizzle-orm"; export function identity<T extends SQL>(value: T): T { return value; }',
    ],
    [
      "database/generic-object-escape.repository.ts",
      "export const repository = { identity<T>(value: T): T { return value; } };",
    ],
    [
      "database/generic-callback.repository.ts",
      "export function defer<T>(callback: () => Promise<T>): Promise<T> { return callback(); }",
    ],
    [
      "database/generic-row-projection.repository.ts",
      "export function project<T extends { id: string }>(value: T): { id: string } { return { id: value.id }; }",
    ],
    [
      "database/generic-union.repository.ts",
      "export function maybeIdentity<T>(value: T): T | undefined { return value; }",
    ],
    [
      "database/imported-sql-shape.ts",
      'import type { SQL } from "drizzle-orm"; export interface Escape { read(): SQL }',
    ],
    [
      "database/imported-sql-shape.repository.ts",
      'import { sql } from "drizzle-orm"; import type { Escape } from "./imported-sql-shape"; export const repository: Escape = { read() { return sql`select 1`; } };',
    ],
    [
      "database/imported-row-shape.ts",
      "export interface Rows { read(): Promise<{ id: string }[]> }",
    ],
    [
      "database/imported-row-shape.repository.ts",
      'import type { Rows } from "./imported-row-shape"; export const repository: Rows = { async read() { return [{ id: "id" }]; } };',
    ],
    [
      "database/default-anonymous-function.repository.ts",
      `import db from "../../database"; export default function () { return db.select(); }`,
    ],
    [
      "database/default-anonymous-class.repository.ts",
      `import db from "../../database"; export default class { read() { return db.select(); } }`,
    ],
    [
      "database/namespace-source.repository.ts",
      `import db from "../../database"; export function read() { return db.select(); }`,
    ],
    [
      "database/namespace-async-source.repository.ts",
      `import { eq } from "drizzle-orm"; import db from "../../database"; import { userTable } from "../../database/schema"; export async function readRows() { return db.select().from(userTable).where(eq(userTable.id, "id")).limit(1); }`,
    ],
    [
      "database/namespace.repository.ts",
      `export * as repository from "./namespace-source.repository";`,
    ],
    [
      "database/namespace-async.repository.ts",
      `export * as repository from "./namespace-async-source.repository";`,
    ],
    [
      "database/namespace-drizzle.repository.ts",
      `export * as drizzle from "drizzle-orm";`,
    ],
    [
      "database/sql-aliased-escape.repository.ts",
      'import { sql } from "drizzle-orm"; export const fragment = sql`select 1`.as("alias");',
    ],
    [
      "database/reach-fragment.repository.ts",
      'import { and, eq, sql, type SQL } from "drizzle-orm"; import { userTable } from "../../database/schema"; export function userReach(id: string): SQL { return and(eq(userTable.id, id), sql`true`)!; } export const reachAlias = userReach; export const fragmentRecord = { predicate: sql`true` };',
    ],
    [
      "database/reach-fragment-consumer.repository.ts",
      'import db from "../../database"; import { userTable } from "../../database/schema"; import { userReach } from "./reach-fragment.repository"; export async function findReachable(id: string) { return await db.select().from(userTable).where(userReach(id)); }',
    ],
    [
      "database/reach-fragment-reexport.repository.ts",
      'export { userReach as predicate } from "./reach-fragment.repository";',
    ],
    [
      "database/reach-fragment-namespace.repository.ts",
      'export * as fragments from "./reach-fragment.repository";',
    ],
    [
      "controllers/reach-fragment-call.ts",
      'import { userReach } from "../database/reach-fragment.repository"; export const predicate = userReach("id");',
    ],
    [
      "controllers/reach-fragment-compose.ts",
      `import { sql } from "drizzle-orm"; import { userReach } from "../database/reach-fragment.repository"; export const predicate = sql\`(\${userReach("id")})\`;`,
    ],
    [
      "database/promise-builder-escape.repository.ts",
      'import { eq } from "drizzle-orm"; import db from "../../database"; import { userTable } from "../../database/schema"; const query = db.select().from(userTable).where(eq(userTable.id, "id")); export function buildRows(): Promise<typeof query> { return new Promise((resolve) => resolve(query)); }',
    ],
    [
      "database/sqlwrapper-builder-escape.repository.ts",
      'import { eq, type SQLWrapper } from "drizzle-orm"; import db from "../../database"; import { userTable } from "../../database/schema"; const query = db.select().from(userTable).where(eq(userTable.id, "id")); export const pending = query as SQLWrapper & typeof query;',
    ],
    [
      "database/sqlwrapper-generic-leak.repository.ts",
      'import { eq, type SQLWrapper } from "drizzle-orm"; import db from "../../database"; import { userTable } from "../../database/schema"; const pending = db.select().from(userTable).where(eq(userTable.id, "id")); interface FragmentCarrier<T> extends SQLWrapper { value: T } export function leak(): FragmentCarrier<typeof pending> { throw new Error("type-shape fixture"); }',
    ],
    [
      "database/sqlwrapper-member-leak.repository.ts",
      'import { eq, type SQLWrapper } from "drizzle-orm"; import db from "../../database"; import { userTable } from "../../database/schema"; const pending = db.select().from(userTable); interface FragmentCarrier extends SQLWrapper { value: typeof pending } export const carrier = {} as FragmentCarrier;',
    ],
    [
      "database/sqlwrapper-intersection-leak.repository.ts",
      'import { eq, type SQLWrapper } from "drizzle-orm"; import { sql } from "drizzle-orm"; import db from "../../database"; import { userTable } from "../../database/schema"; const pending = db.select().from(userTable).where(eq(userTable.id, "id")); export const carrier = { getSQL() { return sql`true`; }, value: pending } as SQLWrapper & { value: typeof pending };',
    ],
    [
      "database/sqlwrapper-class-leak.repository.ts",
      'import { eq, type SQLWrapper } from "drizzle-orm"; import { sql } from "drizzle-orm"; import db from "../../database"; import { userTable } from "../../database/schema"; const pending = db.select().from(userTable); class FragmentCarrier implements SQLWrapper { value = pending; getSQL() { return sql`true`; } } export const carrier = new FragmentCarrier();',
    ],
    [
      "database/sqlwrapper-reflected-leak.repository.ts",
      'import { eq, type SQLWrapper } from "drizzle-orm"; import db from "../../database"; import { userTable } from "../../database/schema"; const pending = db.select().from(userTable); type Pending = typeof pending; type Reflected = SQLWrapper & { value: Pending }; export const carrier = {} as Reflected;',
    ],
    [
      "database/sqlwrapper-leak-reexport.repository.ts",
      'export { leak as exposed } from "./sqlwrapper-generic-leak.repository";',
    ],
    [
      "database/sqlwrapper-fragment.repository.ts",
      'import { sql, type SQLWrapper } from "drizzle-orm"; export function fragment(): SQLWrapper { return sql`true`; }',
    ],
    [
      "database/sql-payload-leak.repository.ts",
      'import { eq, type SQL } from "drizzle-orm"; import db from "../../database"; import { userTable } from "../../database/schema"; const pending = db.select().from(userTable).where(eq(userTable.id, "id")); export const fragment = {} as SQL<typeof pending>;',
    ],
    [
      "database/user-sql-class-leak.repository.ts",
      'import { eq, type SQLWrapper, sql } from "drizzle-orm"; import db from "../../database"; import { userTable } from "../../database/schema"; const pending = db.select().from(userTable); class SQL implements SQLWrapper { value = pending; getSQL() { return sql`true`; } } export const fragment = new SQL();',
    ],
  ]);
  const absoluteFiles = [];
  for (const [relative, source] of fixtureFiles) {
    const absolute = path.join(dir, relative);
    const parent = path.dirname(absolute);
    mkdirSync(parent, { recursive: true });
    const databaseImport = path
      .relative(
        path.dirname(absolute),
        path.join(repoRoot, "apps/api/src/database/index"),
      )
      .replaceAll(path.sep, "/");
    const schemaImport = path
      .relative(
        path.dirname(absolute),
        path.join(repoRoot, "apps/api/src/database/schema"),
      )
      .replaceAll(path.sep, "/");
    writeFileSync(
      absolute,
      source
        .replaceAll("../../database/schema", schemaImport)
        .replaceAll(
          "../../database",
          databaseImport.startsWith(".")
            ? databaseImport
            : `./${databaseImport}`,
        ),
    );
    absoluteFiles.push(absolute);
  }

  const api = new API({ cwd: repoRoot });
  let snapshot;
  try {
    snapshot = api.updateSnapshot({
      openProjects: [fixtureConfig],
      openFiles: absoluteFiles,
    });
    const violations = analyzeQueryOwnership({
      files: absoluteFiles,
      snapshot,
      root: dir,
      apiSourceRoot: dir,
    });
    const byFile = new Map();
    for (const item of violations) {
      const [file, message] = item.trimStart().split("\n");
      const relative = file.replaceAll("\\", "/");
      byFile.set(relative, `${byFile.get(relative) ?? ""}\n${message}`);
    }
    const key = (relative) =>
      path.relative(dir, path.join(dir, relative)).replaceAll("\\", "/");
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
      ["database/escape.repository.ts", /exposes a query builder/],
      ["database/async-escape.repository.ts", /exposes a query builder/],
      ["database/export-list.repository.ts", /exposes a query builder/],
      ["database/reexport-source.repository.ts", /exposes a query builder/],
      ["database/reexport.repository.ts", /exposes a query builder/],
      ["database/object-escape.repository.ts", /exposes a query builder/],
      ["database/class-escape.repository.ts", /exposes a query builder/],
      ["database/factory-escape.repository.ts", /exposes a query builder/],
      ["database/full-select-escape.repository.ts", /exposes a query builder/],
      ["database/omit-select-escape.repository.ts", /exposes a query builder/],
      [
        "database/default-anonymous-function.repository.ts",
        /exposes a query builder/,
      ],
      [
        "database/default-anonymous-class.repository.ts",
        /exposes a query builder/,
      ],
      ["database/namespace.repository.ts", /exposes a query builder/],
      ["database/sql-aliased-escape.repository.ts", /exposes a query builder/],
      [
        "database/promise-builder-escape.repository.ts",
        /exposes a query builder/,
      ],
      [
        "database/sqlwrapper-builder-escape.repository.ts",
        /exposes a query builder/,
      ],
      [
        "database/sqlwrapper-generic-leak.repository.ts",
        /exposes a query builder/,
      ],
      [
        "database/sqlwrapper-member-leak.repository.ts",
        /exposes a query builder/,
      ],
      [
        "database/sqlwrapper-intersection-leak.repository.ts",
        /exposes a query builder/,
      ],
      [
        "database/sqlwrapper-class-leak.repository.ts",
        /exposes a query builder/,
      ],
      [
        "database/sqlwrapper-reflected-leak.repository.ts",
        /exposes a query builder/,
      ],
      [
        "database/sqlwrapper-leak-reexport.repository.ts",
        /exposes a query builder/,
      ],
      ["database/sql-payload-leak.repository.ts", /exposes a query builder/],
      ["database/user-sql-class-leak.repository.ts", /exposes a query builder/],
      [
        "controllers/reach-fragment-call.ts",
        /database operation userReach is outside an allowed repository/,
      ],
      [
        "controllers/reach-fragment-compose.ts",
        /raw SQL fragment construction is outside an allowed repository/,
      ],
      [
        "database/generic-identity.repository.ts",
        /exported repository value shape is unresolved or exceeds safe inspection limits/,
      ],
      [
        "database/generic-sql.repository.ts",
        /exported repository value shape is unresolved or exceeds safe inspection limits/,
      ],
      [
        "database/generic-object-escape.repository.ts",
        /exported repository value shape is unresolved or exceeds safe inspection limits/,
      ],
      [
        "database/generic-union.repository.ts",
        /exported repository value shape is unresolved or exceeds safe inspection limits/,
      ],
      [
        "database/generic-callback.repository.ts",
        /exported repository value shape is unresolved or exceeds safe inspection limits/,
      ],
      [
        "database/namespace-drizzle.repository.ts",
        /exposes a query builder|query-builder escape cannot be excluded/,
      ],
    ]);
    for (const [relative, expected] of expectedViolations) {
      assert.match(
        byFile.get(key(relative)) ?? "",
        expected,
        `${relative} should produce its specific ownership violation; got ${byFile.get(key(relative)) ?? "<none>"}`,
      );
    }
    for (const relative of [
      "database/generic-identity.repository.ts",
      "database/generic-sql.repository.ts",
      "database/generic-object-escape.repository.ts",
      "database/generic-callback.repository.ts",
      "database/generic-row-projection.repository.ts",
      "database/generic-union.repository.ts",
      "database/imported-sql-shape.repository.ts",
      "database/imported-row-shape.repository.ts",
    ]) {
      assert.doesNotMatch(
        byFile.get(key(relative)) ?? "",
        /TypeScript (?:parse error|could not prove this file's types)/,
        `${relative} must be type-clean so its specific generic-boundary result is meaningful`,
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
      /exposes a query builder/,
      "an exported builder escape must be rejected even inside a repository",
    );
    assert.equal(
      byFile.has(key("database/async-assimilated.repository.ts")),
      false,
      "an async function returning an assimilated row thenable remains valid",
    );
    assert.equal(
      byFile.has(key("database/default-async-assimilated.repository.ts")),
      false,
      "an anonymous default async function returning rows remains valid",
    );
    assert.equal(
      byFile.has(key("database/generic-row-projection.repository.ts")),
      false,
      "a generic input projected to a concrete row shape has a proven output",
    );
    assert.equal(
      byFile.has(key("database/imported-row-shape.repository.ts")),
      false,
      "an imported public interface with a concrete row-returning method remains valid",
    );
    assert.equal(
      byFile.has(key("database/private-class-method.repository.ts")),
      false,
      "private/protected implementation methods do not escape the repository boundary",
    );
    assert.equal(
      byFile.has(key("database/type-only-export.repository.ts")),
      false,
      "type-only exports do not form runtime query-builder boundaries",
    );
    assert.equal(
      byFile.has(key("database/type-only-class-export.repository.ts")),
      false,
      "a class exposed only through a type-only export has no runtime query boundary",
    );
    assert.equal(
      byFile.has(key("database/namespace-async.repository.ts")),
      false,
      "namespace runtime exports preserve async thenable assimilation for completed queries",
    );
    for (const relative of [
      "database/reach-fragment.repository.ts",
      "database/reach-fragment-consumer.repository.ts",
      "database/reach-fragment-reexport.repository.ts",
      "database/reach-fragment-namespace.repository.ts",
      "database/imported-sql-shape.repository.ts",
      "database/sqlwrapper-fragment.repository.ts",
    ]) {
      assert.equal(
        byFile.has(key(relative)),
        false,
        `${relative} may expose or compose typed SQL fragments within repository modules: ${byFile.get(key(relative)) ?? "<none>"}`,
      );
    }
    assert.equal(
      byFile.has(key("database/recursive-api.repository.ts")),
      false,
      "recursive exported DTO APIs with row-returning methods are cycle-safe",
    );
  } finally {
    snapshot?.dispose();
    api.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(fixtureConfig, { force: true });
  }
});

test("repository scope is the static exact list, with no database-directory wildcard", () => {
  assert.equal(infrastructureFiles.length, 14);
  for (const file of infrastructureFiles)
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

test("the real analyzer honors all exact persistence files and rejects a nearby unlisted file", async () => {
  const dir = mkdtempSync(
    path.join(repoRoot, "apps/api/src/database/.query-scope-fixture-"),
  );
  const neighbor = path.join(dir, "neighbor.ts");
  writeFileSync(
    neighbor,
    'import db from "../index"; export const run = () => db.select();',
  );
  const infra = infrastructureFiles.map((file) =>
    path.join(repoRoot, "apps/api/src/database", file),
  );
  const files = [...infra, neighbor];
  const api = new API({ cwd: repoRoot });
  let snapshot;
  try {
    snapshot = api.updateSnapshot({
      openProjects: [path.join(repoRoot, "apps/api/tsconfig.json")],
      openFiles: files,
    });
    const violations = analyzeQueryOwnership({
      files,
      snapshot,
      root: repoRoot,
    });
    const locationViolations = violations.filter((item) =>
      /outside an allowed repository or explicit persistence-infrastructure file/.test(
        item,
      ),
    );
    assert.equal(
      locationViolations.some((item) =>
        item.includes("apps/api/src/database/.query-scope-fixture-"),
      ),
      true,
      "the nearby unlisted source must be rejected by the actual analyzer",
    );
    assert.equal(
      locationViolations.some((item) =>
        infrastructureFiles.some((file) =>
          item.includes(`apps/api/src/database/${file}`),
        ),
      ),
      false,
      "all 14 exact infrastructure sources must be allowed by the actual analyzer",
    );
  } finally {
    snapshot?.dispose();
    api.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
