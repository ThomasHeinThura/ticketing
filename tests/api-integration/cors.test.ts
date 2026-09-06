import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/index";

const originalNodeEnv = process.env.NODE_ENV;
const originalClientUrl = process.env.TASKDESK_AGENT_URL;
const originalCorsOrigins = process.env.CORS_ORIGINS;

function restore(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

afterEach(() => {
  restore("NODE_ENV", originalNodeEnv);
  restore("TASKDESK_AGENT_URL", originalClientUrl);
  restore("CORS_ORIGINS", originalCorsOrigins);
});

async function originHeaderFor(requestOrigin: string) {
  const { app } = createApp();
  const response = await app.request("/api/health", {
    headers: { origin: requestOrigin },
  });
  return response.headers.get("access-control-allow-origin");
}

describe("API integration: CORS origin policy", () => {
  it("refuses unconfigured cross-origin requests in production", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.TASKDESK_AGENT_URL;
    delete process.env.CORS_ORIGINS;

    expect(await originHeaderFor("https://attacker.example")).toBeNull();
  });

  // Negative guard for issue #6, CRITICAL. kaneo gated reflection on
  // `NODE_ENV !== "production"`, and "not production" includes UNSET — the
  // normal state of a self-hosted deployment, which is what TaskDesk ships.
  // Combined with `credentials: true`, any website could read a logged-in
  // victim's authenticated responses. The existing tests above and below only
  // exercised the two explicit values, so nothing covered the case that was
  // actually broken.
  it("refuses unconfigured cross-origin requests when NODE_ENV is unset", async () => {
    delete process.env.NODE_ENV;
    delete process.env.TASKDESK_AGENT_URL;
    delete process.env.CORS_ORIGINS;

    expect(await originHeaderFor("https://attacker.example")).toBeNull();
  });

  it("refuses unconfigured cross-origin requests under any unexpected NODE_ENV", async () => {
    process.env.NODE_ENV = "staging";
    delete process.env.TASKDESK_AGENT_URL;
    delete process.env.CORS_ORIGINS;

    expect(await originHeaderFor("https://attacker.example")).toBeNull();
  });

  it("still reflects the origin in development", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.TASKDESK_AGENT_URL;
    delete process.env.CORS_ORIGINS;

    expect(await originHeaderFor("http://localhost:5173")).toBe(
      "http://localhost:5173",
    );
  });

  it("allows the configured client URL and refuses everything else", async () => {
    process.env.NODE_ENV = "production";
    process.env.TASKDESK_AGENT_URL = "https://taskdesk.example";
    delete process.env.CORS_ORIGINS;

    expect(await originHeaderFor("https://taskdesk.example")).toBe(
      "https://taskdesk.example",
    );
    expect(await originHeaderFor("https://attacker.example")).toBeNull();
  });

  it("honours a comma-separated CORS_ORIGINS allowlist", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.TASKDESK_AGENT_URL;
    process.env.CORS_ORIGINS = "https://a.example, https://b.example";

    expect(await originHeaderFor("https://b.example")).toBe(
      "https://b.example",
    );
    expect(await originHeaderFor("https://c.example")).toBeNull();
  });
});
