export type WebSocketPortal = "agent" | "customer";

export type WebSocketOriginResult =
  | { allowed: true; portal: WebSocketPortal }
  | { allowed: false; status: 401 | 403 };

const configuredOrigins: Record<WebSocketPortal, string> = {
  agent: process.env.TASKDESK_AGENT_URL || "http://localhost:5173",
  customer: process.env.TASKDESK_PORTAL_URL || "http://localhost:5174",
};

function originOf(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function configuredPortalForHost(
  host: string | null,
): WebSocketPortal | null {
  if (!host || host.includes(",") || /\s/.test(host)) return null;
  for (const portal of ["agent", "customer"] as const) {
    try {
      if (
        new URL(configuredOrigins[portal]).host.toLowerCase() ===
        host.toLowerCase()
      )
        return portal;
    } catch {
      return null;
    }
  }
  return null;
}

export function checkWebSocketOrigin(input: {
  host: string | null;
  origin: string | null;
  sessionPortal: unknown;
  hasSession: boolean;
}): WebSocketOriginResult {
  const hostPortal = configuredPortalForHost(input.host);
  if (!hostPortal) return { allowed: false, status: 403 };

  if (input.hasSession && input.sessionPortal !== hostPortal) {
    return { allowed: false, status: 403 };
  }

  if (!input.hasSession && input.origin === null) {
    return { allowed: true, portal: hostPortal };
  }

  const expectedOrigin = originOf(configuredOrigins[hostPortal]);
  if (
    !expectedOrigin ||
    !input.origin ||
    input.origin === "null" ||
    input.origin.includes(",") ||
    input.origin !== expectedOrigin
  ) {
    return { allowed: false, status: 403 };
  }

  return { allowed: true, portal: hostPortal };
}
