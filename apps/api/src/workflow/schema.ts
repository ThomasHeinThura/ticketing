import { CHANGE_RISK_LEVELS } from "@taskdesk/domain";
import { z } from "../openapi";

export const workflowIdParam = z.object({ id: z.string() });

export const workspaceIdQuery = z.object({ workspaceId: z.string() });

export const workflowVersionParam = z.object({
  id: z.string(),
  number: z.coerce.number().int().positive(),
});

export const createWorkflowBody = z.object({
  workspaceId: z.string(),
  key: z.string(),
  name: z.string(),
});

// Mirrors `packages/domain/src/workflow/types.ts`'s `Guard` union exactly (`WF-15`) --
// this is the request-side shape of the same closed vocabulary `validateWorkflowVersion`
// checks server-side before a version is ever persisted.
export const guardSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("children_closed") }),
  z.object({ type: z.literal("no_open_blockers") }),
  z.object({ type: z.literal("assignee_present") }),
  z.object({ type: z.literal("field_required"), field: z.string() }),
  z.object({
    type: z.literal("change_risk_at_most"),
    level: z.enum(CHANGE_RISK_LEVELS),
  }),
]);

// Mirrors `Effect` (`WF-19`) -- the six AUTHORED effect kinds only. `resolve_sla`/
// `reopen_sla` (`AutomaticEffect`) are deliberately not representable here at all: a
// caller cannot author what the engine computes automatically (`WF-22`).
export const effectSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("set_assignee"),
    personId: z.union([z.string(), z.literal("default")]),
  }),
  z.object({ kind: z.literal("clear_assignee") }),
  z.object({ kind: z.literal("pause_sla") }),
  z.object({ kind: z.literal("resume_sla") }),
  z.object({
    kind: z.literal("set_field"),
    field: z.string(),
    value: z.unknown(),
  }),
  z.object({
    kind: z.literal("schedule_transition"),
    // Opus security review of PR #457, N7: with no upper bound, an authored value large
    // enough overflows `Date`'s valid range once `transition-work-item.ts` computes
    // `Date.now() + afterMinutes * 60_000`. Deliberately NOT tightened with a schema
    // `.max()` here -- this exact field is also accepted by the ALREADY-SHIPPED
    // `POST /workflows/{id}/versions` route (#31/#443), so narrowing it here is a real
    // breaking change to a route this pull request does not otherwise touch, not a free
    // fix (`pnpm test:contract` confirmed this live: oasdiff flagged it and the repo's
    // own approved-breaks mechanism asks for a decision-log-backed justification this
    // session cannot supply). Fixed instead where the actual failure happens --
    // `transition-work-item.ts` now validates the computed `due_at` before using it and
    // skips the effect (same "disclosed no-op" treatment as an unresolvable
    // `schedule_transition` target) rather than ever handing Postgres an invalid Date.
    afterMinutes: z.number().int().positive(),
    toStateTemplateId: z.string(),
  }),
]);

export const createWorkflowTransitionBody = z.object({
  fromStateTemplateId: z.string().nullable().default(null),
  toStateTemplateId: z.string(),
  roleId: z.string().nullable().default(null),
  notePolicy: z.enum(["none", "optional", "required"]).default("none"),
  noteVisibility: z.enum(["public", "internal"]).default("internal"),
  requiresApproval: z.boolean().default(false),
  approvalPolicy: z.enum(["any", "all"]).nullable().default(null),
  requiresCab: z.boolean().default(false),
  isReopen: z.boolean().default(false),
  guards: z.array(guardSchema).default([]),
  effects: z.array(effectSchema).default([]),
});

export const createWorkflowVersionBody = z.object({
  transitions: z.array(createWorkflowTransitionBody),
});
