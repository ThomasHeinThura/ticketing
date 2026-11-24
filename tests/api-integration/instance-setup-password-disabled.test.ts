import { randomBytes, randomUUID } from "node:crypto";
import { count } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `isPasswordRegistrationDisabled` in auth.ts is read once at module load, and setup.ts
// forces it to "false", so set it before this file imports the app.
vi.hoisted(() => {
  process.env.DISABLE_PASSWORD_REGISTRATION = "true";
});

import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import {
  ensureSetupToken,
  SETUP_TOKEN_HEADER,
} from "../../apps/api/src/instance/setup-token";
import { resetTestDatabase } from "./helpers/database";
import { nextClientIp } from "./helpers/organization-http";

const password =
  randomBytes(24).toString("hex") + String.fromCharCode(65, 97, 49, 33);

async function userCount() {
  const [row] = await db.select({ value: count() }).from(schema.userTable);
  return row?.value ?? 0;
}

function signUp(app: ReturnType<typeof createApp>["app"], setupToken?: string) {
  return app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": nextClientIp(),
      ...(setupToken ? { [SETUP_TOKEN_HEADER]: setupToken } : {}),
    },
    body: JSON.stringify({
      email: `pw-disabled-${randomUUID()}@example.com`,
      password,
      name: "Password Disabled Candidate",
    }),
  });
}

// #232 (owner decision 24 Nov 2026): with DISABLE_PASSWORD_REGISTRATION=true the early gate's
// refusal text differs between an unclaimed and a claimed instance. That difference only reveals
// whether the instance is claimed and is an accepted risk; this pins the behaviour around it.
describe("#232: password registration disabled by environment", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("refuses an unauthorised sign-up on an unclaimed instance and creates no user", async () => {
    const { app } = createApp();
    const response = await signUp(app);

    expect(response.status).toBe(403);
    expect(await userCount()).toBe(0);
  });

  it("still lets a valid setup token claim the instance, then refuses everyone else", async () => {
    const { app } = createApp();
    const token = (await ensureSetupToken()) as string;

    expect((await signUp(app, token)).status).toBe(200);
    expect(await userCount()).toBe(1);

    const refused = await signUp(app);
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { message: string }).message).toMatch(
      /Password registration is currently disabled/,
    );
    expect(await userCount()).toBe(1);
  });
});
