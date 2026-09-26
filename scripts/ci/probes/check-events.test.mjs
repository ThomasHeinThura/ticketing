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
 *   HIGH    (round 5) `resolveLocalConst` matched its declaration regex against `code`
 *           (string CONTENTS intact) and never checked what KIND of binding the resolved
 *           name actually was at the call site — a same-named `let`/`var`, a function
 *           parameter, or a decoy `const NAME = "…";` written as the VALUE of an unrelated
 *           string literal could all silently win. See "resolveLocalConst fails closed on
 *           shadowed/decoy declarations".
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

/**
 * Escape a string for literal use inside a `RegExp(...)` constructor.
 *
 * Was `key.replace(/\./g, "\\.")`, which escaped dots and nothing else. CodeQL's
 * `js/incomplete-sanitization` flagged both call sites below as high severity on PR #91,
 * and the rule is right: a key containing a backslash would be mis-encoded. No fixture
 * key contains one today, so no assertion changes -- this closes the alert and stops the
 * helper being a partial escaper that a future fixture could walk into. Same expression
 * as `escapeRegExp` in `scripts/ci/check-events.mjs`, the checker these probes run.
 */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
    // 27 = the 24 keys before PR 292, plus work_item.created and work_item.updated, plus
    // work_item.assigned (assignment.md AS-16; PR #353). A non-vacuity guard: it proves
    // the checker actually saw the shipped keys, rather than passing on an empty scan.
    assert.match(result.output, /27 published event key/);
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

describe("check:events — resolveLocalConst fails closed on shadowed/decoy declarations (round 5, HIGH)", () => {
  // The flat regex search found exactly one `const NAME = "…";` and resolved to it with
  // confidence, but never checked what KIND of binding `NAME` actually was at the call
  // site — nor, separately, whether the "declaration" it found was really code at all.
  // Both gaps let a call site that reads an unrelated, genuinely undeclared string report
  // as though it read the const's value instead. Reproduced against the pre-fix checker:
  // all three RED cases below returned exit 0 with "1 published event key(s) ... every one
  // registered" — the const's value, standing in for whatever the shadowed binding really
  // held.

  it("a function PARAMETER shadowing a module-level const of the same name is refused, not resolved to the const's value", () => {
    const dir = bareRepo("param-shadow-red");
    write(
      dir,
      "apps/api/src/probe/param-shadow.ts",
      [
        'import { publishEvent } from "../../events";',
        "",
        'const eventType = "task.created";',
        "",
        "export function reemit(eventType) {",
        "  publishEvent(eventType, { id: 'x' });",
        "}",
        "",
        "export async function trigger() {",
        '  reemit("probe.review91_round5_param_shadow_undeclared");',
        "}",
        "",
      ].join("\n"),
    );

    const result = runChecker(dir, "check-events.mjs");
    assert.notEqual(result.status, 0, result.output);
    assert.match(result.output, /is bound some other way as well/);
    // NON-VACUITY: the pre-fix checker resolved this call confidently to the outer const's
    // "task.created" and printed success. Assert this run is not that.
    assert.doesNotMatch(result.output, /published event key.*registered/);
  });

  it("PAIRED: renaming the parameter removes the collision and the outer const resolves correctly", () => {
    const dir = bareRepo("param-shadow-green");
    write(
      dir,
      "apps/api/src/probe/param-shadow.ts",
      [
        'import { publishEvent } from "../../events";',
        "",
        'const eventType = "workspace.created";',
        "",
        "export function reemit(otherEventType) {",
        "  publishEvent(eventType, { id: 'x' });",
        "}",
        "",
      ].join("\n"),
    );

    const result = runChecker(dir, "check-events.mjs");
    assert.equal(result.status, 0, result.output);
  });

  it("a `let` shadowing a module-level const of the same name, immediately above its own publishEvent(...) call, is refused", () => {
    const dir = bareRepo("let-shadow-red");
    write(
      dir,
      "apps/api/src/probe/let-shadow.ts",
      [
        'import { publishEvent } from "../../events";',
        "",
        'const eventType = "task.created";',
        "",
        "export async function handler(cond) {",
        "  let eventType = cond",
        '    ? "probe.review91_round5_let_shadow_a"',
        '    : "probe.review91_round5_let_shadow_b";',
        "  await publishEvent(eventType, { id: 'x' });",
        "}",
        "",
      ].join("\n"),
    );

    const result = runChecker(dir, "check-events.mjs");
    assert.notEqual(result.status, 0, result.output);
    assert.match(result.output, /is bound some other way as well/);
    assert.doesNotMatch(result.output, /published event key.*registered/);
  });

  it("PAIRED: renaming the `let` removes the collision and the outer const resolves correctly", () => {
    const dir = bareRepo("let-shadow-green");
    write(
      dir,
      "apps/api/src/probe/let-shadow.ts",
      [
        'import { publishEvent } from "../../events";',
        "",
        'const eventType = "workspace.created";',
        "",
        "export async function handler(cond) {",
        '  let otherKind = cond ? "a" : "b";',
        "  await publishEvent(eventType, { id: 'x' });",
        "  return otherKind;",
        "}",
        "",
      ].join("\n"),
    );

    const result = runChecker(dir, "check-events.mjs");
    assert.equal(result.status, 0, result.output);
  });

  it('a decoy `const NAME = "…";` hidden inside an unrelated string literal\'s VALUE is not mistaken for a real declaration', () => {
    const dir = bareRepo("string-decoy-red");
    write(
      dir,
      "apps/api/src/probe/string-decoy.ts",
      [
        'import { publishEvent } from "../../events";',
        "",
        // The decoy: its TEXT contains `const eventType = 'task.created';`, but it is data
        // inside a string literal, not code — it must not be found as a declaration.
        "export const SNIPPET = \"const eventType = 'task.created';\";",
        "",
        "export async function handler() {",
        '  let eventType = "probe.review91_round5_decoy_undeclared";',
        "  await publishEvent(eventType, { id: 'x' });",
        "}",
        "",
      ].join("\n"),
    );

    const result = runChecker(dir, "check-events.mjs");
    assert.notEqual(result.status, 0, result.output);
    // No real `const eventType = …;` exists anywhere in this file, so once the decoy is
    // invisible to the declaration search there is nothing to resolve to at all — the
    // pre-existing "cannot determine which key" fail-closed path fires, not the
    // shadowing-specific message above.
    assert.match(result.output, /cannot determine which key/);
    // NON-VACUITY: the pre-fix checker found the decoy via a flat regex over `code`
    // (string contents intact), resolved confidently to "task.created", and printed
    // success. Assert this run is not that.
    assert.doesNotMatch(result.output, /published event key.*registered/);
  });
});

