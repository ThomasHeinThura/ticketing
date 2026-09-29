/**
 * The security review model field accepts only the canonical GPT-6 Sol label.
 *
 * The positive case carries the same committed, current-head-bound note required of a
 * real security-scope pull request. Negative cases change only the model field, so each
 * failure is attributable to the exact-name policy.
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

after(cleanUpScratchRepos);

const NOTE_PATH = "docs/07-planning/security-reviews/19-policy-probe.md";
const CI_CD = [
  "# CI/CD",
  "",
  "```",
  "│ pnpm install --frozen-lockfile                   │",
  "```",
  "",
  "```",
  "│ pnpm test:integration                            │",
  "```",
  "",
  "CI requires the exact model GPT-6 Sol whenever the diff touches **any** of:",
  "",
  "```",
  "apps/api/src/**/policy.ts            packages/permissions/**",
  "apps/api/src/plugins/**              apps/api/src/storage/**",
  "apps/api/src/auth*                   apps/api/src/index.ts",
  "apps/api/src/utils/**                apps/api/src/capabilities/**",
  "apps/api/src/**/index.ts             any new route file (a new *.ts exporting a Hono router)",
  "apps/api/src/**/controllers/**       apps/api/drizzle/*.sql",
  "apps/api/src/policy-registry.ts      apps/api/src/database/**",
  "packages/mcp/src/auth/**             scripts/deploy.sh",
  "packages/domain/src/identity/**      apps/api/src/permissions/**",
  "apps/api/src/middleware/**           (path does not exist yet)",
  "apps/api/src/webhooks/**             (path does not exist yet, P4)",
  "apps/api/src/scim/**                 (path does not exist yet, P3)",
  "packages/plugins-contracts/**        (path does not exist yet)",
  ".github/**                           package.json",
  "scripts/ci/**                        **/package.json",
  "turbo.json                           pnpm-lock.yaml",
  "docs/04-engineering/ci-cd.md         pnpm-workspace.yaml",
  ".npmrc                               .pnpmfile.cjs",
  "trivy.yaml                           .trivyignore",
  ".trivyignore.yaml",
  "scripts/lib/**                       tests/api-integration/global-setup.ts",
  "**/vitest.config.*                   apps/web/playwright.config.ts",
  "**/vitest*.config.*",
  "apps/web/e2e/**                      scripts/ci/redocly.yaml",
  "scripts/ci/openapi-approved-breaks.json",
  "```",
  "",
].join("\n");

function reviewedScenario() {
  const dir = scratchDir("security-model-exact");
  initRepo(dir);
  installCheckers(dir);
  installFromRepo(dir, ".github/pull_request_template.md");
  write(dir, "docs/04-engineering/ci-cd.md", CI_CD);
  write(dir, "apps/api/src/auth.ts", "export const authSurface = 1;\n");
  const base = commit(dir, "chore: bootstrap security model probe");
  setOriginMain(dir, base);

  write(dir, "apps/api/src/auth.ts", "export const authSurface = 2;\n");
  const reviewedHead = commit(dir, "feat: change the security surface");

  write(
    dir,
    NOTE_PATH,
    [
      "# Security review — PR #19 (probe)",
      "",
      `**Reviewed head:** \`${reviewedHead}\``,
      "",
      "**Verdict:** CLEAR.",
      "",
    ].join("\n"),
  );
  commit(dir, "docs: record the bound security review");
  return dir;
}

function runForModel(dir, securityModel) {
  const body = bodyFile(
    completeBody({ securityModel, securityNote: NOTE_PATH }),
  );
  return runChecker(dir, "check-pr-template.mjs", ["--body", body]);
}

describe("security review model is the exact canonical GPT-6 Sol label", () => {
  it("accepts GPT-6 Sol when all other security-review evidence is valid", () => {
    const dir = reviewedScenario();
    const result = runForModel(dir, "GPT-6 Sol");

    assert.equal(
      result.status,
      0,
      `a fully evidenced GPT-6 Sol review must pass:\n${result.output}`,
    );
    assert.match(result.output, /is bound to reviewed head/);
  });

  for (const model of ["GPT-6 Luna", "Opus 5.5", "", "n/a", "pal-mcp"]) {
    it(`rejects ${JSON.stringify(model)} even with otherwise valid evidence`, () => {
      const dir = reviewedScenario();
      const result = runForModel(dir, model);

      assert.equal(result.status, 1, result.output);
      assert.match(result.output, /\*\*Model:\*\* must be exactly GPT-6 Sol/);
      assert.match(result.output, /is bound to reviewed head/);
    });
  }
});
