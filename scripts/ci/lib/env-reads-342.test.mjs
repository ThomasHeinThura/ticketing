import assert from "node:assert/strict";
import test from "node:test";
import { findEnvReads } from "./env-reads.mjs";

const cases = [
  ["object spread", "const copy = { ...process.env };"],
  ["globalThis process", "const value = globalThis.process.env.TASKDESK_PORT;"],
  ["global process", "const value = global.process.env.TASKDESK_PORT;"],
  ["computed env property", 'const value = process["env"].TASKDESK_PORT;'],
  ["optional env property", "const value = process?.env.TASKDESK_PORT;"],
  [
    "process destructuring",
    "const { env } = process; console.log(env.TASKDESK_PORT);",
  ],
  ["process alias", "const p = process; console.log(p.env.TASKDESK_PORT);"],
  [
    "Reflect.get",
    'const env = Reflect.get(process, "env"); console.log(env.TASKDESK_PORT);',
  ],
  [
    "node:process import",
    'import { env } from "node:process"; console.log(env.TASKDESK_PORT);',
  ],
  [
    "CommonJS process require",
    'const value = require("process").env.TASKDESK_PORT;',
  ],
  [
    "computed import.meta env",
    'const value = import.meta["env"].VITE_API_URL;',
  ],
  [
    "comment between process tokens",
    "const value = process/**/.env.TASKDESK_PORT;",
  ],
  [
    "template interpolation",
    "const value = `port=$" + "{process.env.TASKDESK_PORT}`;",
  ],
];

for (const [label, source] of cases) {
  test(`environment detector records ${label}`, () => {
    const reads = findEnvReads(source);
    assert.ok(reads.length > 0, `expected ${label} to be detected`);
    assert.ok(reads.every((read) => read.line === 1));
  });
}

test("environment detector still attributes direct, computed, destructured, and Vite reads", () => {
  const reads = findEnvReads(
    [
      "const direct = process.env.TASKDESK_PORT;",
      "const dynamic = process.env[name];",
      "const { SMTP_HOST, SMTP_PORT } = process.env;",
      "const mode = import.meta.env.MODE;",
    ].join("\n"),
  );

  assert.deepEqual(
    reads.map(({ kind, name, line }) => ({ kind, name, line })),
    [
      { kind: "named", name: "TASKDESK_PORT", line: 1 },
      { kind: "computed", name: null, line: 2 },
      { kind: "named", name: "SMTP_HOST", line: 3 },
      { kind: "named", name: "SMTP_PORT", line: 3 },
      { kind: "named", name: "MODE", line: 4 },
    ],
  );
});

test("environment detector ignores comments and quoted text", () => {
  assert.deepEqual(
    findEnvReads('// process.env.NOPE\nconst text = "process.env.NOPE";'),
    [],
  );
});

test("environment detector skips regular-expression bodies but keeps division expressions", () => {
  assert.deepEqual(findEnvReads("/process.env.SECRET/.test(value);"), []);
  assert.deepEqual(
    findEnvReads("if (ok) /process.env.SECRET/.test(value);"),
    [],
  );
  assert.deepEqual(
    findEnvReads("const rate = value / process.env.RATE;").map(
      ({ name }) => name,
    ),
    ["RATE"],
  );
});

test("environment detector ignores plain node:process import declarations", () => {
  assert.deepEqual(
    findEnvReads(
      'import { env } from "node:process"; const port = env.TASKDESK_PORT;',
    ).map(({ kind, name }) => ({ kind, name })),
    [{ kind: "named", name: "TASKDESK_PORT" }],
  );
});

test("environment detector resolves aliased node:process imports to their real member", () => {
  assert.deepEqual(
    findEnvReads(
      'import { env as runtimeEnv } from "node:process"; const port = runtimeEnv.TASKDESK_PORT;',
    ).map(({ kind, name }) => ({ kind, name })),
    [{ kind: "named", name: "TASKDESK_PORT" }],
  );
});
