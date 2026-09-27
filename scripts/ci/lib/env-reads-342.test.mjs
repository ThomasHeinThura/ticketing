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
  // Exactly one: the unattributable escape at the `Reflect.get` call. `env.TASKDESK_PORT`
  // is deliberately not ALSO resolved through the alias — same reasoning as the SmtpEnv
  // parameter-default case in env-reads.test.mjs, see the comment on `handleBindingDeclaration`'s
  // "env"/"importMetaEnv" branch in lib/env-reads.mjs. What this test's name guards against is
  // `process` (the call's own first argument) separately tripping the generic "process passed
  // as a bare call argument" charge — it does not, because `classify()` already recognizes
  // this exact call shape, see the CallExpression case's own comment.
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

test("environment detector does not flag process.env text inside real comments or strings", () => {
  // #382's H1: a hand-rolled lexer had to re-derive comment/string boundaries itself and
  // could get them wrong (that IS what H1 found). A real parser never has that uncertainty —
  // a comment and a string are unambiguous with real syntax, so text that merely LOOKS like
  // `process.env.NOPE` inside either one is correctly not a read at all. The old fail-closed
  // backstop this test used to assert was compensating for the lexer's own unreliability, not
  // a real requirement; asserting `[]` here is the intended, more precise behavior, not a
  // weakening — see this file's own header.
  const reads = findEnvReads(
    '// process.env.NOPE\nconst text = "process.env.NOPE";',
  );
  assert.deepEqual(reads, []);
});

