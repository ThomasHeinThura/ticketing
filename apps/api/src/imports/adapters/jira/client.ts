/**
 * Mode (b): read-only REST client for Jira Cloud API v3.
 *
 * Egress rules (safety-and-runtime.md, WH-9..WH-12 via `webhook/safe-http`): HTTPS only, the
 * destination is resolved and checked before connecting and again at connect time, the connected
 * socket address is verified, redirects are never followed, the response is byte-capped and there
 * is a timeout. Unlike webhooks there is NO development relaxation here: `import.*` may never
 * reach a private range, whatever `NODE_ENV` says (`guardEnv` exists only so a unit test can talk
 * to a loopback server).
 *
 * The transport type has no method field: it can only GET. The client therefore cannot write to
 * the source. Errors carry fixed codes only; the credential and the request headers never appear
 * in an error, a log line or a return value.
 */
import http from "node:http";
import https from "node:https";
import type net from "node:net";
import {
  type AddressResolver,
  createGuardedLookup,
  developmentRelaxationActive,
  isForbiddenWebhookAddress,
  parseWebhookUrl,
  resolvePermittedAddresses,
  systemResolver,
} from "../../../webhook/safe-http";
import { JiraSourceError } from "./export-source";

export type JiraTransportRequest = {
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
};
export type JiraTransportResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};
/** GET only. Throws `JiraSourceError` with a fixed code on any transport failure. */
export type JiraTransport = (
  request: JiraTransportRequest,
) => Promise<JiraTransportResponse>;

