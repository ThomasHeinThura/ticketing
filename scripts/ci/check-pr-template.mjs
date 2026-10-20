#!/usr/bin/env node
/**
 * check:pr-template — the pull-request body answers the questions in
 * .github/pull_request_template.md (docs/04-engineering/workflow.md § Pull requests).
 *
 *   1. Every `##` section in the template is present and filled in, or says
 *      "n/a — <reason>".
 *   2. `## Reviewed by` is never n/a: every change gets one independent review.
 *   3. `## Security` is not n/a when the diff touches the security paths listed in
 *      docs/04-engineering/ci-cd.md, or changes a file that declares a Hono router.
 *   4. `## Screens` is not n/a when the diff touches apps/web/.
 *
 * Usage:
 *   node scripts/ci/check-pr-template.mjs --body <file>
 *   node scripts/ci/check-pr-template.mjs            # reads $GITHUB_EVENT_PATH
 */

import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { changedPaths, DiffUnavailableError } from "./lib/diff.mjs";
import {
  contentOf,
  DuplicateSectionError,
  loadBody,
  markedNotApplicable,
  normaliseHeading,
  sections,
} from "./lib/pr-body.mjs";
import { exists, finish, readText, repoRoot, violation } from "./lib/repo.mjs";
import {
  looksLikeHonoRouter,
  readSecurityReviewScope,
  SecurityScopeUnavailableError,
} from "./lib/security-paths.mjs";

const NAME = "check:pr-template";
const TEMPLATE = ".github/pull_request_template.md";

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

/**
 * Sections that are required whatever the template says, so a pull request cannot escape a
 * rule by deleting the section from the template in the same diff. Changing this list means
 * changing this reviewed file.
 */
export const MANDATORY_SECTIONS = ["Reviewed by", "Security", "Screens"];

async function templateHeadings() {
  const source = await readText(path.join(repoRoot, TEMPLATE));
  const headings = [...source.matchAll(/^## (.+)$/gm)].map((match) =>
    match[1].trim(),
  );
  const present = new Set(headings.map(normaliseHeading));
  for (const heading of MANDATORY_SECTIONS) {
    if (!present.has(normaliseHeading(heading))) headings.push(heading);
  }
  return headings;
}

/** "n/a", "- N/A —", "**Not applicable**", "None." — any way of saying the section does not apply. */
export function saysNotApplicable(text) {
  const lead = text
    .replace(/^[\s>*_`~-]+/, "")
    .replace(/^(\d+[.)]|[-*+])\s+/, "")
    .replace(/^[*_`~]+/, "");
  return /^(n\s*\/?\s*a|not\s+applicable|none|nothing)\b/i.test(lead);
}

async function securityTouched(paths) {
  const scope = await readSecurityReviewScope();
  const touched = paths.filter((file) => scope.matches(file));
  for (const file of paths) {
    if (!/\.tsx?$/.test(file) || touched.includes(file)) continue;
    const absolute = path.join(repoRoot, file);
    if (!(await exists(absolute))) continue;
    if (looksLikeHonoRouter(await readText(absolute))) touched.push(file);
  }
  return touched;
}

export async function evaluate({ body, headings, paths, security }) {
  const failures = [];
  if (body.trim() === "") {
    return [violation("pull request body", `empty. Fill in ${TEMPLATE}.`)];
  }

  let found;
  try {
    found = sections(body);
  } catch (error) {
    if (error instanceof DuplicateSectionError) {
      return [violation("pull request body", error.message)];
    }
    throw error;
  }

  const webTouched = paths.some((file) => file.startsWith("apps/web/"));
  for (const heading of headings) {
    const section = found.get(normaliseHeading(heading));
    const where = `## ${heading}`;
    if (!section) {
      failures.push(violation(where, "missing from the pull request body."));
      continue;
    }
    const text = contentOf(section.text);
    if (text === "") {
      failures.push(
        violation(where, 'empty. Fill it in, or write "n/a — <reason>".'),
      );
      continue;
    }
    const key = normaliseHeading(heading);
    if (!saysNotApplicable(text)) continue;
    if (key === "not done") continue;
    if (
      !markedNotApplicable(
        text.replace(/\b(not\s+applicable|none|nothing)\b/gi, "n/a"),
      )
    ) {
      failures.push(
        violation(where, 'says n/a without a reason ("n/a — <reason>").'),
      );
    }
    if (key === "reviewed by") {
      failures.push(
        violation(
          where,
          "cannot be n/a: every change gets one independent review.",
        ),
      );
    }
    if (key === "security" && security.length > 0) {
      failures.push(
        violation(
          where,
          `cannot be n/a: the diff touches security paths (${security.slice(0, 5).join(", ")}).`,
        ),
      );
    }
    if (key === "screens" && webTouched) {
      failures.push(
        violation(where, "cannot be n/a: the diff touches apps/web/."),
      );
    }
  }
  return failures;
}

async function main() {
  const body = await loadBody({
    bodyFile: argValue("--body"),
    eventPath: process.env.GITHUB_EVENT_PATH,
  });
  let paths;
  let security;
  try {
    paths = changedPaths();
    security = await securityTouched(paths);
  } catch (error) {
    if (
      error instanceof DiffUnavailableError ||
      error instanceof SecurityScopeUnavailableError
    ) {
      finish({ name: NAME, failures: [violation("diff", error.message)] });
      return;
    }
    throw error;
  }
  const failures = await evaluate({
    body,
    headings: await templateHeadings(),
    paths,
    security,
  });
  finish({ name: NAME, failures, ok: "pull request body complete" });
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
