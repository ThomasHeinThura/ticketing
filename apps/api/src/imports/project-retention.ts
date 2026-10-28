import { sql } from "drizzle-orm";
import type { Executor } from "../database/executor";

/** Keep import history when its project is physically purged; no staged bytes remain executable. */
export async function retireImportProjectTargets(
  tx: Executor,
  projectIds: readonly string[],
): Promise<void> {
  if (projectIds.length === 0) return;
  const ids = sql.join(
    [...new Set(projectIds)].sort().map((id) => sql`${id}`),
    sql`, `,
  );
  const retired = await tx.execute<{ id: string }>(sql`
    UPDATE import_run SET project_id = NULL, state = 'failed', version = version + 1,
      dry_run_digest = NULL, dry_run_expires_at = NULL, updated_at = CURRENT_TIMESTAMP,
      log = log || jsonb_build_array(jsonb_build_object('code', 'target_project_purged', 'at', CURRENT_TIMESTAMP))
    WHERE project_id IN (${ids}) RETURNING id
  `);
  if (retired.rows.length === 0) return;
  const runs = sql.join(
    retired.rows.map((row) => sql`${row.id}`),
    sql`, `,
  );
  await tx.execute(sql`
    UPDATE import_chunk SET state = 'failed', input_payload = NULL,
      report = (report - 'rows') || jsonb_build_object('code', 'target_project_purged')
    WHERE import_run_id IN (${runs}) AND state <> 'committed'
  `);
}
