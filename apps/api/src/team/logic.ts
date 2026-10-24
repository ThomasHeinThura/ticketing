/**
 * Team rules (feature-contracts-p4.md, "Teams"), kept pure so they can be unit tested.
 */

export const MAX_TEAM_NAME_LENGTH = 120;

/**
 * TM-3: who may edit a roster. `workspace:manage_settings` may; so may a lead of that very team.
 * The lead branch is for browser sessions only: an API key edits rosters through its owner's
 * `workspace:manage_settings` or not at all.
 */
export function rosterEditAllowed(input: {
  canManageSettings: boolean;
  isLeadOfTeam: boolean;
  credential: "session" | "api_key";
}): boolean {
  if (input.canManageSettings) return true;
  return input.isLeadOfTeam && input.credential === "session";
}

export type MemberCandidate = {
  side: string;
  active: boolean;
  userId: string | null;
};

/**
 * TM-2: only staff-side people may be team members. Returns a refusal message, or null when the
 * person is eligible. A person with no login (a placeholder) cannot be a member because
 * `team_member` references a user; a deactivated person cannot be added.
 */
export function memberRefusal(
  person: MemberCandidate | undefined,
  isWorkspaceMember: boolean,
): string | null {
  if (!person) return "Person not found";
  if (person.side !== "staff")
    return "Only staff can be team members; customer-side people are refused";
  if (person.userId === null)
    return "This person has no sign-in and cannot be a team member";
  if (!person.active) return "A deactivated person cannot be added to a team";
  if (!isWorkspaceMember) return "The person is not a member of this workspace";
  return null;
}

/** TM-7: reasons a team cannot be deleted yet; empty means it may go. */
export function teamDeletionBlockers(input: {
  isCab: boolean;
  sharedViewCount: number;
  ownedProjectCount: number;
}): string[] {
  const blockers: string[] = [];
  if (input.isCab)
    blockers.push("It is the CAB team. Designate another team first.");
  if (input.ownedProjectCount > 0)
    blockers.push(
      `It owns ${input.ownedProjectCount} project(s). Reassign them first.`,
    );
  if (input.sharedViewCount > 0)
    blockers.push(
      `${input.sharedViewCount} saved view(s) are shared with it. Reassign them first.`,
    );
  return blockers;
}

/** capacity_days_per_week: 0 to 7 days in tenths. */
export function validCapacity(value: number | null): boolean {
  if (value === null) return true;
  return (
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 7 &&
    Math.abs(value * 10 - Math.round(value * 10)) < 1e-9
  );
}
