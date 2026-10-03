import { describe, expect, it } from "vitest";
import { hasInvalidExplicitCredential } from "../../../apps/api/src/utils/authenticate-api-request";

describe("explicit API credentials", () => {
  it.each([
    "",
    " ",
    "Basic token",
    "Digest token",
    "Bearer",
    "Bearer token with-space",
  ])(
    "rejects unsupported or malformed Authorization value %j without cookie fallback",
    (authorization) => {
      expect(hasInvalidExplicitCredential(authorization, undefined)).toBe(true);
    },
  );

  it.each(["", " ", "\t"])("rejects blank x-api-key value %j", (apiKey) => {
    expect(hasInvalidExplicitCredential(undefined, apiKey)).toBe(true);
  });

  it("allows a syntactically valid Bearer credential to be resolved by key verification", () => {
    expect(hasInvalidExplicitCredential("Bearer taskdesk_key", undefined)).toBe(
      false,
    );
  });
});
