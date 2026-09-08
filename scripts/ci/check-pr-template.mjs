#!/usr/bin/env node
/**
 * The PR-template check, fast stage.
 *
 * docs/04-engineering/ci-cd.md: "The same fast-stage PR-template check asserts every fixed
 * section is present, that none is empty unless marked n/a with a reason, that
 * `## Reviewed by` names a different model or session from `## Implemented by`, that
 * `## Screens opened` is non-empty when apps/web/** changed, and that no checklist box is
 * left unticked and unmarked."
 *
 * And, whenever the diff touches the security paths ci-cd.md lists: `## Security review`
 * non-empty, its model matching ^Opus, and a link to the committed note under
 * docs/07-planning/security-reviews/ (docs/04-engineering/definition-of-done.md
 * § The pull request template).
 *
 * The section list is read from .github/pull_request_template.md, so the template stays
 * the single definition of "every fixed section".
 *
 * Usage:
 *   node scripts/ci/check-pr-template.mjs --body <file>
 *   node scripts/ci/check-pr-template.mjs                # reads $GITHUB_EVENT_PATH
 */

import path from "node:path";
import {
  addedPaths,
  changedFiles,
  changedPaths,
  DiffUnavailableError,
} from "./lib/diff.mjs";
import {
  checklistPresenceProblems,
  checklistProblems,
  contentOf,
  effectivelyNotApplicable,
  field,
  loadBody,
  normaliseHeading,
  sections,
} from "./lib/pr-body.mjs";
import { exists, finish, readText, repoRoot, violation } from "./lib/repo.mjs";
import {
  looksLikeHonoRouter,
  readSecurityReviewPaths,
} from "./lib/security-paths.mjs";

const NAME = "pr-template";
const templatePath = path.join(repoRoot, ".github/pull_request_template.md");

/** Thomas fills this one in; agents leave it blank on purpose. */
const thomasOnly = new Set([normaliseHeading("Design review H1–H6")]);

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function gateRows(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && !/^\|[\s:|-]+\|$/.test(line))
    .map((line) =>
      line
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim()),
    )
    .filter((cells) => cells.length >= 3 && !/^gate$/i.test(cells[0]));
}

/**
 * Every checklist in definition-of-done.md ships in every pull request. A checklist is
 * either pasted and ticked, or marked n/a with a reason — never left blank, and never
 * deleted.
 */

async function securitySurfaceTouched() {
  const { matches, globs } = await readSecurityReviewPaths();
  // F4: let DiffUnavailableError propagate. The caller turns it into a hard failure
  // rather than an empty change set that reads as "nothing sensitive was touched".
  const changes = changedFiles();
  const touched = changedPaths(changes).filter((file) => matches(file));

  for (const file of addedPaths(changes)) {
    if (!/\.tsx?$/.test(file) || touched.includes(file)) {
      continue;
    }
    const absolute = path.join(repoRoot, file);
    if (!(await exists(absolute))) {
      continue;
    }
    if (looksLikeHonoRouter(await readText(absolute))) {
      touched.push(`${file} (new file exporting a Hono router)`);
    }
  }

  return { touched, globs };
}

