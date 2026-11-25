import { describe, expect, it } from "vitest";
import {
  hashPassword,
  verifyPassword,
} from "../../../apps/api/src/auth/password-hash";

describe("password hash", () => {
  it("hashes new passwords with argon2id and verifies them", async () => {
    const hash = await hashPassword("correct horse");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "correct horse")).toEqual({
      valid: true,
      needsRehash: false,
    });
    expect((await verifyPassword(hash, "wrong")).valid).toBe(false);
  });

  it("verifies a legacy bcrypt hash and asks for a rehash only on a match", async () => {
    // bcrypt cost 4 of "old secret"
    const legacy =
      "$2b$04$7cfG74vxZplSc30onlI4UORjWx2BORgfFtrANP44k/E61FX1N04CW";
    expect(await verifyPassword(legacy, "old secret")).toEqual({
      valid: true,
      needsRehash: true,
    });
    expect(await verifyPassword(legacy, "nope")).toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it("rejects an unknown hash format", async () => {
    expect((await verifyPassword("plain", "plain")).valid).toBe(false);
  });
});
