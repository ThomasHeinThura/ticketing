/**
 * F15 — the mandatory security review must cover the machinery that decides whether
 * anything gets reviewed, and the dependency graph that decides what code exists.
 *
 * Thomas's decision, 2026-09-08 (docs/07-planning/decision-log.md). Before it, the gate
 * could not see changes to itself: PR #19 — the pull request that BUILDS this gate —
 * touched `.github/**`, `scripts/ci/**`, `package.json`, `pnpm-workspace.yaml` and
 * `pnpm-lock.yaml`, and the checker correctly reported "no security-review path touched
 * (9 globs from ci-cd.md checked)". Its independent review then found two HIGHs and a
 * fail-open inside that blind spot.
 *
 * ci-cd.md stays the single authoritative list, so these tests read it rather than
 * restating it — the same rule the parser follows. They fail if the decision is silently
 * reverted by editing the document.
 *
 * **This file is NOT the control for GPT-F1.** It asserts what ci-cd.md declares today,
 * and it is as editable in a pull request as ci-cd.md is — a diff that shrinks the list
 * can shrink these assertions in the same breath. The control for "a diff cannot narrow
 * its way out of the review requirement" is `probes/security-scope-shrink.test.mjs`,
 * which runs the real checker against constructed history that a document edit cannot
 * reach.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  globToRegExp,
  parseSecurityReviewPaths,
  readSecurityReviewPaths,
} from "./security-paths.mjs";

/** Representative paths for each surface the decision names. */
const MUST_REQUIRE_REVIEW = [
  // the gate machinery itself
  ".github/workflows/ci-fast.yml",
  ".github/workflows/ci-full.yml",
  ".github/actions/setup/action.yml",
  ".github/CODEOWNERS",
  ".github/pull_request_template.md",
  "scripts/ci/check-pr-template.mjs",
  "scripts/ci/check-env.mjs",
  "scripts/ci/lib/diff.mjs",
  "scripts/ci/lib/security-paths.mjs",
  "scripts/ci/env-baseline.json",
  "turbo.json",
  // the authoritative document that defines the list
  "docs/04-engineering/ci-cd.md",
  // dependency control
  "package.json",
  "apps/api/package.json",
  "packages/permissions/package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".npmrc",
  ".pnpmfile.cjs",
  // and every application surface that was already covered
  "apps/api/src/auth.ts",
  "apps/api/src/middleware/require-session.ts",
  "apps/api/src/storage/s3.ts",
  "apps/api/src/scim/users.ts",
  "apps/api/src/webhooks/outbound.ts",
  "packages/permissions/src/evaluator.ts",
];

/** Paths that must NOT drag in the requirement, or it becomes routine and ignored. */
const MUST_NOT_REQUIRE_REVIEW = [
  "README.md",
  "CHANGELOG.md",
  "docs/07-planning/status.md",
  "docs/02-design/screen-inventory.md",
  "apps/web/src/routes/index.tsx",
  "apps/web/src/components/button.tsx",
  "tests/api-integration/organization-plugin-characterization.test.ts",
  "charts/taskdesk/values.yaml",
  "compose.yml",
];

describe("security-review paths — F15 scope", () => {
  it("requires review for every CI, gate-machinery and dependency-control surface", async () => {
    const { matches, globs } = await readSecurityReviewPaths();
    const missed = MUST_REQUIRE_REVIEW.filter((file) => !matches(file));
    assert.deepEqual(
      missed,
      [],
      `${missed.length} path(s) that MUST require an independent security review are not ` +
        "matched by ci-cd.md's list. The gate would not see a change to itself, which is " +
        "the F15 blind spot Thomas's 2026-09-08 decision closed. Restore the globs in " +
        `docs/04-engineering/ci-cd.md (currently ${globs.length}):\n  ${missed.join("\n  ")}`,
    );
  });

  it("does not require review for documentation, UI or test-only paths", async () => {
    const { matches } = await readSecurityReviewPaths();
    const over = MUST_NOT_REQUIRE_REVIEW.filter((file) => matches(file));
    assert.deepEqual(
      over,
      [],
      "the list has widened to paths with no security surface. A requirement that fires " +
        "on everything is one people learn to route around:\n  " +
        over.join("\n  "),
    );
  });

  it("keeps every application glob the list carried before F15", async () => {
    const { globs } = await readSecurityReviewPaths();
    for (const glob of [
      "apps/api/src/**/policy.ts",
      "apps/api/src/middleware/**",
      "apps/api/src/plugins/**",
      "apps/api/src/auth*",
      "apps/api/src/webhooks/**",
      "apps/api/src/scim/**",
      "apps/api/src/storage/**",
      "packages/permissions/**",
      "packages/plugins-contracts/**",
    ]) {
      assert.ok(
        globs.includes(glob),
        `${glob} was dropped from ci-cd.md. F15 EXPANDED the list; it removed nothing.`,
      );
    }
  });

  it("matches nested package.json files, not only the root one", async () => {
    const { matches } = await readSecurityReviewPaths();
    assert.equal(matches("package.json"), true);
    assert.equal(matches("apps/api/package.json"), true);
    assert.equal(matches("packages/email/package.json"), true);
  });

  it("refuses a document whose list block is gone, instead of reviewing nothing", () => {
    // The fail-closed floor under the union scope: if the block cannot be found at all,
    // the parser throws and check:pr-template reports it rather than proceeding with an
    // empty list, which would read as "nothing sensitive was touched".
    assert.throws(
      () => parseSecurityReviewPaths("# CI/CD\n\nNo list here.\n", "a probe"),
      /Could not find the security-review path list in a probe/,
    );
  });

  it("refuses a list shrunk below the point where it could be the whole list", () => {
    const source = [
      "# CI/CD",
      "",
      "```",
      "packages/permissions/**",
      "apps/api/src/auth*",
      "```",
      "",
    ].join("\n");
    assert.throws(
      () => parseSecurityReviewPaths(source, "a probe"),
      /Parsed only 2 security-review path\(s\) from a probe/,
    );
  });

  it("globToRegExp anchors, so a glob cannot match a longer path by accident", () => {
    assert.equal(globToRegExp("turbo.json").test("turbo.json"), true);
    assert.equal(globToRegExp("turbo.json").test("apps/turbo.json"), false);
    assert.equal(globToRegExp("turbo.json").test("turbo.json.bak"), false);
    assert.equal(
      globToRegExp("scripts/ci/**").test("scripts/ci/a/b.mjs"),
      true,
    );
    assert.equal(
      globToRegExp("scripts/ci/**").test("scripts/other.mjs"),
      false,
    );
  });
});
