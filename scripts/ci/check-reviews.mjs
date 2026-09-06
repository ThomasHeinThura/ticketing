#!/usr/bin/env node
/**
 * check:reviews — a feature spec named in the diff must not still have a non-empty section
 * in docs/07-planning/reviews/2026-09-05/.
 *
 * AGENTS.md do-not 15: "Start building a feature while its section in
 * docs/07-planning/reviews/2026-09-05/ is non-empty." CLAUDE.md's spec-interaction rule
 * says open findings are closed before implementing, and that reviewers check it, not the
 * author — so it is checked here instead.
 *
 * ci-cd.md: "the pre-p0-check-fable/ folder is an applied audit trail and is excluded."
 *
 * A spec is "named in the diff" when the branch changes docs/03-features/<spec>.md, or
 * when the pull-request body's `**Spec:**` field points at one.
 *
 * Usage:
 *   node scripts/ci/check-reviews.mjs [--body <file>] [--spec docs/03-features/x.md]
 */

import path from "node:path";
import { changedPaths } from "./lib/diff.mjs";
import {
  contentOf,
  field,
  loadBody,
  normaliseHeading,
  sections,
} from "./lib/pr-body.mjs";
import {
  finish,
  readText,
  rel,
  repoRoot,
  violation,
  walk,
} from "./lib/repo.mjs";

const NAME = "check:reviews";
const reviewsDir = path.join(repoRoot, "docs/07-planning/reviews/2026-09-05");
const excludedDir = "docs/07-planning/reviews/2026-09-05/pre-p0-check-fable/";

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

/**
 * Sections of a review document, keyed by every spec filename their heading names.
 *
 * @returns {{ spec: string, heading: string, body: string }[]}
 */
function specSections(source) {
  const lines = source.split("\n");
  const found = [];
  let open = null;

  const close = (index) => {
    if (open) {
      open.body = lines.slice(open.start, index).join("\n").trim();
      found.push(open);
      open = null;
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const heading = /^(#{1,6})\s+(.*\S)\s*$/.exec(lines[i]);
    if (!heading) {
      continue;
    }
    if (open && heading[1].length <= open.level) {
      close(i);
    }
    const spec = /`([a-z0-9-]+\.md)`/.exec(heading[2]);
    if (spec && !open) {
      open = {
        spec: spec[1],
        heading: heading[2],
        level: heading[1].length,
        start: i + 1,
        body: "",
      };
    }
  }
  close(lines.length);

  return found;
}

async function main() {
  const failures = [];
  const warnings = [];

  const specs = new Set();
  for (const file of changedPaths()) {
    const match = /^docs\/03-features\/([a-z0-9-]+)\.md$/.exec(file);
    if (match && match[1] !== "README") {
      specs.add(`${match[1]}.md`);
    }
  }

  const explicit = argValue("--spec");
  if (explicit) {
    specs.add(path.basename(explicit));
  }

  const body = await loadBody({
    bodyFile: argValue("--body"),
    eventPath: process.env.GITHUB_EVENT_PATH,
  });
  if (body.trim() !== "") {
    const task = sections(body).get(normaliseHeading("Task"));
    const declared = task ? field(contentOf(task.raw), "Spec") : "";
    const named = /([a-z0-9-]+\.md)/.exec(declared);
    if (named && !/^n\/a$/i.test(declared.trim())) {
      specs.add(named[1]);
    }
  }

  if (specs.size === 0) {
    finish({
      name: NAME,
      failures,
      ok: "no feature spec named in this change",
    });
    return;
  }

  const reviewFiles = (
    await walk(reviewsDir, (relative) => relative.endsWith(".md"))
  ).filter((absolute) => !rel(absolute).startsWith(excludedDir));

  for (const absolute of reviewFiles) {
    const source = await readText(absolute);
    for (const section of specSections(source)) {
      if (!specs.has(section.spec) || section.body === "") {
        continue;
      }
      failures.push(
        violation(
          `${rel(absolute)} — ${section.heading}`,
          `\`${section.spec}\` still has open review findings (${section.body.split("\n").length} lines). ` +
            "Close them in the owning document first — a feature is not started while its review " +
            "section is non-empty (AGENTS.md do-not 15).",
        ),
      );
    }
  }

  warnings.push(
    `spec(s) named in this change: ${[...specs].sort().join(", ")}`,
  );

  finish({
    name: NAME,
    failures,
    warnings,
    ok: "every spec named in this change has an empty review section",
  });
}

await main();
