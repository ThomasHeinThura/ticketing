import { randomBytes } from "node:crypto";

/**
 * A valid project key (PR-13: 2-8 uppercase letters, `^[A-Z]{2,8}$`). The create route
 * refuses anything else with 400, so an E2E that creates a project through the API must not
 * derive the key from a UUID or a hyphenated name.
 */
export function uniqueProjectKey(length = 6): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return Array.from(randomBytes(length), (byte) => letters[byte % 26]).join("");
}
