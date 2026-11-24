import { userInfo } from "node:os";
import { sql } from "drizzle-orm";
import { appendAuditLog } from "../../audit/audit-writer";
import db, { schema } from "../../database";
import {
  applyInstanceAdminGrant,
  lockEligibleGrantTarget,
} from "./grant-instance-admin";

export const CLI_USAGE = "Usage: node dist/cli.js grant-instance-admin <email>";

/** `grant-instance-admin <email>` is the only command; anything else is a usage error. */
export function parseCliArgs(
  argv: readonly string[],
): { email: string } | { error: string } {
  const [command, email, ...rest] = argv;
  if (command !== "grant-instance-admin" || !email || rest.length > 0)
    return { error: CLI_USAGE };
  return { email };
}

/**
 * Break-glass for a locked-out instance (safety-and-runtime.md): runs the same eligibility,
 * serialization and in-app security alert as the God Mode route, with no session or step-up,
 * and audits as a system actor with the invoking OS user.
 */
export async function breakGlassGrantInstanceAdmin(
  email: string,
  osUser: string = userInfo().username,
): Promise<"granted" | "already_admin"> {
  const [user] = await db
    .select({ id: schema.userTable.id })
    .from(schema.userTable)
    .where(sql`lower(${schema.userTable.email}) = ${email.toLowerCase()}`)
    .limit(1);
  if (!user) throw new Error("No user with that email");
  return db.transaction(async (tx) => {
    const target = await lockEligibleGrantTarget(tx, user.id);
    const result = await applyInstanceAdminGrant(tx, target);
    await appendAuditLog(tx, {
      action: "auth.instance_admin_break_glass",
      actorId: null,
      actorType: "system",
      workspaceId: null,
      entityType: "user",
      entityId: user.id,
      before: { role: target.role },
      after: { outcome: result, osUser },
    });
    return result;
  });
}
