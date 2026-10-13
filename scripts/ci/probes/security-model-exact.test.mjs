/**
 * The security review model field accepts only an exact label from the accepted list, and
 * that list is read from the MERGE BASE (lib/review-models.mjs).
 *
 * The positive cases carry the same committed, current-head-bound note required of a real
 * security-scope pull request. Negative cases change only the model field or the list, so
 * each failure is attributable to the model policy. Without a list at the merge base the
 * legacy set — exactly GPT-6 Sol — applies.
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  bodyFile,
  cleanUpScratchRepos,
  commit,
  completeBody,
  git,
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

const MODEL_POLICY = "docs/04-engineering/agent-workflow.md";

function modelBlock(models) {
  return [
    "# Agent workflow",
    "",
    "<!-- policy:security-review-models -->",
    ...models.map((model) => `- \`${model}\``),
    "<!-- /policy:security-review-models -->",
    "",
  ].join("\n");
}

function reviewedScenario({
  baseModels = null,
  headModels = null,
  baseRaw = null,
} = {}) {
  const dir = scratchDir("security-model-exact");
  initRepo(dir);
  installCheckers(dir);
  installFromRepo(dir, ".github/pull_request_template.md");
  write(dir, "docs/04-engineering/ci-cd.md", CI_CD);
  write(dir, "apps/api/src/auth.ts", "export const authSurface = 1;\n");
  if (baseRaw !== null) write(dir, MODEL_POLICY, baseRaw);
  else if (baseModels !== null)
    write(dir, MODEL_POLICY, modelBlock(baseModels));
  const base = commit(dir, "chore: bootstrap security model probe");
  setOriginMain(dir, base);

  write(dir, "apps/api/src/auth.ts", "export const authSurface = 2;\n");
  if (headModels !== null) write(dir, MODEL_POLICY, modelBlock(headModels));
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

describe("without a model list at the merge base, only the legacy GPT-6 Sol label passes", () => {
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
      assert.match(
        result.output,
        /\*\*Model:\*\* must be exactly one of "GPT-6 Sol"/,
      );
      assert.match(result.output, /legacy set/);
      assert.match(result.output, /is bound to reviewed head/);
    });
  }
});

const OPUS = "Claude Opus 5.5 (claude-opus-5-5)";

describe("the accepted list is read from the merge base", () => {
  it("accepts a model the merge base lists", () => {
    const dir = reviewedScenario({ baseModels: ["GPT-6 Sol", OPUS] });
    const result = runForModel(dir, OPUS);
    assert.equal(
      result.status,
      0,
      `a listed model with valid evidence must pass:\n${result.output}`,
    );
  });

  it("still accepts GPT-6 Sol when the merge base lists it", () => {
    const dir = reviewedScenario({ baseModels: ["GPT-6 Sol", OPUS] });
    assert.equal(runForModel(dir, "GPT-6 Sol").status, 0);
  });

  it("rejects a model the merge base no longer lists", () => {
    const dir = reviewedScenario({ baseModels: [OPUS] });
    const result = runForModel(dir, "GPT-6 Sol");
    assert.equal(result.status, 1, result.output);
    assert.match(
      result.output,
      /must be exactly one of "Claude Opus 5\.5 \(claude-opus-5-5\)"/,
    );
  });

  it("refuses a model that only the pull request's own HEAD adds (no self-approval)", () => {
    const dir = reviewedScenario({
      baseModels: ["GPT-6 Sol"],
      headModels: ["GPT-6 Sol", OPUS],
    });
    const result = runForModel(dir, OPUS);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /read from the merge base/);
  });

  it("refuses a HEAD-only list when the merge base has none (legacy applies)", () => {
    const dir = reviewedScenario({ headModels: [OPUS] });
    const result = runForModel(dir, OPUS);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /legacy set/);
  });

  for (const nearMiss of [
    "Claude Opus 5.5",
    "claude-opus-5-5",
    "Opus 5.5",
    `${OPUS} `,
    "GPT-6 Sol (Claude Opus 5.5)",
  ]) {
    it(`rejects the near miss ${JSON.stringify(nearMiss)}`, () => {
      const dir = reviewedScenario({ baseModels: ["GPT-6 Sol", OPUS] });
      const result = runForModel(dir, nearMiss);
      // A trailing space is trimmed by the body parser, so that one variant is the exact label.
      if (nearMiss.trim() === OPUS) {
        assert.equal(result.status, 0, result.output);
        return;
      }
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, /must be exactly one of/);
    });
  }

  it("refuses to judge a pull request into another branch (no retargeting to a widened list)", () => {
    const dir = reviewedScenario({ baseModels: ["GPT-6 Sol", OPUS] });
    git(dir, [
      "update-ref",
      "refs/remotes/origin/side",
      git(dir, ["rev-parse", "refs/remotes/origin/main"]).trim(),
    ]);
    const body = bodyFile(
      completeBody({ securityModel: OPUS, securityNote: NOTE_PATH }),
    );
    const result = runChecker(dir, "check-pr-template.mjs", ["--body", body], {
      GITHUB_BASE_REF: "side",
    });
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /targets `side`, not `main`/);
  });

  it("fails closed on a malformed list at the merge base instead of falling back", () => {
    const dir = reviewedScenario({
      baseRaw: [
        "<!-- policy:security-review-models -->",
        "- GPT-6 Sol",
        "<!-- /policy:security-review-models -->",
        "",
      ].join("\n"),
    });
    const result = runForModel(dir, "GPT-6 Sol");
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /must be a list item holding/);
  });

  it("fails closed on two blocks at the merge base", () => {
    const dir = reviewedScenario({
      baseRaw: `${modelBlock(["GPT-6 Sol"])}\n${modelBlock([OPUS])}`,
    });
    const result = runForModel(dir, OPUS);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /exactly one/);
  });
});
