import { responseTimestamp, z } from "../openapi";

export const teamMemberSchema = z.object({
  personId: z.string(),
  userId: z.string(),
  name: z.string().nullable(),
  isLead: z.boolean(),
  allocationPct: z.number().int().nullable(),
  /** False once the person is deactivated: kept for history, off the active roster (TM-8). */
  active: z.boolean(),
});

export const teamSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  isCab: z.boolean(),
  capacityDaysPerWeek: z.number().nullable(),
  memberCount: z.number().int().min(0),
  createdAt: responseTimestamp,
});

export const teamCandidateSchema = z.object({
  personId: z.string(),
  name: z.string(),
  email: z.string(),
});

export const teamDetailSchema = teamSchema.extend({
  members: z.array(teamMemberSchema),
  /** Staff who could be added; empty unless the caller may edit this roster. */
  candidates: z.array(teamCandidateSchema),
  /** The caller may edit this roster (manage_settings, or a lead of this team). */
  canEditRoster: z.boolean(),
  /** The caller may change name, capacity and the CAB flag, and delete the team. */
  canManageTeam: z.boolean(),
  deletionBlockers: z.array(z.string()),
});

export const teamListSchema = z.object({ data: z.array(teamSchema) });
export const okSchema = z.object({ ok: z.literal(true) });
