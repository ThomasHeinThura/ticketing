/**
 * Assignment — pure data types.
 *
 * Mirrors `work_item.assignee_id`, `project.default_assignee_id`,
 * `request_type.default_assignee_id`, `team`/`team_member` and `person.active`
 * (`docs/01-architecture/data-model.md`), and the `AS-n` rules of
 * [assignment.md](../../../../docs/03-features/assignment.md). `workspace_id`/`name`/
 * display concerns are database and UI concerns and never appear here — a person, a
 * roster and a work item are passed into this module as plain data, never loaded by it
 * (do-not 11's tables live in `data-model.md`; this file is the code shape of the rows
 * this module reasons about, not a second registration of them).
 *
 * **AS-15: round-robin and load-balanced auto-assignment are explicitly out of scope for
 * v2** ("They reward gaming and produce worse outcomes than a person looking at a
 * queue."). This module deliberately builds no assignment *strategy* — no round-robin
 * state machine, no least-open-items picker. What it does build is the per-person **open
 * work count** the person-picker screen displays (`assignment.md` § Screens: "avatar,
 * name, role on this project, and current open work count") — a read-only fact for a
 * human to look at, not an algorithm that assigns anyone.
 *
 * **A person id is never confused with a display name (`AS-6`).** Comparisons in this
 * module are always by `PersonId`; nothing here ever compares a name.
 */

/** A `person.id` — assignment stores this, never a display name (`AS-6`). */
export type PersonId = string;

/**
 * Everything this module needs to know about one candidate assignee's standing, resolved
 * by the caller from `person.active` and project/team membership (`data-model.md`
 * `person`, `team_member`). This module never queries either.
 */
export interface AssigneeStanding {
  personId: PersonId;
  /**
   * `person.active` — `AS-5`'s own text (added alongside its roster rule): "Only active
   * people (`person.active = true`) are eligible for any assignment, direct or default.
   * Assigning to a deactivated person is refused." `AS-8`'s retention rule is the other
   * side of this: an assignee who *becomes* inactive after being assigned stays assigned,
   * shown as inactive — this field is about eligibility for a *new* assignment, never
   * about clearing an existing one.
   */
  active: boolean;
  /** Whether `personId` is on the **project roster** (`AS-5`), not the whole directory. */
  onRoster: boolean;
}

/** Why a candidate is not eligible to be assigned — `AS-5`'s roster rule and its own active-person sentence (quoted on `AssigneeStanding.active`, above). */
export type IneligibilityReason = "not_on_roster" | "not_active";

/**
 * The result of `evaluateAssigneeEligibility`, below. `eligible: false` always carries
 * exactly one reason — never a list, since the caller (a refusal message, a "left
 * unassigned" flag) only ever needs to say one thing.
 */
export type EligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: IneligibilityReason };

/** One reason a planned assignment change is currently blocked or requires human confirmation before it is written — see `AssignmentPlan`. */
export type AssignmentAction = "assign" | "unassign" | "noop";

/**
 * What actually happens for one assignment change, and who is notified about it —
 * `AS-3`, `AS-16`, `AS-17`, `AS-18`, and the edge case "Assigning a work item already
 * assigned to you: No-op, no activity entry, no notification." `requiresConfirmation` is
 * `AS-3`'s own "asked to confirm" gate — see `planAssignment`'s doc comment for exactly
 * which changes that is (a member picking up work already held by someone else, and
 * only that): the caller must obtain that confirmation (already given, in an API call
 * that supplies it, or still pending) before writing anything when this is `true`.
 * `notify` is the ordered, deduplicated list of people to notify — always a subset of
 * `{previous holder, new assignee}`, never the actor themselves. `AS-18`'s own text:
 * "Assigning yourself does not notify you. `work_item.assigned` still emits (for
 * automations, webhooks and activity) — only the notification fan-out excludes the
 * actor." — and its new sentence, added alongside it: "The actor is never notified of
 * their own action, and this covers unassigning yourself as well as assigning
 * yourself." — which is why `notify` excludes the actor symmetrically on the unassign
 * path too (see `planAssignment`'s own doc comment).
 */
export interface AssignmentPlan {
  action: AssignmentAction;
  requiresConfirmation: boolean;
  notify: PersonId[];
}

/**
 * Display status for a stored `assignee_id`, resolved from the directory at read time
 * (`AS-7`) — see `resolveAssigneeDisplayStatus`. There is no "former member"/tombstoned
 * status: `AS-8` states plainly that "People are never hard-deleted — only deactivated
 * (`person.active = false`, `data-model.md`) — and `work_item.assignee_id` is `ON DELETE
 * RESTRICT`, so there is no delete path that could clear or cascade an assignment out
 * from under a work item." A deactivated person is `"inactive"`, never a fourth status.
 */
export type AssigneeDisplayStatus = "active" | "inactive" | "not_on_project";

/**
 * Facts about a stored `assignee_id`, all resolved by the caller (the impure edge,
 * reading `person`/`team_member`) before this module ever sees them — mirrors
 * `workflow/types.ts`'s `GuardContext` convention of "facts in, decision out."
 */
export interface AssigneeDisplayFacts {
  /** `person.active` (`AS-8`). */
  active: boolean;
  /** Still on the **project's** roster (`AS-5`) — distinct from `active`, which is directory-wide. */
  onProject: boolean;
}
