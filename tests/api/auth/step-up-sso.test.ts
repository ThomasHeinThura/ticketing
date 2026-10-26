import { describe, expect, it } from "vitest";
import {
  hasMappedFreshUpstreamMfa,
  isFreshSignedAuthTime,
  readSignedAuthTime,
} from "../../../apps/api/src/auth/step-up-sso";

describe("SSO step-up signed authentication time", () => {
  const challengeCreatedAt = new Date("2026-10-25T10:00:00.000Z");
  const callbackReceivedAt = new Date("2026-10-25T10:04:00.000Z");

  it("accepts the exact challenge and callback skew boundaries", () => {
    expect(
      isFreshSignedAuthTime({
        authTime: new Date(challengeCreatedAt.getTime() - 60_000),
        challengeCreatedAt,
        callbackReceivedAt,
      }),
    ).toBe(true);
    expect(
      isFreshSignedAuthTime({
        authTime: new Date(callbackReceivedAt.getTime() + 60_000),
        challengeCreatedAt,
        callbackReceivedAt,
      }),
    ).toBe(true);
  });

  it("rejects stale, future, and malformed signed auth_time claims", () => {
    expect(
      isFreshSignedAuthTime({
        authTime: new Date(challengeCreatedAt.getTime() - 60_001),
        challengeCreatedAt,
        callbackReceivedAt,
      }),
    ).toBe(false);
    expect(
      isFreshSignedAuthTime({
        authTime: new Date(callbackReceivedAt.getTime() + 60_001),
        challengeCreatedAt,
        callbackReceivedAt,
      }),
    ).toBe(false);
    expect(readSignedAuthTime({})).toBeNull();
    expect(readSignedAuthTime({ auth_time: "1792922400" })).toBeNull();
    expect(readSignedAuthTime({ auth_time: Number.NaN })).toBeNull();
    expect(readSignedAuthTime({ auth_time: 1.5 })).toBeNull();
  });

  it("does not treat static or arbitrary provider MFA claims as mapped evidence", () => {
    expect(
      hasMappedFreshUpstreamMfa({ amr: ["mfa"], acr: "urn:example:mfa" }),
    ).toBe(false);
  });
});
