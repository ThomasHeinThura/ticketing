#!/usr/bin/env node
/**
 * What the pull-request template REQUIRES — evaluated against BOTH the merge base and HEAD.
 *
 * **H1 — the template was read only from HEAD.** `check-pr-template` derived its required
 * headings from `.github/pull_request_template.md` in the working tree: the template the
 * same diff had just written. So a pull request could delete a requirement and satisfy the
 * checker by deleting it, in one commit:
 *
 *   1. remove `## Security review` from the pull-request body;
 *   2. remove the same section from `.github/pull_request_template.md`;
 *   3. edit `scripts/ci/**` — a security-review path;
 *   4. tick the author-visible review checkbox.
 *
 * The checker exited GREEN: no Opus model asserted, no committed review note, no binding.
 * The requirement was not satisfied, it was deleted, and the deletion was invisible
 * because CI does not diff the body and the template no longer asked for it.
 *
 * This is GPT-F1 one level up. F15 closed "the gate cannot see changes to itself"; F1
 * closed "the scope may be narrowed by the diff being scoped"; H1 closes "the section list
 * may be narrowed by the diff being checked". Same defect, same fix: union semantics.
 *
 * **A1 — the H2 list became a union and the CHECKLIST list did not.** H1 fixed one of the
 * two things this template declares. `check-pr-template` went on deriving the required
 * `### ` checklist blocks from the working-tree template alone, under a comment claiming it
 * "stays the single definition, exactly as it already does for the H2 list above" — which
 * had just stopped being true. So the identical bypass survived one level down: delete
 * `### Backend change` from the template and from the body in one diff, and the checklist
 * that carries "every new or changed route has a policy entry" and "Opus security review
 * completed and recorded" stops being required by the pull request that deletes it.
 *
 * Both lists are therefore computed here, from the same two template revisions and one
 * merge-base resolution. A requirement is required when the template requires it at the
 * merge base **or** at HEAD.
 *
 * The merge-base template is not something the change can rewrite — the argument
 * `lib/git-baseline.mjs` makes for the ratchets and `lib/security-paths.mjs` makes for the
 * scope — so ADDING a requirement takes effect immediately, and REMOVING one does not take
 * effect on the pull request that performs the removal. Removal is still allowed; it simply
 * cannot be self-authorising.
 *
 * `removed` carries the second half. Narrowing the template is itself a governance act, so
 * the caller can require what was dropped to still be present and filled in on the diff
 * that drops it.
 *
 * Four outcomes, and only one of them skips the merge-base half:
 *
 *   resolved + template present     -> union of both revisions.
 *   resolved + template absent      -> bootstrap: the branch introduces the template, so
 *                                      there is no previous list. HEAD list only.
 *   resolved + template unparseable -> FAIL CLOSED. The file exists at the base and its
 *                                      requirements cannot be computed, which is exactly
 *                                      the blind spot.
 *   unresolved merge base           -> FAIL CLOSED. Same refusal as the ratchets and the
 *                                      security scope: "could not run" is not "found
 *                                      nothing".
 */

import path from "node:path";
import {
  BaselineHistoryUnavailableError,
  readTextAtCommit,
  resolveMergeBase,
} from "./git-baseline.mjs";
import { normaliseHeading, sections } from "./pr-body.mjs";
import { readText, repoRoot } from "./repo.mjs";

export const TEMPLATE_RELATIVE_PATH = ".github/pull_request_template.md";
export const templatePath = path.join(repoRoot, TEMPLATE_RELATIVE_PATH);

export class TemplateScopeUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "TemplateScopeUnavailableError";
  }
}

/**
 * The H2 headings a template declares, in document order.
 *
 * Throws when the document declares none. A template with no fixed sections is
 * indistinguishable from "every requirement was deleted", so it is never an empty list.
 */
export function parseTemplateSections(source, origin = TEMPLATE_RELATIVE_PATH) {
  const headings = [...sections(source).values()].map(
    (section) => section.heading,
  );
  if (headings.length === 0) {
    throw new TemplateScopeUnavailableError(
      `${origin} declares no \`## \` sections. An empty template is not a template with ` +
        "no requirements — it is every requirement deleted at once, which is the H1 " +
        "bypass. If the template is genuinely being replaced, that is a change Thomas " +
        "makes on main, not one a pull request makes about itself.",
    );
  }
  return headings;
}

