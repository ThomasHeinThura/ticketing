import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createId } from "@paralleldrive/cuid2";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { Pool } from "pg";
import {
  classifyLegacyMemberships,
  validateOwnerApprovedReconciliation,
} from "../identity/membership-provenance-preflight";
import type { DatabaseInstance } from "./index";

const CUTOVER_TAG = "0089_unique_the_stranger";
const CUTOVER_END_TAG = "0092_mature_exodus";
const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";

type Journal = {
  entries: Array<{
    idx: number;
    when: number;
    tag: string;
    breakpoints: boolean;
  }>;
};

type DrizzleMigrationInternals = {
  dialect: {
    migrate(
      migrations: ReturnType<typeof readMigrationFiles>,
      session: unknown,
      config: { migrationsFolder: string },
    ): Promise<void>;
  };
  session: unknown;
};

function reconciliationPathFromArgs(args: readonly string[]) {
  const index = args.indexOf("--membership-provenance-reconciliation");
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("Membership provenance reconciliation path is missing");
  }
  return value;
}

/**
 * Run the provenance authority transition at the exact migration boundary. The old
 * schema remains intact if preflight, approval, backfill, projection validation, or any
 * statement in the migration batch fails. The migration connection is the only connection used while
 * the legacy membership writers are blocked.
 */
export async function migrateWithMembershipProvenanceCutover(options: {
  database: DatabaseInstance;
  pool: Pool;
  migrationsFolder: string;
  args?: readonly string[];
}) {
  const lockClient = await options.pool.connect();
  try {
    await lockClient.query(
      "select pg_advisory_lock(hashtextextended('taskdesk:migrations', 0))",
    );
    await executeMigrationsWithMembershipCutover(options);
  } finally {
    try {
      await lockClient.query(
        "select pg_advisory_unlock(hashtextextended('taskdesk:migrations', 0))",
      );
    } finally {
      lockClient.release();
    }
  }
}

