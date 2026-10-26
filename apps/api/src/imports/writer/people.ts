import { and, eq, sql } from "drizzle-orm";
import { normaliseInviteeEmail } from "../../customer-invitation/logic";
import { schema } from "../../database";
import type { Transaction } from "../../database/executor";
import { lockImportPlaceholderClaimEmail } from "../../identity/placeholder-claim";
import { resolveAssigneeEligibility } from "../../work-item/assignee-eligibility";
import type { ImportWriterContext } from "./types";

const PERSON = schema.personTable;
const USER = schema.userTable;
const CLAIM = schema.importPlaceholderClaimTable;

export type ImportPersonRef = {
  personId: string;
  kind: "matched" | "placeholder";
};

function plausibleEmail(email: string) {
  return email.length >= 3 && email.length <= 320 && email.includes("@");
}

/**
 * Match an active-or-former staff member of the workspace's own organisation by email,
 * case-insensitively (IM-7). Scoped to the organisation: a global email match would link authors
 * across tenants. Placeholders are never matched here; they are reached through the claim ledger.
 */
export async function findStaffPersonByEmail(
  tx: Transaction,
  organisationId: string,
  email: string,
): Promise<{ id: string; active: boolean } | "ambiguous" | null> {
  const normalised = normaliseInviteeEmail(email);
  const rows = await tx
    .select({ id: PERSON.id, active: PERSON.active })
    .from(PERSON)
    .innerJoin(USER, eq(USER.id, PERSON.userId))
    .where(
      and(
        eq(PERSON.organisationId, organisationId),
        eq(PERSON.side, "staff"),
        eq(PERSON.isPlaceholder, false),
        sql`lower(btrim(${USER.email})) = ${normalised}`,
      ),
    )
    .limit(2);
  if (rows.length > 1) return "ambiguous";
  return rows[0] ?? null;
}

/**
 * Resolve an imported author to a person: an existing staff member by email, else an existing
 * unclaimed placeholder for that address in this organisation, else a NEW placeholder
 * (`is_placeholder`, no login, no membership, so never assignable) plus its claim row. The claim
 * ledger holds one row per address: a second placeholder for the same address would make it
 * unclaimable forever, so an existing row is always reused or, if it belongs to another
 * organisation, the author is reported unresolved rather than duplicated.
 *
 * The placeholder is `active` because the claim proof (`claimVerifiedImportPlaceholder`) denies an
 * inactive person; it cannot sign in (no user), hold a membership or be picked as an assignee.
 */
export async function resolveImportPerson(
  ctx: ImportWriterContext,
  input: { email: string; name?: string | undefined },
): Promise<ImportPersonRef | null> {
  const email = normaliseInviteeEmail(input.email);
  if (!plausibleEmail(email)) return null;
  const cached = ctx.people.get(email);
  if (cached !== undefined) return cached;
  // Its own savepoint: a database error here must not poison the commit transaction.
  const resolved = await ctx.tx
    .transaction(async (savepoint) =>
      resolveUncached({ ...ctx, tx: savepoint }, email, input.name),
    )
    .catch(() => null);
  ctx.people.set(email, resolved);
  return resolved;
}

async function resolveUncached(
  ctx: ImportWriterContext,
  email: string,
  name: string | undefined,
): Promise<ImportPersonRef | null> {
  const { tx } = ctx;
  const matched = await findStaffPersonByEmail(tx, ctx.organisationId, email);
  if (matched === "ambiguous") return null;
  if (matched) return { personId: matched.id, kind: "matched" };

  // Same order as `claimVerifiedImportPlaceholder` (organisation, then the address lock): a claim
  // takes the organisation row FOR UPDATE, so share-locking it first rules out a lock-order deadlock.
  await tx
    .select({ id: schema.organisationTable.id })
    .from(schema.organisationTable)
    .where(eq(schema.organisationTable.id, ctx.organisationId))
    .for("share");
  await lockImportPlaceholderClaimEmail(tx, email);
  const claims = await tx
    .select({
      personId: CLAIM.personId,
      claimedAt: CLAIM.claimedAt,
      organisationId: PERSON.organisationId,
      isPlaceholder: PERSON.isPlaceholder,
      userId: PERSON.userId,
    })
    .from(CLAIM)
    .innerJoin(PERSON, eq(PERSON.id, CLAIM.personId))
    .where(eq(CLAIM.normalizedEmail, email))
    .limit(2);
  if (claims.length > 1) return null;
  const [claim] = claims;
  if (claim) {
    if (
      claim.organisationId === ctx.organisationId &&
      claim.claimedAt === null &&
      claim.isPlaceholder &&
      claim.userId === null
    )
      return { personId: claim.personId, kind: "placeholder" };
    return null;
  }
  const [person] = await tx
    .insert(PERSON)
    .values({
      organisationId: ctx.organisationId,
      side: "staff",
      displayName: name?.trim() || "Imported user",
      active: true,
      isPlaceholder: true,
    })
    .returning({ id: PERSON.id });
  if (!person) return null;
  await tx.insert(CLAIM).values({
    personId: person.id,
    importRunId: ctx.runId,
    normalizedEmail: email,
  });
  ctx.stats.placeholdersCreated += 1;
  return { personId: person.id, kind: "placeholder" };
}

/** An active staff member who can be assigned on this project: matched only, never a placeholder. */
export async function resolveImportAssignee(
  ctx: ImportWriterContext,
  email: string,
): Promise<
  | { kind: "ok"; personId: string }
  | { kind: "unmatched" }
  | { kind: "not_eligible" }
> {
  const found = await findStaffPersonByEmail(
    ctx.tx,
    ctx.organisationId,
    normaliseInviteeEmail(email),
  );
  if (!found || found === "ambiguous") return { kind: "unmatched" };
  const eligibility = await resolveAssigneeEligibility(
    ctx.tx,
    ctx.projectId,
    found.id,
  );
  return eligibility.eligible
    ? { kind: "ok", personId: found.id }
    : { kind: "not_eligible" };
}
