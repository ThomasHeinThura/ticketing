import { listInstanceFeatures } from "../feature-flag/repository";

/**
 * Is `feature.mcp` on for the instance? MCP keys answer `404` while it is off (MC-14).
 * Fails closed: an unreadable flag is off.
 */
export async function mcpFeatureEnabled(): Promise<boolean> {
  try {
    const features = await listInstanceFeatures();
    return (
      features.find((entry) => entry.key === "feature.mcp")?.enabled === true
    );
  } catch {
    return false;
  }
}
