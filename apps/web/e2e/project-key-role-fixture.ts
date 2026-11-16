import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import { BUILT_IN_ROLES } from "@taskdesk/permissions";
import type { MfaCsrfAppFixtureSetup } from "../../../tests/e2e/helpers/mfa-csrf-app-fixture";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const apiRequire = createRequire(resolve(root, "apps/api/package.json"));
type FixturePgClient = {
  connect(): Promise<void>;
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    query: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
  end(): Promise<void>;
};
const { Client } = apiRequire("pg") as {
  Client: new (options: { connectionString: string }) => FixturePgClient;
};
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};
export const ROLES = [
  "owner",
  "admin",
  "manager",
  "lead",
  "member",
  "viewer",
  "customer",
] as const;
export type Role = (typeof ROLES)[number];
type Actor = {
  role: Role;
  id: string;
  personId: string;
  email: string;
  password: string;
};

export async function projectMatrixRequest<T>(
  page: Page,
  path: string,
  method: "GET" | "POST" | "PUT" = "GET",
  body?: object,
) {
  return page.evaluate(
    async ({ path: url, method: verb, body: value }) => {
      const headers: Record<string, string> = {};
      if (verb !== "GET") {
        const csrf = await fetch("/api/me/csrf-token", {
          credentials: "include",
        });
        if (csrf.status !== 200) throw new Error("Matrix CSRF unavailable");
        const data: unknown = await csrf.json().catch(() => null);
        if (
          !data ||
          typeof data !== "object" ||
          !("token" in data) ||
          typeof data.token !== "string" ||
          !data.token.trim() ||
          data.token.length > 2048
        )
          throw new Error("Matrix CSRF unavailable");
        headers["x-taskdesk-csrf"] = data.token;
        headers["content-type"] = "application/json";
      }
      const response = await fetch(url, {
        method: verb,
        credentials: "include",
        headers,
        ...(verb === "GET" ? {} : { body: JSON.stringify(value) }),
      });
      return {
        status: response.status,
        body: response.ok ? await response.json() : null,
      };
    },
    { path, method, body },
  ) as Promise<{ status: number; body: T }>;
}

