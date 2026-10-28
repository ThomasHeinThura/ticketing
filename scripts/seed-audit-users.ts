import { randomBytes } from "node:crypto";
import { realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Add accounts only: never rotate existing passwords or update customer records.
const requireApi = createRequire(
  new URL("../apps/api/package.json", import.meta.url),
);
const { Pool } = requireApi("pg");
const bcrypt = requireApi("bcryptjs");
const databaseUrl = process.env.TASKDESK_DATABASE_URL;
const destination = process.argv[2];
const repository = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
if (
  !databaseUrl ||
  new URL(databaseUrl).pathname !== "/taskdesk_codex_sit_20261025"
) {
  throw new Error("Audit accounts require the dedicated audit copy database.");
}
if (!destination || !path.isAbsolute(destination)) {
  throw new Error(
    "Supply an absolute private credentials path outside the checkout.",
  );
}
const privateDestination = path.join(
  realpathSync(path.dirname(destination)),
  path.basename(destination),
);
const relative = path.relative(repository, privateDestination);
if (
  relative === "" ||
  (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
) {
  throw new Error("Audit credentials must stay outside the source checkout.");
}
const pool = new Pool({ connectionString: databaseUrl });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const { rows: workspaces } = await client.query(
    "SELECT id FROM workspace ORDER BY id",
  );
  const { rows: organisations } = await client.query(
    "SELECT id, is_internal FROM organisation WHERE active = true AND deleted_at IS NULL ORDER BY id",
  );
  const staffOrg = organisations.find(
    (row: { is_internal: boolean }) => row.is_internal,
  )?.id;
  const customerOrg = organisations.find(
    (row: { is_internal: boolean }) => !row.is_internal,
  )?.id;
  if (!staffOrg || !customerOrg || !workspaces.length)
    throw new Error("Copy lacks audit prerequisites.");
  const accounts = [];
  for (const role of [
    "admin",
    "owner",
    "lead",
    "member",
    "viewer",
    "customer",
  ]) {
    const id = `audit-20261025-${role}`;
    const email = `${id}@example.test`;
    const password = randomBytes(32).toString("base64url");
    const personId = `${id}-person`;
    await client.query(
      'INSERT INTO "user" (id,name,email,email_verified,role) VALUES ($1,$2,$3,true,$4)',
      [id, `SIT Audit ${role}`, email, role === "admin" ? "admin" : "user"],
    );
    await client.query(
      "INSERT INTO account (id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES ($1,$2,'credential',$2,$3,now(),now())",
      [`${id}-credential`, id, await bcrypt.hash(password, 12)],
    );
    await client.query(
      "INSERT INTO person (id,user_id,organisation_id,side,display_name,active,is_placeholder) VALUES ($1,$2,$3,$4,$5,true,false)",
      [
        personId,
        id,
        role === "customer" ? customerOrg : staffOrg,
        role === "customer" ? "customer" : "staff",
        `SIT Audit ${role}`,
      ],
    );
    if (role === "customer") {
      const { rows } = await client.query(
        "SELECT id FROM role WHERE scope='organisation' AND key='customer' AND workspace_id IS NULL LIMIT 1",
      );
      if (!rows[0]) throw new Error("Copy lacks customer role.");
      await client.query(
        "INSERT INTO membership (id,person_id,scope,scope_id,role_id,sees_all) VALUES ($1,$2,'organisation',$3,$4,false)",
        [`${id}-membership`, personId, customerOrg, rows[0].id],
      );
    } else {
      for (const workspace of workspaces) {
        const key = role === "admin" ? "owner" : role;
        const { rows } = await client.query(
          "SELECT id FROM role WHERE scope='workspace' AND workspace_id=$1 AND key=$2 LIMIT 1",
          [workspace.id, key],
        );
        if (!rows[0]) throw new Error("Copy lacks a required workspace role.");
        await client.query(
          "INSERT INTO workspace_member (id,workspace_id,user_id,role,joined_at) VALUES ($1,$2,$3,$4,now())",
          [`${id}-${workspace.id}`, workspace.id, id, key],
        );
        await client.query(
          "INSERT INTO membership (id,person_id,scope,scope_id,role_id,sees_all) VALUES ($1,$2,'workspace',$3,$4,true)",
          [
            `${id}-${workspace.id}-membership`,
            personId,
            workspace.id,
            rows[0].id,
          ],
        );
      }
    }
    accounts.push({ role, email, password });
  }
  // Membership is a materialized projection; preserve direct-grant provenance too.
  await client.query(`
    INSERT INTO membership_grant (
      id, membership_id, person_id, scope, scope_id, role_id,
      source_kind, direct_origin, sees_all, created_at, updated_at
    )
    SELECT 'audit-grant-' || m.id, m.id, m.person_id, m.scope, m.scope_id,
      m.role_id, 'direct', 'system_backfill', m.sees_all, now(), now()
    FROM membership m JOIN person p ON p.id = m.person_id
    WHERE p.user_id IN (
      'audit-20261025-admin', 'audit-20261025-owner', 'audit-20261025-lead',
      'audit-20261025-member', 'audit-20261025-viewer', 'audit-20261025-customer'
    )
      AND NOT EXISTS (
        SELECT 1 FROM membership_grant g
        WHERE g.membership_id = m.id AND g.revoked_at IS NULL
      )
  `);
  // Exclusive creation also prevents accidentally rotating the test accounts.
  writeFileSync(privateDestination, JSON.stringify({ accounts }, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
  await client.query("COMMIT");
  console.log(
    "Added six audit accounts to the isolated copy; credentials saved privately.",
  );
} catch {
  await client.query("ROLLBACK");
  throw new Error(
    "Audit account seed failed; database transaction rolled back. Inspect prerequisites privately.",
  );
} finally {
  client.release();
  await pool.end();
}
