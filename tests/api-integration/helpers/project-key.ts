import { randomBytes } from "node:crypto";

/**
 * A valid project key (PR-13: 2-8 uppercase letters, `^[A-Z]{2,8}$`) that is unique enough
 * for a test run. The create route rejects anything else with 400, so tests that create a
 * project through the API must not derive the key from a UUID or a hyphenated name.
 */
export function projectKey(length = 6): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return Array.from(randomBytes(length), (byte) => letters[byte % 26]).join("");
}
