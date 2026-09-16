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
  effectivelyNotApplicable,
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
 * The characters allowed to immediately follow "n/a"/"blocked" with NO
 * whitespace — i.e., the separators this repository's own convention
 * actually uses glued directly onto the opener, no space needed first.
 * Drawn from `pr-body.test.mjs`'s own recognised examples: `"n/a: nothing
 * visual here"`, `"N/A, backend only"`. A typographic dash counts too,
 * matching `ITEM_SEPARATOR`'s own family elsewhere in `pr-body.mjs`.
 * Deliberately excludes every OTHER character (a hyphen, a period, a
 * letter, a digit) — those are what a genuine filename glues onto its own
 * name, never what this repository's own authors glue onto a state word.
 */
const COMPACT_FIELD_SEPARATOR = /[\s:,—–]/;

/**
 * Is a compact, single-value FIELD like `**Spec:**`'s — not a whole prose
 * section — declaring n/a or BLOCKED, as opposed to a genuine reference
 * whose own text merely starts with letters that spell one of those words?
 *
 * `effectivelyNotApplicable`/`declaredState` (in `lib/pr-body.mjs`) were
 * built for whole-section PROSE, where a state word is realistically always
 * followed by real punctuation or whitespace before further explanation.
 * Their opener regexes end in a bare `\b` — a word/non-word boundary — and
 * ANY non-word character satisfies it, including one glued directly onto a
 * genuine filename's own name: `n/a-workflows.md` (a hyphen) and
 * `blocked.md` (a period) both satisfy that boundary immediately after the
 * first word, even though neither string is declaring a state at all.
 *
 * The first fix here only rejected a hyphen specifically — found
 * adversarially, again, by the fix's own follow-up review round: a period
 * is exactly as dangerous a glue character as a hyphen, and enumerating
 * "reject a hyphen, then also reject a period, then whatever character is
 * found next" is the same convenient-proxy mistake this file's own F9
 * history already condemns, just moved one level down and repeated
 * per-punctuation-mark. Inverted to an ALLOW-list instead: the opener must
 * be followed by whitespace, end-of-string, or one of the few characters
 * this repository's own convention is actually observed gluing directly
 * onto "n/a"/"blocked" with no space (`COMPACT_FIELD_SEPARATOR`) —
 * anything else is treated as glued to a longer identifier, not a
 * standalone declaration, closing the whole class of "which punctuation
 * mark is dangerous" at once rather than one mark at a time.
 *
 * A real "n/a"/"BLOCKED" declaration followed by a spaced hyphen or dash
 * separator (`"n/a - reason"`, `"BLOCKED — reason"`) still reaches
 * `effectivelyNotApplicable` unchanged, because the character right after
 * the opener there is whitespace, which the allow-list also accepts.
 */
function specFieldIsNotApplicable(declared) {
  const opener = declared.trim().replace(/^[^\p{L}\p{N}]+/u, "");
  const match = /^(?:n\s*\/\s*a|not\s+applicable|blocked)/i.exec(opener);
  if (match) {
    const next = opener[match[0].length];
    if (next !== undefined && !COMPACT_FIELD_SEPARATOR.test(next)) {
      return false;
    }
  }
  return effectivelyNotApplicable(declared);
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
    // Not a bare `/^n\/a$/i` exact match — found adversarially, while
    // shepherding PR #144: that exact-match guard only recognised a Spec
    // field that was LITERALLY the two characters "n/a", not the "n/a —
    // reason" shape this repository's own convention requires everywhere
    // else (`docs/04-engineering/definition-of-done.md`: "a checklist that
    // does not apply is marked n/a with a reason, never deleted"). An
    // honestly-written "n/a — this is UAT-deployability infrastructure
    // (tracked in `status.md` and issue #11)..." is not a spec declaration
    // at all, but its own explanation happening to mention a `.md` filename
    // in passing satisfied the old guard and got read as one anyway. This
    // is the same defect class F9 already closed once in `pr-body.mjs`'s
    // own history (a control reading a convenient token instead of the
    // actual declared state) — see `specFieldIsNotApplicable` below for why
    // that fix's own `effectivelyNotApplicable` isn't reused unmodified.
    if (named && !specFieldIsNotApplicable(declared)) {
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
