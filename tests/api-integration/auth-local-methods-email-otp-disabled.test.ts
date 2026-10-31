import { createRequire } from "node:module";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S6 with `DISABLE_EMAIL_OTP_SIGN_IN=true`: the email-code plugin is never mounted, so the portal
 * must not advertise or admit it, even when a stored row says it is on, and God Mode must refuse
 * to store it as on. `auth.ts` reads the flag once at import, so it is set before any import.
 */
const environment = vi.hoisted(() => {
  const previous = process.env.DISABLE_EMAIL_OTP_SIGN_IN;
  process.env.DISABLE_EMAIL_OTP_SIGN_IN = "true";
  return { previous };
});

import {
  getConfiguredAgentOrigin,
  getConfiguredCustomerOrigin,
  reloadAuthConfiguration,
} from "../../apps/api/src/auth";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import { nextClientIp } from "./helpers/organization-http";
import { mintStepUpToken, STEP_UP_TOKEN_HEADER } from "./helpers/step-up";

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};
const PASSWORD = "auth-local-methods-env-password";
const PATH = "/api/instance/auth/local-methods";
const ADMIN_ID = "local-methods-env-admin";
type App = ReturnType<typeof createApp>["app"];

afterAll(() => {
  if (environment.previous === undefined)
    delete process.env.DISABLE_EMAIL_OTP_SIGN_IN;
  else process.env.DISABLE_EMAIL_OTP_SIGN_IN = environment.previous;
});

beforeEach(async () => {
  await resetTestDatabase();
  await db
    .insert(schema.instanceSettingTable)
    .values({ id: "singleton", setupCompletedAt: new Date() });
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id: ADMIN_ID,
      name: "Env admin",
      email: `${ADMIN_ID}@example.test`,
      role: "admin",
    })
    .returning();
  if (!user) throw new Error("user fixture");
  await ensureStaffPersonForUser(user.id);
  await db.insert(schema.accountTable).values({
    id: `${ADMIN_ID}-account`,
    accountId: ADMIN_ID,
    providerId: "credential",
    userId: ADMIN_ID,
    password: await bcrypt.hash(PASSWORD, 4),
  });
  // An install that switched customer email code on before the environment turned it off.
  await db.insert(schema.instancePluginConfigTable).values({
    id: "env-customer-email-otp",
    pluginId: "auth.email-otp",
    instanceKey: "customer",
    displayName: "Email code (customer)",
    enabled: true,
    config: {},
    scope: "instance",
    portalScope: "customer",
    configVersion: 1,
  });
  await reloadAuthConfiguration();
});

async function staffSession(app: App) {
  const origin = getConfiguredAgentOrigin();
  const login = await app.request(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      host: new URL(origin).host,
      origin,
      "content-type": "application/json",
      "x-forwarded-for": nextClientIp(),
    },
    body: JSON.stringify({
      email: `${ADMIN_ID}@example.test`,
      password: PASSWORD,
    }),
  });
  expect(login.status, await login.clone().text()).toBe(200);
  const cookie = login.headers
    .getSetCookie()
    .find((value) => value.startsWith("__Host-tdk_agent_session="))
    ?.split(";", 1)[0];
  expect(cookie).toBeDefined();
  return cookie as string;
}

function portalRequest(app: App, path: string, init: RequestInit = {}) {
  const origin = getConfiguredCustomerOrigin();
  return app.request(`${origin}${path}`, {
    ...init,
    headers: {
      host: new URL(origin).host,
      origin,
      "content-type": "application/json",
      "x-forwarded-for": nextClientIp(),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

describe("local sign-in methods with DISABLE_EMAIL_OTP_SIGN_IN (S6)", () => {
  it("never offers or admits customer email code, and refuses to store it as on", async () => {
    const { app } = createApp();

    // The stored row says on; the portal reports and admits what the runtime can serve.
    const methods = await portalRequest(app, "/api/portal/auth-methods", {
      method: "GET",
    });
    expect(await methods.json()).toEqual({
      password: false,
      magicLink: false,
      emailOtp: false,
    });
    const send = await portalRequest(
      app,
      "/api/auth/email-otp/send-verification-otp",
      {
        method: "POST",
        body: JSON.stringify({
          email: "customer@example.test",
          type: "sign-in",
        }),
      },
    );
    expect(send.status).not.toBe(200);

    const cookie = await staffSession(app);
    const read = await app.request(PATH, { headers: { cookie } });
    expect(read.status).toBe(200);
    const current = (await read.json()) as {
      customer: { emailOtp: boolean };
      emailOtpDisabledByEnvironment: boolean;
      revision: string;
    };
    expect(current.emailOtpDisabledByEnvironment).toBe(true);
    // God Mode still shows the stored row, next to the environment notice.
    expect(current.customer.emailOtp).toBe(true);

    const put = async (body: Record<string, unknown>) => {
      const token = await mintStepUpToken(
        app,
        cookie,
        "auth_local_methods_update",
        body,
        PASSWORD,
      );
      expect(token).not.toBeNull();
      return csrfRequest(
        app,
        PATH,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            cookie,
            [STEP_UP_TOKEN_HEADER]: token as string,
          },
          body: JSON.stringify(body),
        },
        cookie,
      );
    };

    // Enabling email code for either portal is refused before the proof is spent.
    for (const body of [
      {
        agent: { password: true, magicLink: true, emailOtp: false },
        customer: { password: true, magicLink: false, emailOtp: true },
        expectedRevision: current.revision,
      },
      {
        agent: { password: true, magicLink: true, emailOtp: true },
        customer: { password: true, magicLink: false, emailOtp: false },
        expectedRevision: current.revision,
      },
    ]) {
      const refused = await put(body);
      expect(refused.status).toBe(422);
      expect(await refused.text()).toContain(
        "email_otp_disabled_by_environment",
      );
      const proofs = await db
        .select({ state: schema.stepUpConfirmationTable.state })
        .from(schema.stepUpConfirmationTable)
        .where(
          eq(
            schema.stepUpConfirmationTable.operationKey,
            "auth_local_methods_update",
          ),
        );
      // Minting supersedes an older proof; the one just minted is still unspent.
      expect(proofs.filter((proof) => proof.state === "issued")).toHaveLength(
        1,
      );
    }
    const audits = await db
      .select({ id: schema.auditLogTable.id })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.action, "plugin.changed"),
          eq(schema.auditLogTable.entityId, "auth.local-methods"),
        ),
      );
    expect(audits).toHaveLength(0);

    // A save with email code off is accepted and clears the stale stored row.
    const accepted = await put({
      agent: { password: true, magicLink: true, emailOtp: false },
      customer: { password: true, magicLink: false, emailOtp: false },
      expectedRevision: current.revision,
    });
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    expect(
      (
        (await accepted.json()) as {
          customer: { emailOtp: boolean; password: boolean };
        }
      ).customer,
    ).toEqual({ password: true, magicLink: false, emailOtp: false });
    const after = await portalRequest(app, "/api/portal/auth-methods", {
      method: "GET",
    });
    expect(await after.json()).toEqual({
      password: true,
      magicLink: false,
      emailOtp: false,
    });
  });
});
