/**
 * check:events — red probe.
 *
 * Issue #86: the API published event keys in the inherited kaneo vocabulary while
 * events.md declared only the target vocabulary, with zero overlap, because nothing ever
 * mechanically compared "what publishEvent(...) can emit" against "what events.md names".
 * scripts/ci/check-events.mjs is that comparison. This proves it against the REAL checker
 * binary, never against a re-implemented predicate — a probe that only asserts "the code
 * looks like it would catch this" is a unit test of an opinion, not of the gate.
 *
 * Every RED case here is paired with the same scenario made GREEN by the one fix that
 * should make it green (declaring the key, or resolving the call), so a probe that always
 * fails — or a checker gutted to always fail — cannot pass silently.
 *
 * Security review, PR #91 — added coverage:
 *
 *   HIGH 3  `resolveLocalConst` had no scope analysis: a second same-named `const` in one
 *           file was invisible, and the run printed a confident "every one registered"
 *           rather than throwing or skipping. See "resolveLocalConst refuses ambiguity".
 *   HIGH 4  the call detector was a raw `indexOf("publishEvent(")` substring scan, and
 *           five ordinary shapes were invisible (case letters match the review's own):
 *           an aliased import (H), a space before the paren (I), a comment ending in the
 *           word `function` (J), a generic type argument (K), and a local alias (L). See
 *           "call-detector shapes".
 *   MEDIUM  three mutations left `pnpm test:ci-scripts` green: widening `KEY_SHAPE`, and
 *           removing either of the two "refusing to run" fail-closed guards. See
 *           "probe gaps the review found".
 */

import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { repoRoot } from "../lib/repo.mjs";
import {
  cleanUpScratchRepos,
  installCheckers,
  installFromRepo,
  runChecker,
  scratchDir,
  write,
} from "../lib/scratch-repo.mjs";

after(cleanUpScratchRepos);

/** A scratch repo carrying the real checker, the real events.md, and an empty API tree. */
function bareRepo(name) {
  const dir = scratchDir(name);
  installCheckers(dir);
  installFromRepo(dir, "docs/01-architecture/events.md");
  mkdirSync(path.join(dir, "apps/api/src"), { recursive: true });
  return dir;
}

function controller(dir, relative, body) {
  write(
    dir,
    path.join("apps/api/src", relative),
    [
      'import { publishEvent } from "../../events";',
      "",
      "export async function handler() {",
      body,
      "}",
      "",
    ].join("\n"),
  );
}

describe("check:events — the shipped tree", () => {
  it("passes GREEN against the real apps/api/src and the real events.md", () => {
    const dir = scratchDir("shipped");
    installCheckers(dir);
    installFromRepo(dir, "docs/01-architecture/events.md");
    cpSync(
      path.join(repoRoot, "apps/api/src"),
      path.join(dir, "apps/api/src"),
      { recursive: true },
    );

    const result = runChecker(dir, "check-events.mjs");
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /24 published event key/);
  });
});

describe("check:events — RED probe: a published key events.md does not declare", () => {
  it("a synthetic undeclared key fails the checker", () => {
    const dir = bareRepo("undeclared-red");
    controller(
      dir,
      "probe/publish-synthetic.ts",
      '  await publishEvent("probe.synthetic_key_not_declared", { id: "x" });',
    );

    const result = runChecker(dir, "check-events.mjs");
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /probe\.synthetic_key_not_declared/);
    assert.match(
      result.output,
      /not named in docs\/01-architecture\/events\.md/,
    );
  });

  it("PAIRED: the same key, declared, passes — so the RED case above is not vacuous", () => {
    const dir = bareRepo("declared-green");
    controller(
      dir,
      "probe/publish-synthetic.ts",
      '  await publishEvent("probe.synthetic_key_not_declared", { id: "x" });',
    );
    // Append the key to events.md, backticked, exactly as the real registration does.
    const eventsPath = path.join(dir, "docs/01-architecture/events.md");
    const current = readFileSync(eventsPath, "utf8");
    writeFileSync(
      eventsPath,
      `${current}\n\n<!-- probe -->\n\`probe.synthetic_key_not_declared\`\n`,
    );

    const result = runChecker(dir, "check-events.mjs");
    assert.equal(result.status, 0, result.output);
  });
});

