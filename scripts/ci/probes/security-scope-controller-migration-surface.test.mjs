/**
 * Issue #115 red probe — the security-review list must cover the controllers that perform
 * privileged writes and the migrations that change the schema underneath them.
 *
 * Measured, not guessed: an independent investigation ran the repository's own
 * `parseSecurityReviewPaths` + `globToRegExp` (`lib/security-paths.mjs`) over all 925 files
 * under `apps/api/src`, `apps/api/drizzle`, `packages/*\/src` and `apps/web/src`. Before this
 * fix the list held 23 globs matching 110 of them; the sharpest miss:
 *
 *   `readSecurityReviewPaths().matches("apps/api/drizzle/0050_enforce_single_role_membership.sql")`
 *   returned **false**. That migration is PR #110's CHECK constraint enforcing the
 *   single-role membership invariant — a security backstop that would have landed with NO
 *   Opus review required. `apps/api/src/policy-registry.ts` (the route-policy assembly
 *   root — Throttle 1 conditions 4 and 5) and `apps/api/src/database/schema.ts` (the
 *   RBAC/membership tables) were equally out, and so was every controller: nothing under
 *   `apps/api/src/**\/controllers/**` matched, including
 *   `workspace/controllers/update-workspace-member-role.ts` (the two hard-coded rules that
 *   keep an owner-role change safe) and `invitation/controllers/accept-invitation.ts` (the
 *   entire #88 duplicate-member race fix).
 *
 * The fix adds six globs to `docs/04-engineering/ci-cd.md`'s first block:
 * `apps/api/src/**\/controllers/**`, `apps/api/drizzle/*.sql`, `apps/api/src/openapi.ts`,
 * `apps/api/src/policy-registry.ts`, `apps/api/src/database/**`, `packages/mcp/src/auth/**`.
 * That widens the list to 29 globs matching 262 of the same 925 files — 152 newly in scope,
 * all of them accounted for by these six globs (92 controllers + 50 migrations + 5 database
 * files + 3 mcp/auth files + 2 named files: `openapi.ts`, `policy-registry.ts`).
 *
 * Every "in scope now" assertion below reads the WORKING-TREE `docs/04-engineering/ci-cd.md`
 * via `readSecurityReviewPaths()` (`lib/security-paths.mjs`'s `ciCdPath`), so this probe is
 * not vacuous by construction: reverting the six-glob addition in that document makes every
 * one of them fail. That was confirmed by hand while this probe was written — the six lines
 * were removed from the working copy, `node --test` was run against this file, all of
 * section 1 turned red, and the lines were restored. `OLD_GLOBS` below is a frozen snapshot
 * of the pre-#115 list, used only as the non-vacuity CONTROL for section 1 (it must fail to
 * match what section 1 requires to succeed) and is never read from disk.
 *
 * `lib/security-paths.test.mjs` is not the control here, for the same reason
 * `security-scope-enforcement-layer.test.mjs` gives: it asserts what ci-cd.md declares
 * today, and a diff that narrows the list narrows those assertions in the same breath.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  globToRegExp,
  readSecurityReviewPaths,
} from "../lib/security-paths.mjs";

/** The security-review glob list exactly as it stood before issue #115's fix — 23 globs. */
const OLD_GLOBS = [
  "apps/api/src/**/policy.ts",
  "apps/api/src/middleware/**",
  "apps/api/src/plugins/**",
  "apps/api/src/auth*",
  "apps/api/src/webhooks/**",
  "apps/api/src/utils/**",
  "apps/api/src/**/index.ts",
  "packages/permissions/**",
  "packages/plugins-contracts/**",
  "apps/api/src/scim/**",
  "apps/api/src/storage/**",
  "apps/api/src/index.ts",
  "apps/api/src/capabilities/**",
  ".github/**",
  "package.json",
  "scripts/ci/**",
  "**/package.json",
  "turbo.json",
  "pnpm-lock.yaml",
  "docs/04-engineering/ci-cd.md",
  "pnpm-workspace.yaml",
  ".npmrc",
  ".pnpmfile.cjs",
];