async function main() {
  const failures = [];
  const warnings = [];

  const body = await loadBody({
    bodyFile: argValue("--body"),
    eventPath: process.env.GITHUB_EVENT_PATH,
  });

  if (body.trim() === "") {
    finish({
      name: NAME,
      failures: [
        violation(
          "pull request body",
          "empty. Open the pull request from .github/pull_request_template.md and fill it in — " +
            "every fixed section ships in every pull request.",
        ),
      ],
    });
    return;
  }

  const template = await readText(templatePath);
  const required = [...sections(template).values()].map(
    (section) => section.heading,
  );
  const present = sections(body);

  for (const heading of required) {
    const key = normaliseHeading(heading);
    const section = present.get(key);

    if (!section) {
      failures.push(
        violation(
          `## ${heading}`,
          "section missing. Fixed sections are never deleted — mark one n/a instead.",
        ),
      );
      continue;
    }

    if (thomasOnly.has(key)) {
      continue;
    }

    if (section.content === "") {
      failures.push(
        violation(
          `## ${heading}`,
          "empty. Fill it in, or mark it n/a with one line saying why.",
        ),
      );
      continue;
    }

    if (/^n\/a$/i.test(section.content)) {
      failures.push(
        violation(
          `## ${heading}`,
          'marked "n/a" with no reason. One line saying why is required.',
        ),
      );
    }
  }

  const implementedBy = present.get(normaliseHeading("Implemented by"));
  const reviewedBy = present.get(normaliseHeading("Reviewed by"));
  if (implementedBy && reviewedBy) {
    const implementedModel = field(implementedBy.text, "Model");
    const implementedSession = field(implementedBy.text, "Session");
    const reviewedModel = field(reviewedBy.text, "Model");
    const reviewedSession = field(reviewedBy.text, "Session");

    if (reviewedModel === "" || reviewedSession === "") {
      failures.push(
        violation(
          "## Reviewed by",
          "both **Model:** and **Session:** must be filled in.",
        ),
      );
    } else if (
      reviewedModel.toLowerCase() === implementedModel.toLowerCase() &&
      reviewedSession.toLowerCase() === implementedSession.toLowerCase()
    ) {
      failures.push(
        violation(
          "## Reviewed by",
          "names the same model and the same session as ## Implemented by. A reviewer must be a " +
            "different model or a different session — an agent may not approve its own work " +
            "(AGENTS.md do-not 7).",
        ),
      );
    }
  }

  // F4: a diff we could not compute is a hard failure, never a quiet "nothing
  // touched". Both the security-review branch and the Screens-opened branch below
  // depend on the change set, so neither runs on a guess.
  let touched;
  let globs;
  let webTouched = false;
  try {
    ({ touched, globs } = await securitySurfaceTouched());
    webTouched = changedPaths().some((file) => file.startsWith("apps/web/"));
  } catch (error) {
    if (!(error instanceof DiffUnavailableError)) throw error;
    failures.push(violation("changed-file detection", error.message));
    finish({ name: NAME, failures, warnings, ok: "unreachable" });
    return;
  }
  const securityReview = present.get(normaliseHeading("Security review"));
  if (touched.length > 0 && securityReview) {
    const model = field(securityReview.text, "Model");
    if (!/^opus/i.test(model)) {
      failures.push(
        violation(
          "## Security review",
          `this pull request touches ${touched.length} security path(s) — ${touched.slice(0, 5).join(", ")}` +
            `${touched.length > 5 ? ", …" : ""} — so **Model:** must name Opus, and it names "${model || "(nothing)"}". ` +
            "Security review is Opus, always (CLAUDE.md). Never downgrade an unavailable reviewer: " +
            "stop, record what is unreviewed, add a Blocked entry to status.md.",
        ),
      );
    }

    const note = /docs\/07-planning\/security-reviews\/[^\s)>\]]+\.md/.exec(
      securityReview.text,
    );
    if (!note) {
      failures.push(
        violation(
          "## Security review",
          "**Note:** must link the committed review at docs/07-planning/security-reviews/<pr>-<slug>.md.",
        ),
      );
    } else if (!(await exists(path.join(repoRoot, note[0])))) {
      failures.push(
        violation(
          "## Security review",
          `the linked review ${note[0]} is not committed in this branch.`,
        ),
      );
    }
  } else if (touched.length === 0) {
    warnings.push(
      `no security-review path touched (${globs.length} globs from ci-cd.md checked).`,
    );
  }

  const screensOpened = present.get(normaliseHeading("Screens opened"));
  // F9: the old test stripped `n/a` and asked whether ANYTHING was left, so a bare
  // `n/a` failed but `n/a — no UI change` passed: the reason kept the section
  // non-empty. The message said the section "may not be n/a", so implementation and
  // message disagreed. When apps/web/** changed, ANY n/a form is rejected -- with or
  // without a reason -- because do-not 18 asks for the screens you actually opened,
  // and no reason substitutes for that.
  if (
    webTouched &&
    screensOpened &&
    effectivelyNotApplicable(screensOpened.text)
  ) {
    failures.push(
      violation(
        "## Screens opened",
        "apps/web/** changed, so this section may not be n/a. List every screen you actually " +
          "opened and used: route — viewport — what was clicked — screenshot (AGENTS.md do-not 18).",
      ),
    );
  }

  const gates = present.get(normaliseHeading("Gates"));
  if (gates) {
    for (const cells of gateRows(gates.text)) {
      const [gate, result, link] = cells;
      if (result === "") {
        failures.push(
          violation(
            "## Gates",
            `"${gate}" has no result. Use pass, n/a or waived.`,
          ),
        );
        continue;
      }
      if (!/^(pass|n\/a|waived)$/i.test(result)) {
        failures.push(
          violation(
            "## Gates",
            `"${gate}" reads "${result}". Only pass, n/a or waived are allowed.`,
          ),
        );
        continue;
      }
      if (/^waived$/i.test(result)) {
        // F7: `waived` used to need only a NON-EMPTY third cell, so
        // `| waived | see chat |` passed on all thirteen design gates. The message
        // claimed "Only Thomas may waive a gate" — an assertion this check cannot
        // make and must stop making: agents operate through the same repository
        // identity as Thomas, so nothing readable from a pull-request body proves a
        // human authorized anything.
        //
        // What IS enforceable is a durable, committed decision-log reference that
        // names the gate being waived. That does not prove who waived it; it means a
        // waiver leaves a reviewable record in version control instead of pointing at
        // a chat.
        const reference = /docs\/07-planning\/decision-log\.md(#[\w-]+)?/.exec(
          link ?? "",
        );
        if (!reference) {
          const shown = (link ?? "") === "" ? "empty" : `"${link}"`;
          failures.push(
            violation(
              "## Gates",
              `"${gate}" is waived and the link cell is ${shown}. A waiver must cite a ` +
                "committed entry in docs/07-planning/decision-log.md (optionally with " +
                "an #anchor). This check CANNOT verify who authored the waiver — " +
                "agents share the repository identity — so the durable record is the " +
                "whole control: no entry, no waiver.",
            ),
          );
          continue;
        }
        const logPath = path.join(repoRoot, "docs/07-planning/decision-log.md");
        if (!(await exists(logPath))) {
          failures.push(
            violation(
              "## Gates",
              `"${gate}" cites docs/07-planning/decision-log.md, which is not present ` +
                "in this branch.",
            ),
          );
          continue;
        }
        // The entry must correspond to THIS gate, not merely exist. Gate rows are
        // identified by their leading token (G1..G13), or by name when they have none.
        const decisionLog = await readText(logPath);
        const identifier = /^\s*(G\d+)\b/.exec(gate)?.[1] ?? gate;
        const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (!new RegExp(`\\b${escaped}\\b`, "i").test(decisionLog)) {
          failures.push(
            violation(
              "## Gates",
              `"${gate}" is waived citing the decision log, but no entry there ` +
                `mentions "${identifier}". A waiver has to name the gate it waives, or ` +
                "the citation is decoration.",
            ),
          );
        }
      }
    }
  }

  const checklists = present.get(normaliseHeading("Checklists"));
  if (!checklists) {
    // sections() already reports a missing fixed section, but the review blocker
    // deserves its own sentence rather than being one line in a list of headings.
    failures.push(
      violation(
        "## Checklists",
        "the section is absent, so the mandatory independent-review checkbox is absent " +
          "with it. That is not how the review gate is closed.",
      ),
    );
  }
  if (checklists) {
    // The template declares which ### blocks ship. It stays the single definition,
    // exactly as it already does for the H2 list above.
    const declaredChecklists = [];
    let insideChecklists = false;
    for (const line of template.split("\n")) {
      if (/^##\s+Checklists\s*$/.test(line)) {
        insideChecklists = true;
        continue;
      }
      if (!insideChecklists) continue;
      if (/^##\s+/.test(line)) break;
      const heading = /^###\s+(.*\S)\s*$/.exec(line);
      if (heading) declaredChecklists.push(heading[1]);
    }

    for (const problem of checklistPresenceProblems(
      checklists.raw,
      declaredChecklists,
    )) {
      failures.push(violation("## Checklists", problem));
    }

    for (const problem of checklistProblems(checklists.raw)) {
      failures.push(
        violation(
          "## Checklists",
          `${problem} An unticked box is a blocker, not a note.`,
        ),
      );
    }
  }

  finish({
    name: NAME,
    failures,
    warnings,
    ok: "every fixed section present and filled",
  });
}

await main();
