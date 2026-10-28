import { createRequire } from "node:module";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import { nextClientIp } from "./helpers/organization-http";
import { mintStepUpToken, STEP_UP_TOKEN_HEADER } from "./helpers/step-up";

/**
 * P2R1-11 / AU-13: exporting the instance audit log is elevated. It needs `instance:read_audit`
 * (instance administrator), a browser session, and a one-use PA-15 `audit_export` proof bound to
 * the exact export request.
 */

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};
const PASSWORD = "audit-export-step-up-password";
const EXPORT = "/api/instance/audit/export";
type App = ReturnType<typeof createApp>["app"];

beforeEach(async () => {
  await resetTestDatabase();
  await db
    .insert(schema.instanceSettingTable)
    .values({ id: "singleton", setupCompletedAt: new Date() });
});

async function makeUser(id: string, role: string | null) {
  const [user] = await db
    .insert(schema.userTable)
    .values({ id, name: `User ${id}`, email: `${id}@example.test`, role })
    .returning();
  if (!user) throw new Error("user fixture");
  await ensureStaffPersonForUser(user.id);
  await db.insert(schema.accountTable).values({
    id: `${id}-account`,
    accountId: id,
    providerId: "credential",
    userId: id,
    password: await bcrypt.hash(PASSWORD, 4),
  });
  return user;
}

async function signIn(app: App, email: string) {
  const login = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": nextClientIp(),
    },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(login.status).toBe(200);
  const cookie = login.headers
    .getSetCookie()
    .find((value) => value.startsWith("__Host-tdk_agent_session="))
    ?.split(";", 1)[0];
  expect(cookie).toBeDefined();
  return cookie as string;
}

function exportAudit(
  app: App,
  cookie: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return csrfRequest(
    app,
    EXPORT,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie, ...headers },
      body: JSON.stringify(body),
    },
    cookie,
  );
}

async function exportedRows() {
  return db
    .select({ id: schema.auditLogTable.id })
    .from(schema.auditLogTable)
    .where(eq(schema.auditLogTable.action, "audit.exported"));
}

async function consumedProofs() {
  return db
    .select({ id: schema.stepUpConfirmationTable.id })
    .from(schema.stepUpConfirmationTable)
    .where(
      and(
        eq(schema.stepUpConfirmationTable.operationKey, "audit_export"),
        eq(schema.stepUpConfirmationTable.state, "consumed"),
      ),
    );
}

describe("POST /api/instance/audit/export step-up (P2R1-11)", () => {
  it("refuses an administrator without a proof with 403 step_up_required and exports nothing", async () => {
    const admin = await makeUser("audit-export-admin", "admin");
    const { app } = createApp();
    const cookie = await signIn(app, admin.email);

    const response = await exportAudit(app, cookie, { format: "json" });
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("step_up_required");
    expect(await exportedRows()).toHaveLength(0);
  });

  it("exports with a proof bound to the request, once, and audits the export", async () => {
    const admin = await makeUser("audit-export-admin-ok", "admin");
    const { app } = createApp();
    const cookie = await signIn(app, admin.email);
    const body = { format: "json", limit: 50 };

    // A proof for a narrower export cannot be spent on a different one.
    const narrow = await mintStepUpToken(
      app,
      cookie,
      "audit_export",
      { format: "json", limit: 5 },
      PASSWORD,
    );
    expect(narrow).not.toBeNull();
    const mismatched = await exportAudit(app, cookie, body, {
      [STEP_UP_TOKEN_HEADER]: narrow as string,
    });
    expect(mismatched.status).toBe(403);
    expect(await mismatched.text()).toContain("step_up_unavailable");
    expect(await exportedRows()).toHaveLength(0);

    const token = await mintStepUpToken(
      app,
      cookie,
      "audit_export",
      body,
      PASSWORD,
    );
    expect(token).not.toBeNull();
    const consumedBefore = (await consumedProofs()).length;
    const response = await exportAudit(app, cookie, body, {
      [STEP_UP_TOKEN_HEADER]: token as string,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const exported = (await response.json()) as {
      format: string;
      rowCount: number;
      truncated: boolean;
      content: string;
    };
    expect(exported.format).toBe("json");
    expect(exported.truncated).toBe(false);
    expect(await exportedRows()).toHaveLength(1);
    expect(await consumedProofs()).toHaveLength(consumedBefore + 1);

    // The proof is single-use.
    const replay = await exportAudit(app, cookie, body, {
      [STEP_UP_TOKEN_HEADER]: token as string,
    });
    expect(replay.status).toBe(403);
    expect(await replay.text()).toContain("step_up_unavailable");
    expect(await exportedRows()).toHaveLength(1);
  });

  it("denies a caller without instance:read_audit before any proof is asked for", async () => {
    const plain = await makeUser("audit-export-plain", null);
    const { app } = createApp();
    const cookie = await signIn(app, plain.email);

    // No proof can be minted without the authority ...
    expect(
      await mintStepUpToken(
        app,
        cookie,
        "audit_export",
        { format: "csv" },
        PASSWORD,
      ),
    ).toBeNull();
    // ... and the route refuses on the capability, not on the missing proof.
    const response = await exportAudit(
      app,
      cookie,
      { format: "csv" },
      { [STEP_UP_TOKEN_HEADER]: "A".repeat(43) },
    );
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("step_up");
    expect(await exportedRows()).toHaveLength(0);
  });
});
