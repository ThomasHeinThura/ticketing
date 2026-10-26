import { sql } from "drizzle-orm";
import db from "../database";

export type DuplicateSuggestion = {
  id: string;
  key: string;
  title: string;
  score: number;
};

/** Bounded page enrichment; matching happens inside the caller's current readable projects. */
export async function suggestDuplicatesForQueueRows(
  workspaceId: string,
  rows: readonly { ref: string; summary: string; organisationId: string }[],
  readableProjectIds: readonly string[],
): Promise<Map<string, DuplicateSuggestion[]>> {
  const suggestions = new Map<string, DuplicateSuggestion[]>();
  const seeds = rows.filter((row) => row.summary.trim().length >= 2);
  if (seeds.length === 0 || readableProjectIds.length === 0) return suggestions;
  if (seeds.length > 200)
    throw new Error("Duplicate suggestion page exceeds its bound");
  const values = sql.join(
    seeds.map(
      (row) =>
        sql`(${row.ref}::text, ${row.summary.trim()}::text, ${row.organisationId}::text)`,
    ),
    sql`, `,
  );
  const projects = sql.join(
    [...new Set(readableProjectIds)].map((id) => sql`${id}`),
    sql`, `,
  );
  const cutoff = new Date(Date.now() - 90 * 86_400_000);
  const result = await db.transaction(async (tx) => {
    // The indexed trigram prefilter and precise score use the same threshold. LOCAL
    // resets at transaction end, preserving every other caller's connection settings.
    await tx.execute(
      sql`SELECT set_config('pg_trgm.similarity_threshold', '0.3', true)`,
    );
    return tx.execute<{ ref: string } & DuplicateSuggestion>(sql`
      SELECT seed.ref, candidate.id, candidate.key, candidate.title, candidate.score
      FROM (VALUES ${values}) AS seed(ref, summary, organisation_id)
      CROSS JOIN LATERAL (
        SELECT wi.id, wi.key, wi.title, similarity(wi.title, seed.summary) AS score
        FROM work_item wi
        JOIN project p ON p.id = wi.project_id AND p.workspace_id = ${workspaceId}
        WHERE wi.workspace_id = ${workspaceId}
          AND p.organisation_id = seed.organisation_id
          AND p.id IN (${projects})
          AND p.deleted_at IS NULL AND p.archived_at IS NULL
          AND wi.deleted_at IS NULL AND wi.archived_at IS NULL
          AND wi.created_at > ${cutoff}
          AND wi.title % seed.summary
          AND similarity(wi.title, seed.summary) > 0.3
        ORDER BY score DESC, wi.created_at DESC, wi.id ASC
        LIMIT 10
      ) AS candidate
      ORDER BY seed.ref, candidate.score DESC, candidate.id ASC
    `);
  });
  for (const row of result.rows) {
    const group = suggestions.get(row.ref) ?? [];
    group.push({
      id: row.id,
      key: row.key,
      title: row.title,
      score: row.score,
    });
    suggestions.set(row.ref, group);
  }
  return suggestions;
}
