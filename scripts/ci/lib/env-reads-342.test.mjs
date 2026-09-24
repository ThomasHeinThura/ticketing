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

test("environment detector ignores nested properties named like runtime globals", () => {
  assert.deepEqual(
    findEnvReads(
      [
        "const options = { process: { env: { SAFE: true } } };",
        "use(options.process.env.SAFE);",
        "const wrapper = { globalThis: { process: { env: { SAFE: true } } } };",
        "use(wrapper.globalThis.process.env.SAFE);",
      ].join("\n"),
    ),
    [],
  );
  assert.deepEqual(
    findEnvReads(
      "const processAlias = process; use(options.processAlias.env.SAFE);",
    ),
    [],
  );
  assert.deepEqual(
    findEnvReads("const argv = process.argv; use(argv[0]);"),
    [],
  );
  assert.deepEqual(
    findEnvReads('import { env } from "node:process"; use(options.env.SAFE);'),
    [],
  );
});

test("environment detector ignores comments but fails closed on quoted text", () => {
  const reads = findEnvReads(
    '// process.env.NOPE\nconst text = "process.env.NOPE";',
  );
  assert.deepEqual(
    reads.map(({ kind, name, line }) => ({ kind, name, line })),
    [{ kind: "alias", name: null, line: 2 }],
  );
});

test("environment detector skips regular-expression bodies but keeps division expressions", () => {
  for (const source of [
    "/process.env.SECRET/.test(value);",
    "if (ok) /process.env.SECRET/.test(value);",
    "do /process.env.SECRET/.test(value); while (false);",
    "if (ok) {} /process.env.SECRET/.test(value);",
    "function check() {} /process.env.SECRET/.test(value);",
    "class Check {} /process.env.SECRET/.test(value);",
  ]) {
    assert.deepEqual(
      findEnvReads(source).map(({ kind }) => kind),
      ["alias"],
    );
  }
  assert.deepEqual(
    findEnvReads("const ratio = function() {} / process.env.RATE;").map(
      ({ name }) => name,
    ),
    ["RATE"],
  );
  for (const prefix of ["!", "typeof ", "void ", "+", "-", "new "]) {
    assert.deepEqual(
      findEnvReads(
        `const ratio = ${prefix}function() {} / process.env.RATE;`,
      ).map(({ name }) => name),
      ["RATE"],
    );
  }
  assert.deepEqual(
    findEnvReads("const ratio = -class {} / process.env.RATE;").map(
      ({ name }) => name,
    ),
    ["RATE"],
  );
  assert.deepEqual(
    findEnvReads("const ratio = new class {} / process.env.RATE;").map(
      ({ name }) => name,
    ),
    ["RATE"],
  );
  assert.deepEqual(
    findEnvReads("const ratio = class {} / process.env.RATE;").map(
      ({ name }) => name,
    ),
    ["RATE"],
  );
  assert.deepEqual(
    findEnvReads("const rate = value / process.env.RATE;").map(
      ({ name }) => name,
    ),
    ["RATE"],
  );
});

test("environment detector fails closed on TSX, postfix division, and eval text", () => {
  for (const source of [
    "export function Footer() { return <p>Don't have an account? <a href={import.meta.env.VITE_SIGNUP_URL}>Sign up</a></p>; }",
    "const markup = </x><b>{process.env.TASKDESK_PORT}</b>;",
    "let i = 0; i++ / process.env.TASKDESK_PORT;",
    'eval("process.env.TASKDESK_PORT");',
  ]) {
    assert.ok(findEnvReads(source).length > 0, source);
  }
});

test("environment detector does not trust JSX text as tokenizer-confirmed comments", () => {
  for (const source of [
    "export const Docs = () => <p>See https://example.com/docs {process.env.STRIPE_SECRET_KEY}</p>;",
    [
      "export const Glob = () => <code>apps/*</code>;",
      "export const key = process.env.STRIPE_SECRET_KEY;",
      "/** end */",
    ].join("\n"),
  ]) {
    assert.ok(
      findEnvReads(source).some(
        (read) => read.kind === "alias" && read.name === null,
      ),
      source,
    );
  }
});

test("environment detector does not trust line-leading slash text inside JSX", () => {
  const reads = findEnvReads(
    "const X = () => <p>\n // note {process.env.STRIPE_SECRET_KEY}\n</p>;",
  );
  assert.deepEqual(
    reads.map(({ kind, name, line }) => ({ kind, name, line })),
    [{ kind: "alias", name: null, line: 2 }],
  );
});

test("environment detector bounds malformed quoted strings to one line", () => {
  const reads = findEnvReads(
    "const text = 'unterminated\nprocess.env.TASKDESK_PORT;",
  );
  assert.deepEqual(
    reads.map(({ kind, name, line }) => ({ kind, name, line })),
    [{ kind: "named", name: "TASKDESK_PORT", line: 2 }],
  );
});

test("TypeScript assertions on process.env stay unattributable", () => {
  for (const operator of ["as", "satisfies"]) {
    const reads = findEnvReads(
      `const env = process.env ${operator} Record<string, string>;`,
    );
    assert.deepEqual(
      reads.map(({ kind, name }) => ({ kind, name })),
      [{ kind: "alias", name: null }],
    );
  }
});

test("environment detector recognizes static process module and access variants", () => {
  const cases = [
    ['import { env } from "process"; use(env.TASKDESK_PORT);', "TASKDESK_PORT"],
    [
      'const value = require("node:process").env.TASKDESK_PORT;',
      "TASKDESK_PORT",
    ],
    [
      'import proc from "node:process"; use(proc.env.TASKDESK_PORT);',
      "TASKDESK_PORT",
    ],
    [
      'import * as proc from "node:process"; use(proc.env.TASKDESK_PORT);',
      "TASKDESK_PORT",
    ],
    [
      "const p = globalThis.process; use(p.env.TASKDESK_PORT);",
      "TASKDESK_PORT",
    ],
    [
      "const { env } = globalThis.process; use(env.TASKDESK_PORT);",
      "TASKDESK_PORT",
    ],
    [
      'const { env } = require("node:process"); use(env.TASKDESK_PORT);',
      "TASKDESK_PORT",
    ],
    [
      'const { env } = await import("node:process"); use(env.TASKDESK_PORT);',
      "TASKDESK_PORT",
    ],
    [
      'const proc = await import("node:process"); use(proc.env.TASKDESK_PORT);',
      "TASKDESK_PORT",
    ],
    ["use(process[`env`].TASKDESK_PORT);", "TASKDESK_PORT"],
    ['use(process["e" + "nv"].TASKDESK_PORT);', "TASKDESK_PORT"],
    ["const key = `env`; use(process[key].TASKDESK_PORT);", "TASKDESK_PORT"],
    ["use(globalThis[`process`].env.TASKDESK_PORT);", "TASKDESK_PORT"],
    [
      'use(Object.getOwnPropertyDescriptor(process, "env").value.TASKDESK_PORT);',
      "TASKDESK_PORT",
    ],
    ["use((process).env.TASKDESK_PORT);", "TASKDESK_PORT"],
    ["use(process!.env.TASKDESK_PORT);", "TASKDESK_PORT"],
  ];
  for (const [source, name] of cases) {
    assert.ok(
      findEnvReads(source).some((read) => read.name === name),
      `expected static environment access to be detected: ${source}`,
    );
  }
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
