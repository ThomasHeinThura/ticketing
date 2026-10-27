import { randomUUID } from "node:crypto";
import db, { schema } from "../../../apps/api/src/database";
import { ensureStaffPersonForUser } from "../../../apps/api/src/utils/seed-internal-organisation";

/**
 * P4R1-M3: an impersonation session is honoured only while `impersonatedBy` names a current,
 * unsuspended instance administrator (admin role and exactly one active staff person). Tests of
 * what an impersonated session may do need a real one, or the session ends with 401 before the
 * behaviour under test is reached.
 */
export async function createImpersonatingAdmin(): Promise<string> {
  const id = `impersonator-${randomUUID()}`;
  await db.insert(schema.userTable).values({
    id,
    name: "Impersonating administrator",
    email: `${id}@example.test`,
    emailVerified: true,
    role: "admin",
  });
  await ensureStaffPersonForUser(id);
  return id;
}