export const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export function createGuardedJiraTransport(
  options: {
    resolver?: AddressResolver;
    /** Tests only. Production egress always uses the strict guard. */
    guardEnv?: { NODE_ENV?: string | undefined };
    maxBytes?: number;
  } = {},
): JiraTransport {
  const env = options.guardEnv ?? { NODE_ENV: "production" };
  const resolver = options.resolver ?? systemResolver;
  const maxBytes = options.maxBytes ?? MAX_RESPONSE_BYTES;
  return async (input) => {
    const relaxed = developmentRelaxationActive(env);
    let parsed: ReturnType<typeof parseWebhookUrl>;
    try {
      parsed = parseWebhookUrl(input.url, env);
      await resolvePermittedAddresses(parsed.url.hostname, resolver, relaxed);
    } catch {
      throw new JiraSourceError("jira_destination_refused");
    }
    const transport = parsed.secure ? https : http;
    return new Promise<JiraTransportResponse>((resolve, reject) => {
      let settled = false;
      const done = (action: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        action();
      };
      const fail = (code: string) =>
        done(() => reject(new JiraSourceError(code)));
      const request = transport.request(
        {
          protocol: parsed.url.protocol,
          hostname: parsed.url.hostname.replace(/^\[|\]$/g, ""),
          port: parsed.url.port || undefined,
          path: `${parsed.url.pathname}${parsed.url.search}`,
          method: "GET",
          headers: { ...input.headers, "accept-encoding": "identity" },
          lookup: createGuardedLookup(
            resolver,
            relaxed,
          ) as unknown as net.LookupFunction,
          agent: false,
        },
        (response) => {
          const chunks: Buffer[] = [];
          let received = 0;
          response.on("data", (chunk: Buffer) => {
            received += chunk.length;
            if (received > maxBytes) {
              fail("jira_response_too_large");
              request.destroy();
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () =>
            done(() => {
              const headers: Record<string, string> = {};
              for (const [name, value] of Object.entries(response.headers))
                if (typeof value === "string") headers[name] = value;
              resolve({
                status: response.statusCode ?? 0,
                headers,
                body: Buffer.concat(chunks).toString("utf8"),
              });
            }),
          );
          response.on("error", () => fail("jira_network_error"));
          response.on("aborted", () => fail("jira_network_error"));
        },
      );
      request.on("socket", (socket) => {
        socket.once("connect", () => {
          const remote = socket.remoteAddress;
          if (
            !relaxed &&
            (remote === undefined || isForbiddenWebhookAddress(remote))
          ) {
            fail("jira_destination_refused");
            request.destroy();
          }
        });
      });
      request.on("error", () => fail("jira_network_error"));
      const deadline = setTimeout(() => {
        fail("jira_timeout");
        request.destroy();
      }, input.timeoutMs);
      request.end();
    });
  };
}

export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export type JiraCredentials = { email: string; token: string };

/** `email:token`, a JSON `{ "email", "apiToken" }`, or a bare token with `config.email`. */
export function parseCredential(
  credential: string | null,
  configEmail: unknown,
): JiraCredentials | null {
  if (!credential) return null;
  const text = credential.trim();
  if (text.startsWith("{")) {
    try {
      const object = JSON.parse(text) as Record<string, unknown>;
      const email = object.email;
      const token = object.apiToken ?? object.token;
      if (typeof email === "string" && typeof token === "string")
        return { email, token };
    } catch {
      return null;
    }
    return null;
  }
  const colon = text.indexOf(":");
  if (colon > 0)
    return { email: text.slice(0, colon), token: text.slice(colon + 1) };
  if (typeof configEmail === "string" && configEmail.includes("@"))
    return { email: configEmail, token: text };
  return null;
}

/** Normalises and validates the base URL: https, no credentials, no query or fragment. */
export function parseBaseUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

export type JiraClientOptions = {
  baseUrl: URL;
  credentials: JiraCredentials;
  transport: JiraTransport;
  sleep?: Sleep;
  maxRetries?: number;
  maxWaitMs?: number;
  timeoutMs?: number;
};

export function retryAfterMs(headers: Record<string, string>, attempt: number) {
  const header = headers["retry-after"];
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }
  return Math.min(30_000, 1000 * 2 ** attempt);
}

export class JiraClient {
  private readonly authorization: string;
  private readonly sleep: Sleep;
  private readonly maxRetries: number;
  private readonly maxWaitMs: number;
  constructor(private readonly options: JiraClientOptions) {
    this.authorization = `Basic ${Buffer.from(
      `${options.credentials.email}:${options.credentials.token}`,
    ).toString("base64")}`;
    this.sleep = options.sleep ?? realSleep;
    this.maxRetries = options.maxRetries ?? 4;
    this.maxWaitMs = options.maxWaitMs ?? 60_000;
  }

  private url(path: string, query: Record<string, string | undefined>) {
    const base = this.options.baseUrl;
    const url = new URL(base.origin);
    url.pathname = `${base.pathname.replace(/\/+$/u, "")}${path}`;
    for (const [name, value] of Object.entries(query))
      if (value !== undefined) url.searchParams.set(name, value);
    return url.toString();
  }

  /** GET one JSON document, honouring `Retry-After` on 429/503 with bounded retries. */
  async getJson(
    path: string,
    query: Record<string, string | undefined> = {},
  ): Promise<unknown> {
    const url = this.url(path, query);
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.options.transport({
        url,
        headers: {
          authorization: this.authorization,
          accept: "application/json",
        },
        timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
      const { status } = response;
      if (status >= 200 && status < 300) {
        // Atlassian signals a nearly exhausted budget: ease off before the next call.
        if (response.headers["x-ratelimit-nearlimit"] === "true")
          await this.sleep(1000);
        try {
          return JSON.parse(response.body) as unknown;
        } catch {
          throw new JiraSourceError("jira_invalid_response");
        }
      }
      if (status === 429 || status === 503) {
        if (attempt >= this.maxRetries)
          throw new JiraSourceError("jira_rate_limited");
        const wait = retryAfterMs(response.headers, attempt);
        if (wait > this.maxWaitMs)
          throw new JiraSourceError("jira_rate_limited");
        await this.sleep(wait);
        continue;
      }
      if (status >= 300 && status < 400)
        throw new JiraSourceError("jira_redirect_refused");
      if (status === 401) throw new JiraSourceError("jira_unauthorized");
      if (status === 403) throw new JiraSourceError("jira_forbidden");
      if (status === 404) throw new JiraSourceError("jira_not_found");
      throw new JiraSourceError("jira_http_error");
    }
  }
}
