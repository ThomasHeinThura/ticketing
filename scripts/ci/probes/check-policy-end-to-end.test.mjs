/**
 * check:policy end to end — every rule in main() can turn the gate red.
 *
 * The helper tests (../check-policy.test.mjs) prove slugging, link and live-state parsing.
 * These run the real script in a scratch repository with a small, coherent policy set and then
 * break one property at a time, so deleting any rule from main() turns a test red.
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  cleanUpScratchRepos,
  initRepo,
  installCheckers,
  remove,
  runChecker,
  scratchDir,
  write,
} from "../lib/scratch-repo.mjs";

after(cleanUpScratchRepos);

const MODEL_BLOCK = [
  "<!-- policy:security-review-models -->",
  "- `GPT-6 Sol`",
  "- `Claude Opus 5.5 (claude-opus-5-5)`",
  "<!-- /policy:security-review-models -->",
].join("\n");

const FILES = {
  "AGENTS.md": [
    "# AGENTS.md",
    "",
    "## Read in this order",
    "",
    "1. This file.",
    "2. [active mission](docs/07-planning/active-mission.md)",
    "3. [workflow](docs/04-engineering/agent-workflow.md#model-policy)",
    "",
    "## Authority",
    "",
    "See [CLAUDE.md](CLAUDE.md).",
    "",
  ].join("\n"),
  "CLAUDE.md":
    "# CLAUDE.md — provider adapter\n\nSee [AGENTS.md](AGENTS.md#authority).\n",
  "docs/07-planning/active-mission.md":
    "# Active mission\n\n[workflow](../04-engineering/agent-workflow.md)\n",
  "docs/04-engineering/agent-workflow.md": `# Agent workflow\n\n## Model policy\n\n${MODEL_BLOCK}\n`,
  "docs/04-engineering/definition-of-done.md":
    "# Definition of Done\n\n## Levels of done\n",
  "docs/04-engineering/sdlc.md":
    "# SDLC\n\n[DoD](definition-of-done.md#levels-of-done)\n",
  "docs/04-engineering/error-fix-loop.md": "# Error fix loop\n",
  "docs/04-engineering/ci-cd.md": "# CI/CD\n",
};

function policyRepo(name, mutate = () => {}) {
  const dir = scratchDir(`check-policy-${name}`);
  initRepo(dir);
  installCheckers(dir);
  for (const [relative, contents] of Object.entries(FILES))
    write(dir, relative, contents);
  mutate(dir);
  return dir;
}

describe("check:policy end to end", () => {
  it("a coherent policy set is GREEN (non-vacuity control)", () => {
    const result = runChecker(policyRepo("coherent"), "check-policy.mjs");
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /8 policy file\(s\) coherent/);
  });

  it("a missing policy file is RED", () => {
    const result = runChecker(
      policyRepo("missing", (dir) =>
        remove(dir, "docs/07-planning/active-mission.md"),
      ),
      "check-policy.mjs",
    );
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /policy file is missing/);
  });

  it("a broken anchor is RED", () => {
    const result = runChecker(
      policyRepo("anchor", (dir) =>
        write(
          dir,
          "CLAUDE.md",
          "# CLAUDE.md\n\nSee [AGENTS.md](AGENTS.md#no-such-section).\n",
        ),
      ),
      "check-policy.mjs",
    );
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /anchor `#no-such-section` does not exist/);
  });

  it("a broken link target is RED", () => {
    const result = runChecker(
      policyRepo("target", (dir) =>
        write(dir, "CLAUDE.md", "# CLAUDE.md\n\nSee [x](nowhere.md).\n"),
      ),
      "check-policy.mjs",
    );
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /link target `nowhere\.md` does not exist/);
  });

  it("live state in an entry file is RED", () => {
    const result = runChecker(
      policyRepo("live", (dir) =>
        write(
          dir,
          "docs/07-planning/active-mission.md",
          `# Active mission\n\nMerged ${"a".repeat(40)} after #612.\n`,
        ),
      ),
      "check-policy.mjs",
    );
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /a 40-character SHA/);
    assert.match(result.output, /a PR\/issue number/);
  });

  it("the workflow read before the active mission is RED", () => {
    const result = runChecker(
      policyRepo("order", (dir) =>
        write(
          dir,
          "AGENTS.md",
          FILES["AGENTS.md"]
            .replace(
              "2. [active mission](docs/07-planning/active-mission.md)",
              "2. [workflow](docs/04-engineering/agent-workflow.md)",
            )
            .replace(
              "3. [workflow](docs/04-engineering/agent-workflow.md#model-policy)",
              "3. [active mission](docs/07-planning/active-mission.md)",
            ),
        ),
      ),
      "check-policy.mjs",
    );
    assert.equal(result.status, 1, result.output);
    assert.match(
      result.output,
      /must name docs\/07-planning\/active-mission\.md before/,
    );
  });

  it("no security-review model block is RED", () => {
    const result = runChecker(
      policyRepo("noblock", (dir) =>
        write(
          dir,
          "docs/04-engineering/agent-workflow.md",
          "# Agent workflow\n\n## Model policy\n",
        ),
      ),
      "check-policy.mjs",
    );
    assert.equal(result.status, 1, result.output);
    assert.match(
      result.output,
      /has no `<!-- policy:security-review-models -->` block/,
    );
  });

  it("a malformed model block is RED", () => {
    const result = runChecker(
      policyRepo("badblock", (dir) =>
        write(
          dir,
          "docs/04-engineering/agent-workflow.md",
          `# Agent workflow\n\n## Model policy\n\n${MODEL_BLOCK.replace("- `GPT-6 Sol`", "- GPT-6 Sol")}\n`,
        ),
      ),
      "check-policy.mjs",
    );
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /must be a list item holding/);
  });
});
