import { clearCredentials } from "./token-store.js";

export type AuthServiceOptions = {
  baseUrl: string;
  clientId: string;
  apiKey?: string;
};

/**
 * Authentication for the MCP client.
 *
 * **`TASKDESK_API_KEY` is the only way to authenticate.** That is not a new
 * restriction — it is the only path that has worked since issue #6 removed
 * better-auth's `deviceAuthorization()` plugin and kaneo's in-process MCP OAuth
 * server. Both `/api/auth/device/code` and `/api/auth/device/token` return **404**.
 *
 * This class used to run that device flow: request a code, open a browser, poll for
 * a token, and cache the result to `~/.config/taskdesk-mcp/credentials.json`. All of
 * it was retained after the server side was deleted, so the package's only
 * interactive path POSTed to endpoints that no longer exist. Independent review of
 * `a4147a1` found it; removing it is issue #6's inherited-surface work, not #17's.
 *
 * **Stored credentials are no longer honoured, and that is deliberate.** A
 * `credentials.json` on disk holds an access token minted by the very flow this
 * change removes. Reading it would let a token from a deleted authorization path
 * keep authenticating — which is exactly the distinction migrations `0048` and
 * `0049` make when they say dropping the tables is not revocation. `clearToken()`
 * still deletes the file, so a stale one can be purged rather than merely ignored.
 *
 * Revoking sessions those flows already minted **server-side** remains issue #17.
 * This only stops the client from presenting them.
 */
export class AuthService {
  readonly baseUrl: string;
  readonly clientId: string;
  private readonly apiKey?: string;

  constructor(options: AuthServiceOptions) {
    this.baseUrl = options.baseUrl;
    this.clientId = options.clientId;
    this.apiKey = options.apiKey;
  }

  /**
   * True when a pre-created TaskDesk API key is configured.
   *
   * Now always the case for a working client — there is no other credential — but
   * kept because callers use it to decide whether to clear and retry auth on a 401,
   * and a static key must not be cleared.
   */
  get usingApiKey(): boolean {
    return Boolean(this.apiKey);
  }

  async clearToken(): Promise<void> {
    // Nothing to clear for API-key auth; the key is static config.
    if (this.apiKey) return;
    // Purges any credentials.json left by the removed device flow.
    await clearCredentials();
  }

  private log(msg: string): void {
    console.error(`[taskdesk-mcp] ${msg}`);
  }

  /**
   * Returns the configured API key, or throws.
   *
   * Throwing is the honest answer. The alternative — falling back to a cached
   * token — would honour a credential minted by a removed flow, and the
   * alternative before that, running the flow itself, reaches a 404.
   */
  async getAccessToken(): Promise<string> {
    if (this.apiKey) {
      return this.apiKey;
    }

    this.log(
      "No TASKDESK_API_KEY is set. Interactive device authorization was removed in issue #6 and its endpoints return 404; create an API key in TaskDesk and set TASKDESK_API_KEY.",
    );
    throw new Error(
      "TASKDESK_API_KEY is required: interactive device authorization has been removed.",
    );
  }
}
