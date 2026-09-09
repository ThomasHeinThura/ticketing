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
 * Three of the path-conditional decisions this file makes are answered by libraries
 * rather than inline, because each turned out to be answerable in a way that looked
 * right and was not:
 *
 *   lib/security-paths.mjs        GPT-F1 — the scope is the union of ci-cd.md's list at
 *                                 the merge base and at HEAD, so a diff that shrinks the
 *                                 list does not thereby escape it.
 *   lib/security-review-note.mjs  GPT-F2 — the committed note must name the head it
 *                                 reviewed, and nothing but review artefacts may have
 *                                 landed since.
 *   lib/gate-waiver.mjs           GPT-F4 — `waived` needs a declaration inside one
 *                                 anchored decision-log entry, bound to this gate, this
 *                                 pull request and a follow-up issue.
 *
 * Usage:
 *   node scripts/ci/check-pr-template.mjs --body <file>
 *   node scripts/ci/check-pr-template.mjs                # reads $GITHUB_EVENT_PATH
 *   node scripts/ci/check-pr-template.mjs --pr 19        # when no event payload exists
 */

import path from "node:path";
import {
  changedFiles,
  changedPaths,
  DiffUnavailableError,
} from "./lib/diff.mjs";
import { verifyWaiver } from "./lib/gate-waiver.mjs";
import { headAgreesWithPayload } from "./lib/head-binding.mjs";
import {
  checklistPresenceProblems,
  checklistProblems,
  declaredState,
  field,
  loadBody,
  loadPullRequestHead,
  loadPullRequestNumber,
  normaliseHeading,
  sections,
} from "./lib/pr-body.mjs";
import { exists, finish, readText, repoRoot, violation } from "./lib/repo.mjs";
import {
  CI_CD_RELATIVE_PATH,
  looksLikeHonoRouter,
  readSecurityReviewScope,
  SecurityScopeUnavailableError,
} from "./lib/security-paths.mjs";
import {
  BaselineHistoryUnavailableError,
  REVIEW_ARTEFACT_PREFIX,
  ReviewBindingUnavailableError,
  reviewBinding,
} from "./lib/security-review-note.mjs";
import {
  readTemplateScope,
  TEMPLATE_RELATIVE_PATH,
  TemplateScopeUnavailableError,
} from "./lib/template-scope.mjs";

