import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { APIRequestContext, APIResponse } from "@playwright/test";
import type { Client as PgClient } from "pg";
import { redactSecretErrorContext } from "../../apps/web/e2e/helpers/redact-secret-error-context";
import {
  type MfaCsrfAppFixture,
  type MfaCsrfAppFixtureSetup,
  totpForUri,
  withMfaCsrfApp,
} from "./helpers/mfa-csrf-app-fixture";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const webRequire = createRequire(resolve(repoRoot, "apps/web/package.json"));
const apiRequire = createRequire(resolve(repoRoot, "apps/api/package.json"));
const playwright = webRequire(
  "@playwright/test",
) as typeof import("@playwright/test");
const { Client } = apiRequire("pg") as typeof import("pg");
const { expect, test } = playwright;

test.use({ trace: "off", video: "off", screenshot: "off" });

test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

type CustomerCredentials = { email: string; password: string };

async function runCustomerSeeder(fixture: MfaCsrfAppFixtureSetup) {
  const outputPath = resolve(fixture.fixtureDir, "users-primary-customer.json");
  const child = await fixture.spawnChild(
    process.execPath,
    [
      resolve(repoRoot, "apps/api/node_modules/tsx/dist/cli.mjs"),
      "--tsconfig",
      resolve(repoRoot, "apps/api/tsconfig.tests.json"),
      resolve(repoRoot, "tests/e2e/scripts/seed-instance-users-customer.ts"),
      outputPath,
    ],
    {
      ...process.env,
      TASKDESK_DATABASE_URL: fixture.databaseUrl,
      TASKDESK_MIGRATION_DATABASE_URL: undefined,
    },
    "users-primary-customer-seed",
    fixture.fixtureDir,
  );
  await new Promise<void>((resolveChild, reject) => {
    child.once("close", (code) => {
      if (code === 0) resolveChild();
      else reject(new Error("The private customer fixture seeder failed."));
    });
  });
  return JSON.parse(readFileSync(outputPath, "utf8")) as CustomerCredentials;
}

async function seedCustomerPasswordProvider(fixture: MfaCsrfAppFixtureSetup) {
  const child = await fixture.spawnChild(
    process.execPath,
    [
      resolve(repoRoot, "apps/api/node_modules/tsx/dist/cli.mjs"),
      "--tsconfig",
      resolve(repoRoot, "apps/api/tsconfig.tests.json"),
      resolve(repoRoot, "tests/e2e/scripts/seed-approval-auth-provider.ts"),
    ],
    {
      ...process.env,
      TASKDESK_DATABASE_URL: fixture.databaseUrl,
      TASKDESK_MIGRATION_DATABASE_URL: undefined,
    },
    "users-primary-auth-provider-seed",
    fixture.fixtureDir,
  );
  await new Promise<void>((resolveChild, reject) => {
    child.once("close", (code) => {
      if (code === 0) resolveChild();
      else
        reject(new Error("The private auth-provider fixture seeder failed."));
    });
  });
}

async function statusText(response: APIResponse, status: number) {
  const body = await response.text();
  expect(response.status(), body).toBe(status);
  return body;
}

async function postWithCsrf(
  context: APIRequestContext,
  origin: string,
  path: string,
  data: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
) {
  const tokenResponse = await context.get(
    new URL("/api/me/csrf-token", origin).toString(),
    { headers: { Origin: origin } },
  );
  const tokenBody = await tokenResponse.text();
  expect(tokenResponse.status(), tokenBody).toBe(200);
  const { token } = JSON.parse(tokenBody) as { token?: string };
  expect(token).toBeTruthy();
  return context.post(new URL(path, origin).toString(), {
    data,
    headers: {
      Origin: origin,
      "x-taskdesk-csrf": token ?? "",
      ...extraHeaders,
    },
  });
}

async function signUp(
  context: APIRequestContext,
  origin: string,
  input: { name: string; email: string; password: string },
) {
  return context.post(new URL("/api/auth/sign-up/email", origin).toString(), {
    data: input,
    headers: { Origin: origin },
  });
}

