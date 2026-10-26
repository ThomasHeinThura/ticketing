import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import type { Executor } from "../../../apps/api/src/database/executor.js";
import {
  expiredPendingImportChunkCleanupQuery,
  scrubExpiredImportChunksInTransaction,
  scrubExpiredPendingImportChunksInTransaction,
} from "../../../apps/api/src/imports/expiry-cleanup.js";

async function captureCleanup(batchSize?: number) {
  const execute = vi.fn(async (_statement: SQL) => ({
    rows: [{ id: "chunk-1" }],
  }));
  const tx = { execute } as unknown as Executor;
  const scrubbed = await scrubExpiredImportChunksInTransaction(tx, batchSize);
  const statement = execute.mock.calls[0]?.[0];
  if (!statement) throw new Error("cleanup statement was not executed");
  return {
    scrubbed,
    query: new PgDialect().sqlToQuery(statement),
    execute,
  };
}

describe("expired import chunk cleanup", () => {
  it("uses one bounded statement and locks runs before chunks", async () => {
    const { scrubbed, query, execute } = await captureCleanup(17);
    const lockedRuns = query.sql.indexOf("locked_runs AS MATERIALIZED");
    const lockedChunks = query.sql.indexOf("locked_chunks AS MATERIALIZED");
    const update = query.sql.indexOf('UPDATE "import_chunk"');

    expect(scrubbed).toBe(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(query.params).toContain(17);
    expect(lockedRuns).toBeGreaterThan(-1);
    expect(lockedChunks).toBeGreaterThan(lockedRuns);
    expect(update).toBeGreaterThan(lockedChunks);
    expect(query.sql).toContain("FOR UPDATE OF run SKIP LOCKED");
    expect(query.sql).toContain("FOR UPDATE OF chunk SKIP LOCKED");
  });

  it("only selects expired non-pending chunks and preserves the report summary while clearing row data", async () => {
    const { query } = await captureCleanup();

    expect(query.sql).toContain("chunk.expires_at <= clock_timestamp()");
    expect(query.sql).toContain(
      "chunk.state IN ('previewed', 'rejected', 'failed')",
    );
    expect(query.sql).toContain("chunk.pending_action_id IS NULL");
    expect(query.sql).toContain("action.state IN (");
    expect(query.params).toContain("executed");
    expect(query.params).toContain("cancelled");
    expect(query.sql).not.toContain("'pending_approval'");
    expect(query.sql).toContain("SET input_payload = NULL");
    expect(query.sql).toContain(
      "jsonb_set(chunk.report, '{rows}', '[]'::jsonb, true)",
    );
    expect(query.sql).toContain("'{rejectionCodes}'");
    expect(query.sql).toContain("chunk.report -> 'rejectionCodes'");
    expect(query.sql).not.toContain("'{counts}'");
    expect(query.sql).not.toContain("DELETE FROM");
    expect(query.sql).not.toContain('UPDATE "import_run"');
    expect(query.sql).toContain(
      "jsonb_object_agg(code_counts.code, to_jsonb(code_counts.total))",
    );
    expect(query.params).toContain("assignment_update_requires_manual_action");
    expect(query.sql).toContain("chunk.report -> 'rows'");
  });

  it("clamps the batch to a safe range and returns the number of scrubbed rows", async () => {
    const minimum = await captureCleanup(0);
    const maximum = await captureCleanup(10_000);
    const fallback = await captureCleanup(Number.NaN);

    expect(minimum.query.params).toContain(1);
    expect(maximum.query.params).toContain(500);
    expect(fallback.query.params).toContain(100);
    expect(maximum.scrubbed).toBe(1);
  });

  it("locks terminal pending actions before runs and chunks, while excluding live approvals", () => {
    const query = new PgDialect().sqlToQuery(
      expiredPendingImportChunkCleanupQuery(12),
    );
    const lockedActions = query.sql.indexOf("locked_actions AS MATERIALIZED");
    const lockedRuns = query.sql.indexOf("locked_runs AS MATERIALIZED");
    const lockedChunks = query.sql.indexOf("locked_chunks AS MATERIALIZED");
    const update = query.sql.indexOf('UPDATE "import_chunk"');

    expect(lockedActions).toBeGreaterThan(-1);
    expect(lockedRuns).toBeGreaterThan(lockedActions);
    expect(lockedChunks).toBeGreaterThan(lockedRuns);
    expect(update).toBeGreaterThan(lockedChunks);
    expect(query.sql).toContain("chunk.state = 'pending_approval'");
    expect(query.sql).toContain("FOR UPDATE OF action SKIP LOCKED");
    expect(query.sql).toContain("FOR UPDATE OF run SKIP LOCKED");
    expect(query.sql).toContain("FOR UPDATE OF chunk SKIP LOCKED");
    expect(query.sql).toContain(
      "pending_action_id IS NOT DISTINCT FROM chunk.pending_action_id",
    );
    expect(query.params).toContain("executed");
    expect(query.params).toContain("denied");
    expect(query.params).toContain("cancelled");
    expect(query.params).toContain("expired");
    expect(query.params).toContain("invalidated");
    expect(query.params).toContain("failed");
    expect(query.sql).not.toContain("action.state IN ('pending'");
    expect(query.params).toContain(12);
  });

  it("takes the global pending-action lifecycle gate before the pending cleanup query", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "chunk-1" }] });
    const tx = { execute } as unknown as Executor;

    const scrubbed = await scrubExpiredPendingImportChunksInTransaction(tx, 8);
    const dialect = new PgDialect();
    const firstStatement = execute.mock.calls[0]?.[0];
    const secondStatement = execute.mock.calls[1]?.[0];
    if (!firstStatement || !secondStatement) {
      throw new Error("pending cleanup statements were not executed");
    }
    const firstQuery = dialect.sqlToQuery(firstStatement);
    const secondQuery = dialect.sqlToQuery(secondStatement);

    expect(scrubbed).toBe(1);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(firstQuery.sql).toContain("pg_advisory_xact_lock");
    expect(secondQuery.sql).toContain("locked_actions AS MATERIALIZED");
  });
});
