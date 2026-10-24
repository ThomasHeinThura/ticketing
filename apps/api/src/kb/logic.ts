/** Pure knowledge base rules (KB-2, KB-4, KB-7, KB-9). No database, no clock. */

export type ArticleState = "draft" | "in_review" | "published" | "archived";
export type ArticleAction =
  | "submit"
  | "publish"
  | "unpublish"
  | "archive"
  | "restore";

export class TransitionError extends Error {}

/**
 * Where an action leads from a state, or why it is refused. KB-4: with the review step on, a
 * draft or archived article is submitted and a reviewer (the `kb_article:publish` holder)
 * publishes it from `in_review`. An already published article is republished by a publisher
 * directly, because moving it back to review would take it off the portal. With the step off
 * a publisher publishes from any state but archived articles must be restored to draft first.
 */
export function nextState(
  from: ArticleState,
  action: ArticleAction,
  reviewStepEnabled: boolean,
): ArticleState {
  switch (action) {
    case "submit":
      if (!reviewStepEnabled)
        throw new TransitionError("This workspace has no review step");
      if (from === "draft" || from === "archived") return "in_review";
      throw new TransitionError(`A ${from} article cannot be submitted`);
    case "publish":
      if (from === "published") return "published";
      if (from === "in_review") return "published";
      if (from === "draft" && !reviewStepEnabled) return "published";
      if (from === "draft")
        throw new TransitionError("Submit the article for review first");
      throw new TransitionError("Restore an archived article to draft first");
    case "unpublish":
      if (from === "published" || from === "in_review") return "draft";
      throw new TransitionError(`A ${from} article is not published`);
    case "archive":
      if (from === "archived")
        throw new TransitionError("The article is already archived");
      return "archived";
    case "restore":
      if (from === "archived") return "draft";
      throw new TransitionError(`A ${from} article is not archived`);
  }
}

/** Search terms: lower-cased words, at most eight, none empty. */
export function searchTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[\s,.;:!?()[\]{}"']+/)
        .map((term) => term.trim())
        .filter((term) => term.length > 0),
    ),
  ].slice(0, 8);
}

export const MIN_DEFLECTION_QUERY_LENGTH = 3;

/** Deflection suggestions only start once the summary has some substance (KB-8). */
export function deflectionQuery(query: string): string | null {
  const trimmed = query.trim().slice(0, 500);
  return trimmed.length >= MIN_DEFLECTION_QUERY_LENGTH ? trimmed : null;
}

/** KB-7: a review date in the past is overdue. */
export function reviewOverdue(reviewDueAt: Date | null, now: Date): boolean {
  return reviewDueAt !== null && reviewDueAt.getTime() < now.getTime();
}

export function snippet(text: string, length = 160): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= length) return collapsed;
  return `${collapsed.slice(0, length - 1).trimEnd()}…`;
}
