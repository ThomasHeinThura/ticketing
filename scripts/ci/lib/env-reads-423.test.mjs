import assert from "node:assert/strict";
import test from "node:test";
import { findEnvReads } from "./env-reads.mjs";

// Opus review of #423 pass 1 (docs/07-planning/security-reviews/423-env-reads-ast-rewrite.md)
// — the AST walker's allow-list default silently dropped ~26 real shapes the old tokenizer on
// `main` correctly charged, because it only recognized specific consuming contexts instead of
// charging by default and carving out specific safe narrowings. Every row below is one of
// those verified-missed shapes; each is confirmed (by running against `0d07d84`, this PR's
// pre-fix head) to have returned `[]` before this file's structural default-flip fix, and to
// return at least one charge after it.

const constructorCases = [
  ["new Config(process.env)", "new Config(process.env);"],
  ["new X(process.env as any)", "new X(process.env as any);"],
  ["new Wrapper(process)", "new Wrapper(process);"],
];

const returnedCases = [
  [
    "return process.env in a local (non-exported) function",
    "function f() { return process.env; }",
  ],
  ["() => process.env", "const f = () => process.env;"],
  [
    "exported function whose return is inside an if",
    "export function f() { if (cond) { return process.env; } return {}; }",
  ],
  ["yield process.env", "function* f() { yield process.env; }"],
];

const operatorCases = [
  ["(0, process.env).X", "const v = (0, process.env).X;"],
  ["(0, process).env.X", "const v = (0, process).env.X;"],
  ["(true && process.env).X", "const v = (true && process.env).X;"],
  ["e ||= process.env", "let e; e ||= process.env;"],
  ['"X" in process.env', 'const v = "X" in process.env;'],
];

const assignmentCases = [
  ["({ SECRET } = process.env)", "let SECRET; ({ SECRET } = process.env);"],
  ["o.env = process.env", "o.env = process.env;"],
  ["module.exports = process.env", "module.exports = process.env;"],
];

const classCases = [
  ["class field initializer", "class C { env = process.env; }"],
];

const destructureQuotedKeyCases = [
  ["quoted key off process", 'const { "env": e } = process; use(e);'],
  [
    "computed key off process",
    'const key = "env"; const { [key]: e } = process; use(e);',
  ],
];

const jsxSpreadPropCases = [
  [
    "JSX spread of import.meta.env",
    "const X = () => <C {...import.meta.env} />;",
  ],
  [
    "JSX prop of import.meta.env",
    "const X = () => <C env={import.meta.env} />;",
  ],
];

const thenDestructureCases = [
  [
    "destructured import('node:process').then callback parameter",
    'import("node:process").then(({ env }) => console.log(env.X));',
  ],
];

function runGroup(groupLabel, cases, options = {}) {
  for (const [label, source] of cases) {
    test(`environment detector charges #423 pass-1 shape (${groupLabel}): ${label}`, () => {
      const reads = findEnvReads(source, options);
      assert.ok(reads.length > 0, `expected ${label} to be charged: ${source}`);
    });
  }
}

runGroup("constructors", constructorCases);
runGroup("values returned", returnedCases);
runGroup("operators", operatorCases);
runGroup("assignments", assignmentCases);
runGroup("classes", classCases);
runGroup(
  "destructuring from process, quoted/computed key",
  destructureQuotedKeyCases,
);
runGroup("JSX", jsxSpreadPropCases, { jsx: true });
runGroup("other", thenDestructureCases);

// Opus review of #423 pass 1's own follow-up to round 1's shadow-scoping fix — `isShadowedAt`
// treated anything inside a function NODE as shadowed by that function's own parameter, not
// just its body/parameters. A computed class-member/method key or a decorator argument runs
// in the OUTER scope and must still see the real global, even though the enclosing
// method/parameter happens to be named `process`.
const shadowFollowUpCases = [
  [
    "computed class-member key with a same-named method parameter",
    "class C { [process.env.SECRET_KEY](process) {} }",
  ],
  [
    "computed object-literal method key with a same-named method parameter",
    "const o = { [process.env.SECRET_KEY](process) {} };",
  ],
  [
    "decorator argument on a method whose own parameter is named process",
    "class C { @dec(process.env.SECRET_KEY) m(process) {} }",
  ],
  [
    "parameter decorator argument evaluated before that parameter's own binding",
    "class C { m(@Inject(process.env.SECRET_KEY) process) {} }",
  ],
];

for (const [label, source] of shadowFollowUpCases) {
  test(`environment detector still charges the real global despite a same-named param (${label})`, () => {
    const reads = findEnvReads(source, { jsx: false }).filter(
      (read) => read.name === "SECRET_KEY",
    );
    assert.ok(
      reads.length > 0,
      `expected ${label} to still resolve the outer-scope process: ${source}`,
    );
  });
}
