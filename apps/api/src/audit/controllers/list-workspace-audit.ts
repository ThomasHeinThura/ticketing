import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { resolveRequestIdentity } from "../../permissions/resolve-request-identity";
import { type AuditQuery, listWorkspaceAuditRows } from "../repository";
import { writeAuditRead } from "./audit-read-common";

/**
 * AU-10 keeps its existing route admission and response ordering. The repository owns
 * the workspace and project reach predicates in SQL; this handler only resolves the
 * authenticated request identity and writes the AU-13 read event after the list query.
 */
export async function listWorkspaceAudit(
  c: Context,
  workspaceId: string,
  query: AuditQuery,
) {
  const userId = c.get("userId") as string | undefined;
  const session = c.get("session") as { impersonatedBy?: string | null } | null;
  const identity = userId
    ? await resolveRequestIdentity({
        userId,
        apiKey: c.get("apiKey"),
        impersonatedBy: session?.impersonatedBy,
      })
    : null;
  if (!identity) throw new HTTPException(403, { message: "Forbidden" });
  const rows = await listWorkspaceAuditRows(identity, workspaceId, query);

  await writeAuditRead(c, { workspaceId });
  return rows;
}
