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
