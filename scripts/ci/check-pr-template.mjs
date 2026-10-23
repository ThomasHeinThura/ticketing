#!/usr/bin/env node
/** Ordinary PR descriptions need a visible outcome and actual validation. A phase
 * submission reuses the one consolidated source-bound report; no per-change reviewer. */
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validatePhaseReview } from "./check-reviews.mjs";
import {
  contentOf,
  DuplicateSectionError,
  loadBody,
  normaliseHeading,
  sections,
  stripComments,
} from "./lib/pr-body.mjs";
import { finish, readText, repoRoot, violation } from "./lib/repo.mjs";

const NAME = "check:pr-template";
const TEMPLATE = ".github/pull_request_template.md";
export const MANDATORY_SECTIONS = ["What and why", "How it was checked"];
function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}
export function saysNotApplicable(value) {
  return /^(?:n\s*\/?\s*a|not\s+applicable|none|nothing)\b/i.test(
    value.replace(/^[\s>*_`~-]+/, ""),
  );
}
export async function evaluate({ body }) {
  if (!body.trim())
    return [violation("pull request body", `empty. Fill in ${TEMPLATE}.`)];
  let found;
  try {
    found = sections(body);
  } catch (error) {
    if (error instanceof DuplicateSectionError)
      return [violation("pull request body", error.message)];
    throw error;
  }
  const failures = [];
  for (const heading of MANDATORY_SECTIONS) {
    const section = found.get(normaliseHeading(heading));
    const value = section ? contentOf(section.text) : "";
    if (!value)
      failures.push(
        violation(
          `## ${heading}`,
          "missing or empty. Describe the actual outcome and checks, including anything unverified.",
        ),
      );
    else if (saysNotApplicable(value))
      failures.push(
        violation(
          `## ${heading}`,
          "describe the outcome or the actual validation/limitations instead of an n/a assertion.",
        ),
      );
  }
  return failures;
}
/** A phase claim is explicit, never inferred from prose or a model name. */
export function phaseSubmission(body) {
  const section = sections(body).get(normaliseHeading("Phase completion"));
  if (!section) return null;
  const source = stripComments(section.raw);
  const fields = new Map();
  for (const match of source.matchAll(
    /^\s*\*\*(Phase|Report):\*\*\s*([^\n]+)$/gim,
  )) {
    const key = match[1].toLowerCase();
    if (fields.has(key))
      throw new Error(`Duplicate ${key} field in Phase completion`);
    fields.set(key, match[2].trim().replace(/^`([^`]+)`$/, "$1"));
  }
  const phase = fields.get("phase");
  const report = fields.get("report");
  if (/^(?:none|not submitted)$/i.test(phase ?? "") && !report) return null;
  if (!/^P[0-9]$/.test(phase ?? "") || !report)
    throw new Error(
      "Phase completion requires explicit **Phase:** P0..P9 and **Report:** docs/evidence/Pn-review.json; unfinished phases are 'not submitted'.",
    );
  return { phase, report };
}
async function main() {
  const body = await loadBody({
    bodyFile: argValue("--body"),
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: this uncached CI command reads GitHub event metadata, not product configuration.
    eventPath: process.env.GITHUB_EVENT_PATH,
  });
  const failures = await evaluate({ body });
  let submission;
  try {
    const template = await readText(path.join(repoRoot, TEMPLATE));
    for (const heading of MANDATORY_SECTIONS)
      if (!sections(template).has(normaliseHeading(heading)))
        throw new Error(`The current PR template is missing ## ${heading}`);
    submission = phaseSubmission(body);
    const cliRequested =
      process.argv.includes("--phase") || process.argv.includes("--report");
    if (cliRequested) {
      const explicit = {
        phase: argValue("--phase"),
        report: argValue("--report"),
      };
      if (
        submission &&
        (submission.phase !== explicit.phase ||
          submission.report !== explicit.report)
      )
        throw new Error(
          "CLI phase submission conflicts with the pull request body",
        );
      submission = explicit;
    }
    if (submission) await validatePhaseReview(submission);
  } catch (error) {
    failures.push(violation("phase submission", error.message));
  }
  finish({
    name: NAME,
    failures,
    ok: submission
      ? "description and consolidated phase evidence validated; Thomas acceptance remains separate"
      : "description complete; phase not submitted, no independent review or acceptance inferred",
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
if (invokedDirectly) await main();