describe("check:events — fails CLOSED, never silently, on a call it cannot read", () => {
  it("a publishEvent(...) argument that is neither a literal nor a resolvable const throws", () => {
    const dir = bareRepo("unresolvable-red");
    controller(
      dir,
      "probe/dynamic-key.ts",
      "  const kind = computeKind();\n  await publishEvent(kind, { id: 'x' });",
    );

    const result = runChecker(dir, "check-events.mjs");
    assert.notEqual(result.status, 0, result.output);
    assert.match(result.output, /cannot determine which key/);
  });

  it("PAIRED: the same call resolved to a declared literal passes", () => {
    const dir = bareRepo("resolved-green");
    controller(
      dir,
      "probe/static-key.ts",
      '  const kind = "workspace.created";\n  await publishEvent(kind, { id: "x" });',
    );

    const result = runChecker(dir, "check-events.mjs");
    assert.equal(result.status, 0, result.output);
  });

  it("one unresolved branch of a resolvable ternary that is not declared still fails", () => {
    const dir = bareRepo("ternary-red");
    controller(
      dir,
      "probe/ternary-key.ts",
      "  const kind = ok\n" +
        '    ? "workspace.created"\n' +
        '    : "probe.ternary_branch_not_declared";\n' +
        "  await publishEvent(kind, { id: 'x' });",
    );

    const result = runChecker(dir, "check-events.mjs");
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /probe\.ternary_branch_not_declared/);
  });

  it("PAIRED: both branches of the same ternary declared passes", () => {
    const dir = bareRepo("ternary-green");
    controller(
      dir,
      "probe/ternary-key.ts",
      "  const kind = ok\n" +
        '    ? "workspace.created"\n' +
        '    : "probe.ternary_branch_declared";\n' +
        "  await publishEvent(kind, { id: 'x' });",
    );
    const eventsPath = path.join(dir, "docs/01-architecture/events.md");
    const current = readFileSync(eventsPath, "utf8");
    writeFileSync(
      eventsPath,
      `${current}\n\n<!-- probe -->\n\`probe.ternary_branch_declared\`\n`,
    );

    const result = runChecker(dir, "check-events.mjs");
    assert.equal(result.status, 0, result.output);
  });
});

describe("check:events — resolveLocalConst refuses ambiguity rather than guessing (HIGH 3)", () => {
  it("two functions each declaring `const kind` in the same file refuses to run, rather than silently resolving to the first", () => {
    const dir = bareRepo("ambiguous-const-red");
    write(
      dir,
      "apps/api/src/probe/dup-const.ts",
      [
        'import { publishEvent } from "../../events";',
        "",
        "export async function first() {",
        '  const kind = "workspace.created";',
        '  await publishEvent(kind, { id: "a" });',
        "}",
        "",
        "export async function second() {",
        '  const kind = "probe.review91_second_const_unregistered";',
        '  await publishEvent(kind, { id: "b" });',
        "}",
        "",
      ].join("\n"),
    );

    const result = runChecker(dir, "check-events.mjs");
    assert.notEqual(result.status, 0, result.output);
    assert.match(result.output, /cannot be resolved with confidence/);
    assert.match(result.output, /"kind" has 2 `const kind = …;` declarations/);
    // NON-VACUITY: the old defect answered wrongly rather than failing — it printed a
    // confident "every one registered" while the second key was invisible. Assert this
    // run is not that: it must not report success at all.
    assert.doesNotMatch(result.output, /published event key.*registered/);
  });

  it("PAIRED: renaming the second declaration removes the ambiguity and both resolve correctly", () => {
    const dir = bareRepo("ambiguous-const-green");
    write(
      dir,
      "apps/api/src/probe/dup-const.ts",
      [
        'import { publishEvent } from "../../events";',
        "",
        "export async function first() {",
        '  const kind = "workspace.created";',
        '  await publishEvent(kind, { id: "a" });',
        "}",
        "",
        "export async function second() {",
        '  const kindTwo = "workspace.created";',
        '  await publishEvent(kindTwo, { id: "b" });',
        "}",
        "",
      ].join("\n"),
    );

    const result = runChecker(dir, "check-events.mjs");
    assert.equal(result.status, 0, result.output);
  });
});

