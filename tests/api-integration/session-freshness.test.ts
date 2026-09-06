import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";

type SessionResponse = { user: { image: string | null; name: string } } | null;

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

function collectCookies(response: Response) {
  return applyCookies("", response);
}

async function signUp(app: ReturnType<typeof createApp>["app"]) {
  const response = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "avatar-session@example.com",
      password: "correct horse battery staple",
      name: "Avatar Session",
    }),
  });

  expect(response.status).toBe(200);
  const cookies = collectCookies(response);
  expect(cookies).not.toBe("");

  return cookies;
}

/**
 * Session freshness, after the cookie cache was disabled in issue #6.
 *
 * kaneo cached the session in the cookie for five minutes. That path returns
 * session data with NO database read, so a revoked session kept working for up
 * to five minutes and a forged cookie was never compared against any row. The
 * two tests that used to live here asserted the STALENESS was tolerable —
 * that `get-session` returned the old user until you passed
 * `?disableCookieCache=true`.
 *
 * That is now the wrong assertion. These are its inverse: an ordinary
 * `get-session`, with no special query parameter, must already reflect the
 * database. If the cache is ever re-enabled, these fail.
 */
describe("API integration: session freshness without a cookie cache", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("reflects a profile update immediately, with no cache-bypass parameter", async () => {
    const { app } = createApp();
    const cookies = await signUp(app);

    const update = await app.request("/api/auth/update-user", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookies },
      body: JSON.stringify({ image: "/api/user/avatar/new-avatar-id" }),
    });
    expect(update.status).toBe(200);

    // The plain call — the one kaneo served from the cookie cache.
    const session = (await (
      await app.request("/api/auth/get-session", {
        headers: { cookie: cookies },
      })
    ).json()) as SessionResponse;

    expect(session?.user.image).toBe("/api/user/avatar/new-avatar-id");
  });

  it("gives the same answer with and without disableCookieCache", async () => {
    const { app } = createApp();
    const cookies = await signUp(app);

    await app.request("/api/auth/update-user", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookies },
      body: JSON.stringify({ name: "Renamed User" }),
    });

    const plain = (await (
      await app.request("/api/auth/get-session", {
        headers: { cookie: cookies },
      })
    ).json()) as SessionResponse;
    const bypassed = (await (
      await app.request("/api/auth/get-session?disableCookieCache=true", {
        headers: { cookie: cookies },
      })
    ).json()) as SessionResponse;

    // Identical answers mean there is no cache to bypass.
    expect(plain?.user.name).toBe("Renamed User");
    expect(bypassed?.user.name).toBe("Renamed User");
  });
});
