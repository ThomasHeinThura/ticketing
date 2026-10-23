import { randomUUID } from "node:crypto";
import db, { schema } from "../../../apps/api/src/database";
import { grantCustomerOrganisationMembership } from "./approval-fixtures";

/**
 * A real customer-side principal: user, `side: "customer"` person and the canonical
 * organisation-scope `customer` membership, in its OWN organisation (never the workspace's).
 * `resolveIdentity` resolves it to a non-null customer identity, so a negative test built on it
 * exercises the customer branch for real instead of skipping when resolution fails.
 */
export async function createCustomerPrincipal() {
  const id = `cust-${randomUUID()}`;
  const orgId = `cust-org-${randomUUID()}`;
  await db.insert(schema.organisationTable).values({
    id: orgId,
    key: orgId,
    name: "Customer principal org",
    isInternal: false,
    portalAccess: true,
  });
  const [user] = await db
    .insert(schema.userTable)
    .values({ id, name: id, email: `${id}@example.test` })
    .returning();
  const [person] = await db
    .insert(schema.personTable)
    .values({
      userId: id,
      organisationId: orgId,
      side: "customer",
      active: true,
      isPlaceholder: false,
    })
    .returning();
  if (!user || !person) throw new Error("customer principal fixture missing");
  await grantCustomerOrganisationMembership(orgId, person.id);
  return { user, person, orgId };
}