export async function expectReadOnlyProjectReady(
  page: Page,
  url: string,
  key: string,
) {
  await expect(page).toHaveURL(url);
  await expect(
    page.getByRole("heading", { name: "General Settings", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(key, { exact: true })).toBeVisible();
}

export async function expectEmptyPortalProjectsReady(page: Page, url: string) {
  await expect(page).toHaveURL(url);
  await expect(
    page.getByRole("heading", { name: "Projects", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No projects yet", { exact: true }),
  ).toBeVisible();
}
export function signInRetryDelay(headers: Record<string, string>) {
  const value = headers["retry-after"] ?? headers["x-retry-after"];
  if (!value || !/^(?:[1-9]|10)$/.test(value))
    throw new Error(
      "Auth retry requires a server-advertised delay of 1-10 seconds",
    );
  return Number(value) * 1000;
}

export async function seedPortalSupport(fixture: MfaCsrfAppFixtureSetup) {
  const input = resolve(fixture.fixtureDir, "team-portal-input.json");
  const output = resolve(fixture.fixtureDir, "team-portal-output.json");
  await writeFile(input, JSON.stringify({ phase: "instance" }), {
    mode: 0o600,
  });
  for (const [script, args] of [
    ["seed-approval-auth-provider.ts", []],
    ["seed-portal-projects.ts", [input, output]],
  ] as const) {
    const child = await fixture.spawnChild(
      process.execPath,
      [
        resolve(root, "apps/api/node_modules/tsx/dist/cli.mjs"),
        "--tsconfig",
        resolve(root, "apps/api/tsconfig.tests.json"),
        resolve(root, "tests/e2e/scripts", script),
        ...args,
      ],
      `template-matrix-${script}`,
    );
    await new Promise<void>((done, reject) => {
      child.once("close", (code) =>
        code === 0
          ? done()
          : reject(new Error("Private portal fixture setup failed")),
      );
    });
  }
}

export async function seedMatrixActors(
  databaseUrl: string,
  adminEmail: string,
) {
  if (!/^\/mfa_csrf_[a-f0-9]{32}_test$/.test(new URL(databaseUrl).pathname))
    throw new Error("Role matrix requires the disposable fixture database");
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const owner = await db.query<{ organisation_id: string }>(
      `SELECT p.organisation_id FROM person p JOIN "user" u ON u.id = p.user_id
       WHERE u.email = $1 AND p.side = 'staff'`,
      [adminEmail],
    );
    expect(owner.rows).toHaveLength(1);
    const internalOrganisationId = owner.rows[0]?.organisation_id;
    if (!internalOrganisationId)
      throw new Error("Fixture staff organisation missing");
    let customerRole = await db.query<{ id: string }>(
      `SELECT id FROM "role" WHERE scope = 'organisation' AND workspace_id IS NULL AND key = 'customer'`,
    );
    if (customerRole.rows.length === 0) {
      customerRole = await db.query<{ id: string }>(
        `INSERT INTO "role" (id, scope, workspace_id, key, name, rank, capabilities, is_system, is_editable)
         VALUES ($1, 'organisation', NULL, 'customer', 'Customer', $2, $3::jsonb, true, false) RETURNING id`,
        [
          randomUUID(),
          BUILT_IN_ROLES.customer.rank,
          JSON.stringify(BUILT_IN_ROLES.customer.capabilities),
        ],
      );
    }
    const customerRoleId = customerRole.rows[0]?.id;
    if (!customerRoleId) throw new Error("Canonical customer role missing");
    const actors = [];
    for (const role of ROLES) {
      const actor: Actor = {
        role,
        id: randomUUID(),
        personId: randomUUID(),
        email: `template-matrix-${role}-${randomUUID()}@example.test`,
        password: randomUUID(),
      };
      const now = new Date();
      let organisationId = internalOrganisationId;
      if (role === "customer") {
        organisationId = randomUUID();
        await db.query(
          `INSERT INTO organisation (id, key, name, is_internal, portal_access, default_customer_visibility)
           VALUES ($1, $2, 'Disposable customer organisation', false, true, 'organisation')`,
          [organisationId, `template-matrix-${randomUUID()}`],
        );
      }
      await db.query(
        `INSERT INTO "user" (id, name, email, email_verified, role, banned, two_factor_enabled, created_at, updated_at)
         VALUES ($1, $2, $3, true, NULL, false, false, $4, $4)`,
        [actor.id, `Team Matrix ${role}`, actor.email, now],
      );
      await db.query(
        `INSERT INTO person (id, user_id, organisation_id, side, display_name, active, is_placeholder, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, true, false, $6, $6)`,
        [
          actor.personId,
          actor.id,
          organisationId,
          role === "customer" ? "customer" : "staff",
          `Team Matrix ${role}`,
          now,
        ],
      );
      await db.query(
        `INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
         VALUES ($1, $2, 'credential', $2, $3, $4, $4)`,
        [randomUUID(), actor.id, await bcrypt.hash(actor.password, 4), now],
      );
      if (role === "customer") {
        await db.query(
          `INSERT INTO membership (id, person_id, scope, scope_id, role_id, sees_all, created_at, updated_at)
           VALUES ($1, $2, 'organisation', $3, $4, false, $5, $5)`,
          [randomUUID(), actor.personId, organisationId, customerRoleId, now],
        );
      }
      actors.push(actor);
    }
    return actors;
  } finally {
    await db.end();
  }
}

export async function grantMatrixRoles(
  databaseUrl: string,
  workspaceId: string,
  actors: Actor[],
) {
  if (!/^\/mfa_csrf_[a-f0-9]{32}_test$/.test(new URL(databaseUrl).pathname))
    throw new Error("Role matrix requires the disposable fixture database");
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const owner = actors.find((actor) => actor.role === "owner");
    if (!owner) throw new Error("Matrix owner missing");
    for (const actor of actors) {
      if (actor.role === "owner" || actor.role === "customer") continue;
      const rows = await db.query<{ id: string; capabilities: string[] }>(
        `SELECT id, capabilities FROM "role" WHERE workspace_id = $1 AND key = $2 AND scope = 'workspace'`,
        [workspaceId, actor.role],
      );
      expect(rows.rows).toHaveLength(1);
      const storedRole = rows.rows[0];
      if (!storedRole) throw new Error("Canonical workspace role missing");
      expect([...storedRole.capabilities].sort()).toEqual(
        [...BUILT_IN_ROLES[actor.role].capabilities].sort(),
      );
      const membershipId = randomUUID();
      const now = new Date();
      await db.query(
        `INSERT INTO workspace_member (id, user_id, workspace_id, role, joined_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), actor.id, workspaceId, actor.role, now],
      );
      await db.query(
        `INSERT INTO membership (id, person_id, scope, scope_id, role_id, sees_all, created_at, updated_at)
         VALUES ($1, $2, 'workspace', $3, $4, false, $5, $5)`,
        [membershipId, actor.personId, workspaceId, storedRole.id, now],
      );
      await db.query(
        `INSERT INTO membership_grant (id, membership_id, person_id, scope, scope_id, role_id,
          source_kind, sees_all, direct_origin, granted_by_person_id, created_at, updated_at)
         VALUES ($1, $2, $3, 'workspace', $4, $5, 'direct', false, 'admin', $6, $7, $7)`,
        [
          randomUUID(),
          membershipId,
          actor.personId,
          workspaceId,
          storedRole.id,
          owner.personId,
          now,
        ],
      );
    }
  } finally {
    await db.end();
  }
}
