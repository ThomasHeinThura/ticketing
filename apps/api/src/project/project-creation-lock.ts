import { sql } from "drizzle-orm";
import type db from "../database";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Serializes project creation against erasure of the workspace that owns the project.
 * Keep namespace 1524: project creation already uses it to serialize project ordering.
 */
export async function lockProjectCreation(tx: Tx, workspaceId: string) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(1524, hashtext(${workspaceId}))`,
  );
}
