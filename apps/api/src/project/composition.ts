/**
 * Project composition rules that are WARNING-only (`projects-and-engagements.md`: "Every
 * rule below is warning-only by default -- the save succeeds and the violation appears as a
 * persistent banner on the project overview"). `PR-9` is blocking and lives with the
 * managed-service validation, not here.
 *
 * - `PR-6` exactly one project manager (`project.manager_id`);
 * - `PR-7` at least one team member (a project-scope roster row);
 * - `PR-10` a start date (end date optional).
 *
 * Pure so the rule set is unit-testable; the read path supplies the three facts.
 */

export const COMPOSITION_RULES = ["PR-6", "PR-7", "PR-10"] as const;
export type CompositionRule = (typeof COMPOSITION_RULES)[number];

export type CompositionFacts = {
  managerId: string | null;
  startDate: string | null;
  /** Number of project-scope roster rows. */
  memberCount: number;
};

export function compositionWarnings(
  facts: CompositionFacts,
): CompositionRule[] {
  const warnings: CompositionRule[] = [];
  if (facts.managerId === null) warnings.push("PR-6");
  if (facts.memberCount < 1) warnings.push("PR-7");
  if (facts.startDate === null) warnings.push("PR-10");
  return warnings;
}
