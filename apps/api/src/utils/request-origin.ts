import type { Context } from "hono";

export type AppOrigin = {
  kind: "agent" | "portal";
  scheme: "http:" | "https:";
  hostname: string;
  authority: string;
  url: string;
};

export type SelectedOrigin = AppOrigin["kind"] | "unknown" | "invalid";

export function publicOriginForKind(
  kind: AppOrigin["kind"],
  origins: readonly [AppOrigin, AppOrigin],
): string {
  const origin = origins.find((candidate) => candidate.kind === kind);
  if (!origin) throw new Error(`No configured public origin for ${kind}.`);
  return origin.url;
}

export function requirePublicAppOrigin(value: string | undefined): string {
  if (!value)
    throw new Error("A validated application origin is required for this URL.");
  return value;
}

type NodeIncomingBinding = {
  rawHeaders?: string[];
  httpVersionMajor?: number;
  authority?: string;
  headers?: Record<string, string | string[] | undefined>;
};

export function parseConfiguredOrigins(
  agentUrl: string | undefined,
  portalUrl: string | undefined,
): [AppOrigin, AppOrigin] {
  const agent = parseConfiguredOrigin(agentUrl, "agent");
  const portal = parseConfiguredOrigin(portalUrl, "portal");
  if (agent.hostname === portal.hostname)
    throw new Error(
      "TASKDESK_AGENT_URL and TASKDESK_PORTAL_URL need distinct hostnames.",
    );
  if (agent.authority === portal.authority)
    throw new Error(
      "TASKDESK_AGENT_URL and TASKDESK_PORTAL_URL must be distinct origins.",
    );
  return [agent, portal];
}

function parseConfiguredOrigin(
  value: string | undefined,
  kind: AppOrigin["kind"],
): AppOrigin {
  if (!value)
    throw new Error(`TASKDESK_${kind.toUpperCase()}_URL is required.`);
  if (/[?#]/u.test(value))
    throw new Error(
      `TASKDESK_${kind.toUpperCase()}_URL must not contain a query or fragment.`,
    );
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `TASKDESK_${kind.toUpperCase()}_URL must be an absolute HTTP origin.`,
    );
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !url.hostname ||
    url.username ||
    url.password ||
    value.includes("@") ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      `TASKDESK_${kind.toUpperCase()}_URL must contain only an HTTP origin.`,
    );
  const hostname = normalizeHostname(url.hostname);
  return {
    kind,
    scheme: url.protocol,
    hostname,
    authority: normalizeAuthority(hostname, url.port),
    url: url.origin,
  };
}

function normalizeHostname(hostname: string): string {
  const normalized = hostname.toLowerCase();
  return normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized
    : normalized.replace(/\.$/, "");
}

function normalizeAuthority(hostname: string, port: string): string {
  return port ? `${hostname}:${Number(port)}` : hostname;
}

function authorityForScheme(
  hostValue: string,
  scheme: AppOrigin["scheme"],
): string | undefined {
  if (
    !hostValue ||
    hostValue !== hostValue.trim() ||
    /[,/@\\?#\s]/u.test(hostValue)
  )
    return undefined;
  try {
    const parsed = new URL(`${scheme}//${hostValue}`);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      !parsed.hostname
    )
      return undefined;
    return normalizeAuthority(normalizeHostname(parsed.hostname), parsed.port);
  } catch {
    return undefined;
  }
}

function rawHostFromBinding(incoming: NodeIncomingBinding): {
  host?: string;
  invalid: boolean;
} {
  const rawHeaders = incoming.rawHeaders;
  if (!rawHeaders) return { host: undefined, invalid: false };
  const values: string[] = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === "host")
      values.push(rawHeaders[index + 1] ?? "");
  }
  if (values.length > 1) return { host: undefined, invalid: true };
  return { host: values[0], invalid: false };
}

export function selectOriginFromHost(
  host: string | undefined,
  origins: readonly [AppOrigin, AppOrigin],
): SelectedOrigin {
  if (!host) return "invalid";
  for (const origin of origins) {
    if (authorityForScheme(host, origin.scheme) === origin.authority)
      return origin.kind;
  }
  return authorityForScheme(host, origins[0].scheme) === undefined
    ? "invalid"
    : "unknown";
}

export function selectOriginFromContext(
  context: Context,
  origins: readonly [AppOrigin, AppOrigin],
): SelectedOrigin {
  const incoming = (
    context.env as { incoming?: NodeIncomingBinding } | undefined
  )?.incoming;
  if (incoming) {
    if (incoming.httpVersionMajor === 2) {
      const authority = incoming.authority ?? incoming.headers?.[":authority"];
      const hostBinding = rawHostFromBinding(incoming);
      if (hostBinding.invalid || typeof authority !== "string")
        return "invalid";
      const selected = selectOriginFromHost(authority, origins);
      if (selected === "agent" || selected === "portal") {
        const origin = origins.find((candidate) => candidate.kind === selected);
        if (
          hostBinding.host &&
          authorityForScheme(hostBinding.host, origin?.scheme ?? "http:") !==
            authorityForScheme(authority, origin?.scheme ?? "http:")
        )
          return "invalid";
      } else if (hostBinding.host && hostBinding.host !== authority) {
        return "invalid";
      }
      return selected;
    }
    const rawHost = rawHostFromBinding(incoming);
    if (rawHost.invalid) return "invalid";
    return rawHost.host
      ? selectOriginFromHost(rawHost.host, origins)
      : "invalid";
  }
  return selectOriginFromHost(context.req.header("host"), origins);
}
