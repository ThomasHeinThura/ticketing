import { createHash } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import type db from "../database";
import {
  getScimIdentityByTokenDigest,
  lockScimConnection,
  lockScimIdentityConnection,
} from "./repository";

export type ScimRequestAuthority = {
  connectionId: string;
  /** Internal credential binding for mutation-time revalidation; never serialized. */
  tokenHash: Buffer;
  portalScope: "agent" | "customer";
  organisationId: string | null;
  allowedResources: readonly ("users" | "groups")[];
  maxRoleRank: number | null;
};

/** Recheck a resolved bearer while holding the connection rows for a mutation. */
export async function lockAndVerifyScimMutation(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  authority: ScimRequestAuthority,
  requiredResource: "users" | "groups",
) {
  const [connection] = await lockScimIdentityConnection(
    tx,
    authority.connectionId,
  );
  const [scim] = await lockScimConnection(tx, authority.connectionId);
  if (!connection?.enabled || !scim?.enabled)
    throw new HTTPException(403, { message: "Connection disabled" });
  if (
    !scim.tokenHash ||
    !Buffer.from(scim.tokenHash).equals(authority.tokenHash)
  )
    throw new HTTPException(401, { message: "Unauthorized" });
  if (
    connection.portalScope !== authority.portalScope ||
    connection.organisationId !== authority.organisationId
  )
    throw new HTTPException(403, { message: "Connection scope changed" });
  if (
    !Array.isArray(scim.allowedResources) ||
    !scim.allowedResources.includes(requiredResource)
  )
    throw new HTTPException(403, { message: "Resource is not allowed" });
  return { connection, scim };
}

/**
 * Resolves only the dedicated SCIM bearer credential. This function intentionally does
 * not read cookies, API keys, or Better Auth sessions; callers must not translate this
 * authority into an application user/session identity.
 */
export async function resolveScimBearer(
  authorization: string | undefined,
): Promise<ScimRequestAuthority> {
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
  if (!match) throw new HTTPException(401, { message: "Unauthorized" });

  const token = match[1];
  if (!token) throw new HTTPException(401, { message: "Unauthorized" });
  const digest = createHash("sha256").update(token, "utf8").digest();
  const [row] = await getScimIdentityByTokenDigest(digest);

  if (
    !row?.enabled ||
    !row.connectionEnabled ||
    (row.portalScope !== "agent" && row.portalScope !== "customer") ||
    (row.portalScope === "customer" && !row.organisationId)
  ) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  const allowedResources: unknown = row.allowedResources;
  if (
    !Array.isArray(allowedResources) ||
    !allowedResources.includes("users") ||
    allowedResources.some(
      (resource) => resource !== "users" && resource !== "groups",
    )
  ) {
    throw new HTTPException(503, { message: "SCIM configuration unavailable" });
  }

  return {
    connectionId: row.connectionId,
    tokenHash: digest,
    portalScope: row.portalScope,
    organisationId: row.organisationId,
    allowedResources: [
      ...new Set(allowedResources as Array<"users" | "groups">),
    ],
    maxRoleRank: row.maxRoleRank,
  };
}