function matchedByOldGlobs(file) {
  return OLD_GLOBS.some((glob) => globToRegExp(glob).test(file));
}

// ---------------------------------------------------------------------------
// 1. Privileged-write controllers and migrations are in scope.
// ---------------------------------------------------------------------------

describe("the security-review list covers privileged controllers and migrations", () => {
  // One representative from each named class in issue #115's measured proof.
  const PRIVILEGED_SURFACE = [
    // the assembly root and the schema underneath it
    "apps/api/src/policy-registry.ts",
    "apps/api/src/openapi.ts",
    "apps/api/src/database/schema.ts",
    "apps/api/src/database/relations.ts",
    "apps/api/src/database/resolve-database-url.ts",
    "apps/api/src/database/prepare-database-startup.ts",
    // membership / ownership mutation
    "apps/api/src/workspace/controllers/update-workspace-member-role.ts",
    "apps/api/src/workspace/controllers/transfer-workspace-ownership.ts",
    "apps/api/src/workspace/controllers/add-workspace-member.ts",
    "apps/api/src/workspace/controllers/remove-workspace-member.ts",
    "apps/api/src/workspace/controllers/delete-workspace.ts",
    // #88's fix, filed under invitation/controllers
    "apps/api/src/invitation/controllers/accept-invitation.ts",
    // authorization middleware filed under controllers, not utils
    "apps/api/src/task/controllers/require-task-permission.ts",
    // destructive account deletion and a stored OAuth credential
    "apps/api/src/user/controllers/delete-account-data.ts",
    "apps/api/src/oauth/controllers/get-id-token.ts",
    // #6's removal surface, on the SQL side
    "apps/api/drizzle/0045_drop_project_is_public.sql",
    "apps/api/drizzle/0046_drop_inherited_integrations.sql",
    "apps/api/drizzle/0047_drop_billing.sql",
    "apps/api/drizzle/0048_drop_mcp_oauth_state.sql",
    "apps/api/drizzle/0049_drop_device_code.sql",
    "apps/api/drizzle/0026_encrypt_notification_preference_secrets.sql",
    // PR #110's CHECK constraint — the sharpest instance
    "apps/api/drizzle/0050_enforce_single_role_membership.sql",
    // the MCP CLI's credential store
    "packages/mcp/src/auth/token-store.ts",
    "packages/mcp/src/auth/auth-service.ts",
  ];

  it("every file is in scope NOW (reads the working-tree ci-cd.md)", async () => {
    const { matches, globs } = await readSecurityReviewPaths();
    const missed = PRIVILEGED_SURFACE.filter((file) => !matches(file));
    assert.deepEqual(
      missed,
      [],
      `${missed.length} privileged-write path(s) are not matched by ci-cd.md's list ` +
        `(currently ${globs.length} globs). Restore the six issue-#115 globs to ` +
        `docs/04-engineering/ci-cd.md:\n  ${missed.join("\n  ")}`,
    );
  });

  it("and was NOT in scope before — the non-vacuity control", () => {
    // If this starts failing, the pre-#115 snapshot above already covered these paths and
    // the assertion above proves nothing. Delete this probe rather than leave it as
    // decoration — see security-scope-enforcement-layer.test.mjs for the same discipline.
    const alreadyCovered = PRIVILEGED_SURFACE.filter((file) =>
      matchedByOldGlobs(file),
    );
    assert.deepEqual(
      alreadyCovered,
      [],
      `${alreadyCovered.length} path(s) were expected to be OUTSIDE the pre-#115 list; ` +
        `the reproduction has changed:\n  ${alreadyCovered.join("\n  ")}`,
    );
  });

  it("PR #110's fix target specifically — the reason this is not theoretical", async () => {
    const { matches } = await readSecurityReviewPaths();
    const target = "apps/api/drizzle/0050_enforce_single_role_membership.sql";
    assert.ok(
      matches(target),
      "0050 is the single-role membership CHECK constraint; its own fix, and any future " +
        "edit to it, must require an independent security review",
    );
    assert.equal(
      matchedByOldGlobs(target),
      false,
      "the pre-#115 list already covered this file; the reproduction has changed",
    );
  });
});

