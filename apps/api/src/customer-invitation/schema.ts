import { z } from "../openapi";

export const workspaceParam = z.object({ workspaceId: z.string().min(1) });
export const organisationParam = z.object({
  workspaceId: z.string().min(1),
  organisationId: z.string().min(1),
});
export const invitationParam = z.object({
  workspaceId: z.string().min(1),
  organisationId: z.string().min(1),
  id: z.string().min(1),
});
export const portalInvitationParam = z.object({ id: z.string().min(1) });

/**
 * Create takes the address only. The role is not a field: a customer-scope invitation is always
 * `customer`. Unknown keys are passed through to the handler, which refuses a body that names a
 * role, a team or a scope with 422 (CP-21) and audits it, rather than silently ignoring it.
 */
export const createCustomerInvitationBody = z
  .object({ email: z.string().trim().email().max(320) })
  .passthrough();

export const acceptCustomerInvitationBody = z
  .object({ credential: z.string().min(16).max(256) })
  .strict();