test("environment detector does not treat a regular-expression body as code, but still reads real division expressions", () => {
  // Same class as above: `/process.env.SECRET/` is a regex literal — its content is an
  // opaque pattern, never executed as JS, to a real parser exactly as it is to the real
  // runtime. The division-expression cases right after this one are the actual code the old
  // heuristic had to get right to avoid a false positive, and still must.
  for (const source of [
    "/process.env.SECRET/.test(value);",
    "if (ok) /process.env.SECRET/.test(value);",
    "do /process.env.SECRET/.test(value); while (false);",
    "if (ok) {} /process.env.SECRET/.test(value);",
    "function check() {} /process.env.SECRET/.test(value);",
    "class Check {} /process.env.SECRET/.test(value);",
  ]) {
    assert.deepEqual(findEnvReads(source), [], source);
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

test("environment detector reads real JSX expression containers and postfix division", () => {
  for (const source of [
    "export function Footer() { return <p>Don't have an account? <a href={import.meta.env.VITE_SIGNUP_URL}>Sign up</a></p>; }",
    "const markup = </x><b>{process.env.TASKDESK_PORT}</b>;",
  ]) {
    assert.ok(findEnvReads(source, { jsx: true }).length > 0, source);
  }
  assert.ok(
    findEnvReads("let i = 0; i++ / process.env.TASKDESK_PORT;").length > 0,
  );
});

test("environment detector does not resolve a dynamically-built eval() string — accepted limit", () => {
  // No static analyzer resolves arbitrary code constructed and run through `eval` at
  // runtime; a real parser correctly treats the string argument as opaque data, not code
  // (this is *more* correct than the old lexer's blanket "any raw text anywhere" backstop,
  // which only happened to catch the single literal, unconcatenated case and would have
  // missed `eval("proc" + "ess.env.X")` just as completely). Documented, not silently lost.
  assert.deepEqual(findEnvReads('eval("process.env.TASKDESK_PORT");'), []);
});

test("environment detector resolves JSX text that used to be mistaken for a comment", () => {
  // #382's H1, closed structurally: a real parser never confuses `//docs` inside JSX text
  // with a line comment, so `process.env.STRIPE_SECRET_KEY` right after it is not just
  // caught fail-closed (the old backstop's degraded `alias`/`name: null`) — it resolves to
  // the real, fully-attributable named read, which is strictly more precise.
  const withSlashInText = findEnvReads(
    "export const Docs = () => <p>See https://example.com/docs {process.env.STRIPE_SECRET_KEY}</p>;",
    { jsx: true },
  );
  assert.deepEqual(
    withSlashInText.map(({ kind, name }) => ({ kind, name })),
    [{ kind: "named", name: "STRIPE_SECRET_KEY" }],
  );

  const withGlobInText = findEnvReads(
    [
      "export const Glob = () => <code>apps/*</code>;",
      "export const key = process.env.STRIPE_SECRET_KEY;",
      "/** end */",
    ].join("\n"),
    { jsx: true },
  );
  assert.deepEqual(
    withGlobInText.map(({ kind, name }) => ({ kind, name })),
    [{ kind: "named", name: "STRIPE_SECRET_KEY" }],
  );
});

test("environment detector resolves a line-leading slash inside JSX to a real named read", () => {
  const reads = findEnvReads(
    "const X = () => <p>\n // note {process.env.STRIPE_SECRET_KEY}\n</p>;",
    { jsx: true },
  );
  assert.deepEqual(
    reads.map(({ kind, name, line }) => ({ kind, name, line })),
    [{ kind: "named", name: "STRIPE_SECRET_KEY", line: 2 }],
  );
});

test("a real parser is not fooled by JSX spans that merely look like comments", () => {
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
    const reads = findEnvReads(source, { jsx: true });
    assert.ok(
      reads.some(
        (read) => read.kind === "named" && read.name === "STRIPE_SECRET_KEY",
      ),
      `expected a real named read for ${label}`,
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

// #382's Opus review, "M1" — passing the raw `process`/`process.env` object across a module
// boundary. This file cannot see what the OTHER file does with it, so the export site itself
// is the only place left to charge — see env-reads.mjs's `handleBindingDeclaration`/
// `ExportAssignment`/`ExportDeclaration` cases.
const m1ExportCases = [
  ["export default process", "export default process;"],
  ["export const p = process", "export const p = process;"],
  ["export const get = () => process", "export const get = () => process;"],
  ["export { env } from node:process", 'export { env } from "node:process";'],
];
for (const [label, source] of m1ExportCases) {
  test(`environment detector charges the module boundary for D3 shape M1: ${label}`, () => {
    const reads = findEnvReads(source);
    assert.ok(
      reads.some((read) => read.kind === "alias" || read.kind === "computed"),
      `expected ${label} to be charged as unattributable`,
    );
  });
}

test("environment detector does not charge a non-exported alias of the same shapes", () => {
  // The mirror image of m1ExportCases: nothing crosses a module boundary, so nothing is
  // charged merely for existing — matches the long-standing "ignores nested properties
  // named like runtime globals" test's spirit (an alias, on its own, is not a read).
  assert.deepEqual(findEnvReads("const p = process;"), []);
  assert.deepEqual(findEnvReads("const get = () => process;"), []);
});

// #382's Opus review, "M4" — nested destructuring of `process` out of `globalThis`. The two
// listed shapes were record-kept as still open on #342 specifically because #382's own PR
// tested neither.
test("environment detector resolves D3 shape M4: nested globalThis destructuring", () => {
  assert.ok(
    findEnvReads(
      "const { process: { env } } = globalThis; use(env.TASKDESK_PORT);",
    ).some((read) => read.kind === "named" && read.name === "TASKDESK_PORT"),
  );
  assert.ok(
    findEnvReads(
      "const { process: p } = globalThis; use(p.env.TASKDESK_PORT);",
    ).some((read) => read.kind === "named" && read.name === "TASKDESK_PORT"),
  );
});

// #382's Opus review, "M2" (the remaining cast shapes beyond what #382's own tests already
// covered) and "M3" (escapes inside string literals the old lexer read as raw source text
// rather than the parser's own decoded value).
const m2AndM3Cases = [
  ["M2: (import.meta as any).env.X", "const v = (import.meta as any).env.X;"],
  ["M2: double-parenthesized cast", "const v = ((process as any)).env.X;"],
  [
    "M2: non-null then cast (process! as any).env",
    "const v = (process! as any).env.X;",
  ],
  [
    "M2: (globalThis as any).process.env",
    "const v = (globalThis as any).process.env.X;",
  ],
  [
    "M2: (import.meta).env (redundant parens)",
    "const v = (import.meta).env.X;",
  ],
  [
    "M2: cast alias const p = (process as any); p.env",
    "const p = (process as any); use(p.env.X);",
  ],
  [
    "M3: process['\\x65nv'] (hex-escaped property name)",
    "const v = process['\\x65nv'].X;",
  ],
  [
    "M3: globalThis['\\x70rocess'] (hex-escaped property name)",
    "const v = globalThis['\\x70rocess'].env.X;",
  ],
  [
    "M3: Reflect.get(process, '\\x65nv') (hex-escaped literal argument)",
    "const v = Reflect.get(process, '\\x65nv'); use(v.X);",
  ],
];
for (const [label, source] of m2AndM3Cases) {
  test(`environment detector records D3 shape ${label}`, () => {
    assert.ok(
      findEnvReads(source).length > 0,
      `expected ${label} to be detected`,
    );
  });
}

// #382's Opus review, "L1" — a bare-argument heuristic in that PR's implementation flagged
// several shapes that never actually reference the real `process` global at all: a condition
// test, a parameter/catch-clause DECLARATION (which binds a new local name, it does not
// reference anything), and a local variable that merely happens to be named "process". A
// real parser distinguishes a declaration binding from an expression reference structurally
// (this design never calls `classify()` on a declaration's own name, only on the values
// initializers/arguments actually resolve to), so none of these shapes is reachable by any
// charge in this file — unlike a token-adjacency heuristic, which cannot tell them apart from
// a genuine reference without the real grammar.
test("environment detector does not flag D3 shape L1's false positives", () => {
  assert.deepEqual(findEnvReads("if (process) { ok(); }"), []);
  assert.deepEqual(findEnvReads("const f = (process) => process.length;"), []);
  assert.deepEqual(
    findEnvReads("function f(process) { return process.length; }"),
    [],
  );
  assert.deepEqual(
    findEnvReads("try { ok(); } catch (process) { log(process); }"),
    [],
  );
  // A local variable literally named `process`, entirely unrelated to the Node global,
  // still is not enough on its own to trip anything — matches the existing
  // "ignores nested properties named like runtime globals" test's own precedent.
  assert.deepEqual(findEnvReads("function f(process) { return process; }"), []);
});

// Ordinary review of #423 (this PR), Finding 1 — L1's file-wide `Set` suppressed the literal
// spelling `process` EVERYWHERE in the file the instant it saw ANY shadow binding, so a real,
// unrelated, top-level `process.env.X` read elsewhere in the same file was silently never
// charged. Real JS scoping is lexical: a parameter/catch binding shadows its OWN scope only.
test("environment detector still charges a real read elsewhere in a file that also shadows process", () => {
  assert.deepEqual(
    findEnvReads(
      "function f(process) { return process.length; }\nconst secret = process.env.API_KEY;",
    ),
    [
      {
        object: "process.env",
        kind: "named",
        name: "API_KEY",
        line: 2,
        snippet: "const secret = process.env.API_KEY;",
      },
    ],
  );
  assert.deepEqual(
    findEnvReads(
      "try { ok(); } catch (process) { log(process); }\nconst secret = process.env.API_KEY;",
    ),
    [
      {
        object: "process.env",
        kind: "named",
        name: "API_KEY",
        line: 2,
        snippet: "const secret = process.env.API_KEY;",
      },
    ],
  );
});

// Ordinary review of #423 (this PR), Finding 2 — the bag or a bare global escaping through an
// object-literal property value, an array-literal element, a ternary branch, or an `||`/`??`
// fallback was not charged anywhere, unlike the dedicated spread-handling case that already
// covers `{ ...process.env }`. Matches that existing case's own charge shape (`kind: "alias"`).
const containerEscapeCases = [
  ["object literal property value", "const obj = { env: process.env };"],
  ["object literal shorthand property", "const obj = { process };"],
  ["array literal element", "const list = [process.env];"],
  ["conditional expression branch", "const x = cond ? process.env : {};"],
  ["logical OR fallback", "const x = maybe || process.env;"],
  ["logical nullish-coalescing fallback", "const x = maybe ?? process.env;"],
];

for (const [label, source] of containerEscapeCases) {
  test(`environment detector charges container escape: ${label}`, () => {
    const reads = findEnvReads(source);
    assert.equal(reads.length, 1, `expected ${label} to be charged once`);
    assert.equal(reads[0].kind, "alias");
  });
}
