import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
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

  it("lets a process exit on its own after a legacy verify (idle worker is unref'd)", async () => {
    const root = resolve(import.meta.dirname, "../../..");
    const script = `import { verifyPassword } from ${JSON.stringify(pathToFileURL(resolve(root, "apps/api/src/auth/password-hash.ts")).href)};
const r = await verifyPassword("$2b$04$7cfG74vxZplSc30onlI4UORjWx2BORgfFtrANP44k/E61FX1N04CW", "old secret");
console.log(r.valid);`;
    const file = resolve(mkdtempSync(resolve(tmpdir(), "pwhash-")), "run.mts");
    writeFileSync(file, script);
    const out = await new Promise<string>((done, fail) =>
      execFile(
        process.execPath,
        ["--import", "tsx", file],
        { cwd: resolve(root, "apps/api"), timeout: 15_000 },
        (err, stdout, stderr) => (err ? fail(err) : done(stdout || stderr)),
      ),
    );
    expect(out.trim()).toBe("true");
  }, 20_000);
  it("verifies a legacy bcrypt hash when the parent runs with --input-type=module", async () => {
    // The e2e fixtures start the API with `node --input-type=module -e`; workers must not inherit that flag.
    const root = resolve(import.meta.dirname, "../../..");
    const script = `import { verifyPassword } from ${JSON.stringify(pathToFileURL(resolve(root, "apps/api/src/auth/password-hash.ts")).href)};
const r = await verifyPassword("$2b$04$7cfG74vxZplSc30onlI4UORjWx2BORgfFtrANP44k/E61FX1N04CW", "old secret");
console.log(r.valid);`;
    const out = await new Promise<string>((done, fail) =>
      execFile(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "-e", script],
        { cwd: resolve(root, "apps/api"), timeout: 15_000 },
        (err, stdout, stderr) => (err ? fail(err) : done(stdout || stderr)),
      ),
    );
    expect(out.trim()).toBe("true");
  }, 20_000);
});
