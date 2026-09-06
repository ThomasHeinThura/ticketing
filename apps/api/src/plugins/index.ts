import { initializeEventSubscriptions } from "./registry";

/**
 * Plugin initialisation.
 *
 * TaskDesk ships **no** plugins yet. kaneo's six inherited integrations
 * (GitHub, Gitea, Slack, Discord, Telegram, generic webhook) were deleted in
 * issue #6 — not flagged off — because an outbound-request surface configured
 * per project is not something to ship dormant.
 *
 * The registry and the contract types survive deliberately: they are the seed
 * of `packages/plugins-contracts`, and the engine boundary rule says a plugin
 * contract is the right shape here because storage, notification and identity
 * providers are genuinely swappable implementations.
 */
export function initializePlugins() {
  initializeEventSubscriptions();
}

export * from "./registry";
export * from "./types";
