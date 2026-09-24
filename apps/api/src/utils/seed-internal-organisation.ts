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
 *
 * Exported (#192): `workspace.organisation_id` is now NOT NULL, and every workspace this
 * codebase creates today is internal -- both `create-workspace.ts`'s real controller and
 * the integration-test fixtures/helpers that insert `workspace` rows directly need this
 * same get-or-create lookup, rather than each re-deriving its own query against
 * `organisation.is_internal`.
 *
 * Takes an optional `dbOrTx` (defaulting to the module's own `db`) so a caller running
 * inside its own transaction -- `create-workspace.ts`'s native create contract, whose own
 * atomicity test (`workspace-write-create-atomicity.test.ts`, A2-P6/A2-P7) asserts that
 * EVERY row a failed create might have written, including this one, rolls back together --
 * can pass its `tx` and get this insert covered by that same transaction. Called with no
 * argument (boot seed, and test fixtures that are not themselves inside a transaction), it
 * runs on the plain pooled connection exactly as before.
 *
 * The insert attempt below runs inside its OWN nested `dbOrTx.transaction(...)` (a real
 * transaction when `dbOrTx` is the plain `db`, a SAVEPOINT when `dbOrTx` is already a `tx`
 * -- drizzle-orm's node-postgres driver implements nested `.transaction()` calls as
 * SAVEPOINT/RELEASE SAVEPOINT/ROLLBACK TO SAVEPOINT). This is load-bearing, not
 * belt-and-braces: found by `workspace-write-create-contract.test.ts`'s own concurrent-
 * create test (12 simultaneous requests against a database with no internal organisation
 * yet) after `dbOrTx` first became callable with a `tx` -- a plain `INSERT` run directly
 * against `tx` that hits the unique-violation race aborts the WHOLE enclosing Postgres
 * transaction (an error inside a transaction poisons every later statement on it, "current
 * transaction is aborted, commands ignored until end of transaction block", not just the
 * one statement), so the re-read fallback below would itself fail for every concurrent
 * loser, turning a handled race into an unhandled 500. A SAVEPOINT confines that failure
 * to the insert attempt alone -- rolled back to the savepoint, not the outer transaction --
 * so the re-read that follows runs on a healthy transaction either way.
 */
export async function ensureInternalOrganisation(
  // `Pick<..., "select" | "insert" | "transaction">`, not `typeof db`: a `db.transaction()`
  // callback's `tx` argument is a `PgTransaction`, structurally missing `$client` and a few
  // other members `typeof db` has -- but it has every method this function actually calls,
  // so this is the narrowest type that accepts both the plain pooled `db` and a `tx`.
  dbOrTx: Pick<typeof db, "select" | "insert" | "transaction"> = db,
): Promise<{ id: string }> {
  const [existing] = await dbOrTx
    .select({ id: schema.organisationTable.id })
    .from(schema.organisationTable)
    .where(eq(schema.organisationTable.isInternal, true))
    .limit(1);

  if (existing) {
    return existing;
  }

  const now = new Date();

  try {
    const inserted = await dbOrTx.transaction(async (nested) => {
      const [row] = await nested
        .insert(schema.organisationTable)
        .values({
          key: INTERNAL_ORGANISATION_KEY,
          name: INTERNAL_ORGANISATION_NAME,
          isInternal: true,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: schema.organisationTable.id });
      return row;
    });

    if (inserted) {
      console.log(`✅ Seeded internal organisation "${inserted.id}"`);
      return inserted;
    }
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    // A concurrent first boot (or a concurrent workspace-create, #192) won either
    // `organisation_key_unique` or `organisation_is_internal_unique` first -- the
    // savepoint above already rolled back just the failed insert, so the enclosing
    // transaction (if any) is still healthy here -- fall through to re-read below.
  }

  const [nowExisting] = await dbOrTx
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

/** Ensure an ordinary registered user has the same internal staff identity as boot users. */
export async function ensureStaffPersonForUser(userId: string): Promise<void> {
  const internalOrganisation = await ensureInternalOrganisation();
  const now = new Date();
  await db
    .insert(schema.personTable)
    .values({
      userId,
      organisationId: internalOrganisation.id,
      side: "staff",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [schema.personTable.userId],
      where: sql`${schema.personTable.userId} is not null`,
    });
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
