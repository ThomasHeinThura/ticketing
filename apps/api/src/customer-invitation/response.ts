import { z } from "../openapi";

const status = z.enum(["pending", "accepted", "revoked", "expired"]);

/** Never carries the credential or its hash (CP-23). */
export const customerInvitationSchema = z
  .object({
    id: z.string(),
    organisationId: z.string(),
    email: z.string(),
    status,
    expiresAt: z.string(),
    createdAt: z.string(),
    lastSentAt: z.string().nullable(),
    acceptedAt: z.string().nullable(),
    inviterId: z.string(),
  })
  .openapi("CustomerInvitation");

/** Create and resend also say whether the email was handed to the mailer. */
export const customerInvitationSentSchema = customerInvitationSchema
  .extend({ delivered: z.boolean() })
  .openapi("CustomerInvitationSent");

export const customerInvitationListSchema = z
  .object({ invitations: z.array(customerInvitationSchema) })
  .openapi("CustomerInvitationList");

export const customerOrganisationListSchema = z
  .object({
    organisations: z.array(
      z.object({ id: z.string(), key: z.string(), name: z.string() }),
    ),
  })
  .openapi("CustomerInvitationOrganisations");

export const acceptedCustomerInvitationSchema = z
  .object({ accepted: z.literal(true) })
  .openapi("AcceptedCustomerInvitation");
