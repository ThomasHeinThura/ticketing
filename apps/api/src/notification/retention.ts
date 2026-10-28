import { sql } from "drizzle-orm";
import db from "../database";

/**
 * `NO-17` retention: delete read notifications whose `read_at` is older than
 * `instance_setting.notification_retention_days`. Unread rows (and rows with no `read_at`)
 * are never eligible. A missing settings row makes the cutoff NULL, so nothing is deleted
 * (fail closed).
 *
 * Legal holds (`background-jobs.md`, "Retention obeys person, source, recipient and
 * resource-owner legal holds; unresolved ownership retains history conservatively"): a row is
 * retained while an open hold covers its recipient person, the recipient's organisation, or an
 * organisation that owns the referenced resource. A resource whose owner cannot be resolved
 * (deleted, or a type with no owner mapping) is retained while ANY open hold exists.
 *
 * `read_at` is a UTC wall clock in `timestamp without time zone`, so the cutoff is expressed in
 * the same convention (see `utils/db-time.ts`).
 */
const WORK_ITEM_MATCH = sql`(
  (n."resource_type" = 'work_item' AND (wi."id" = n."resource_id" OR wi."key" = n."resource_id"))
  OR (n."resource_type" = 'comment' AND wi."id" IN (SELECT c."work_item_id" FROM "comment" c WHERE c."id" = n."resource_id"))
  OR (n."resource_type" = 'approval' AND wi."id" IN (SELECT a."work_item_id" FROM "approval" a WHERE a."id" = n."resource_id"))
)`;

const RESOURCE_ORGANISATIONS = sql`
  SELECT p."organisation_id" AS oid FROM "work_item" wi JOIN "project" p ON p."id" = wi."project_id" WHERE ${WORK_ITEM_MATCH}
  UNION ALL
  SELECT w."organisation_id" FROM "work_item" wi JOIN "workspace" w ON w."id" = wi."workspace_id" WHERE ${WORK_ITEM_MATCH}
  UNION ALL
  SELECT s."organisation_id" FROM "submission" s WHERE n."resource_type" = 'submission' AND s."id" = n."resource_id"
  UNION ALL
  SELECT p."organisation_id" FROM "project" p WHERE n."resource_type" = 'project' AND p."id" = n."resource_id"
  UNION ALL
  SELECT p."organisation_id" FROM "prerequisite" pr JOIN "project" p ON p."id" = pr."project_id" WHERE n."resource_type" = 'prerequisite' AND pr."id" = n."resource_id"
  UNION ALL
  SELECT w."organisation_id" FROM "workspace" w WHERE n."resource_type" = 'workspace' AND w."id" = n."resource_id"
`;

/** Resource types whose notifications reference no organisation-owned row. */
const OWNERLESS_RESOURCE_TYPES = sql`('webhook', 'api_key', 'automation', 'pending_action', 'identity_connection', 'instance', 'person')`;

const RECIPIENTS = sql`
  SELECT pe."id" AS pid, pe."organisation_id" AS oid FROM "person" pe
  WHERE pe."id" = n."person_id" OR pe."user_id" = n."user_id"
`;

const UNDER_OPEN_HOLD = sql`(
  EXISTS (
    SELECT 1 FROM "legal_hold" lh
    WHERE lh."lifted_at" IS NULL
      AND (
        (lh."scope" = 'person' AND lh."scope_id" IN (SELECT r.pid FROM (${RECIPIENTS}) r))
        OR (lh."scope" = 'organisation' AND lh."scope_id" IN (SELECT r.oid FROM (${RECIPIENTS}) r))
        OR (lh."scope" = 'organisation' AND lh."scope_id" IN (SELECT ro.oid FROM (${RESOURCE_ORGANISATIONS}) ro))
      )
  )
  OR (
    NOT EXISTS (SELECT 1 FROM (${RESOURCE_ORGANISATIONS}) ro2)
    AND (n."resource_type" IS NULL OR n."resource_type" NOT IN ${OWNERLESS_RESOURCE_TYPES})
    AND EXISTS (SELECT 1 FROM "legal_hold" any_hold WHERE any_hold."lifted_at" IS NULL)
  )
)`;

/** Returns the number of notifications deleted. */
export async function purgeReadNotifications(): Promise<number> {
  const result = await db.execute(sql`
    DELETE FROM "notification" n
    WHERE n."read_at" IS NOT NULL
      AND n."read_at" < (clock_timestamp() AT TIME ZONE 'UTC') - make_interval(
        days => (SELECT s."notification_retention_days" FROM "instance_setting" s WHERE s."id" = 'singleton')
      )
      AND NOT ${UNDER_OPEN_HOLD}
      -- An external child still waiting (deferred by quiet hours, backing off) claims through this
      -- inbox row; deleting it would orphan the child so it stays pending forever.
      AND NOT EXISTS (
        SELECT 1 FROM "notification_delivery" d
        WHERE d."event_id" = n."event_id"
          AND d."recipient_person_id" = n."person_id"
          AND d."state" = 'pending'
      )
  `);
  return result.rowCount ?? 0;
}
