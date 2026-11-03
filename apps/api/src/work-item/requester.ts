import { and, asc, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Executor } from "../database/executor";
import {
  organisationTable,
  personTable,
  projectTable,
  userTable,
} from "../database/schema";

/**
 * A-03 (Thomas, 3 November 2026): staff may name a customer as a work item's requester
 * (`work_item.requester_id`), so a request raised by staff opens in that customer's portal
 * (`CP-16`, D6). The requester must be an active customer person of the item's project's
 * organisation; anyone else is refused with 422. Clearing is allowed.
 */
export async function assertProjectCustomerRequester(
  executor: Executor,
  projectId: string,
  personId: string,
): Promise<void> {
  const [match] = await executor
    .select({ id: personTable.id })
    .from(personTable)
    .innerJoin(
      projectTable,
      eq(projectTable.organisationId, personTable.organisationId),
    )
    .innerJoin(
      organisationTable,
      eq(organisationTable.id, personTable.organisationId),
    )
    .where(
      and(
        eq(projectTable.id, projectId),
        eq(personTable.id, personId),
        eq(personTable.side, "customer"),
        eq(personTable.active, true),
        eq(organisationTable.isInternal, false),
      ),
    )
    .limit(1);
  if (!match)
    throw new HTTPException(422, {
      message:
        "The requester must be a customer of this project's organisation.",
    });
}

/**
 * The people the requester picker offers: the active customers of the project's organisation,
 * by name. Empty for a project of the internal organisation.
 */
export async function listProjectRequesterCandidates(
  executor: Executor,
  projectId: string,
) {
  return executor
    .select({
      personId: personTable.id,
      name: sql<
        string | null
      >`coalesce(nullif(${personTable.displayName}, ''), ${userTable.name})`,
      email: userTable.email,
    })
    .from(personTable)
    .innerJoin(
      projectTable,
      eq(projectTable.organisationId, personTable.organisationId),
    )
    .innerJoin(
      organisationTable,
      eq(organisationTable.id, personTable.organisationId),
    )
    .leftJoin(userTable, eq(userTable.id, personTable.userId))
    .where(
      and(
        eq(projectTable.id, projectId),
        eq(personTable.side, "customer"),
        eq(personTable.active, true),
        eq(organisationTable.isInternal, false),
      ),
    )
    .orderBy(
      asc(
        sql`lower(coalesce(nullif(${personTable.displayName}, ''), ${userTable.name}, ''))`,
      ),
      asc(personTable.id),
    )
    .limit(500);
}

/** The display name of a work item's requester (customer or staff), for the staff detail page. */
export async function findRequesterName(
  executor: Executor,
  personId: string | null,
): Promise<string | null> {
  if (!personId) return null;
  const [row] = await executor
    .select({
      name: sql<
        string | null
      >`coalesce(nullif(${personTable.displayName}, ''), ${userTable.name})`,
    })
    .from(personTable)
    .leftJoin(userTable, eq(userTable.id, personTable.userId))
    .where(eq(personTable.id, personId))
    .limit(1);
  return row?.name ?? null;
}
