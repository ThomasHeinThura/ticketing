import { z } from "../openapi";

export const capabilitiesResponseSchema = z
  .object({
    manageProjects: z.boolean(),
    createProjects: z.boolean(),
    updateProjects: z.boolean(),
    deleteProjects: z.boolean(),
    updateTasks: z.boolean(),
    createTasks: z.boolean(),
    deleteTasks: z.boolean(),
    assignTasks: z.boolean(),
    createLabels: z.boolean(),
    updateLabels: z.boolean(),
    deleteLabels: z.boolean(),
    manageWorkspace: z.boolean(),
    deleteWorkspace: z.boolean(),
    inviteUsers: z.boolean(),
    manageTeam: z.boolean(),
    removeMembers: z.boolean(),
  })
  .openapi("Capabilities");

/**
 * The DISTINGUISHABLE refusal — issue #82's "and does so *distinguishably*, so an operator
 * can tell 'malformed membership row' from 'role has no such capability'".
 *
 * Before this existed, a member whose `workspace_member.role` held `"owner,admin"` got a
 * 200 carrying the ordinary sixteen-key map with every value `false` — byte-identical to
 * the answer a correctly-assigned `viewer` gets when correctly denied the same sixteen
 * checks. The two states are not the same and must not look the same: one is authorization
 * working, the other is a corrupt row that no amount of correct role assignment will fix
 * and that the caller can do nothing about. Support cannot triage what it cannot see, and
 * "the UI shows nothing" is the same symptom for both.
 *
 * **Why 409 and not 403.** A 403 says "you may not"; that is the true answer for the viewer
 * and a misleading one here, because the caller's PRIVILEGES are not the problem — the
 * stored state is. 409 Conflict says the request cannot be served because the resource's
 * state conflicts with an invariant, which is exactly what a membership row holding two
 * roles is. It is also a status the client's existing capability hook cannot mistake for a
 * routine denial.
 *
 * **This is not a leak.** It names the shape of the fault, never the role names in the
 * corrupt value: `problem` is one of three fixed words. A caller learns that their own
 * membership row is malformed — which is about them, and which they must be told in order
 * to report it — and learns nothing about anyone else's privileges.
 */
export const malformedMembershipResponseSchema = z
  .object({
    error: z.literal("MALFORMED_MEMBERSHIP_ROLE"),
    message: z.string(),
    problem: z.enum(["empty", "multi-valued", "untrimmed"]),
  })
  .openapi("MalformedMembershipRole");