// ---------------------------------------------------------------------------
// 2. The deliberate exclusions stay excluded — this fix must not be "improved" into the
//    two broader globs the investigation measured and rejected.
// ---------------------------------------------------------------------------

describe("the deliberately rejected broader globs are NOT in scope", () => {
  it("drizzle-kit's generated snapshots stay out (apps/api/drizzle/** was rejected)", async () => {
    const { matches } = await readSecurityReviewPaths();
    for (const file of [
      "apps/api/drizzle/meta/0000_snapshot.json",
      "apps/api/drizzle/meta/0044_snapshot.json",
      "apps/api/drizzle/_journal.json",
    ]) {
      assert.equal(
        matches(file),
        false,
        `${file} is drizzle-kit's mechanical mirror of a migration, not independent ` +
          "review signal — apps/api/drizzle/*.sql was chosen deliberately over the bare " +
          "apps/api/drizzle/** to keep this file out. If this now matches, the glob was " +
          "widened past what issue #115 measured.",
      );
    }
  });

  it("a routine field-shape file stays out (the feature-root catch-all was rejected)", async () => {
    const { matches } = await readSecurityReviewPaths();
    for (const file of [
      "apps/api/src/label/schema.ts",
      "apps/api/src/label/response.ts",
      "apps/api/src/project/schema.ts",
    ]) {
      assert.equal(
        matches(file),
        false,
        `${file} is a field-shape file with no controller logic — a blanket ` +
          "apps/api/src/*/*.ts catch-all was measured at 57 newly-captured files for ~5 " +
          "sensitive ones and rejected. If this now matches, that catch-all crept back in.",
      );
    }
  });

  it("the notification-preferences trio stays a named-file call, not a glob capture", async () => {
    // Left out deliberately as LOW; if a future change wants these in scope it should name
    // them directly rather than reintroduce a directory glob that also isn't here.
    const { matches } = await readSecurityReviewPaths();
    for (const file of [
      "apps/api/src/notification-preferences/secrets.ts",
      "apps/api/src/notification-preferences/service.ts",
      "apps/api/src/notification-preferences/delivery.ts",
    ]) {
      assert.equal(
        matches(file),
        false,
        `${file} was rated LOW by the issue-#115 investigation and left as a ` +
          "named-file recommendation rather than added. This assertion only pins today's " +
          "choice — naming these three directly is a legitimate, separate change.",
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 3. The count moved the way the investigation measured, not further and not less.
// ---------------------------------------------------------------------------

describe("the list grew by exactly the six issue-#115 globs", () => {
  it("29 globs now, all 23 pre-#115 globs still present", async () => {
    const { globs } = await readSecurityReviewPaths();
    assert.equal(
      globs.length,
      29,
      `expected 23 pre-#115 globs + 6 issue-#115 globs = 29; found ${globs.length}. ` +
        "Either a glob was dropped or an extra one was added beyond what was measured.",
    );
    for (const glob of OLD_GLOBS) {
      assert.ok(
        globs.includes(glob),
        `${glob} was dropped from ci-cd.md — F15/#115 only expand this list`,
      );
    }
    for (const glob of [
      "apps/api/src/**/controllers/**",
      "apps/api/drizzle/*.sql",
      "apps/api/src/openapi.ts",
      "apps/api/src/policy-registry.ts",
      "apps/api/src/database/**",
      "packages/mcp/src/auth/**",
    ]) {
      assert.ok(
        globs.includes(glob),
        `${glob} is one of issue #115's six globs and is missing from ci-cd.md`,
      );
    }
  });
});
