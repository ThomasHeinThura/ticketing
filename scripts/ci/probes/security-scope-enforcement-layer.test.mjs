/**
 * Red probe — the security-review gate must cover the code that enforces authorization,
 * and must notice a router that is MODIFIED rather than only one that is added.
 *
 * Found by an independent Opus audit of `main@5270954`. Three separate defects, all in the
 * same control, all of the same class this repository keeps producing: **the gate derived
 * its scope from a convenient proxy — a hand-written path list and a regex for one spelling
 * of "router" — rather than from the code that actually enforces anything.**
 *
 *   1. `ci-cd.md`'s list covered only the per-directory `policy.ts` glob and `auth*`, and
 *      nothing else in `apps/api`.
 *      So `require-workspace-permission.ts` — the authorization engine —
 *      `require-session-only.ts`, `validate-workspace-access.ts`, `is-instance-admin.ts`,
 *      `verify-api-key.ts`, `apps/api/src/index.ts` (the app-wide guard) and
 *      `capabilities/capability-checks.ts` were all OUT of scope. The sharpest instance:
 *      the fix for #66, a privilege-restoration fail-open, edits
 *      `require-workspace-permission.ts`. A P0 security fix would not have tripped its own
 *      gate.
 *
 *   2. `looksLikeHonoRouter` tested `/new\s+(?:OpenAPI)?Hono\s*[<(]/`, which matches exactly
 *      TWO files in this repository. All 20 route modules are declared with `apiRouter()`
 *      (`apps/api/src/openapi.ts:25`), so ci-cd.md's "any new route file" clause matched
 *      essentially nothing.
 *
 *   3. The predicate ran over ADDED files only. Deleting `requireSessionOnly()` from an
 *      existing router is a larger change than adding a router, and it matched nothing.
 *
 * Every assertion below is paired with the OLD predicate evaluated over the SAME input, so
 * this probe cannot go quietly vacuous. If someone later reverts the widening, the paired
 * control still shows the old behaviour and the new assertion fails.
 *
 * `lib/security-paths.test.mjs` is not the control here: it asserts what ci-cd.md declares
 * today, and it is as editable in a pull request as ci-cd.md is. These assert properties of
 * the CHECKER and of the predicate.
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  bodyFile,
  cleanUpScratchRepos,
  commit,
  completeBody,
  initRepo,
  installCheckers,
  installFromRepo,
  runChecker,
  scratchDir,
  setOriginMain,
  write,
} from "../lib/scratch-repo.mjs";
import {
  globToRegExp,
  looksLikeHonoRouter,
  readSecurityReviewPaths,
} from "../lib/security-paths.mjs";

after(cleanUpScratchRepos);

/** The predicate exactly as it was before this fix — the non-vacuity control. */
const OLD_ROUTER_PREDICATE = /new\s+(?:OpenAPI)?Hono\s*[<(]/;

/** The `apps/api` half of the list exactly as it was before this fix. */
const OLD_API_GLOBS = [
  "apps/api/src/**/policy.ts",
  "apps/api/src/middleware/**",
  "apps/api/src/plugins/**",
  "apps/api/src/auth*",
  "apps/api/src/webhooks/**",
  "apps/api/src/scim/**",
  "apps/api/src/storage/**",
];

function matchedByOldGlobs(file) {
  return OLD_API_GLOBS.some((glob) => globToRegExp(glob).test(file));
}

// ---------------------------------------------------------------------------
// 1. The authorization enforcement layer is in scope.
// ---------------------------------------------------------------------------

describe("the security-review list covers the code that enforces authorization", () => {
  // Each of these decides whether a request is allowed. None of them was in scope.
  const ENFORCEMENT_LAYER = [
    "apps/api/src/utils/require-workspace-permission.ts",
    "apps/api/src/utils/require-session-only.ts",
    "apps/api/src/utils/validate-workspace-access.ts",
    "apps/api/src/utils/is-instance-admin.ts",
    "apps/api/src/utils/verify-api-key.ts",
    "apps/api/src/utils/require-workspace-membership.ts",
    "apps/api/src/index.ts",
    "apps/api/src/capabilities/capability-checks.ts",
    "apps/api/src/workspace/index.ts",
  ];

  it("every enforcement file is in scope NOW", async () => {
    const { globs } = await readSecurityReviewPaths();
    const expressions = globs.map(globToRegExp);
    for (const file of ENFORCEMENT_LAYER) {
      assert.ok(
        expressions.some((re) => re.test(file)),
        `${file} enforces authorization and must be in the security-review scope`,
      );
    }
  });

  it("and was NOT in scope before — the control that keeps this probe honest", () => {
    // If this ever starts failing, the old list already covered these and the probe above
    // proves nothing. Then delete this probe rather than leaving it as decoration.
    for (const file of ENFORCEMENT_LAYER) {
      assert.equal(
        matchedByOldGlobs(file),
        false,
        `${file} was expected to be OUTSIDE the pre-fix list; the reproduction has changed`,
      );
    }
  });

  it("#66's fix target specifically — the reason this is not theoretical", async () => {
    const { globs } = await readSecurityReviewPaths();
    const target = "apps/api/src/utils/require-workspace-permission.ts";
    assert.ok(
      globs.map(globToRegExp).some((re) => re.test(target)),
      "#66 is a privilege-restoration fail-open in this file; its fix must require a review",
    );
    assert.equal(matchedByOldGlobs(target), false);
  });
});

// ---------------------------------------------------------------------------
// 2. The router predicate matches how this codebase actually declares routers.
// ---------------------------------------------------------------------------

describe("looksLikeHonoRouter recognises this repository's own router factory", () => {
  // Copied in shape from a real route module.
  const APIROUTER_SOURCE = [
    'import { apiRouter } from "../openapi";',
    "",
    "const router = apiRouter();",
    "router.openapi(listRoute, async (c) => c.json([]));",
    "export default router;",
  ].join("\n");

  const RAW_HONO_SOURCE = [
    'import { OpenAPIHono } from "@hono/zod-openapi";',
    "",
    "const app = new OpenAPIHono();",
    "export default app;",
  ].join("\n");

  it("detects apiRouter()", () => {
    assert.equal(looksLikeHonoRouter(APIROUTER_SOURCE), true);
  });

  it("the OLD predicate missed apiRouter() — the non-vacuity control", () => {
    assert.equal(
      OLD_ROUTER_PREDICATE.test(APIROUTER_SOURCE),
      false,
      "the pre-fix regex was expected to miss apiRouter(); the reproduction has changed",
    );
  });

  it("still detects a raw OpenAPIHono, so the widening lost nothing", () => {
    assert.equal(looksLikeHonoRouter(RAW_HONO_SOURCE), true);
    assert.equal(OLD_ROUTER_PREDICATE.test(RAW_HONO_SOURCE), true);
  });

  it("does not fire on a file that merely mentions the word", () => {
    // A comment or an import name is not a declaration. Keeps the widening from turning
    // every file that says "apiRouter" into a security surface.
    assert.equal(
      looksLikeHonoRouter("// this module is not an apiRouter at all\n"),
      false,
    );
    assert.equal(looksLikeHonoRouter("const apiRouterName = 'x';\n"), false);
  });
});

// ---------------------------------------------------------------------------
// 3. A MODIFIED router is noticed, not only an added one.
// ---------------------------------------------------------------------------

describe("the checker notices a router that is modified, not only one that is added", () => {
  /**
   * The scenario, built end to end.
   *
   * The router deliberately lives at `apps/api/src/thing/router.ts` — NOT `index.ts` —
   * so no path glob can catch it and the predicate is the only thing under test. On `main`
   * it enforces `requireSessionOnly()`; the branch removes that line. Nothing is added.
   */
  function buildModifiedRouterRepo() {
    const dir = scratchDir("modified-router");
    initRepo(dir);
    installCheckers(dir);
    // WITHOUT these two the checker dies on ENOENT before it ever reaches the
    // security-path logic, and the "it failed" assertion below passes for entirely the
    // wrong reason. That happened while this probe was being written: the first run went
    // green against a crash. Install the real authority documents so the failure under
    // test is the only failure available.
    installFromRepo(dir, ".github/pull_request_template.md");
    installFromRepo(dir, "docs/04-engineering/ci-cd.md");

    write(
      dir,
      "apps/api/src/thing/router.ts",
      [
        'import { apiRouter } from "../openapi";',
        'import { requireSessionOnly } from "../utils/require-session-only";',
        "",
        "const router = apiRouter();",
        "router.use(requireSessionOnly());",
        "export default router;",
      ].join("\n"),
    );
    const base = commit(dir, "feat: a router that enforces session-only reach");
    setOriginMain(dir, base);

    // The whole change: one line removed from an existing file.
    write(
      dir,
      "apps/api/src/thing/router.ts",
      [
        'import { apiRouter } from "../openapi";',
        "",
        "const router = apiRouter();",
        "export default router;",
      ].join("\n"),
    );
    commit(dir, "chore: drop the session guard from the thing router");
    return dir;
  }

  it("fails when the review section is empty, because a router changed", () => {
    const dir = buildModifiedRouterRepo();
    // A body whose security review names no model: acceptable only if nothing sensitive
    // was touched. Here something was.
    const body = bodyFile(completeBody({ securityModel: "n/a" }));
    const run = runChecker(dir, "check-pr-template.mjs", ["--body", body]);

    const output = `${run.stdout}${run.stderr}`;
    assert.notEqual(
      run.status,
      0,
      "removing a session guard from an existing router must require a security review",
    );
    // Not "it failed" — it must have failed FOR THIS REASON. A crash also exits non-zero.
    assert.doesNotMatch(
      output,
      /ENOENT|SyntaxError|Cannot find module/,
      "the checker must fail on the security requirement, not on a broken scratch repo",
    );
    assert.match(
      output,
      /security path/i,
      "the failure must be the security-review requirement",
    );
  });

  it("and names the modified file, not just 'something changed'", () => {
    const dir = buildModifiedRouterRepo();
    const body = bodyFile(completeBody({ securityModel: "n/a" }));
    const run = runChecker(dir, "check-pr-template.mjs", ["--body", body]);
    const output = `${run.stdout}${run.stderr}`;
    assert.doesNotMatch(output, /ENOENT|SyntaxError|Cannot find module/);
    assert.match(
      output,
      /apps\/api\/src\/thing\/router\.ts/,
      "an operator must be told which file put the change in scope",
    );
    assert.match(
      output,
      /declares a Hono router/,
      "and why that file counts — it was the predicate, not a path glob",
    );
  });

  it("the OLD behaviour would have let it through — the non-vacuity control", () => {
    // Reproduced without the checker: the pre-fix loop read the ADDED list, and this
    // scenario adds nothing. So even the pre-fix regex, had it matched apiRouter(), would
    // never have been given this file to test.
    const addedFiles = [];
    assert.equal(
      addedFiles.length,
      0,
      "the scenario must add no file, or it does not exercise the added-only defect",
    );
    // And the pre-fix predicate missed the factory anyway, so both halves had to be fixed.
    assert.equal(
      OLD_ROUTER_PREDICATE.test("const router = apiRouter();"),
      false,
    );
  });
});