describe("check:events — assertNoOtherBinding's call-argument whitelist restores round 5's failure for one naming coincidence (round 6, MEDIUM)", () => {
  // legitimateCallArgument matches the SAME textual shape for a real call
  // (`publishEvent(eventType, …)`) and for a function DECLARATION whose own name happens
  // to collide with a tracked call name (`function publishEvent(eventType: string, …)`)
  // -- publishedKeysIn's own declaration-site skip already excludes the latter shape
  // (via the same `\bfunction\s*\*?\s*$` lookbehind) when deciding what is a CALL, but
  // assertNoOtherBinding did not apply the identical exclusion when deciding what
  // legitimately explains an occurrence of the resolved name -- so the declaration's own
  // parameter binding was whitelisted as if it were a real call's argument, silently
  // restoring the exact "answers with confidence instead of refusing" failure round 5
  // fixed, for this one naming coincidence.

  it("a wrapper function literally named publishEvent, whose own parameter shadows an outer const of the same name, is refused", () => {
    const dir = bareRepo("fn-name-collision-red");
    write(
      dir,
      "apps/api/src/probe/fn-name-collision.ts",
      [
        'import { publishEvent as emit } from "../../events";',
        "",
        'const eventType = "task.created";',
        "",
        "export async function publishEvent(eventType, payload) {",
        "  await emit(eventType, payload);",
        "}",
        "",
        "export async function trigger() {",
        '  await publishEvent("probe.review91_round6_fn_name_collision_undeclared", { id: "x" });',
        "}",
        "",
      ].join("\n"),
    );

    const result = runChecker(dir, "check-events.mjs");
    assert.notEqual(result.status, 0, result.output);
    assert.match(result.output, /is bound some other way as well/);
    // NON-VACUITY: before this fix, the declaration's own parameter was whitelisted as a
    // legitimate call argument, and this call resolved confidently to the outer const's
    // "task.created" -- printing success while publishing an undeclared key.
    assert.doesNotMatch(result.output, /published event key.*registered/);
  });

  it("CONTROL: renaming only the wrapper function (not its parameter) still correctly refuses -- the parameter itself is still shadowing, proving the fix closes the gap uniformly rather than for one specific function name", () => {
    const dir = bareRepo("fn-name-collision-renamed-still-red");
    write(
      dir,
      "apps/api/src/probe/fn-name-collision.ts",
      [
        'import { publishEvent as emit } from "../../events";',
        "",
        'const eventType = "task.created";',
        "",
        "export async function republish(eventType, payload) {",
        "  await emit(eventType, payload);",
        "}",
        "",
      ].join("\n"),
    );

    const result = runChecker(dir, "check-events.mjs");
    assert.notEqual(result.status, 0, result.output);
    assert.match(result.output, /is bound some other way as well/);
  });

  it("PAIRED GREEN: the outer const resolves cleanly when the file has no other function sharing its name with a tracked call", () => {
    const dir = bareRepo("fn-name-collision-green");
    write(
      dir,
      "apps/api/src/probe/fn-name-collision.ts",
      [
        'import { publishEvent as emit } from "../../events";',
        "",
        'const eventType = "workspace.created";',
        "",
        "export async function trigger() {",
        '  await emit(eventType, { id: "x" });',
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
      assert.match(result.output, new RegExp(escapeRegExp(shape.key)));
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

describe("check:events — the fail-closed RESIDUAL SCAN itself refuses, rather than silently reporting 0 keys (review round 2, MEDIUM 2)", () => {
  // Security review round 2, MEDIUM 2: the residual scan at the bottom of
  // `publishedKeysIn` — the control that is supposed to catch every call shape this
  // extractor does not specifically recognise, rather than reporting the file as though
  // the usage does not exist — had NO test of its own. Deleting it outright left
  // `pnpm test:ci-scripts` at 354/354 green, and seven measured shapes (this describe
  // block exercises two of them) silently returned to "0 published event key(s)". These
  // two cases are two of the ten the review measured the scan as genuinely refusing on,
  // chosen because each is a couple of lines and neither is a call shape the review's
  // HIGH 4 cases (H/I/J/K/L, above) already cover — so deleting the residual scan cannot
  // hide behind those probes passing.
  //
  // Review round 3, LOW 2: both cases above spell `publishEvent` directly, so neither
  // exercises the scan's ALIAS arm — `for (const name of names)` iterating only the
  // tracked aliases, not just the canonical name. Narrowing that loop to
  // `for (const name of ["publishEvent"])` passed both cases above (0 probe failures)
  // and let `const emit = publishEvent; emit?.("k")` return to a silent
  // "0 published event key(s)". The third case below uses an ALIASED name so that
  // narrowing is caught.
  const residualShapes = [
    {
      label: 'optional chaining (`publishEvent?.("…")`)',
      slug: "optional-chaining",
      key: "probe.review91_residual_optional_chaining",
      body: [
        'import { publishEvent } from "../../events";',
        "export async function handler() {",
        '  await publishEvent?.("probe.review91_residual_optional_chaining", { id: "x" });',
        "}",
        "",
      ].join("\n"),
    },
    {
      label:
        "a generic argument nested two levels deep (`publishEvent<A<A<string>>>(...)`)",
      slug: "nested-generic",
      key: "probe.review91_residual_nested_generic",
      body: [
        'import { publishEvent } from "../../events";',
        "export async function handler() {",
        '  await publishEvent<A<A<string>>>("probe.review91_residual_nested_generic", { id: "x" });',
        "}",
        "",
      ].join("\n"),
    },
    {
      label:
        'an ALIASED name via optional chaining (`const emit = publishEvent; emit?.("…")`)',
      slug: "aliased-optional-chaining",
      key: "probe.review91_residual_aliased_optional_chaining",
      body: [
        'import { publishEvent } from "../../events";',
        "export async function handler() {",
        "  const emit = publishEvent;",
        '  await emit?.("probe.review91_residual_aliased_optional_chaining", { id: "x" });',
        "}",
        "",
      ].join("\n"),
    },
  ];

  for (const shape of residualShapes) {
    it(`${shape.label}: refuses to run rather than reporting "0 published event key(s)"`, () => {
      const dir = bareRepo(`residual-${shape.slug}`);
      write(dir, "apps/api/src/probe/case.ts", shape.body);

      const result = runChecker(dir, "check-events.mjs");
      assert.notEqual(result.status, 0, result.output);
      assert.match(
        result.output,
        /is used in a shape this extractor does not recognise/,
      );
      // NON-VACUITY, the exact tell the review used: if the residual scan is deleted or
      // neutered, this run reports the file as though the call does not exist instead of
      // refusing — the "0 published event key(s)" silent-green this whole file exists to
      // prevent. Assert this run is not that, and never mentions the key it could not see.
      assert.doesNotMatch(result.output, /0 published event key/);
      assert.doesNotMatch(result.output, new RegExp(escapeRegExp(shape.key)));
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