const NAME = "pr-template";

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
  // GPT-F1: the scope is the UNION of ci-cd.md's list at the merge base and at HEAD, so
  // a diff that shrinks the list cannot thereby escape it. See lib/security-paths.mjs.
  const scope = await readSecurityReviewScope();
  // F4: let DiffUnavailableError propagate. The caller turns it into a hard failure
  // rather than an empty change set that reads as "nothing sensitive was touched".
  const changes = changedFiles();
  const touched = changedPaths(changes).filter((file) => scope.matches(file));

  // Every CHANGED .ts/.tsx file, not only added ones. This loop used to read
  // the ADDED-files list only, so **modifying** an existing router — adding a route to it,
  // or removing a middleware from one — matched nothing unless a path glob caught it.
  // "Any new route file" was the documented clause, but the risk is not confined to new
  // files: deleting `requireSessionOnly()` from an existing router is a bigger change
  // than adding a router. Found by an independent Opus audit of `main@5270954`.
  for (const file of changedPaths(changes)) {
    if (!/\.tsx?$/.test(file) || touched.includes(file)) {
      continue;
    }
    const absolute = path.join(repoRoot, file);
    if (!(await exists(absolute))) {
      // Deleted, or renamed away. A file that is gone cannot be read; the path globs
      // above have already had their say on it.
      continue;
    }
    if (looksLikeHonoRouter(await readText(absolute))) {
      touched.push(`${file} (declares a Hono router)`);
    }
  }

  return { touched, scope };
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

  // H1 + A1: the required-section list AND the required checklist-block list are each the
  // UNION of the template at the merge base and the template at HEAD. Reading either from
  // HEAD alone let a pull request delete a requirement and satisfy the checker by deleting
  // it — see lib/template-scope.mjs for the four outcomes and both reproductions. Fails
  // closed rather than guessing.
  let templateScope;
  try {
    templateScope = await readTemplateScope();
  } catch (error) {
    if (!(error instanceof TemplateScopeUnavailableError)) throw error;
    failures.push(violation("template requirement scope", error.message));
    finish({ name: NAME, failures, warnings, ok: "unreachable" });
    return;
  }
  const required = templateScope.sections.headings;
  const present = sections(body);

  // Narrowing the template is a governance act, so it is reported on the diff that does
  // it. The sections themselves stay required by the union above; this says WHY, so the
  // failure above does not read like an authoring slip.
  if (templateScope.sections.removed.length > 0) {
    failures.push(
      violation(
        TEMPLATE_RELATIVE_PATH,
        `this diff REMOVES ${templateScope.sections.removed.length} required section(s) ` +
          `from the template — ${templateScope.sections.removed
            .map((heading) => `## ${heading}`)
            .join(", ")}. ` +
          "Those sections remain required on this pull request: a requirement that applied " +
          "at the merge base cannot be deleted by the change being checked against it. " +
          "Removing them from the template is a change to land on main, reviewed on its " +
          "own terms, not a side effect of the pull request that benefits from it.",
      ),
    );
  }

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
  // H1: the distinctness check ran only `if (implementedBy && reviewedBy)`, so deleting
  // either section silenced it. The union above already requires both; this names the
  // CHECK the deletion would have removed, so an absence does not read as a missing
  // heading in a list.
  for (const [label, section] of [
    ["Implemented by", implementedBy],
    ["Reviewed by", reviewedBy],
  ]) {
    if (!section) {
      failures.push(
        violation(
          `## ${label}`,
          "absent, so the check that `## Reviewed by` names a DIFFERENT model and " +
            "session from `## Implemented by` cannot run. A reviewer who is the author " +
            "is not a reviewer, and deleting one of the two sections is not how that " +
            "gets established.",
        ),
      );
    }
  }
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
  // depend on the change set, so neither runs on a guess. GPT-F1 adds the second
  // undeterminable input: a merge base we cannot resolve means the union scope cannot be
  // computed, and that is equally not "nothing sensitive was touched".
  let touched;
  let scope;
  let webTouched = false;
  try {
    ({ touched, scope } = await securitySurfaceTouched());
    webTouched = changedPaths().some((file) => file.startsWith("apps/web/"));
  } catch (error) {
    if (error instanceof DiffUnavailableError) {
      failures.push(violation("changed-file detection", error.message));
    } else if (error instanceof SecurityScopeUnavailableError) {
      failures.push(violation("security-review scope", error.message));
    } else {
      throw error;
    }
    finish({ name: NAME, failures, warnings, ok: "unreachable" });
    return;
  }

  // GPT-F1, second half: narrowing the protected list is itself a security-sensitive
  // act. Union matching already keeps the narrowed-away paths in scope; this keeps the
  // requirement firing even if a future refactor moved the list somewhere the diff does
  // not touch, and it says out loud what was removed.
  if (scope.removed.length > 0) {
    warnings.push(
      `${scope.removed.length} security-review glob(s) REMOVED from ${CI_CD_RELATIVE_PATH} ` +
        `relative to the merge base ${scope.base.sha.slice(0, 9)} (${scope.base.ref}): ` +
        `${scope.removed.join(", ")}. Narrowing the protected list requires a review of ` +
        "the narrowing, and this pull request is measured against the UNION of the old " +
        "and the new list — a reduction does not take effect on the change that makes it.",
    );
  }
  if (scope.previous === null) {
    warnings.push(
      `${CI_CD_RELATIVE_PATH} does not exist at the merge base ` +
        `${scope.base.sha.slice(0, 9)} (${scope.base.ref}), so this branch bootstraps the ` +
        "security-review scope and only its current list applies.",
    );
  }

  const requiresReview = touched.length > 0 || scope.removed.length > 0;
  const securityReview = present.get(normaliseHeading("Security review"));
  // H1: this was `if (requiresReview && securityReview)`. When a review IS required, the
  // ABSENCE of the section is the strongest failure available, not a reason to skip the
  // Opus-model assertion and the committed-note requirement. Reproduced: remove the
  // section from the body AND from the template in one commit, touch scripts/ci/**, tick
  // the author-visible checkbox — the old checker exited 0.
  if (requiresReview && !securityReview) {
    failures.push(
      violation(
        "## Security review",
        `this pull request touches ${touched.length} security path(s) and carries NO ` +
          "`## Security review` section. That is not an exemption, it is the requirement " +
          "deleted. Security review is Opus, always (CLAUDE.md), and it needs a committed " +
          "note at docs/07-planning/security-reviews/<pr>-<slug>.md. Restore the section.",
      ),
    );
  }
  if (requiresReview && securityReview) {
    const why =
      touched.length > 0
        ? `touches ${touched.length} security path(s) — ${touched.slice(0, 5).join(", ")}` +
          `${touched.length > 5 ? ", …" : ""}`
        : `removes ${scope.removed.length} glob(s) from the security-review list ` +
          `(${scope.removed.join(", ")})`;

    const model = field(securityReview.text, "Model");
    if (!/^opus/i.test(model)) {
      failures.push(
        violation(
          "## Security review",
          `this pull request ${why} — so **Model:** must name Opus, and it names ` +
            `"${model || "(nothing)"}". ` +
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
    } else {
      // GPT-F2: existence is not currency. The note must name the head it reviewed, that
      // head must be in this branch, and nothing but review artefacts may have landed
      // since. See lib/security-review-note.mjs for the four rules and why prose SHAs
      // are not parsed.
      try {
        // Bind to the pull request's OWN head, not `HEAD`. In CI `HEAD` is
        // `refs/pull/N/merge`, a synthetic merge whose base-side diff re-expresses the
        // whole branch as "landed after the reviewed head" — see
        // lib/pr-body.mjs § loadPullRequestHead. Falls back to `HEAD` only where that
        // genuinely IS the branch head (local runs, push events).
        let prHead = null;
        try {
          prHead = await loadPullRequestHead({
            eventPath: process.env.GITHUB_EVENT_PATH,
          });
        } catch (error) {
          // Typed, so the caller below COLLECTS it with every other template failure
          // instead of the process dying on an untyped throw and reporting nothing else.
          // Still fail-closed: a collected failure is a non-zero exit.
          throw new ReviewBindingUnavailableError(error.message);
        }

        // M-1, from the independent delta review of 074aae3: the payload SHA was trusted
        // without being checked against the checkout, so a payload naming an EARLIER
        // commit on the branch — the reviewed head itself, or the note commit — would
        // make a stale note pass. Reachable only by controlling the payload, which
        // already requires editing files inside the security-review list, so the trust
        // boundary was unchanged; but it was newly WIDENED, and that is worth closing
        // rather than arguing about.
        //
        // `refs/pull/N/merge` has exactly two parents: the base tip first, the pull
        // request's head second. So when HEAD is a merge, the claimed head must be its
        // SECOND parent SPECIFICALLY (C-2 — accepting any parent let a payload naming the
        // base tip through) — see lib/head-binding.mjs for the full reasoning, including
        // why a non-merge HEAD is checked too even though it cannot occur in this
        // repository's CI today (C-1), and why a git failure here refuses rather than
        // silently reading as "not a merge" (C-3).
        if (prHead !== null) {
          const agreement = headAgreesWithPayload(repoRoot, prHead);
          if (!agreement.agrees) {
            throw new ReviewBindingUnavailableError(
              `${agreement.reason} A payload that disagrees with the tree cannot be used ` +
                "to decide which code was reviewed — it would let an earlier or unrelated " +
                "commit stand in for the head and revive a stale note.",
            );
          }
        }
        const binding = reviewBinding({
          notePath: note[0],
          noteSource: await readText(path.join(repoRoot, note[0])),
          ...(prHead === null ? {} : { head: prHead }),
        });
        if (binding.kind === "unbound") {
          failures.push(violation("## Security review", binding.reason));
        } else {
          warnings.push(
            `${note[0]} is bound to reviewed head ${binding.head.slice(0, 9)}; nothing ` +
              `outside ${REVIEW_ARTEFACT_PREFIX} has changed since.`,
          );
        }
      } catch (error) {
        if (
          !(error instanceof ReviewBindingUnavailableError) &&
          !(error instanceof BaselineHistoryUnavailableError)
        ) {
          throw error;
        }
        failures.push(violation("## Security review", error.message));
      }
    }
  } else if (!requiresReview) {
    warnings.push(
      `no security-review path touched (${scope.globs.length} glob(s) checked — the union ` +
        `of ${(scope.previous ?? []).length} at the merge base and ${scope.current.length} ` +
        `at HEAD, from ${CI_CD_RELATIVE_PATH}).`,
    );
  }

  const screensOpened = present.get(normaliseHeading("Screens opened"));
  // F9: the original test stripped `n/a` and asked whether ANYTHING was left, so a bare
  // `n/a` failed but `n/a — no UI change` passed: the reason kept the section non-empty.
  //
  // F9 RESIDUAL: the replacement matched the token `n/a` ANYWHERE in the section, and so
  // rejected the one honest sentence a careful author writes — "I am not marking this n/a
  // — that would misrepresent a real gap" — reading a negation as an assertion. The
  // section's state now comes from its FIRST meaningful line, the way a status field is
  // read, and prose that merely mentions `n/a` later carries no state. See
  // lib/pr-body.mjs § declaredState for why this is structural rather than linguistic.
  // H1: same shape. With apps/web/** changed, an ABSENT `## Screens opened` must fail
  // rather than skip the rule that rejects every n/a form in it.
  if (webTouched && !screensOpened) {
    failures.push(
      violation(
        "## Screens opened",
        "apps/web/** changed and there is NO `## Screens opened` section. Deleting the " +
          "section does not answer what it asks (AGENTS.md do-not 18): which routes you " +
          "opened, at what viewport, and what you clicked.",
      ),
    );
  }
  if (webTouched && screensOpened) {
    const declared = declaredState(screensOpened.text);
    const complaint =
      declared.state === "not-applicable"
        ? `it declares "${declared.first}". apps/web/** changed, so this section may not be ` +
          "n/a — with or without a reason. List every screen you actually opened and " +
          "used: route — viewport — what was clicked — screenshot (AGENTS.md do-not 18). " +
          "If you genuinely could not open them, say so with `BLOCKED — <why>` and name " +
          "the screens you did not open. That is accepted here as an honest gap; it is " +
          "not a pass on the rest of the template."
        : declared.state === "blocked-bare"
          ? `it declares "${declared.first}" with nothing substantive after it. A BLOCKED ` +
            "declaration is accepted, but it has to say what blocked you and which " +
            "screens went unopened — a bare marker is a bare n/a wearing a different word."
          : declared.state === "empty"
            ? "empty. apps/web/** changed, so list every screen you actually opened and " +
              "used: route — viewport — what was clicked — screenshot (AGENTS.md do-not " +
              "18), or declare `BLOCKED — <why>`."
            : null;

    if (complaint !== null) {
      failures.push(violation("## Screens opened", complaint));
    } else if (declared.state === "blocked") {
      // Accepted by the parser, and said out loud so nobody reads it as readiness.
      warnings.push(
        "## Screens opened declares BLOCKED with an explanation, which this check " +
          "accepts as an honest gap rather than a false n/a (F9 residual). It is NOT a " +
          "readiness signal: the screens were not opened, AGENTS.md do-not 18 is not " +
          "satisfied, and every other requirement in this template still applies.",
      );
    }
  }

  const gates = present.get(normaliseHeading("Gates"));
  // H1: an absent `## Gates` silenced the pass/n-a/waived validation AND the waiver
  // binding to a committed decision-log entry. The union requires the section; this
  // names the lost checks.
  if (!gates) {
    failures.push(
      violation(
        "## Gates",
        "absent, so nothing validates the gate results and nothing binds a `waived` row " +
          "to a committed decision-log entry. A gate table that does not exist is not a " +
          "table of passing gates.",
      ),
    );
  }
  if (gates) {
    // GPT-F4: a waiver is scoped to one pull request, so the number is an input to the
    // check rather than decoration. Resolved once, whether or not any row is waived.
    const pullRequest = await loadPullRequestNumber({
      number: argValue("--pr"),
      eventPath: process.env.GITHUB_EVENT_PATH,
      ref: process.env.GITHUB_REF,
    });
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
        // F7 replaced "any non-empty third cell" with "cites the decision log and the
        // gate identifier appears somewhere in it". GPT-F4 showed the second half is a
        // false control: the `#anchor` was optional, the identifier was searched across
        // the WHOLE 1,400-line document, and the sentence "G1 is not waived" satisfied
        // it. So the binding moved from prose to a declaration — a specific entry, this
        // gate, this pull request, a follow-up issue. lib/gate-waiver.mjs carries the
        // syntax, the adversarial case and the honest statement of what is still not
        // enforceable (who authored it).
        const decisionLogRelative = "docs/07-planning/decision-log.md";
        const logPath = path.join(repoRoot, decisionLogRelative);
        const verdict = verifyWaiver({
          gate,
          link,
          decisionLog: (await exists(logPath)) ? await readText(logPath) : null,
          decisionLogPath: decisionLogRelative,
          pullRequest,
        });
        if (!verdict.ok) {
          failures.push(violation("## Gates", verdict.problem));
          continue;
        }
        warnings.push(
          `"${gate}" waived by ${decisionLogRelative}#${verdict.anchor}, scoped to ` +
            `PR #${pullRequest}, follow-up #${verdict.followUp}. Who authorised it is ` +
            "NOT machine-verifiable and is not claimed — Thomas confirms that at merge.",
        );
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
  // A1: which ### blocks ship is the UNION across the merge base and HEAD, for the same
  // reason the H2 list is. This block used to parse the working-tree template inline,
  // under a comment claiming it stayed "the single definition, exactly as it already does
  // for the H2 list above" — which H1 had just made false. Deleting `### Backend change`
  // from the template and the body in one diff dropped "every new or changed route has a
  // policy entry" and "Opus security review completed and recorded" from the requirements
  // of the pull request doing the deleting. Reported whether or not `## Checklists`
  // survived in the body, because the removal is the governance act either way.
  if (templateScope.checklists.removed.length > 0) {
    failures.push(
      violation(
        TEMPLATE_RELATIVE_PATH,
        `this diff REMOVES ${templateScope.checklists.removed.length} required checklist ` +
          `block(s) from the template — ${templateScope.checklists.removed
            .map((heading) => `### ${heading}`)
            .join(", ")}. ` +
          "Those checklists remain required on this pull request. A checklist that does " +
          "not apply is marked n/a with one line saying why; deleting it removes the " +
          "record that it was considered, and deleting it from the template in the same " +
          "diff removes the requirement to consider it at all.",
      ),
    );
  }

  if (checklists) {
    for (const problem of checklistPresenceProblems(
      checklists.raw,
      templateScope.checklists.headings,
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
