export type SecuritySurface = "agent" | "portal";
export type CspMode = "report_only" | "enforce";

export type SecurityOrigins = {
  agent: string;
  portal: string;
  storage?: Partial<Record<SecuritySurface, readonly string[]>>;
  telemetry?: Partial<Record<SecuritySurface, readonly string[]>>;
};

const REPORT_PATH = "/api/public/csp-report";

function parsedOrigin(value: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid origin URL`);
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error(`${label} must use HTTP(S) and contain no credentials`);
  }
  return parsed;
}

function asSourceOrigin(value: string, label: string): string {
  const parsed = parsedOrigin(value, label);
  return parsed.origin;
}

function uniqueSources(values: readonly string[], label: string): string[] {
  return [...new Set(values.map((value) => asSourceOrigin(value, label)))];
}

export function validateSecurityOrigins(origins: SecurityOrigins) {
  const agent = parsedOrigin(origins.agent, "Agent origin");
  const portal = parsedOrigin(origins.portal, "Portal origin");
  if (agent.pathname !== "/" || agent.search || agent.hash) {
    throw new Error("Agent origin must not include a path, query, or fragment");
  }
  if (portal.pathname !== "/" || portal.search || portal.hash) {
    throw new Error(
      "Portal origin must not include a path, query, or fragment",
    );
  }
  return {
    agent: agent.origin,
    portal: portal.origin,
    storage: {
      agent: uniqueSources(
        origins.storage?.agent ?? [],
        "Agent storage origin",
      ),
      portal: uniqueSources(
        origins.storage?.portal ?? [],
        "Portal storage origin",
      ),
    },
    telemetry: {
      agent: uniqueSources(
        origins.telemetry?.agent ?? [],
        "Agent telemetry origin",
      ),
      portal: uniqueSources(
        origins.telemetry?.portal ?? [],
        "Portal telemetry origin",
      ),
    },
  } as const;
}

function nonceSource(nonce: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(nonce)) {
    throw new Error("CSP nonce must be a base64url token");
  }
  return `'nonce-${nonce}'`;
}

export function reportingEndpointsHeader(surfaceOrigin: string) {
  const origin = asSourceOrigin(surfaceOrigin, "Reporting origin");
  return `csp-endpoint="${origin}${REPORT_PATH}"`;
}

export function buildContentSecurityPolicy(input: {
  surface: SecuritySurface;
  nonce: string;
  origins: ReturnType<typeof validateSecurityOrigins>;
}) {
  const surfaceOrigin = input.origins[input.surface];
  const wsOrigin = new URL(surfaceOrigin);
  const wsSource = `${wsOrigin.protocol === "https:" ? "wss:" : "ws:"}//${wsOrigin.host}`;
  const imageSources = [
    "'self'",
    "blob:",
    ...input.origins.storage[input.surface],
  ];
  const connectSources = [
    "'self'",
    wsSource,
    ...input.origins.storage[input.surface],
    ...input.origins.telemetry[input.surface],
  ];
  const frameSources = [
    `${surfaceOrigin}/pdf-preview.html`,
    "https://www.youtube.com/embed/",
  ];
  return [
    "default-src 'none'",
    `script-src 'self' ${nonceSource(input.nonce)}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imageSources.join(" ")}`,
    "font-src 'self'",
    `connect-src ${connectSources.join(" ")}`,
    "manifest-src 'self'",
    `frame-src ${frameSources.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "report-to csp-endpoint",
    `report-uri ${REPORT_PATH}`,
  ].join("; ");
}

/** Strict CSP for the exact opaque-origin PDF child document. */
export function buildPdfPreviewContentSecurityPolicy(input: {
  surface: SecuritySurface;
  nonce: string;
  origins: ReturnType<typeof validateSecurityOrigins>;
}) {
  const viewerAssets = `${input.origins[input.surface]}/assets/pdf-preview/`;
  return [
    "default-src 'none'",
    `script-src ${viewerAssets} ${nonceSource(input.nonce)}`,
    "style-src 'self'",
    "img-src 'none'",
    "font-src 'none'",
    "connect-src 'none'",
    `worker-src ${viewerAssets} blob:`,
    "media-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
    "sandbox allow-scripts",
  ].join("; ");
}

export const SECURITY_RESPONSE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), camera=(), microphone=(), payment=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "X-Frame-Options": "DENY",
} as const;
