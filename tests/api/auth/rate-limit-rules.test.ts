import { describe, expect, it } from "vitest";
import { AUTH_RATE_LIMIT } from "../../../apps/api/src/auth/rate-limit-rules";

describe("better-auth rate limit rules", () => {
  it("keeps the limiter on with the default per-IP budget", () => {
    expect(AUTH_RATE_LIMIT.enabled).toBe(true);
    expect(AUTH_RATE_LIMIT.window).toBe(10);
    expect(AUTH_RATE_LIMIT.max).toBe(100);
  });

  it("keeps the sign-up throttle", () => {
    expect(AUTH_RATE_LIMIT.customRules["/sign-up/email"]).toEqual({
      window: 60,
      max: 3,
    });
  });

  it("exempts only the session read", () => {
    const exempt = Object.entries(AUTH_RATE_LIMIT.customRules)
      .filter(([, rule]) => rule === false)
      .map(([path]) => path);
    expect(exempt).toEqual(["/get-session"]);
  });
});
