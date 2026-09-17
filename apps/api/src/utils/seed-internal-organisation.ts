import { eq, isNotNull, sql } from "drizzle-orm";
import db, { schema } from "../database";
import { isUniqueViolation } from "./is-unique-violation";

/**
 * The one internal `organisation` row every deployment needs — the operating company
 * whose staff work across customer organisations (multi-tenancy.md). `key` is a stable,
 * human-legible slug; `is_internal` is guarded by a partial unique index
 * (`organisation_is_internal_unique`) so at most one row can ever carry it.
 */
const INTERNAL_ORGANISATION_KEY = "internal";
const INTERNAL_ORGANISATION_NAME = "Internal";

/**
 * Finds the internal organisation, creating it on the first boot that reaches this code.
 * Idempotent, including under a race: if a concurrent boot (another replica starting for
 * the first time against the same empty database) wins the insert first, this falls back
 * to re-reading the row that boot created rather than treating the unique-constraint
 * violation as a real failure.
 */
async function ensureInternalOrganisation(): Promise<{ id: string }> {
  const [existing] = await db
    .select({ id: schema.organisationTable.id })
    .from(schema.organisationTable)
    .where(eq(schema.organisationTable.isInternal, true))
    .limit(1);

  if (existing) {
    return existing;
  }

  const now = new Date();

  try {
    const [inserted] = await db
      .insert(schema.organisationTable)
      .values({
        key: INTERNAL_ORGANISATION_KEY,
        name: INTERNAL_ORGANISATION_NAME,
        isInternal: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: schema.organisationTable.id });

    if (inserted) {
      console.log(`✅ Seeded internal organisation "${inserted.id}"`);
      return inserted;
    }
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    // A concurrent first boot won either `organisation_key_unique` or
    // `organisation_is_internal_unique` first — fall through to re-read below.
  }

  const [nowExisting] = await db
    .select({ id: schema.organisationTable.id })
    .from(schema.organisationTable)
    .where(eq(schema.organisationTable.isInternal, true))
    .limit(1);

  if (!nowExisting) {
    throw new Error(
      "Failed to create or find the internal organisation during seed",
    );
  }

  return nowExisting;
}

/**
 * Backfills one `person` row (side: "staff") per existing `user` row, in the internal
 * organisation — the P1 foundational identity schema (decision log 2026-09-16, "P1's
 * foundational identity schema") needs `person` rows to exist ahead of #23/#25, and every
 * user that existed before this migration is staff (the customer/portal side of `person`
 * has no data source yet — that is P3's identity-provisioning scope, not this one).
 *
 * Idempotent: only inserts for a user that doesn't already have a person row anywhere --
 * one `user_id` may back at most one `person` row, globally, not just within the internal
 * organisation (`person_user_unique`) -- following this codebase's existing
 * check-then-insert seed convention (`seed-default-workspace-roles.ts`). Not proof against
 * every concurrent-boot race — the same accepted limitation as that precedent — but
 * running this sequentially any number of times, including on every boot, creates no
 * duplicates.
 */
export async function seedInternalOrganisationAndStaffPersons() {
  try {
    const internalOrganisation = await ensureInternalOrganisation();

    const users = await db
      .select({ id: schema.userTable.id })
      .from(schema.userTable);

    if (users.length === 0) {
      return;
    }

    const existingPersons = await db
      .select({ userId: schema.personTable.userId })
      .from(schema.personTable)
      .where(isNotNull(schema.personTable.userId));

    const existingUserIds = new Set(
      existingPersons
        .map((person) => person.userId)
        .filter((userId): userId is string => userId !== null),
    );

    const now = new Date();
    const rows: Array<typeof schema.personTable.$inferInsert> = [];

    for (const user of users) {
      if (existingUserIds.has(user.id)) {
        continue;
      }

      rows.push({
        userId: user.id,
        organisationId: internalOrganisation.id,
        side: "staff",
        createdAt: now,
        updatedAt: now,
      });
    }

    if (rows.length === 0) {
      return;
    }

    // Postgres' bind protocol caps parameters at 65535 per query, so insert in chunks
    // (mirrors seed-default-workspace-roles.ts's BATCH_SIZE reasoning).
    const BATCH_SIZE = 1000;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      await db
        .insert(schema.personTable)
        .values(rows.slice(i, i + BATCH_SIZE))
        // Matches the global partial unique index `person_user_unique`'s own predicate --
        // Postgres only accepts this as a conflict arbiter when the `where` clause here
        // is identical to the index's, and every row inserted here always has a
        // non-null userId anyway (see the filter above). The arbiter is on `user_id`
        // alone (not `organisation_id, user_id`) because the invariant is global: at
        // most one `person` row per `user_id`, across every organisation, not just this
        // one -- see the index's own comment in schema.ts.
        .onConflictDoNothing({
          target: [schema.personTable.userId],
          where: sql`${schema.personTable.userId} is not null`,
        });
    }

    console.log(
      `✅ Seeded ${rows.length} person row(s) for existing user(s) in the internal organisation.`,
    );
  } catch (error) {
    console.error("❌ Failed to seed internal organisation/persons:", error);
    throw error;
  }
}
