import { createHmac, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import { ensureNotFirstSignup } from "./helpers/organization-http";

const passwordForTest = () => `Pw-${randomUUID()}`;

function applyCookies(existing: string, response: Response) {
  const jar = new Map<string, string>();

  for (const pair of existing.split("; ").filter(Boolean)) {
    const [name, ...value] = pair.split("=");
    if (name) jar.set(name, value.join("="));
  }

  for (const setCookie of response.headers.getSetCookie()) {
    const [pair] = setCookie.split(";");
    const [name, ...value] = (pair ?? "").split("=");
    if (!name) continue;
    if (value.join("=") === "") {
      jar.delete(name);
      continue;
    }
    jar.set(name, value.join("="));
  }

  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

function postJson(
  app: ReturnType<typeof createApp>["app"],
  path: string,
  body: Record<string, unknown>,
  cookie?: string,
) {
  return app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:1337",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function base32Decode(value: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let buffer = 0;
  let bits = 0;
  const bytes: number[] = [];

  for (const character of value.toUpperCase().replaceAll("=", "")) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error("Invalid TOTP secret encoding");
    buffer = (buffer << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

function totpCode(uri: string) {
  const secret = new URL(uri).searchParams.get("secret");
  if (!secret) throw new Error("TOTP URI has no secret");

  const counter = BigInt(Math.floor(Date.now() / 30_000));
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", base32Decode(secret))
    .update(counterBytes)
    .digest();
  const lastByte = digest.at(-1);
  if (lastByte === undefined) throw new Error("TOTP digest is empty");
  const offset = lastByte & 0x0f;
  const first = digest[offset];
  const second = digest[offset + 1];
  const third = digest[offset + 2];
  const fourth = digest[offset + 3];
  if (
    first === undefined ||
    second === undefined ||
    third === undefined ||
    fourth === undefined
  ) {
    throw new Error("TOTP digest is truncated");
  }
  const binary =
    ((first & 0x7f) << 24) |
    ((second & 0xff) << 16) |
    ((third & 0xff) << 8) |
    (fourth & 0xff);

  return String(binary % 1_000_000).padStart(6, "0");
}

async function signUp(app: ReturnType<typeof createApp>["app"]) {
  await ensureNotFirstSignup();
  const email = `two-factor-${randomUUID()}@example.com`;
  const password = passwordForTest();
  const response = await postJson(app, "/api/auth/sign-up/email", {
    email,
    password,
    name: "Two Factor Test",
  });

  expect(response.status).toBe(200);
  const cookies = applyCookies("", response);
  expect(cookies).not.toBe("");
  const [user] = await db
    .select()
    .from(schema.userTable)
    .where(eq(schema.userTable.email, email));
  if (!user) throw new Error("Sign-up did not create the test user");

  return { cookies, email, password, userId: user.id };
}

async function signIn(
  app: ReturnType<typeof createApp>["app"],
  email: string,
  password: string,
) {
  const response = await postJson(app, "/api/auth/sign-in/email", {
    email,
    password,
  });
  return { response, cookies: applyCookies("", response) };
}

async function enrollTotp(
  app: ReturnType<typeof createApp>["app"],
  cookies: string,
  password: string,
) {
  const enable = await postJson(
    app,
    "/api/auth/two-factor/enable",
    { password },
    cookies,
  );
  expect(enable.status).toBe(200);
  const enrollment = (await enable.json()) as {
    backupCodes: string[];
    totpURI: string;
  };
  expect(enrollment.backupCodes.length).toBeGreaterThan(0);
  expect(enrollment.totpURI).toContain("otpauth://totp/");

  const verify = await postJson(
    app,
    "/api/auth/two-factor/verify-totp",
    { code: totpCode(enrollment.totpURI) },
    cookies,
  );
  expect(verify.status).toBe(200);
  expect((await verify.json()).user.email).toBeTruthy();
  const previousSession = await app.request("/api/auth/get-session", {
    headers: { cookie: cookies },
  });
  expect(await previousSession.json()).toBeNull();

  return {
    backupCodes: enrollment.backupCodes,
    cookies: applyCookies(cookies, verify),
    totpURI: enrollment.totpURI,
  };
}

describe("better-auth optional TOTP and backup-code support", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("keeps sign-in password-only until a user enrolls in TOTP", async () => {
    const { app } = createApp();
    const account = await signUp(app);

    const [beforeEnrollment] = await db
      .select()
      .from(schema.userTable)
      .where(eq(schema.userTable.id, account.userId));
    expect(beforeEnrollment?.twoFactorEnabled).toBe(false);

    await postJson(app, "/api/auth/sign-out", {}, account.cookies);
    const { response, cookies } = await signIn(
      app,
      account.email,
      account.password,
    );

    expect(response.status).toBe(200);
    expect((await response.json()).twoFactorRedirect).not.toBe(true);
    const session = await app.request("/api/auth/get-session", {
      headers: { cookie: cookies },
    });
    expect(session.status).toBe(200);
    expect((await session.json()).user.email).toBe(account.email);
  });

  it("verifies TOTP enrollment and requires TOTP at the next password sign-in", async () => {
    const { app } = createApp();
    const account = await signUp(app);
    const enrollment = await enrollTotp(app, account.cookies, account.password);

    const [user] = await db
      .select()
      .from(schema.userTable)
      .where(eq(schema.userTable.id, account.userId));
    const [factor] = await db
      .select()
      .from(schema.twoFactorTable)
      .where(eq(schema.twoFactorTable.userId, account.userId));
    expect(user?.twoFactorEnabled).toBe(true);
    expect(factor?.verified).toBe(true);

    await postJson(app, "/api/auth/sign-out", {}, enrollment.cookies);
    const challenge = await signIn(app, account.email, account.password);
    expect(challenge.response.status).toBe(200);
    expect((await challenge.response.json()).twoFactorMethods).toEqual([
      "totp",
    ]);

    const unauthenticated = await app.request("/api/auth/get-session", {
      headers: { cookie: challenge.cookies },
    });
    expect(await unauthenticated.json()).toBeNull();

    const verify = await postJson(
      app,
      "/api/auth/two-factor/verify-totp",
      { code: totpCode(enrollment.totpURI) },
      challenge.cookies,
    );
    expect(verify.status).toBe(200);
    const authenticated = await app.request("/api/auth/get-session", {
      headers: { cookie: applyCookies(challenge.cookies, verify) },
    });
    expect((await authenticated.json()).user.email).toBe(account.email);
  });

  it("accepts a backup code once and rejects it on a later challenge", async () => {
    const { app } = createApp();
    const account = await signUp(app);
    const enrollment = await enrollTotp(app, account.cookies, account.password);
    const backupCode = enrollment.backupCodes[0];
    if (!backupCode) throw new Error("Enrollment returned no backup code");

    await postJson(app, "/api/auth/sign-out", {}, enrollment.cookies);
    const firstChallenge = await signIn(app, account.email, account.password);
    const firstVerification = await postJson(
      app,
      "/api/auth/two-factor/verify-backup-code",
      { code: backupCode },
      firstChallenge.cookies,
    );
    expect(firstVerification.status).toBe(200);
    const authenticated = await app.request("/api/auth/get-session", {
      headers: {
        cookie: applyCookies(firstChallenge.cookies, firstVerification),
      },
    });
    expect((await authenticated.json()).user.email).toBe(account.email);

    await postJson(
      app,
      "/api/auth/sign-out",
      {},
      applyCookies(firstChallenge.cookies, firstVerification),
    );
    const secondChallenge = await signIn(app, account.email, account.password);
    const reusedCode = await postJson(
      app,
      "/api/auth/two-factor/verify-backup-code",
      { code: backupCode },
      secondChallenge.cookies,
    );
    expect(reusedCode.status).toBe(401);
    const unauthenticated = await app.request("/api/auth/get-session", {
      headers: { cookie: applyCookies(secondChallenge.cookies, reusedCode) },
    });
    expect(await unauthenticated.json()).toBeNull();
  });
});