async function seedValidAdminApiKey(
  client: PgClient,
  adminId: string,
): Promise<string> {
  const rawKey = `taskdesk_test_${randomUUID()}`;
  const hashed = createHash("sha256").update(rawKey).digest("base64url");
  const id = `users-primary-key-${randomUUID()}`;
  const now = new Date();
  await client.query(
    `INSERT INTO apikey
      (id, reference_id, user_id, key, name, start, prefix, enabled, created_at, updated_at)
     VALUES ($1, $2, $2, $3, $4, $5, 'taskdesk', true, $6, $6)`,
    [
      id,
      adminId,
      hashed,
      "users primary session-only negative",
      rawKey.slice(0, 12),
      now,
    ],
  );
  return rawKey;
}

async function runJourney(fixture: MfaCsrfAppFixture) {
  const { origin, email, password } = fixture;
  const portalOrigin = new URL(origin);
  portalOrigin.hostname = `portal.${portalOrigin.hostname}`;
  const portal = portalOrigin.toString();
  const admin = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  const employee = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  const customerContext = await playwright.request.newContext({
    baseURL: portal,
    extraHTTPHeaders: { Origin: portal },
  });
  const client = new Client({ connectionString: fixture.databaseUrl });
  await client.connect();

  try {
    const firstSignup = await signUp(admin, origin, {
      name: "Users primary administrator",
      email,
      password,
    });
    const signupBody = await statusText(firstSignup, 200);
    expect(signupBody).not.toContain("password");

    const customer = await runCustomerSeeder(fixture);

    const enrollment = await postWithCsrf(
      admin,
      origin,
      "/api/auth/two-factor/enable",
      { password, issuer: "TaskDesk" },
    );
    const enrollmentBody = JSON.parse(await statusText(enrollment, 200)) as {
      totpURI: string;
      backupCodes: string[];
    };
    expect(enrollmentBody.backupCodes.length).toBeGreaterThan(0);
    const verifyEnrollment = await postWithCsrf(
      admin,
      origin,
      "/api/auth/two-factor/verify-totp",
      { code: totpForUri(enrollmentBody.totpURI) },
    );
    await statusText(verifyEnrollment, 200);

    const directoryResponse = await admin.get(
      new URL("/api/instance/users", origin).toString(),
      { headers: { Origin: origin } },
    );
    const directoryBody = JSON.parse(
      await statusText(directoryResponse, 200),
    ) as {
      data: Array<Record<string, unknown>>;
    };
    const administrator = directoryBody.data.find((row) => row.email === email);
    expect(administrator).toBeDefined();
    expect(administrator?.isInstanceAdmin).toBe(true);
    expect(Object.keys(administrator ?? {}).sort()).toEqual(
      [
        "id",
        "name",
        "email",
        "emailVerified",
        "createdAt",
        "locale",
        "isInstanceAdmin",
        "isSuspended",
        "suspensionExpiresAt",
        "twoFactorEnabled",
        "person",
      ].sort(),
    );
    const administratorId = String(administrator?.id);

    const selfDeactivation = await postWithCsrf(
      admin,
      origin,
      `/api/instance/users/${encodeURIComponent(administratorId)}/deactivate`,
      {},
    );
    const selfBody = await statusText(selfDeactivation, 409);
    expect(selfBody).toContain("self_target_refused");

    const employeeEmail = `users-primary-employee-${randomUUID()}@example.test`;
    const employeeSignup = await signUp(employee, origin, {
      name: "Users primary employee",
      email: employeeEmail,
      password: `${password}-employee`,
    });
    await statusText(employeeSignup, 200);
    const employeeDirectory = await employee.get(
      new URL("/api/instance/users", origin).toString(),
      { headers: { Origin: origin } },
    );
    await statusText(employeeDirectory, 403);

    const customerSignIn = await customerContext.post(
      new URL("/api/auth/sign-in/email", portal).toString(),
      {
        data: customer,
        headers: { Origin: portal },
      },
    );
    await statusText(customerSignIn, 200);
    const customerDirectory = await customerContext.get(
      new URL("/api/instance/users", portal).toString(),
      { headers: { Origin: portal } },
    );
    // The instance-user route is not mounted on the customer portal origin.
    await statusText(customerDirectory, 404);

    const rawApiKey = await seedValidAdminApiKey(client, administratorId);
    const keyDirectory = await admin.get(
      new URL("/api/instance/users", origin).toString(),
      { headers: { Origin: origin, "x-api-key": rawApiKey } },
    );
    const keyBody = await statusText(keyDirectory, 403);
    expect(keyBody.toLowerCase()).toContain("session_required");

    const targetDirectory = JSON.parse(
      await statusText(
        await admin.get(new URL("/api/instance/users", origin).toString()),
        200,
      ),
    ) as {
      data: Array<{
        id: string;
        email: string;
        person: { id: string } | null;
      }>;
    };
    const target = targetDirectory.data.find(
      (row) => row.email === employeeEmail,
    );
    expect(target).toBeDefined();
    const requestedResponse = await postWithCsrf(
      admin,
      origin,
      `/api/instance/users/${encodeURIComponent(String(target?.id))}/deactivate`,
      {},
    );
    const requested = JSON.parse(await statusText(requestedResponse, 202)) as {
      pendingActionId: string;
      confirmation: string;
    };
    expect(requested.confirmation).toBe("typed_name_step_up");
    const actionRead = await admin.get(
      new URL(
        `/api/me/pending-actions/${encodeURIComponent(requested.pendingActionId)}`,
        origin,
      ).toString(),
      { headers: { Origin: origin } },
    );
    expect(JSON.parse(await statusText(actionRead, 200))).toMatchObject({
      state: "pending",
      approvalSupported: true,
      action: "delete",
      targetType: "user",
    });

    const challengeResponse = await postWithCsrf(
      admin,
      origin,
      "/api/me/step-up/challenges",
      { kind: "pending_action", pendingActionId: requested.pendingActionId },
    );
    const challenge = JSON.parse(await statusText(challengeResponse, 200)) as {
      challengeId: string;
      nonce: string;
    };
    const proofResponse = await postWithCsrf(admin, origin, "/api/me/step-up", {
      kind: "pending_action",
      pendingActionId: requested.pendingActionId,
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      method: "totp",
      code: totpForUri(enrollmentBody.totpURI),
    });
    const proof = JSON.parse(await statusText(proofResponse, 200)) as {
      token: string;
    };
    const approved = await postWithCsrf(
      admin,
      origin,
      `/api/me/pending-actions/${encodeURIComponent(requested.pendingActionId)}/approve`,
      { typedName: employeeEmail },
      { "x-taskdesk-step-up-token": proof.token },
    );
    expect(JSON.parse(await statusText(approved, 200))).toEqual({
      id: requested.pendingActionId,
      state: "executed",
    });

    const pendingRow = await client.query<{
      state: string;
      confirmation_required: string;
      credential_type: string;
    }>(
      `SELECT state, confirmation_required, credential_type
         FROM pending_action WHERE id = $1`,
      [requested.pendingActionId],
    );
    expect(pendingRow.rows).toEqual([
      expect.objectContaining({
        state: "executed",
        confirmation_required: "typed_name_step_up",
        credential_type: "session",
      }),
    ]);
    const auditRows = await client.query<{ action: string }>(
      "SELECT action FROM audit_log WHERE entity_id = $1",
      [requested.pendingActionId],
    );
    const outboxRows = await client.query<{ kind: string }>(
      `SELECT kind FROM outbox
        WHERE payload->'payload'->>'pendingActionId' = $1
        ORDER BY created_at, event_id`,
      [requested.pendingActionId],
    );
    const identityRows = await client.query<{ kind: string }>(
      `SELECT kind FROM outbox
        WHERE kind = 'identity.deprovisioned'
          AND payload->'payload'->>'personId' = $1`,
      [target?.person?.id ?? ""],
    );
    const personRows = await client.query<{ active: boolean }>(
      "SELECT active FROM person WHERE user_id = $1",
      [target?.id],
    );
    expect(auditRows.rows.map(({ action }) => action)).toEqual(
      expect.arrayContaining([
        "pending_action.decided",
        "pending_action.executed",
        "auth.step_up_issued",
      ]),
    );
    expect(outboxRows.rows.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining([
        "pending_action.requested",
        "pending_action.decided",
        "pending_action.executed",
      ]),
    );
    expect(identityRows.rows).toEqual([{ kind: "identity.deprovisioned" }]);
    expect(personRows.rows).toEqual([{ active: false }]);
  } finally {
    await Promise.allSettled([
      admin.dispose(),
      employee.dispose(),
      customerContext.dispose(),
      client.end(),
    ]);
  }
}

test("instance user administration uses real sessions, PA-15 and audited deactivation", async () => {
  await withMfaCsrfApp(async (fixture) => runJourney(fixture), {
    beforeStart: async (setup) => {
      await seedCustomerPasswordProvider(setup);
    },
  });
});
