/**
 * Intake — IQ-8 description rendering and IQ-18 duplicate similarity scoring.
 *
 * The two unit areas `intake-queue.md`'s Testing section still demands beyond the state
 * machine: "field mapping from form data to work item; duplicate similarity scoring".
 * Pure: no I/O, no Tiptap parsing, no clock. The API slice passes in plain-text
 * candidates (title + already-extracted description text) because `work_item.description`
 * is Tiptap JSON and this module deliberately knows nothing about its structure.
 *
 * IQ-18 says only "text similarity over recent work items in the same organisation.
 * Suggestions only — the decision is human." The algorithm and threshold are therefore
 * implementation details, not spec contracts: this uses the Sørensen–Dice coefficient
 * over character bigrams of lowercased, punctuation-stripped text — a deterministic
 * standard that matches on word order-insensitively and tolerates the small typos
 * customers actually make. Flagged as an implementation choice in the PR body.
 */

import type { FormSchema, FormValue } from "./types.js";

/** The heading the unmapped values render under (IQ-8: "under a clear heading"). */
export const UNMAPPED_HEADING = "Additional details";

/** A candidate for duplicate suggestion: ids and plain text only. */
export interface DuplicateCandidate {
  readonly id: string;
  readonly title: string;
  /** Plain text (the caller extracts it from Tiptap JSON before calling). */
  readonly description?: string;
}

export interface DuplicateSuggestion {
  readonly id: string;
  /** 0…1. Above the threshold the caller chose; sorted descending by the scorer. */
  readonly score: number;
}

/**
 * IQ-8: render the form values that were NOT mapped onto native/custom fields into the
 * description fragment the acceptance path appends under a clear heading. File fields
 * are attachments, not text (IQ-9 handles them separately) and are skipped; empty and
 * hidden-unanswered values are skipped so the heading does not appear for nothing.
 * The caller decides whether this replaces or appends to an existing description —
 * this function only produces the fragment.
 */
export function renderUnmappedIntoDescription(
  schema: FormSchema,
  data: Readonly<Record<string, FormValue>>,
): string {
  const lines: string[] = [];
  for (const field of schema.fields) {
    if (field.type === "file") continue;
    if (field.mapsTo !== undefined) continue; // RT-3: mapped fields live in their columns.
    // Own-property lookup (M1): an inherited key like `toString` must not count as an
    // answer just because `data["toString"]` resolves via the prototype chain.
    const value = Object.hasOwn(data, field.key) ? data[field.key] : undefined;
    if (value === undefined || value === null) continue;
    const rendered = renderValue(value);
    if (rendered === "") continue;
    lines.push(`- **${field.label}:** ${rendered}`);
  }
  if (lines.length === 0) return "";
  return `## ${UNMAPPED_HEADING}\n\n${lines.join("\n")}`;
}

function renderValue(value: FormValue): string {
  if (Array.isArray(value)) {
    return value
      .map((v) => renderValue(v))
      .filter((s) => s !== "")
      .join(", ");
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value).trim();
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i++) {
    const gram = text.slice(i, i + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

/** Sørensen–Dice over character bigrams, 0…1. Order-insensitive, typo-tolerant. */
export function similarityScore(a: string, b: string): number {
  const left = normalise(a);
  const right = normalise(b);
  if (left === "" || right === "") return 0;
  if (left === right) return 1;
  const gramsA = bigrams(left);
  const gramsB = bigrams(right);
  let overlap = 0;
  for (const [gram, countA] of gramsA) {
    const countB = gramsB.get(gram);
    if (countB !== undefined) overlap += Math.min(countA, countB);
  }
  const totalA = [...gramsA.values()].reduce((sum, n) => sum + n, 0);
  const totalB = [...gramsB.values()].reduce((sum, n) => sum + n, 0);
  return (2 * overlap) / (totalA + totalB);
}

/**
 * IQ-18: score each candidate against the submission's text and return those at or
 * above `threshold`, best first. "Suggestions only — the decision is human": callers
 * must never auto-act on this output. Deterministic; ties break by input order.
 */
export function duplicateSuggestions(
  query: string,
  candidates: readonly DuplicateCandidate[],
  threshold = 0.35,
): readonly DuplicateSuggestion[] {
  const scored: readonly DuplicateSuggestion[] = candidates
    .map((candidate, index) => ({
      id: candidate.id,
      index,
      score: similarityScore(
        query,
        `${candidate.title} ${candidate.description ?? ""}`,
      ),
    }))
    .filter((s) => s.score >= threshold)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ id, score }) => ({ id, score }));
  return scored;
}
