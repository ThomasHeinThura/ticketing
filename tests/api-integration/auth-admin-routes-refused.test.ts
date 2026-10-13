import { createRequire } from "node:module";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";

/**
 * Better Auth's admin plugin is kept as a session primitive only
 * (docs/01-architecture/auth-and-identity.md). Its HTTP endpoints grant
 * instance admin, set passwords, ban, impersonate and hard-delete with no
 * step-up, eligibility check or audit, so `/api/auth/admin/*` must be refused
 * for even a genuine instance-admin session. The refusal lives in the
 * `hooks.before` of `createAuth` (apps/api/src/auth.ts).
 */
const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};
const PASSWORD = "admin-routes-fixture-password";
// Each sign-in is a distinct client for the auth rate limiter.
let clientIpCounter = 0;
const nextClientIp = () => `198.51.100.${(++clientIpCounter % 250) + 1}`;

beforeEach(async () => {
  await resetTestDatabase();
  await db.insert(schema.instanceSettingTable).values({ id: "singleton" });
});

async function createUser(id: string, role: "admin" | "user") {
  const [user] = await db
    .insert(schema.userTable)
    .values({ id, name: id, email: `${id}@example.test`, role })
    .returning();
  if (!user) throw new Error("fixture user was not created");
  await ensureStaffPersonForUser(user.id);
  await db.insert(schema.accountTable).values({
    id: `${id}-account`,
    accountId: user.id,
    providerId: "credential",
    userId: user.id,
    password: await bcrypt.hash(PASSWORD, 4),
  });
  return user;
}

async function signIn(app: ReturnType<typeof createApp>["app"], email: string) {
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

async function snapshot(userId: string) {
  const [user] = await db
    .select()
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId));
  const [account] = await db
    .select()
    .from(schema.accountTable)
    .where(eq(schema.accountTable.userId, userId));
  const sessions = await db
    .select({ id: schema.sessionTable.id })
    .from(schema.sessionTable)
    .where(eq(schema.sessionTable.userId, userId));
  const users = await db
    .select({ id: schema.userTable.id })
    .from(schema.userTable);
  return {
    role: user?.role,
    banned: user?.banned,
    banReason: user?.banReason,
    passwordHash: account?.password,
    exists: Boolean(user),
    sessionIds: sessions.map((s) => s.id).sort(),
    userIds: users.map((u) => u.id).sort(),
  };
}

const ADMIN_ROUTES = (target: string): [string, string, unknown][] => [
  ["POST", "/api/auth/admin/set-role", { userId: target, role: "admin" }],
  [
    "POST",
    "/api/auth/admin/create-user",
    {
      email: "created@example.test",
      password: "created-password-123",
      name: "Created",
      role: "admin",
    },
  ],
  [
    "POST",
    "/api/auth/admin/set-user-password",
    { userId: target, newPassword: "hijacked-password-123" },
  ],
  ["POST", "/api/auth/admin/impersonate-user", { userId: target }],
  ["POST", "/api/auth/admin/remove-user", { userId: target }],
  ["POST", "/api/auth/admin/ban-user", { userId: target, banReason: "x" }],
  ["POST", "/api/auth/admin/unban-user", { userId: target }],
  ["POST", "/api/auth/admin/revoke-user-sessions", { userId: target }],
  ["GET", "/api/auth/admin/list-users", undefined],
];

describe("Better Auth admin plugin HTTP routes are refused", () => {
  it.each(ADMIN_ROUTES("victim"))(
    "refuses %s %s for an instance-admin session without changing state",
    async (method, path, body) => {
      await createUser("admin-actor", "admin");
      await createUser("victim", "user");
      const { app } = createApp();
      const cookie = await signIn(app, "admin-actor@example.test");
      const before = await snapshot("victim");

      const response =
        method === "GET"
          ? await app.request(path, {
              headers: { cookie, origin: "http://localhost:1337" },
            })
          : await csrfRequest(
              app,
              path,
              {
                method,
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
              },
              cookie,
            );

      expect([403, 404]).toContain(response.status);
      expect(await snapshot("victim")).toEqual(before);
      expect(before.role).toBe("user");
      expect(before.banned).toBeFalsy();
    },
  );

  it("still refuses path variants (trailing/double slash, case, encoding)", async () => {
    await createUser("admin-actor", "admin");
    await createUser("victim", "user");
    const { app } = createApp();
    const cookie = await signIn(app, "admin-actor@example.test");
    const before = await snapshot("victim");
    const variants = [
      "/api/auth/admin/set-role/",
      "/api/auth//admin/set-role",
      "/api/auth/admin//set-role",
      "/api/auth/Admin/set-role",
      "/api/auth/ADMIN/SET-ROLE",
      "/api/auth/%61dmin/set-role",
      "/api/auth/admin%2Fset-role",
      "/api/auth/./admin/set-role",
      "/api/auth/x/../admin/set-role",
      "/api/auth/admin/set-role?x=1",
      "/api/auth/admin/set-role;x",
    ];
    for (const path of variants) {
      let response: Response;
      try {
        response = await csrfRequest(
          app,
          path,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ userId: "victim", role: "admin" }),
          },
          cookie,
        );
      } catch {
        // csrfRequest rejects targets that normalise out of `/api/`: nothing sent.
        continue;
      }
      expect(response.status, path).not.toBe(200);
      expect(await snapshot("victim"), path).toEqual(before);
    }
  });

  it("keeps the plugin's session fields and ban enforcement working", async () => {
    await createUser("admin-actor", "admin");
    await createUser("banned-user", "user");
    const { app } = createApp();
    const cookie = await signIn(app, "admin-actor@example.test");

    const session = await app.request("/api/auth/get-session", {
      headers: { cookie },
    });
    const body = (await session.json()) as { user?: { role?: string } };
    expect(body.user?.role).toBe("admin");

    await db
      .update(schema.userTable)
      .set({ banned: true, banReason: "test" })
      .where(eq(schema.userTable.id, "banned-user"));
    const login = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": nextClientIp(),
      },
      body: JSON.stringify({
        email: "banned-user@example.test",
        password: PASSWORD,
      }),
    });
    expect(login.status).toBeGreaterThanOrEqual(400);
    expect(
      login.headers
        .getSetCookie()
        .some((c) => c.startsWith("__Host-tdk_agent_session=")),
    ).toBe(false);
  });
});
