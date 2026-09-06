/**
 * The approved better-auth plugin list.
 *
 * `/auth/*` is **one mounted handler**, and its endpoint set is defined by the better-auth
 * plugin list — rebuilt at runtime from database configuration — so `app.routes` shows a single
 * wildcard where dozens of endpoints live. A delegated policy allowlists the mount; it does not
 * cover what is behind it. The control that closes that gap is this one: assert the
 * **constructed plugin list equals the approved list**, and re-run the same assertion on every
 * runtime rebuild.
 *
 * Verdicts come from `docs/01-architecture/auth-and-identity.md` § "The better-auth plugin set
 * — inherited, removed, added", which is the identity half of the fork-time removal list in the
 * decision log. Ids are better-auth's runtime plugin ids, not the factory names.
 */

export type PluginVerdict =
  /** Inherited from kaneo and kept. Must be present. */
  | "kept"
  /** Removed at fork. Must not be present. */
  | "removed"
  /** Ours, added at the stated stage. Not required to be present before then. */
  | "added";

export type ApprovedPlugin = {
  readonly id: string;
  readonly verdict: PluginVerdict;
  readonly note: string;
};

export const BETTER_AUTH_PLUGINS: readonly ApprovedPlugin[] = [
  { id: "magic-link", verdict: "kept", note: "auth.magic-link" },
  { id: "email-otp", verdict: "kept", note: "auth.email-otp" },
  {
    id: "generic-oauth",
    verdict: "kept",
    note: "the protocol implementation every auth.oidc connection is built on",
  },
  {
    id: "api-key",
    verdict: "kept",
    note: "the credential only; our api_key table owns everything else",
  },
  {
    id: "admin",
    verdict: "kept",
    note: "session primitive only — its HTTP routes are not mounted and user.role is never read",
  },
  { id: "open-api", verdict: "kept", note: "development only" },
  { id: "last-login-method", verdict: "kept", note: "" },
  {
    id: "anonymous",
    verdict: "removed",
    note: "guest sign-in, on by default in kaneo. An ephemeral-identity surface does not ship dormant",
  },
  {
    id: "device-authorization",
    verdict: "removed",
    note: "a device-code grant no v2 spec asks for",
  },
  {
    id: "bearer",
    verdict: "removed",
    note: "a second token-bearing authentication surface; it published the raw session token in a CORS-exposed header",
  },
  {
    id: "organization",
    verdict: "removed",
    note: "kaneo's workspace model — replaced by our organisation/workspace/membership/role tables in P0 step 1b",
  },
  { id: "two-factor", verdict: "added", note: "TOTP and backup codes — P0" },
  { id: "passkey", verdict: "added", note: "later stage" },
];

const BY_ID = new Map(BETTER_AUTH_PLUGINS.map((plugin) => [plugin.id, plugin]));

export type PluginListBaseline = {
  /**
   * Plugins whose verdict is `removed` but which are still constructed, because the fork-time
   * removal (#6) has not merged yet. **A shrinking list**: an entry that is no longer present
   * fails, so the line must be deleted when the plugin goes.
   */
  readonly pendingRemoval: readonly string[];
};

export type PluginListResult = {
  /** Present and removed at fork, and not in the pending-removal baseline. */
  readonly forbiddenPresent: readonly string[];
  /** Present and not in the list at all — nobody approved this. */
  readonly unknownPresent: readonly string[];
  /** Verdict `kept` but absent — a plugin disappeared without a decision. */
  readonly keptMissing: readonly string[];
  /** Verdict `added` and not present yet. Reported, never a failure. */
  readonly pendingAddition: readonly string[];
  /** Baseline entries that are no longer constructed — delete the line. */
  readonly baselineStale: readonly string[];
  readonly ok: boolean;
};

/**
 * Compare the constructed plugin list against the approved list.
 *
 * One wildcard mount hides dozens of endpoints, so this assertion is what stands in for
 * enumerating them.
 */
export function checkPluginList(
  constructedIds: readonly string[],
  baseline: PluginListBaseline = { pendingRemoval: [] },
): PluginListResult {
  const present = new Set(constructedIds);
  const pending = new Set(baseline.pendingRemoval);

  const forbiddenPresent: string[] = [];
  const unknownPresent: string[] = [];
  const keptMissing: string[] = [];
  const pendingAddition: string[] = [];

  for (const id of present) {
    const plugin = BY_ID.get(id);
    if (plugin === undefined) {
      unknownPresent.push(id);
      continue;
    }
    if (plugin.verdict === "removed" && !pending.has(id)) {
      forbiddenPresent.push(id);
    }
  }

  for (const plugin of BETTER_AUTH_PLUGINS) {
    if (present.has(plugin.id)) continue;
    if (plugin.verdict === "kept") keptMissing.push(plugin.id);
    if (plugin.verdict === "added") pendingAddition.push(plugin.id);
  }

  const baselineStale = [...pending].filter((id) => !present.has(id)).sort();

  return {
    forbiddenPresent: forbiddenPresent.sort(),
    unknownPresent: unknownPresent.sort(),
    keptMissing: keptMissing.sort(),
    pendingAddition: pendingAddition.sort(),
    baselineStale,
    ok:
      forbiddenPresent.length === 0 &&
      unknownPresent.length === 0 &&
      keptMissing.length === 0 &&
      baselineStale.length === 0,
  };
}

export function formatPluginListReport(result: PluginListResult): string {
  const lines: string[] = [];
  if (result.forbiddenPresent.length > 0) {
    lines.push(
      `Removed at fork but still constructed: ${result.forbiddenPresent.join(", ")}`,
    );
  }
  if (result.unknownPresent.length > 0) {
    lines.push(
      `Constructed but on no list — one wildcard mount hides dozens of endpoints: ${result.unknownPresent.join(", ")}`,
    );
  }
  if (result.keptMissing.length > 0) {
    lines.push(`Approved but absent: ${result.keptMissing.join(", ")}`);
  }
  if (result.baselineStale.length > 0) {
    lines.push(
      `Pending-removal entries that are already gone — delete these lines: ${result.baselineStale.join(", ")}`,
    );
  }
  if (result.pendingAddition.length > 0) {
    lines.push(`Approved, not added yet: ${result.pendingAddition.join(", ")}`);
  }
  return lines.join("\n");
}
