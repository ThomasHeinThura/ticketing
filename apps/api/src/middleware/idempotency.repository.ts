import { sql } from "drizzle-orm";
import db from "../database";
import type { IdempotencyReservation, IdempotencyStore } from "./idempotency";

type Executor = Pick<typeof db, "execute">;

/**
 * PostgreSQL store for `idempotency_key` (data-model.md §1). Every time comparison uses the
 * database clock (`now()` against `timestamptz` columns) so all replicas share one clock.
 *
 * REQUIRES the coordinator-owned migration that creates `idempotency_key`; the table does
 * not exist in the current schema, so this store must not be wired before that migration.
 */
export function createPostgresIdempotencyStore(
  executor: Executor = db,
): IdempotencyStore {
  return {
    async reserve(input): Promise<IdempotencyReservation> {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const inserted = await executor.execute(sql`
          INSERT INTO idempotency_key AS existing
            (id, actor_type, actor_id, key, route, request_hash, state,
             response_status, response_body, created_at, expires_at)
          VALUES
            (${input.token}, ${input.actorType}, ${input.actorId}, ${input.key},
             ${input.route}, ${input.requestHash}, 'in_flight', NULL, NULL, now(),
             now() + make_interval(secs => ${input.leaseMs / 1000}))
          ON CONFLICT (actor_type, actor_id, key) DO UPDATE
             SET id = EXCLUDED.id,
                 route = EXCLUDED.route,
                 request_hash = EXCLUDED.request_hash,
                 state = 'in_flight',
                 response_status = NULL,
                 response_body = NULL,
                 created_at = EXCLUDED.created_at,
                 expires_at = EXCLUDED.expires_at
           WHERE existing.expires_at <= now()
          RETURNING id
        `);
        if (inserted.rows.length > 0)
          return { kind: "reserved", token: input.token };

        const current = await executor.execute(sql`
          SELECT route, request_hash AS "requestHash", state,
                 response_status AS "status", response_body AS "body"
            FROM idempotency_key
           WHERE actor_type = ${input.actorType}
             AND actor_id = ${input.actorId}
             AND key = ${input.key}
             AND expires_at > now()
        `);
        const row = current.rows[0] as
          | {
              route: string;
              requestHash: string;
              state: string;
              status: number | null;
              body: unknown;
            }
          | undefined;
        // Expired or removed between the two statements: try the reservation again.
        if (!row) continue;
        if (row.route !== input.route || row.requestHash !== input.requestHash)
          return { kind: "mismatch" };
        if (row.state === "done" && row.status !== null && row.body !== null)
          return {
            kind: "replay",
            status: row.status,
            body: JSON.stringify(row.body),
          };
        return { kind: "in_flight" };
      }
      return { kind: "in_flight" };
    },
    async complete(input) {
      await executor.execute(sql`
        UPDATE idempotency_key
           SET state = 'done',
               response_status = ${input.status},
               response_body = ${input.body}::jsonb,
               expires_at = created_at + make_interval(secs => ${input.ttlMs / 1000})
         WHERE actor_type = ${input.actorType}
           AND actor_id = ${input.actorId}
           AND key = ${input.key}
           AND id = ${input.token}
           AND state = 'in_flight'
      `);
    },
    async release(input) {
      await executor.execute(sql`
        DELETE FROM idempotency_key
         WHERE actor_type = ${input.actorType}
           AND actor_id = ${input.actorId}
           AND key = ${input.key}
           AND id = ${input.token}
           AND state = 'in_flight'
      `);
    },
  };
}