describe("check:events — call-detector shapes the review measured as silently GREEN (HIGH 4)", () => {
  const shapes = [
    {
      label: "H — an aliased import (`import { publishEvent as emit }`)",
      slug: "h-aliased-import",
      key: "probe.review91_h_aliased_import",
      body: [
        'import { publishEvent as emit } from "../../events";',
        "export async function handler() {",
        '  await emit("probe.review91_h_aliased_import", { id: "x" });',
        "}",
        "",
      ].join("\n"),
    },
    {
      label: "I — a space before the paren (`publishEvent (...)`)",
      slug: "i-space-before-paren",
      key: "probe.review91_i_space_before_paren",
      body: [
        'import { publishEvent } from "../../events";',
        "export async function handler() {",
        '  await publishEvent ("probe.review91_i_space_before_paren", { id: "x" });',
        "}",
        "",
      ].join("\n"),
    },
    {
      label:
        "J — a comment ending in the word `function` immediately above the call",
      slug: "j-comment-ends-in-function",
      key: "probe.review91_j_comment_function",
      body: [
        'import { publishEvent } from "../../events";',
        "export function handler() {",
        "  // this helper is basically a pure function",
        '  publishEvent("probe.review91_j_comment_function", { id: "x" });',
        "}",
        "",
      ].join("\n"),
    },
    {
      label: "K — a generic type argument (`publishEvent<T>(...)`)",
      slug: "k-generic-type-argument",
      key: "probe.review91_k_generic_arg",
      body: [
        'import { publishEvent } from "../../events";',
        "export async function handler() {",
        '  await publishEvent<{ id: string }>("probe.review91_k_generic_arg", { id: "x" });',
        "}",
        "",
      ].join("\n"),
    },
    {
      label: "L — a local alias (`const emit = publishEvent;`)",
      slug: "l-local-alias",
      key: "probe.review91_l_local_alias",
      body: [
        'import { publishEvent } from "../../events";',
        "export async function handler() {",
        "  const emit = publishEvent;",
        '  await emit("probe.review91_l_local_alias", { id: "x" });',
        "}",
        "",
      ].join("\n"),
    },
  ];

  for (const shape of shapes) {
    it(`${shape.label}: an unregistered key is caught, never reported as zero`, () => {
      const dir = bareRepo(`shape-red-${shape.slug}`);
      write(dir, "apps/api/src/probe/case.ts", shape.body);

      const result = runChecker(dir, "check-events.mjs");
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, new RegExp(shape.key.replace(/\./g, "\\.")));
      // The tell the review named: a real publish reported as "0 published event key(s)".
      assert.doesNotMatch(result.output, /0 published event key/);
    });

    it(`PAIRED — ${shape.label}: the same key, declared, passes`, () => {
      const dir = bareRepo(`shape-green-${shape.slug}`);
      write(dir, "apps/api/src/probe/case.ts", shape.body);
      const eventsPath = path.join(dir, "docs/01-architecture/events.md");
      const current = readFileSync(eventsPath, "utf8");
      writeFileSync(
        eventsPath,
        `${current}\n\n<!-- probe -->\n\`${shape.key}\`\n`,
      );

      const result = runChecker(dir, "check-events.mjs");
      assert.equal(result.status, 0, result.output);
    });
  }
});

