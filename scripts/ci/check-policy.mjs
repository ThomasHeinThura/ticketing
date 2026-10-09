#!/usr/bin/env node
/**
 * check:policy — the agent operating policy stays coherent and loadable.
 *
 * The policy is split on purpose (AGENTS.md § Authority): AGENTS.md is the entry point, the
 * active mission is the only home for current scope, agent-workflow.md is the only home for
 * the execution workflow and the model policy, CLAUDE.md is a provider adapter. Prose cannot
 * keep that split from drifting back into copies, live dashboards and dead links — the
 * restructure that introduced this check found all three (docs/07-planning/
 * workflow-policy-audit-2026-10-09.md). So the properties that matter are executable:
 *
 *   1. Every relative link and #anchor in the policy files resolves.
 *   2. The entry files carry no live state: no 40-character SHA, no PR/issue number.
 *   3. The active mission exists, and AGENTS.md's startup order reads it before the workflow.
 *   4. agent-workflow.md carries exactly one well-formed security-review model block — the
 *      list the PR-template check reads from the merge base (lib/review-models.mjs).
 *
 * Fails closed: a policy file that cannot be read is a failure, not a skip.
 */

import path from "node:path";
import { exists, finish, readText, repoRoot, violation } from "./lib/repo.mjs";
import {
  parseSecurityReviewModels,
  ReviewModelsUnavailableError,
} from "./lib/review-models.mjs";

const NAME = "check:policy";

export const POLICY_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "docs/07-planning/active-mission.md",
  "docs/04-engineering/agent-workflow.md",
  "docs/04-engineering/definition-of-done.md",
  "docs/04-engineering/sdlc.md",
  "docs/04-engineering/error-fix-loop.md",
  "docs/04-engineering/ci-cd.md",
];

/** Files whose job is permanent policy: no SHAs, no PR numbers. */
export const NO_LIVE_STATE_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "docs/07-planning/active-mission.md",
  "docs/04-engineering/agent-workflow.md",
];

/** GitHub's heading-anchor slug, close enough for the ASCII headings these files use. */
export function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_]/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** Strip fenced code blocks so their contents are neither links nor headings. */
function proseLines(source) {
  const lines = [];
  let fenced = false;
  for (const [index, line] of source.split("\n").entries()) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) lines.push({ number: index + 1, text: line });
  }
  return lines;
}

/** Every anchor a Markdown document defines: heading slugs (with -1, -2 duplicates) and ids. */
export function anchorsOf(source) {
  const anchors = new Set();
  const seen = new Map();
  for (const { text } of proseLines(source)) {
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(text);
    if (heading) {
      const slug = slugify(heading[1]);
      const count = seen.get(slug) ?? 0;
      seen.set(slug, count + 1);
      anchors.add(count === 0 ? slug : `${slug}-${count}`);
    }
    for (const id of text.matchAll(/<a\s+id="([^"]+)"/g)) anchors.add(id[1]);
  }
  return anchors;
}

/** Relative links in prose: `[text](target)`, ignoring schemes and inline code spans. */
export function linksOf(source) {
  const links = [];
  for (const { number, text } of proseLines(source)) {
    const withoutCode = text.replace(/`[^`]*`/g, "");
    for (const match of withoutCode.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      links.push({ line: number, target });
    }
  }
  return links;
}

/** Live-state tokens in one file's prose: full SHAs and `#123`-style references. */
export function liveStateIn(source) {
  const found = [];
  for (const { number, text } of proseLines(source)) {
    if (/\*\*Reviewed head:\*\*/.test(text)) continue; // a syntax example, not a claim
    const withoutLinks = text.replace(/\]\([^)]*\)/g, "]");
    if (/\b[0-9a-f]{40}\b/.test(withoutLinks)) found.push({ line: number, what: "a 40-character SHA" });
    if (/(^|[^\w/&`])#[0-9]{2,5}\b/.test(withoutLinks)) found.push({ line: number, what: "a PR/issue number" });
  }
  return found;
}

async function main() {
  const failures = [];
  const sources = new Map();

  for (const relative of POLICY_FILES) {
    const absolute = path.join(repoRoot, relative);
    if (!(await exists(absolute))) {
      failures.push(violation(relative, "policy file is missing; the startup order points at it."));
      continue;
    }
    sources.set(relative, await readText(absolute));
  }

  // 1 · links and anchors
  const anchorCache = new Map();
  for (const [relative, source] of sources) {
    for (const { line, target } of linksOf(source)) {
      const [file, fragment] = target.split("#");
      const resolved = file === "" ? relative : path.posix.normalize(path.posix.join(path.posix.dirname(relative), file));
      const absolute = path.join(repoRoot, resolved);
      if (!(await exists(absolute))) {
        failures.push(violation(`${relative}:${line}`, `link target \`${target}\` does not exist.`));
        continue;
      }
      if (fragment && resolved.endsWith(".md")) {
        if (!anchorCache.has(resolved)) anchorCache.set(resolved, anchorsOf(await readText(absolute)));
        if (!anchorCache.get(resolved).has(fragment)) {
          failures.push(violation(`${relative}:${line}`, `anchor \`#${fragment}\` does not exist in \`${resolved}\`.`));
        }
      }
    }
  }

  // 2 · no live state in the permanent entry files
  for (const relative of NO_LIVE_STATE_FILES) {
    const source = sources.get(relative);
    if (source === undefined) continue;
    for (const { line, what } of liveStateIn(source)) {
      failures.push(
        violation(`${relative}:${line}`, `${what} in a permanent policy file. Live state belongs in GitHub, the queue or a dated status snapshot.`),
      );
    }
  }

  // 3 · startup order
  const agents = sources.get("AGENTS.md");
  if (agents !== undefined) {
    const order = /## Read in this order([\s\S]*?)\n## /.exec(`${agents}\n## `);
    const section = order ? order[1] : "";
    const mission = section.indexOf("active-mission.md");
    const workflow = section.indexOf("agent-workflow.md");
    if (mission === -1 || workflow === -1 || mission > workflow) {
      failures.push(
        violation("AGENTS.md § Read in this order", "must name docs/07-planning/active-mission.md before docs/04-engineering/agent-workflow.md."),
      );
    }
  }

  // 4 · the security-review model block
  const workflow = sources.get("docs/04-engineering/agent-workflow.md");
  if (workflow !== undefined) {
    try {
      if (parseSecurityReviewModels(workflow) === null) {
        failures.push(
          violation("docs/04-engineering/agent-workflow.md", "has no `<!-- policy:security-review-models -->` block; the PR-template check reads it from the merge base."),
        );
      }
    } catch (error) {
      if (!(error instanceof ReviewModelsUnavailableError)) throw error;
      failures.push(violation("docs/04-engineering/agent-workflow.md", error.message));
    }
  }

  finish({ name: NAME, failures, ok: `${sources.size} policy file(s) coherent: links, live state, startup order, model block` });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
