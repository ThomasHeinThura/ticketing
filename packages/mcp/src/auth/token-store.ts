import { unlink } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/**
 * What is left of the MCP credential store: the ability to **delete** it.
 *
 * This module used to load, save and clear `~/.config/taskdesk-mcp/credentials.json`
 * — the access token cached by better-auth's device-authorization flow. Issue #6
 * removed that flow, both server-side and, in this change, client-side, so nothing
 * writes the file any more.
 *
 * The read path went with it, deliberately. A `credentials.json` still on disk holds
 * a token minted by a removed authorization path; reading it would let that token
 * keep authenticating. Migrations `0048` and `0049` make the same point about the
 * server tables — dropping them is not revocation — and the client half of that is
 * refusing to present the credential rather than merely losing the ability to
 * refresh it.
 *
 * `clearCredentials()` remains so a stale file can be **purged** rather than left
 * lying around ignored. Revoking the session that token belongs to, server-side, is
 * issue #17.
 */

function configDir(): string {
  const base =
    process.env.XDG_CONFIG_HOME?.trim() || path.join(homedir(), ".config");
  return path.join(base, "taskdesk-mcp");
}

export function credentialsPath(): string {
  return path.join(configDir(), "credentials.json");
}

/** Deletes any credentials file left behind by the removed device flow. */
export async function clearCredentials(): Promise<void> {
  try {
    await unlink(credentialsPath());
  } catch {
    // Already gone, or never written. Both are the desired end state.
  }
}