describe("check:events — probe gaps the review found (MEDIUM): KEY_SHAPE, and both fail-closed refusals", () => {
  it("a bare, non-dot-namespaced key throws rather than silently passing — catches a widened KEY_SHAPE", () => {
    // Review mutation M5: widening KEY_SHAPE from a strict lowercase/dot-namespaced
    // pattern to `/^[\\s\\S]*$/` took declaredKeys()'s allowlist from 71 tokens to 192,
    // admitting ordinary prose identifiers such as `id`, `kind`, `payload`. `kind` here is
    // backticked in events.md as a FIELD NAME, not an event key — today it must not count
    // as declared, and a publish literally named "kind" must not validate as event-key
    // shaped either (both checks share the one KEY_SHAPE constant). If KEY_SHAPE is ever
    // widened the way M5 did, this scenario flips from a thrown, fail-closed refusal to a
    // silent pass — which is exactly what this assertion catches.
    const dir = bareRepo("key-shape-guard");
    const eventsPath = path.join(dir, "docs/01-architecture/events.md");
    const current = readFileSync(eventsPath, "utf8");
    writeFileSync(
      eventsPath,
      `${current}\n\n<!-- probe: a field name, not an event key -->\n\`kind\`\n`,
    );
    write(
      dir,
      "apps/api/src/probe/bare-key.ts",
      [
        'import { publishEvent } from "../../events";',
        "export async function handler() {",
        '  await publishEvent("kind", { id: "x" });',
        "}",
        "",
      ].join("\n"),
    );

    const result = runChecker(dir, "check-events.mjs");
    assert.notEqual(result.status, 0, result.output);
    assert.match(
      result.output,
      /not shaped like a lowercase, dot-namespaced event key/,
    );
  });

  it("declaredKeys()'s empty-parse refusal fires when events.md names no event-key-shaped token (review mutation M8)", () => {
    const dir = scratchDir("no-declared-keys");
    installCheckers(dir);
    write(
      dir,
      "docs/01-architecture/events.md",
      "# Events\n\nNo event keys here — just prose, and a `singleword` mention.\n",
    );
    mkdirSync(path.join(dir, "apps/api/src"), { recursive: true });
    write(dir, "apps/api/src/probe/empty.ts", "export const nothing = 1;\n");

    const result = runChecker(dir, "check-events.mjs");
    assert.notEqual(result.status, 0, result.output);
    assert.match(
      result.output,
      /No event keys parsed from .*events\.md; refusing to run/,
    );
  });

  it("main()'s empty-source-tree refusal fires when apps/api/src has no code files at all (review mutation M9)", () => {
    const dir = bareRepo("no-source-files");
    // bareRepo() creates apps/api/src but writes nothing under it — exactly the M9 shape.

    const result = runChecker(dir, "check-events.mjs");
    assert.notEqual(result.status, 0, result.output);
    assert.match(
      result.output,
      /No source files found under apps\/api\/src; refusing to run/,
    );
  });
});

describe("check:events — LOW/MEDIUM: source text reaching stderr is sanitised", () => {
  it("an unresolved call's raw argument text is JSON-escaped, so an embedded newline cannot start a fake `::error::` line", () => {
    const dir = bareRepo("sanitised-unresolved-argument");
    write(
      dir,
      "apps/api/src/probe/inject.ts",
      [
        'import { publishEvent } from "../../events";',
        "export async function handler() {",
        "  const kind = computeKind();",
        "  await publishEvent(",
        // A `${…}` interpolation makes this genuinely unresolvable (literalBody rejects
        // any backtick body containing `${`), so this exercises the FIRST throw site —
        // the raw, unresolved `rawArgument` interpolation the review's LOW-10 finding
        // named — rather than the (separately sanitised) shape-validation throw.
        "    `line one",
        "::error::a fake annotation",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture SOURCE TEXT for the checker under test, not a template literal here
        "line three${kind}`,",
        '    { id: "x" },',
        "  );",
        "}",
        "",
      ].join("\n"),
    );

    const result = runChecker(dir, "check-events.mjs");
    assert.notEqual(result.status, 0, result.output);
    // The raw multi-line text must not appear verbatim: every line of output containing
    // the injected marker must ALSO still contain the JSON-escaped `\n`, proving the
    // literal newline was collapsed rather than passed through.
    const markerLines = result.output
      .split("\n")
      .filter((line) => line.includes("::error::a fake annotation"));
    assert.ok(
      markerLines.length > 0,
      "expected the sanitised text to appear somewhere",
    );
    for (const line of markerLines) {
      assert.match(line, /\\n/, `expected an escaped newline on: ${line}`);
    }
  });
});
