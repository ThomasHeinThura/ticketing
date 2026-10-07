import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { shouldCopyCheckerSource } from "./scratch-repo.mjs";

test("scratch checker copies retain real checkers and exclude transient fixtures", () => {
  assert.equal(
    shouldCopyCheckerSource(path.join("scripts", "ci", "check-env.mjs")),
    true,
  );
  assert.equal(
    shouldCopyCheckerSource(
      path.join("scripts", "ci", ".contrast-button-123.test.tsx"),
    ),
    false,
  );
  assert.equal(
    shouldCopyCheckerSource(
      path.join("scripts", "ci", "probes", "check-env.test.mjs"),
    ),
    false,
  );
  assert.equal(
    shouldCopyCheckerSource(path.join("scripts", "ci", "check-env.test.mjs")),
    false,
  );
});
