import { eq, sql } from "drizzle-orm";
import db, { schema } from "../database";
import {
  claimVerifiedImportPlaceholder,
  reportPlaceholderClaimAuditWriteFailure,
} from "../identity/placeholder-claim";
import { findPendingInvitation } from "../utils/registration.repository";
import { insertStaffPersonIfAbsent } from "../utils/seed-defaults.repository";
import { ensureInternalOrganisation } from "../utils/seed-internal-organisation";

export class StaffInvitationRequiredError extends Error {}

/** Called only by successful Better Auth endpoints that consumed TaskDesk email proof. */
export function verifiedLocalEmailClaimMethod(path: string) {
  if (path === "/sign-in/email-otp") return "email_otp" as const;
  if (path === "/magic-link/verify") return "magic_link" as const;
  return undefined;
}

export async function establishVerifiedLocalStaffPerson(input: {
  userId: string;
  verifiedEmail: string;
  method: "email_otp" | "magic_link";
}) {
  const result = await db.transaction(async (tx) => {
    // Existing accounts keep their canonical person, including inactive accounts;
    // normal identity admission still decides whether they may use the session.
    const [existing] = await tx
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, input.userId))
      .limit(1);
    if (existing) return { kind: "none" as const };
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('taskdesk:auth-local-methods'), 0)`,
    );
    const organisation = await ensureInternalOrganisation(tx);
    const claim = await claimVerifiedImportPlaceholder(tx, {
      ...input,
      side: "staff",
      organisationId: organisation.id,
    });
    if (claim.kind === "none") {
      const [setting] = await tx
        .select({
          enabled: schema.instanceSettingTable.staffSelfRegistrationEnabled,
        })
        .from(schema.instanceSettingTable)
        .where(eq(schema.instanceSettingTable.id, "singleton"))
        .limit(1);
      if (
        process.env.DISABLE_REGISTRATION === "true" ||
        setting?.enabled !== true
      ) {
        const invitation = await findPendingInvitation({
          email: input.verifiedEmail,
          now: new Date(),
          executor: tx,
        });
        if (!invitation) throw new StaffInvitationRequiredError();
      }
      // The claim's user/email locks remain held until ordinary fallback commits.
      await insertStaffPersonIfAbsent(
        input.userId,
        organisation.id,
        new Date(),
        tx,
      );
    }
    return claim;
  });
  await reportPlaceholderClaimAuditWriteFailure(
    result.kind === "claimed" && result.auditFailure === true,
  );
}
