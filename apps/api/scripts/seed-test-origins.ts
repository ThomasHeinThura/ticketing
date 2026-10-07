type SeedTestOriginEnvironment = {
  TASKDESK_AGENT_URL?: string;
  TASKDESK_PORTAL_URL?: string;
};

const DEFAULT_AGENT_ORIGIN = "http://localhost:1337";
const DEFAULT_PORTAL_ORIGIN = "http://portal.localhost:5174";

function resolveOrigin(
  value: string | undefined,
  fallback: string,
  name: string,
) {
  const candidate = value?.trim() || fallback;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) origin`);
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} must be an absolute HTTP(S) origin`);
  }
  return url.origin;
}

/** Supplies the same safe defaults as the API integration setup while retaining valid
 * explicitly configured origins for the in-process auth harness. */
export function configureSeedTestOrigins(
  environment: SeedTestOriginEnvironment,
) {
  const agent = resolveOrigin(
    environment.TASKDESK_AGENT_URL,
    DEFAULT_AGENT_ORIGIN,
    "TASKDESK_AGENT_URL",
  );
  const portal = resolveOrigin(
    environment.TASKDESK_PORTAL_URL,
    DEFAULT_PORTAL_ORIGIN,
    "TASKDESK_PORTAL_URL",
  );
  environment.TASKDESK_AGENT_URL = agent;
  environment.TASKDESK_PORTAL_URL = portal;
  return { agent, portal };
}
