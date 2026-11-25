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

  it("does not ask to rehash a password bcrypt truncated at 72 bytes", async () => {
    const long = "a".repeat(72);
    const legacy =
      "$2b$04$ZyVGXFWt2rOfRndyKDYOFeXm3rMJ/XOeGoyaIzp4azdfbMolFKD16"; // bcrypt cost 4 of "a" x72
    // a typo after byte 72 still verifies, so rehashing would lock the real password out
    expect(await verifyPassword(legacy, `${long}typo`)).toEqual({
      valid: true,
      needsRehash: false,
    });
  });

  it("keeps the event loop free during parallel legacy compares", async () => {
    const legacy =
      "$2b$10$EGmlivyQncItiMILoKYYEOOdhHdll9SqSAVFzIOOQpfNpI4M/4vgm"; // bcrypt cost 10 of "x"
    let ticks = 0;
    const timer = setInterval(() => ticks++, 10);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => verifyPassword(legacy, "wrong")),
    );
    clearInterval(timer);
    expect(results.every((r) => !r.valid)).toBe(true);
    expect(ticks).toBeGreaterThan(10);
  });

  it("rejects an unknown hash format", async () => {
    expect((await verifyPassword("plain", "plain")).valid).toBe(false);
  });
});