/**
 * The `### ` checklist blocks a template declares inside its `## Checklists` section, in
 * document order.
 *
 * Deliberately NOT a throw-on-empty, unlike the H2 list above, and the asymmetry is the
 * point. `## Checklists` missing from one revision of the template is a normal half of the
 * union — the bootstrap case, and the deletion case this function exists to defeat — and it
 * must reach the caller as "this revision declares nothing" so the OTHER revision's list
 * survives. Throwing here would convert the deletion the union is meant to neutralise into
 * a scope error, which reports the wrong thing and, worse, reports it as a checkout problem.
 *
 * A union that is empty on BOTH sides cannot be produced by a pull request: `main`'s
 * template declares eight blocks, and a revision where the file does not exist at all is
 * already handled as bootstrap. If it ever happens anyway, `checklistPresenceProblems`
 * still enforces its unconditional protections — at least one block carrying checkboxes,
 * and exactly one independent-review checkbox — so the review gate does not rest on this
 * list being non-empty.
 */
export function parseChecklistBlocks(source) {
  const headings = [];
  let inside = false;
  for (const line of source.split("\n")) {
    if (/^##\s+Checklists\s*$/.test(line)) {
      inside = true;
      continue;
    }
    if (!inside) continue;
    if (/^##\s+/.test(line)) break;
    const heading = /^###\s+(.*\S)\s*$/.exec(line);
    if (heading) headings.push(heading[1]);
  }
  return headings;
}

/** The union of two heading lists, plus what the second one dropped. */
function unionOf(previous, current) {
  const seen = new Map();
  for (const heading of [...(previous ?? []), ...current]) {
    const key = normaliseHeading(heading);
    if (!seen.has(key)) seen.set(key, heading);
  }

  const currentKeys = new Set(current.map(normaliseHeading));
  const removed = (previous ?? []).filter(
    (heading) => !currentKeys.has(normaliseHeading(heading)),
  );

  return {
    headings: [...seen.values()],
    removed,
    current,
    previous,
    isRequired: (heading) => seen.has(normaliseHeading(heading)),
  };
}

/**
 * @typedef {{
 *   headings: string[],
 *   removed: string[],
 *   current: string[],
 *   previous: string[] | null,
 *   isRequired: (heading: string) => boolean,
 * }} HeadingUnion
 *
 * @returns {Promise<{
 *   sections: HeadingUnion,
 *   checklists: HeadingUnion,
 *   base: { ref: string, sha: string },
 * }>}
 */
export async function readTemplateScope() {
  const currentSource = await readText(templatePath);
  const currentSections = parseTemplateSections(
    currentSource,
    `${TEMPLATE_RELATIVE_PATH} (working tree)`,
  );
  const currentChecklists = parseChecklistBlocks(currentSource);

  const base = resolveMergeBase();
  if (base.kind === "unresolved") {
    throw new TemplateScopeUnavailableError(
      `cannot resolve a merge base for ${TEMPLATE_RELATIVE_PATH} (tried ` +
        `${base.triedRefs.join(", ")}). The required sections AND the required checklist ` +
        "blocks are the UNION of the template at the merge base and the template at HEAD, " +
        "because a pull request that deletes a requirement must not thereby escape it " +
        "(H1, A1). Proving what the template used to require needs that history, and a " +
        "shallow single-branch checkout has none. This does NOT mean every requirement is " +
        "met: it means the requirement could not be computed. Use `fetch-depth: 0`, or " +
        "`git fetch origin main`, and run it again.",
    );
  }

  let previousSections = null;
  let previousChecklists = null;
  let source;
  try {
    source = readTextAtCommit(base.sha, TEMPLATE_RELATIVE_PATH);
  } catch (error) {
    if (!(error instanceof BaselineHistoryUnavailableError)) throw error;
    throw new TemplateScopeUnavailableError(error.message);
  }

  if (source !== null) {
    try {
      previousSections = parseTemplateSections(
        source,
        `${TEMPLATE_RELATIVE_PATH} at the merge base ${base.sha}`,
      );
    } catch (error) {
      throw new TemplateScopeUnavailableError(
        `${TEMPLATE_RELATIVE_PATH} exists at the merge base ${base.sha} (${base.ref}) ` +
          `but its section list could not be read: ${error.message} The previous list ` +
          "is half of the union this gate is evaluated against, so a template that " +
          "exists and cannot be parsed is a hard failure rather than an empty previous " +
          "list — an empty previous list would let a deleting change measure itself " +
          "against its own output, which is the H1 bypass.",
      );
    }
    previousChecklists = parseChecklistBlocks(source);
  }

  return {
    sections: unionOf(previousSections, currentSections),
    checklists: unionOf(previousChecklists, currentChecklists),
    base: { ref: base.ref, sha: base.sha },
  };
}
