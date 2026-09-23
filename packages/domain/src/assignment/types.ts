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

import type { Effect } from "../workflow/types.js";

/** A `person.id` — assignment stores this, never a display name (`AS-6`). */
export type PersonId = string;

/**
 * Everything this module needs to know about one candidate assignee's standing, resolved
 * by the caller from `person.active` and project/team membership (`data-model.md`
 * `person`, `team_member`). This module never queries either.
 */
export interface AssigneeStanding {
  personId: PersonId;
  /** `person.active` — `AS-8`/`AS-9`/`AS-10`, and the default-assignee edge case. */
  active: boolean;
  /** Whether `personId` is on the **project roster** (`AS-5`), not the whole directory. */
  onRoster: boolean;
}

/** Why a candidate is not eligible to be assigned — `AS-5`'s roster rule and the active-person rules it generalises (`AS-8`, the default-assignee edge case). */
export type IneligibilityReason = "not_on_roster" | "not_active";

/**
 * The result of `evaluateAssigneeEligibility`, below. `eligible: false` always carries
 * exactly one reason — never a list, since the caller (a refusal message, a "left
 * unassigned" flag) only ever needs to say one thing.
 */
export type EligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: IneligibilityReason };

/**
 * `AS-13`'s two assignment-relevant effects, reusing `workflow/types.ts`'s own `Effect`
 * union member shapes verbatim (`Extract`) rather than redeclaring the vocabulary a
 * second time (do-not 11) — `set_assignee`/`clear_assignee` are named once, in
 * `workflow/types.ts`, and this module only narrows to the two kinds it resolves.
 */
export type AssignmentEffect = Extract<
  Effect,
  { kind: "set_assignee" } | { kind: "clear_assignee" }
>;

/**
 * The result of resolving a `set_assignee`/`clear_assignee` effect (`AS-13`) or a
 * default-assignee lookup (`AS-11`/`AS-12`) to an actual assignee, or the lack of one.
 * `"no_default"` is "no project or request-type default is configured"; `"default_inactive"`
 * is the edge case "Default assignee is inactive when a work item is created" — "Left
 * unassigned, and the project is flagged in settings." Flagging the project is the
 * caller's job; this module only names *why* the result came back empty so the caller
 * can decide whether to flag.
 */
export type DefaultAssigneeResolution =
  | { assigneeId: PersonId }
  | { assigneeId: null; reason: "no_default" | "default_inactive" };

/**
 * The outcome of a compare-and-swap self-assign attempt — "Two people self-assign
 * simultaneously; optimistic concurrency; the second is told who won" (edge cases table).
 * `expectedCurrentAssigneeId` is what the actor's client believed the assignee was when
 * it started the attempt; `actualCurrentAssigneeId` is what the row actually holds at
 * write time, read by the caller under the same transaction that would otherwise write
 * the actor's own id. A mismatch is a lost race, never a retry the caller can silently
 * paper over — the loser must be told who won.
 */
export type ConcurrentAssignResult =
  | { outcome: "success" }
  | { outcome: "conflict"; winnerId: PersonId | null };

/** One reason a planned assignment change is currently blocked or requires human confirmation before it is written — see `AssignmentPlan`. */
export type AssignmentAction = "assign" | "unassign" | "noop";

/**
 * What actually happens for one assignment change, and who is notified about it —
 * `AS-3`, `AS-16`, `AS-17`, `AS-18`, and the edge case "Assigning a work item already
 * assigned to you: No-op, no activity entry, no notification." `requiresConfirmation` is
 * `AS-3`'s "asked to confirm" gate: the caller must obtain that confirmation (already
 * given, in an API call that supplies it, or still pending) before writing anything when
 * this is `true`. `notify` is the ordered, deduplicated list of people to notify — always
 * a subset of `{previous holder, new assignee}`, never the actor themselves (`AS-18`,
 * generalised symmetrically to unassignment — see `planAssignment`'s own doc comment).
 */
export interface AssignmentPlan {
  action: AssignmentAction;
  requiresConfirmation: boolean;
  notify: PersonId[];
}

/** Display status for a stored `assignee_id`, resolved from the directory at read time (`AS-7`) — see `resolveAssigneeDisplayStatus`. */
export type AssigneeDisplayStatus =
  | "active"
  | "inactive"
  | "not_on_project"
  | "former_member";

/**
 * Facts about a stored `assignee_id`, all resolved by the caller (the impure edge,
 * reading `person`/`team_member`/the account-deletion tombstone) before this module ever
 * sees them — mirrors `workflow/types.ts`'s `GuardContext` convention of "facts in,
 * decision out."
 */
export interface AssigneeDisplayFacts {
  /** `person.active` (`AS-8`). Ignored when `accountDeleted` is true. */
  active: boolean;
  /** Still on the **project's** roster (`AS-5`) — distinct from `active`, which is directory-wide. */
  onProject: boolean;
  /** The person's account has been deleted; the assignment is tombstoned to "Former member" (edge cases table), not silently cleared (`AS-9`). */
  accountDeleted: boolean;
}

/** The result of resolving an assignee's standing after a project move (edge cases table: "Assigning across projects during a move"). */
export interface ProjectMoveAssignmentResult {
  assigneeId: PersonId | null;
  /** `true` when the assignment was cleared because the assignee is not on the destination roster — the caller warns the user first, before this decision is acted on. */
  cleared: boolean;
}
