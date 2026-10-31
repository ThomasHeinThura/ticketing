import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";

/**
 * Issue #704 part 2: the app-wide `/api` body limit in front of the real Better Auth handler and
 * database. An oversize anonymous `/api/auth/*` body is refused with the API's plain-text `413`
 * and creates nothing; a normal-size request still reaches Better Auth.
 */
let clientIpCounter = 0;
const nextClientIp = () => `198.51.100.${(++clientIpCounter % 250) + 1}`;

beforeEach(async () => {
  await resetTestDatabase();
  await db.insert(schema.instanceSettingTable).values({ id: "singleton" });
});

describe("API integration: /api request-body limit (issue #704)", () => {
  it("refuses an oversize anonymous sign-up body with 413 and creates no user", async () => {
    const { app } = createApp();
    const response = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": nextClientIp(),
      },
      body: JSON.stringify({
        email: "oversize@example.test",
        password: "oversize-body-password",
        name: "x".repeat(64 * 1024),
      }),
    });
    expect(response.status).toBe(413);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toBe("Payload too large");
    expect(await db.select().from(schema.userTable)).toHaveLength(0);
  });

  it("still hands a normal-size sign-in body to Better Auth", async () => {
    const { app } = createApp();
    const response = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": nextClientIp(),
      },
      body: JSON.stringify({
        email: "nobody@example.test",
        password: "wrong-password-value",
      }),
    });
    // Better Auth answered (unknown account), not the body limit.
    expect(response.status).not.toBe(413);
    expect(response.status).toBeLessThan(500);
  });
});
