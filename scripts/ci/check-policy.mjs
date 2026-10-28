#!/usr/bin/env node
/**
 * check:policy — the agent policy stays short, linked and free of live state.
 *
 * AGENTS.md is the entry point; docs/ contains the concise roadmap, scope and evidence.
 * AGENTS.md is the only rulebook (CLAUDE.md was removed). Archived guidance is not policy. Checked here:
 *
 *   1. Every relative link and #anchor in those files resolves.
 *   2. The entry files carry no live state: no 40-character SHA, no PR/issue number.
 *
 * Fails closed: a policy file that cannot be read is a failure, not a skip.
 */

import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exists, finish, readText, repoRoot, violation } from "./lib/repo.mjs";

const NAME = "check:policy";

export const POLICY_FILES = [
  "AGENTS.md",
  "docs/README.md",
  "docs/features.md",
  "docs/alignment.md",
  "docs/agent-work.md",
  "docs/roadmap.md",
  "docs/requirements.md",
  "docs/audit.md",
  "docs/testing.md",
  "docs/status.md",
  "docs/screens.md",
  "docs/contracts.md",
];

/** Files whose job is permanent policy: no SHAs, no PR numbers. */
export const NO_LIVE_STATE_FILES = ["AGENTS.md", "docs/testing.md"];

/** GitHub's heading-anchor slug, close enough for the ASCII headings these files use. */
export function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*]/g, "")
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
    for (const match of withoutCode.matchAll(
      /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    )) {
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
    if (/\b[0-9a-f]{40}\b/.test(withoutLinks))
      found.push({ line: number, what: "a 40-character SHA" });
    if (/(^|[^\w/&`])#[0-9]{2,5}\b/.test(withoutLinks))
      found.push({ line: number, what: "a PR/issue number" });
  }
  return found;
}

async function main() {
  const failures = [];
  const sources = new Map();

  for (const relative of POLICY_FILES) {
    const absolute = path.join(repoRoot, relative);
    if (!(await exists(absolute))) {
      failures.push(violation(relative, "policy file is missing."));
      continue;
    }
    sources.set(relative, await readText(absolute));
  }

  // 1 · links and anchors
  const anchorCache = new Map();
  for (const [relative, source] of sources) {
    for (const { line, target } of linksOf(source)) {
      const [file, fragment] = target.split("#");
      const resolved =
        file === ""
          ? relative
          : path.posix.normalize(
              path.posix.join(path.posix.dirname(relative), file),
            );
      const absolute = path.join(repoRoot, resolved);
      if (!(await exists(absolute))) {
        failures.push(
          violation(
            `${relative}:${line}`,
            `link target \`${target}\` does not exist.`,
          ),
        );
        continue;
      }
      if (fragment && resolved.endsWith(".md")) {
        if (!anchorCache.has(resolved))
          anchorCache.set(resolved, anchorsOf(await readText(absolute)));
        if (!anchorCache.get(resolved).has(fragment)) {
          failures.push(
            violation(
              `${relative}:${line}`,
              `anchor \`#${fragment}\` does not exist in \`${resolved}\`.`,
            ),
          );
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
        violation(
          `${relative}:${line}`,
          `${what} in a permanent policy file. Live state belongs in GitHub, the queue or a dated status snapshot.`,
        ),
      );
    }
  }

  finish({
    name: NAME,
    failures,
    ok: `${sources.size} policy file(s) coherent: links, live state`,
  });
}

const invokedDirectly = (() => {
  try {
    return (
      realpathSync(process.argv[1]) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  await main();
}