async function executeMigrationsWithMembershipCutover(options: {
  database: DatabaseInstance;
  pool: Pool;
  migrationsFolder: string;
  args?: readonly string[];
}) {
  const { database, pool, migrationsFolder } = options;
  // Drizzle's public `migrate()` does not expose a hook between journal entries.
  // This narrow cast reaches the same dialect/session used by that public wrapper so
  // earlier/later migrations retain the installed Drizzle implementation.
  const runner = database as unknown as DrizzleMigrationInternals;
  const journal = JSON.parse(
    await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"),
  ) as Journal;
  const cutoverIndex = journal.entries.findIndex(
    (entry) => entry.tag === CUTOVER_TAG,
  );
  const cutoverEndIndex = journal.entries.findIndex(
    (entry) => entry.tag === CUTOVER_END_TAG,
  );
  if (cutoverIndex < 0 || cutoverEndIndex < cutoverIndex)
    throw new Error("Membership cutover migration is missing");
  const cutover = journal.entries[cutoverIndex];
  const cutoverEnd = journal.entries[cutoverEndIndex];
  const previous = journal.entries[cutoverIndex - 1];
  if (!cutover || !cutoverEnd || !previous) {
    throw new Error("Membership cutover journal boundary is invalid");
  }
  const migrations = readMigrationFiles({ migrationsFolder });
  if (migrations.length !== journal.entries.length) {
    throw new Error("Migration journal and files are inconsistent");
  }

  const config = { migrationsFolder };
  await runner.dialect.migrate(
    migrations.slice(0, cutoverIndex),
    runner.session,
    config,
  );

  const client = await pool.connect();
  let clientReleased = false;
  try {
    await client.query("BEGIN");
    await client.query(
      "LOCK TABLE public.organisation IN ACCESS EXCLUSIVE MODE",
    );
    await client.query("LOCK TABLE public.workspace IN ACCESS EXCLUSIVE MODE");
    await client.query("LOCK TABLE public.person IN ACCESS EXCLUSIVE MODE");
    await client.query("LOCK TABLE public.role IN ACCESS EXCLUSIVE MODE");
    await client.query("LOCK TABLE public.membership IN ACCESS EXCLUSIVE MODE");

    const latest = await client.query<{ created_at: string | number }>(
      `select created_at from ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}
       order by created_at desc limit 1`,
    );
    if (
      latest.rows[0] &&
      Number(latest.rows[0].created_at) >= cutoverEnd.when
    ) {
      const existingProjection = await client.query<{ missing_count: string }>(
        `select count(*)::text as missing_count
           from public.membership membership
          where not exists (
            select 1 from public.membership_grant grant_row
             where grant_row.membership_id = membership.id
               and grant_row.person_id = membership.person_id
               and grant_row.scope = membership.scope
               and grant_row.scope_id = membership.scope_id
               and grant_row.role_id = membership.role_id
               and grant_row.sees_all = membership.sees_all
               and grant_row.revoked_at is null
          )`,
      );
      if (existingProjection.rows[0]?.missing_count !== "0") {
        throw new Error(
          "Applied membership cutover has an incomplete grant projection",
        );
      }
      await client.query("ROLLBACK");
      client.release();
      clientReleased = true;
      await runner.dialect.migrate(
        migrations.slice(cutoverEndIndex + 1),
        runner.session,
        config,
      );
      return;
    }
    if (
      !latest.rows[0] ||
      Number(latest.rows[0].created_at) !== previous.when
    ) {
      throw new Error(
        "Migration history is not at the provenance cutover boundary",
      );
    }

    const legacy = await client.query<{
      id: string;
      person_id: string;
      scope: string;
      scope_id: string;
      role_id: string;
      sees_all: boolean;
      derived_from: string | null;
    }>(`select id, person_id, scope, scope_id, role_id, sees_all, derived_from
        from public.membership order by id`);
    const inventory = classifyLegacyMemberships(
      legacy.rows.map((row) => ({
        id: row.id,
        personId: row.person_id,
        scope: row.scope,
        scopeId: row.scope_id,
        roleId: row.role_id,
        seesAll: row.sees_all,
        derivedFrom: row.derived_from,
      })),
      [],
    );
    const duplicateKeys = new Set<string>();
    const seenKeys = new Set<string>();
    for (const row of legacy.rows) {
      const key = `${row.person_id}\u0000${row.scope}\u0000${row.scope_id}`;
      if (seenKeys.has(key)) duplicateKeys.add(key);
      seenKeys.add(key);
    }
    if (duplicateKeys.size > 0) {
      throw new Error(
        "Membership provenance cutover refuses duplicate effective projection keys; resolve them with owner evidence first",
      );
    }

    let approvedGrants: Array<{
      membershipId: string;
      rowDigest: string;
      sourceKind: string;
      roleId: string;
      scope: string;
      scopeId: string;
      seesAll: boolean;
      directOrigin?: string;
      grantedByPersonId?: string;
      externalIdentityId?: string;
      identityConnectionId?: string;
      oidcGroupMappingId?: string;
      scimGroupMappingId?: string;
    }> = [];
    if (inventory.length > 0) {
      const recordPath = reconciliationPathFromArgs(
        options.args ?? process.argv,
      );
      if (!recordPath) {
        throw new Error(
          "Membership provenance cutover requires a complete owner reconciliation file",
        );
      }
      const recordInfo = await lstat(recordPath);
      if (
        !recordInfo.isFile() ||
        recordInfo.isSymbolicLink() ||
        (recordInfo.mode & 0o077) !== 0 ||
        recordInfo.size > 4 * 1024 * 1024
      ) {
        throw new Error(
          "Membership reconciliation file must be a private regular file no larger than 4 MiB",
        );
      }
      let rawRecord: unknown;
      try {
        rawRecord = JSON.parse(await readFile(recordPath, "utf8")) as unknown;
      } catch {
        throw new Error("Membership reconciliation file is not valid JSON");
      }
      const validation = validateOwnerApprovedReconciliation(
        inventory,
        rawRecord,
      );
      if (!validation.ok) {
        throw new Error(
          `Membership reconciliation refused: ${validation.reason}`,
        );
      }
      const approval = (rawRecord as { approval: { approverPersonId: string } })
        .approval;
      const approver = await client.query<{ person_id: string }>(
        `select person.id as person_id
           from public.person person
           join public."user" auth_user on auth_user.id = person.user_id
          where person.id = $1 and person.active = true
            and person.is_placeholder = false and auth_user.role = 'admin'
          for update of person, auth_user`,
        [approval.approverPersonId],
      );
      if (approver.rowCount !== 1) {
        throw new Error(
          "Membership reconciliation approver is not a current instance admin",
        );
      }

      const directRecords = validation.grants.filter(
        (grant) => grant.sourceKind === "direct",
      );
      if (
        directRecords.length !== validation.grants.length ||
        directRecords.length !== inventory.length ||
        directRecords.some(
          (grant) =>
            grant.directOrigin !== "admin" ||
            !grant.grantedByPersonId ||
            inventory.find((row) => row.membershipId === grant.membershipId)
              ?.roleId !== grant.roleId ||
            inventory.find((row) => row.membershipId === grant.membershipId)
              ?.seesAll !== grant.seesAll ||
            grant.externalIdentityId !== undefined ||
            grant.identityConnectionId !== undefined ||
            grant.oidcGroupMappingId !== undefined ||
            grant.scimGroupMappingId !== undefined,
        )
      ) {
        throw new Error(
          "Legacy cutover accepts only owner-attested direct grants with the current approver as actor",
        );
      }
      approvedGrants = directRecords;
    }

    for (const grant of approvedGrants) {
      const membership = inventory.find(
        (row) => row.membershipId === grant.membershipId,
      );
      if (
        !membership ||
        membership.roleId !== grant.roleId ||
        membership.scope !== grant.scope ||
        membership.scopeId !== grant.scopeId ||
        membership.seesAll !== grant.seesAll
      ) {
        throw new Error(
          "Reconciled grant differs from the locked membership row",
        );
      }
      const role = await client.query<{ id: string }>(
        `select id from public.role
          where id = $1 and scope = $2
            and (($2 = 'organisation' and workspace_id is null)
              or ($2 = 'workspace' and workspace_id = $3))
          for update`,
        [grant.roleId, grant.scope, grant.scopeId],
      );
      const target = await client.query<{ id: string }>(
        grant.scope === "organisation"
          ? "select id from public.organisation where id = $1 and active = true and deleted_at is null for update"
          : `select workspace.id from public.workspace workspace
              join public.organisation organisation
                on organisation.id = workspace.organisation_id
             where workspace.id = $1 and organisation.active = true
               and organisation.deleted_at is null
             for update of workspace`,
        [grant.scopeId],
      );
      if (role.rowCount !== 1 || target.rowCount !== 1) {
        throw new Error(
          "Reconciled membership role or scope is no longer valid",
        );
      }
      const person = await client.query<{ id: string }>(
        `select person.id from public.person person
          left join public.workspace workspace on workspace.id = $2
          where person.id = $1 and person.active = true
            and person.is_placeholder = false
            and (($3 = 'organisation' and person.organisation_id = $2)
              or ($3 = 'workspace' and workspace.organisation_id = person.organisation_id))
            and (workspace.id is null or workspace.organisation_id = person.organisation_id)
          for update of person`,
        [membership.personId, grant.scopeId, grant.scope],
      );
      if (person.rowCount !== 1) {
        throw new Error(
          "Reconciled membership person or target is no longer valid",
        );
      }
      const grantor = await client.query<{ id: string }>(
        `select id from public.person
          where id = $1 and side = 'staff' and is_placeholder = false
          for update`,
        [grant.grantedByPersonId],
      );
      if (grantor.rowCount !== 1) {
        throw new Error(
          "Reconciled direct grant actor is not a recorded staff person",
        );
      }
    }

    for (let index = cutoverIndex; index <= cutoverEndIndex; index += 1) {
      const migration = migrations[index];
      const entry = journal.entries[index];
      if (!migration || !entry) {
        throw new Error("Membership cutover migration chain is incomplete");
      }
      for (const statement of migration.sql) await client.query(statement);
      if (entry.idx === cutover.idx) {
        for (const grant of approvedGrants) {
          const membership = inventory.find(
            (row) => row.membershipId === grant.membershipId,
          );
          if (!membership) throw new Error("Reconciled membership disappeared");
          await client.query(
            `insert into public.membership_grant
              (id, membership_id, person_id, scope, scope_id, role_id, source_kind,
               sees_all, direct_origin, granted_by_person_id)
             values ($1,$2,$3,$4,$5,$6,'direct',$7,'admin',$8)`,
            [
              createId(),
              grant.membershipId,
              membership.personId,
              grant.scope,
              grant.scopeId,
              grant.roleId,
              grant.seesAll,
              grant.grantedByPersonId,
            ],
          );
        }
      }
      await client.query(
        `insert into ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} (hash, created_at)
         values ($1, $2)`,
        [migration.hash, entry.when],
      );
    }

    const projection = await client.query<{ missing_count: string }>(
      `select count(*)::text as missing_count
         from public.membership membership
        where not exists (
          select 1 from public.membership_grant grant_row
           where grant_row.membership_id = membership.id
             and grant_row.person_id = membership.person_id
             and grant_row.scope = membership.scope
             and grant_row.scope_id = membership.scope_id
             and grant_row.role_id = membership.role_id
             and grant_row.sees_all = membership.sees_all
             and grant_row.source_kind = 'direct'
             and grant_row.revoked_at is null
        )`,
    );
    if (projection.rows[0]?.missing_count !== "0") {
      throw new Error(
        "Membership grant backfill does not match the effective projection",
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    if (!clientReleased) client.release();
  }

  await runner.dialect.migrate(
    migrations.slice(cutoverEndIndex + 1),
    runner.session,
    config,
  );
}
