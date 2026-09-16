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
 * Does a compact, single-value FIELD like `**Spec:**`'s open with a genuine,
 * STANDALONE "n/a" / "not applicable" / "blocked" state word — as opposed to
 * a genuine filename reference whose own text merely starts with letters
 * that spell one of those words (`n/a-workflows.md`, `blocked.md`)?
 *
 * Two prior fixes here tried to enumerate which punctuation characters are
 * "safe" to glue directly onto the opener with no space: first a deny-list
 * (reject a hyphen), then an allow-list (accept only whitespace/colon/comma/
 * dash). Both were found adversarially to be wrong in one direction or the
 * other — a deny-list misses the next dangerous character (a period, in
 * `blocked.md`); an allow-list rejects ordinary sentence punctuation a human
 * obviously writes (a period, semicolon, exclamation mark, closing paren, or
 * bold-markdown `**` before more prose), wrongly treating an honest "n/a."
 * or "n/a;" explanation as a genuine reference — reopening the exact
 * original bug via different punctuation. Enumerating characters is the
 * wrong shape of fix no matter which list it is.
 *
 * The actual invariant doesn't need a list at all: scan forward from the end
 * of the matched opener. If a WHITESPACE character (or the end of the
 * string) is reached before any ALPHANUMERIC character, the opener is a
 * standalone word — whatever punctuation sits in between. If an
 * alphanumeric character is reached first, the opener is fused into a
 * longer identifier (a filename), no matter what punctuation preceded it.
 *
 * @returns {"not-applicable"|"blocked"|null} `null` when the field does not
 *   open with a standalone n/a/blocked word at all.
 */
function fieldOpener(declared) {
  const opener = declared.trim().replace(/^[^\p{L}\p{N}]+/u, "");
  const match = /^(?:n\s*\/\s*a|not\s+applicable|blocked)/i.exec(opener);
  if (!match) {
    return null;
  }
  let i = match[0].length;
  while (i < opener.length && !/\s/.test(opener[i])) {
    if (/[\p{L}\p{N}]/u.test(opener[i])) {
      return null; // fused into a longer identifier, e.g. "n/a-workflows.md"
    }
    i += 1;
  }
  return /^blocked/i.test(match[0]) ? "blocked" : "not-applicable";
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
    // Not a bare `/^n\/a$/i` exact match — found adversarially, while
    // shepherding PR #144: that exact-match guard only recognised a Spec
    // field that was LITERALLY the two characters "n/a", not the "n/a —
    // reason" shape this repository's own convention requires everywhere
    // else (`docs/04-engineering/definition-of-done.md`: "a checklist that
    // does not apply is marked n/a with a reason, never deleted"). An
    // honestly-written "n/a — this is UAT-deployability infrastructure
    // (tracked in `status.md` and issue #11)..." is not a spec declaration
    // at all, but its own explanation happening to mention a `.md` filename
    // in passing satisfied the old guard and got read as one anyway.
    //
    // "n/a" unconditionally exempts every `.md` mention in the field: it
    // asserts "there is no spec for this PR", which is true regardless of
    // what else the explanation happens to mention. "blocked" does NOT
    // carry that assertion — it only says an answer can't be given right
    // now — so once a real filename is actually named, it is always
    // checked, independent of how much surrounding explanation there is.
    // (Found adversarially: a length-based "is there enough explanation"
    // heuristic, reused from `pr-body.mjs`'s whole-SECTION-prose logic, let
    // a terse "blocked: workflows.md" dodge detection while a more verbose
    // phrasing of the identical claim was checked — naming the spec more
    // precisely and tersely was what triggered the bypass. A well-explained
    // "BLOCKED — reason, see workflows.md" is deliberately still checked
    // under this design: a false negative here is a real security-process
    // gap (do-not 15), a false positive only costs a reword, as PR #144
    // already did once.)
    //
    // Every `.md`-shaped token in the field is checked, not just the first
    // — found adversarially: a Spec field naming a decoy file before the
    // real one let the real one's open findings go unchecked entirely.
    if (fieldOpener(declared) !== "not-applicable") {
      for (const match of declared.matchAll(/[a-z0-9-]+\.md/g)) {
        specs.add(match[0]);
      }
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
