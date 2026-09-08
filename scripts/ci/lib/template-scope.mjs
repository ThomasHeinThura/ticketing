#!/usr/bin/env node
/**
 * The set of fixed sections a pull request must carry — evaluated against BOTH the
 * merge base and HEAD.
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
 * A section is required when the template requires it at the merge base **or** at HEAD.
 * The merge-base template is not something the change can rewrite — the argument
 * `lib/git-baseline.mjs` makes for the ratchets and `lib/security-paths.mjs` makes for the
 * scope — so ADDING a required section takes effect immediately, and REMOVING one does not
 * take effect on the pull request that performs the removal. Removal is still allowed; it
 * simply cannot be self-authorising.
 *
 * `removed` carries the second half. Narrowing the template is itself a governance act, so
 * the caller can require the sections that were dropped to still be present and filled in
 * on the diff that drops them.
 *
 * Four outcomes, and only one of them skips the merge-base half:
 *
 *   resolved + template present     -> union of both heading lists.
 *   resolved + template absent      -> bootstrap: the branch introduces the template, so
 *                                      there is no previous list. HEAD list only.
 *   resolved + template unparseable -> FAIL CLOSED. The file exists at the base and its
 *                                      section list cannot be computed, which is exactly
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
 * @returns {Promise<{
 *   headings: string[],
 *   removed: string[],
 *   current: string[],
 *   previous: string[] | null,
 *   base: { ref: string, sha: string },
 *   isRequired: (heading: string) => boolean,
 * }>}
 */
export async function readRequiredSectionsScope() {
  const current = parseTemplateSections(
    await readText(templatePath),
    `${TEMPLATE_RELATIVE_PATH} (working tree)`,
  );

  const base = resolveMergeBase();
  if (base.kind === "unresolved") {
    throw new TemplateScopeUnavailableError(
      `cannot resolve a merge base for ${TEMPLATE_RELATIVE_PATH} (tried ` +
        `${base.triedRefs.join(", ")}). The required-section list is the UNION of the ` +
        "template at the merge base and the template at HEAD, because a pull request " +
        "that deletes a required section must not thereby escape it (H1). Proving what " +
        "the template used to require needs that history, and a shallow single-branch " +
        "checkout has none. This does NOT mean every section is present: it means the " +
        "requirement could not be computed. Use `fetch-depth: 0`, or " +
        "`git fetch origin main`, and run it again.",
    );
  }

  let previous = null;
  let source;
  try {
    source = readTextAtCommit(base.sha, TEMPLATE_RELATIVE_PATH);
  } catch (error) {
    if (!(error instanceof BaselineHistoryUnavailableError)) throw error;
    throw new TemplateScopeUnavailableError(error.message);
  }

  if (source !== null) {
    try {
      previous = parseTemplateSections(
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
  }

  const seen = new Map();
  for (const heading of [...(previous ?? []), ...current]) {
    const key = normaliseHeading(heading);
    if (!seen.has(key)) seen.set(key, heading);
  }
  const headings = [...seen.values()];

  const currentKeys = new Set(current.map(normaliseHeading));
  const removed = (previous ?? []).filter(
    (heading) => !currentKeys.has(normaliseHeading(heading)),
  );

  return {
    headings,
    removed,
    current,
    previous,
    base: { ref: base.ref, sha: base.sha },
    isRequired: (heading) => seen.has(normaliseHeading(heading)),
  };
}
