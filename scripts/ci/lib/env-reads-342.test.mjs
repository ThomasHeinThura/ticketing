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

// D3: shapes Thomas found still evaded #352's detector on `main`
// (docs/07-planning/security-reviews/352-env-read-detector.md, "Delta Opus 5.5 review at
// `fa1d325`", finding G1) and asked to keep #342 open for. Confirmed absent from
// `apps/` and `packages/` today (grepped for every one of these shapes before writing
// this file), so none of them changes `check:env`'s exact-count ratchet on the real tree.
const d3Cases = [
  [
    "TS non-null cast (process as any).env",
    "const v = (process as any).env.STRIPE_SECRET_KEY;",
  ],
  [
    "TS satisfies cast (process satisfies T).env",
    "const v = (process satisfies Record<string, unknown>).env.STRIPE_SECRET_KEY;",
  ],
  [
    "old-style cast (<any>process).env",
    "const v = (<any>process).env.STRIPE_SECRET_KEY;",
  ],
  [
    "optional-chained globalThis?.process.env",
    "const v = globalThis?.process.env.STRIPE_SECRET_KEY;",
  ],
  [
    "optional-chained global?.process.env",
    "const v = global?.process.env.STRIPE_SECRET_KEY;",
  ],
  ["window.process.env", "const v = window.process.env.STRIPE_SECRET_KEY;"],
  [
    "parenthesized process alias",
    "const p = (process); console.log(p.env.STRIPE_SECRET_KEY);",
  ],
  [
    "globalThis alias, then .process",
    "const g = globalThis; console.log(g.process.env.STRIPE_SECRET_KEY);",
  ],
  [
    "global alias, then .process",
    "const g = global; console.log(g.process.env.STRIPE_SECRET_KEY);",
  ],
  [
    "globalThis['process'] stored in a variable",
    "const p = globalThis['process']; console.log(p.env.STRIPE_SECRET_KEY);",
  ],
  [
    "require('process') stored in a variable",
    "const p = require('process'); console.log(p.env.STRIPE_SECRET_KEY);",
  ],
  [
    "require('node:process') stored in a variable",
    "const p = require('node:process'); console.log(p.env.STRIPE_SECRET_KEY);",
  ],
  [
    "unicode-escaped process identifier",
    "const v = pro\\u0063ess.env.STRIPE_SECRET_KEY;",
  ],
  [
    "optional computed process?.['env']",
    "const v = process?.['env'].STRIPE_SECRET_KEY;",
  ],
  [
    "dynamic import('node:process').then(...)",
    'import("node:process").then((m) => console.log(m.env.STRIPE_SECRET_KEY));',
  ],
  [
    "dynamic import('process').then(...)",
    'import("process").then((m) => console.log(m.env.STRIPE_SECRET_KEY));',
  ],
  [
    "import.meta stored in a variable",
    "const m = import.meta; console.log(m.env.STRIPE_SECRET_KEY);",
  ],
  [
    "import.meta destructured",
    "const { env } = import.meta; console.log(env.STRIPE_SECRET_KEY);",
  ],
  [
    "with (process) statement",
    "with (process) { console.log(env.STRIPE_SECRET_KEY); }",
  ],
  ["process passed as a bare call argument", "logEnvironment(process);"],
  [
    "process passed as a later call argument",
    "logEnvironment(logger, process);",
  ],
];

for (const [label, source] of d3Cases) {
  test(`environment detector records D3 shape: ${label}`, () => {
    const reads = findEnvReads(source);
    assert.ok(reads.length > 0, `expected ${label} to be detected`);
  });
}

test("environment detector does not flag a globalThis/import.meta alias used for something else", () => {
  assert.deepEqual(findEnvReads("const g = globalThis; g.fetch();"), []);
  assert.deepEqual(
    findEnvReads("const m = import.meta; console.log(m.url);"),
    [],
  );
  assert.deepEqual(
    findEnvReads("const { url } = import.meta; console.log(url);"),
    [],
  );
});

test("environment detector still ignores safe, non-env process members", () => {
  assert.deepEqual(findEnvReads("process.exit(1);"), []);
  assert.deepEqual(findEnvReads("const a = process.argv;"), []);
  assert.deepEqual(findEnvReads("const c = process.cwd();"), []);
});

test('environment detector does not double-flag Reflect.get(process, "env") because process is its first argument', () => {
  const reads = findEnvReads(
    'const env = Reflect.get(process, "env"); console.log(env.TASKDESK_PORT);',
  );
  assert.equal(reads.length, 1);
});

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

test("environment detector fails closed on raw environment spellings in comments and strings", () => {
  const reads = findEnvReads(
    '// process.env.NOPE\nconst text = "process.env.NOPE";',
  );
  assert.deepEqual(
    reads.map(({ kind, name, line }) => ({ kind, name, line })),
    [
      { kind: "alias", name: null, line: 1 },
      { kind: "alias", name: null, line: 2 },
    ],
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

test("raw-access backstop does not exempt JSX spans mistaken for comments", () => {
  const cases = [
    [
      "fragment with a line-leading slash",
      "const X = () => <>\n // docs {process.env.STRIPE_SECRET_KEY}\n</>;",
    ],
    [
      "tag attribute containing a comparison",
      "const X = () => <div hidden={a < b}>\n // docs {process.env.STRIPE_SECRET_KEY}\n</div>;",
    ],
    [
      "closing tag inside an expression string",
      'const X = () => <p>{"</p>"}\n // docs {process.env.STRIPE_SECRET_KEY}\n</p>;',
    ],
    [
      "block-comment-like fragment text",
      "const X = () => <>\n /* glob\n</>;\nconst secret = process.env.STRIPE_SECRET_KEY;\n/** end */",
    ],
    [
      "backtick in JSX followed by a template comment-like line",
      "const X = () => <p>Press ` to open</p>;\nconst text = `first\n/* $" +
        "{process.env.STRIPE_SECRET_KEY}`;\n/** end */",
    ],
    [
      "backtick text followed by a template with slash text",
      "const X = () => <p>`</p>;\nconst text = `first\n// $" +
        "{process.env.STRIPE_SECRET_KEY}`;",
    ],
  ];

  for (const [label, source] of cases) {
    const reads = findEnvReads(source);
    assert.ok(
      reads.some(
        (read) => read.kind === "alias" || read.name === "STRIPE_SECRET_KEY",
      ),
      `expected fail-closed read for ${label}`,
    );
  }
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
