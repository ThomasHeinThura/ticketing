import type { ResolvedIdentity } from "@taskdesk/permissions";
import { sql } from "drizzle-orm";
import { reachPredicate, selectRows } from "./context";

export type ReportOrganisation = { id: string; name: string };

/**
 * RP-7's organisation filter choices: the customer organisations of the projects the caller's
 * report reach covers (`report:read` reach, or the whole workspace with `report:read_all`), never
 * the internal organisation and never one reached only through another workspace. Organisations
 * are instance-wide, so they are only ever read through this workspace's projects.
 */
export async function reportOrganisations(
  identity: ResolvedIdentity,
  workspaceId: string,
  readAll: boolean,
): Promise<ReportOrganisation[]> {
  return await selectRows<ReportOrganisation>(sql`
    SELECT DISTINCT o.id, o.name
    FROM project p
    JOIN organisation o ON o.id = p.organisation_id
    WHERE p.workspace_id = ${workspaceId}
      AND p.deleted_at IS NULL
      AND o.deleted_at IS NULL
      AND o.is_internal = false
      AND ${reachPredicate(identity, readAll)}
    ORDER BY o.name, o.id`);
}
