import { and, eq } from "drizzle-orm";
import db, { schema } from "../database";
import { retryIdentityGrantClosure } from "./membership-projection";
import { transitionPersonLifecycleInTransaction } from "./person-lifecycle";

/** SCIM source wrapper: the shared transition owns person-wide state and grants. */
export async function setScimIdentityActive(
  identityId: string,
  connectionId: string,
  active: boolean,
  lifecyclePolicy: "end_memberships" | "keep_memberships",
) {
  return retryIdentityGrantClosure(async () =>
    db.transaction((tx) =>
      setScimIdentityActiveInTransaction(
        tx,
        identityId,
        connectionId,
        active,
        lifecyclePolicy,
      ),
    ),
  );
}

export async function setScimIdentityActiveInTransaction(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  identityId: string,
  connectionId: string,
  active: boolean,
  lifecyclePolicy: "end_memberships" | "keep_memberships",
) {
  const [identity] = await tx
    .select({ personId: schema.externalIdentityTable.personId })
    .from(schema.externalIdentityTable)
    .where(
      and(
        eq(schema.externalIdentityTable.id, identityId),
        eq(schema.externalIdentityTable.identityConnectionId, connectionId),
        eq(schema.externalIdentityTable.provisionedVia, "scim"),
      ),
    )
    .limit(1);
  if (!identity) return false;

  const changed = await transitionPersonLifecycleInTransaction(
    tx,
    identity.personId,
    active,
    lifecyclePolicy,
    { kind: "scim", identityId, connectionId },
  );
  if (!changed) return false;

  const now = new Date();
  await tx
    .update(schema.externalIdentityTable)
    .set({ active, deactivatedAt: active ? null : now })
    .where(
      and(
        eq(schema.externalIdentityTable.id, identityId),
        eq(schema.externalIdentityTable.identityConnectionId, connectionId),
        eq(schema.externalIdentityTable.personId, identity.personId),
      ),
    );
  await tx.insert(schema.provisioningEventTable).values({
    identityConnectionId: connectionId,
    scimConnectionId: connectionId,
    externalIdentityId: identityId,
    kind: active ? "user.reactivated" : "user.deactivated",
    outcome: "success",
    detail: { personId: identity.personId, active, lifecyclePolicy },
    actorType: "scim",
  });
  return true;
}
