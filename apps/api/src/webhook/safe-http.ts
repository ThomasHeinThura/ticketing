import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { isDisallowedAddress } from "../utils/assert-public-destination";
import { WEBHOOK_RESPONSE_BODY_LIMIT, WEBHOOK_TIMEOUT_MS } from "./constants";

/**
 * The outbound client for webhook delivery. `safety-and-runtime.md` (SSRF / egress) and
 * `WH-9`..`WH-12` fix its behaviour:
 *
 * - `WH-9`  the destination is resolved and checked against private, loopback, link-local and
 *   metadata ranges before connecting;
 * - `WH-10` the check is made **again at connect time**, against the address the socket is
 *   actually going to use. Node resolves through the `lookup` function handed to
 *   `https.request`, and the connection is made to exactly the address that function returns, so
 *   validating inside it leaves no window between "checked" and "connected" for a rebinding DNS
 *   answer to exploit. The connected socket's `remoteAddress` is verified once more after the
 *   TCP handshake (this also covers IP-literal hosts, for which `lookup` is never called);
 * - `WH-11` redirects are never followed: any 3xx is a failure with the reason recorded;
 * - `WH-12` HTTPS only. The one relaxation (plain `http:` and private targets) exists only when
 *   `NODE_ENV=development`; no allowlist and no other environment variable widens a webhook.
 *
 * The production egress allowlist is for `ai.*` plugins only and is intentionally not consulted
 * here.
 */

export class WebhookDestinationError extends Error {
  constructor(
    readonly code:
      | "invalid_url"
      | "scheme_not_allowed"
      | "credentials_in_url"
      | "destination_not_allowed"
      | "unresolvable",
    message: string,
  ) {
    super(message);
    this.name = "WebhookDestinationError";
  }
}

/** The only environment value the guard reads, injectable for tests. */
export type WebhookEnv = { NODE_ENV?: string | undefined };

/** A literal `NODE_ENV` read (never an alias of `process.env`), so the env gate can attribute it. */
function currentEnv(): WebhookEnv {
  return { NODE_ENV: process.env.NODE_ENV };
}

/** The development relaxation applies only when `NODE_ENV` is exactly `development`. */
export function developmentRelaxationActive(
  env: WebhookEnv = currentEnv(),
): boolean {
  return env.NODE_ENV === "development";
}

function ipv4Octets(ip: string): [number, number, number, number] | null {
  const parts = ip.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return null;
  return parts as [number, number, number, number];
}

/**
 * The shared private/loopback/link-local/CGNAT guard plus the ranges a webhook must also never
 * reach: multicast and reserved space, 192.0.0.0/24, benchmarking 198.18.0.0/15, the broadcast
 * address, IPv6 multicast, site-local, and the NAT64 prefix (which tunnels to IPv4).
 */
export function isForbiddenWebhookAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (isDisallowedAddress(bare)) return true;
  const version = net.isIP(bare);
  if (version === 4) {
    const octets = ipv4Octets(bare);
    if (!octets) return true;
    const [a, b, c] = octets;
    return (
      a >= 224 ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (version === 6) {
    return (
      bare.startsWith("ff") ||
      bare.startsWith("fec") ||
      bare.startsWith("fed") ||
      bare.startsWith("fee") ||
      bare.startsWith("fef") ||
      bare.startsWith("64:ff9b:")
    );
  }
  return false;
}

export type ResolvedAddress = { address: string; family: 4 | 6 };

export type AddressResolver = (hostname: string) => Promise<ResolvedAddress[]>;

export const systemResolver: AddressResolver = (hostname) =>
  new Promise((resolve, reject) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(
        addresses.map((entry) => ({
          address: entry.address,
          family: entry.family === 6 ? 6 : 4,
        })),
      );
    });
  });

/**
 * Resolves `hostname` and refuses the destination unless **every** answer is permitted
 * (`WH-9`). One forbidden answer among several fails the lot: a client may race to any of them.
 */
export async function resolvePermittedAddresses(
  hostname: string,
  resolver: AddressResolver,
  relaxed: boolean,
): Promise<ResolvedAddress[]> {
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(bare)) {
    if (!relaxed && isForbiddenWebhookAddress(bare)) {
      throw new WebhookDestinationError(
        "destination_not_allowed",
        "Destination is a non-routable address",
      );
    }
    return [{ address: bare, family: net.isIP(bare) === 6 ? 6 : 4 }];
  }
  if (!relaxed && bare.toLowerCase() === "localhost") {
    throw new WebhookDestinationError(
      "destination_not_allowed",
      "Destination is a non-routable address",
    );
  }
  let addresses: ResolvedAddress[];
  try {
    addresses = await resolver(bare);
  } catch {
    throw new WebhookDestinationError(
      "unresolvable",
      "Destination could not be resolved",
    );
  }
  if (addresses.length === 0) {
    throw new WebhookDestinationError(
      "unresolvable",
      "Destination could not be resolved",
    );
  }
  if (
    !relaxed &&
    addresses.some((entry) => isForbiddenWebhookAddress(entry.address))
  ) {
    throw new WebhookDestinationError(
      "destination_not_allowed",
      "Destination resolves to a non-routable address",
    );
  }
  return addresses;
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | ResolvedAddress[],
  family?: number,
) => void;

/**
 * The `lookup` function handed to `https.request` (`WH-10`). It validates on every call, which
 * is every connection attempt, and returns only validated addresses, so the socket can only ever
 * connect to an address that passed.
 */
export function createGuardedLookup(
  resolver: AddressResolver,
  relaxed: boolean,
) {
  return (
    hostname: string,
    options: { all?: boolean; family?: number | string },
    callback: LookupCallback,
  ): void => {
    resolvePermittedAddresses(hostname, resolver, relaxed).then(
      (addresses) => {
        const wanted =
          options.family === 4 || options.family === "IPv4"
            ? 4
            : options.family === 6 || options.family === "IPv6"
              ? 6
              : null;
        const usable = wanted
          ? addresses.filter((entry) => entry.family === wanted)
          : addresses;
        if (usable.length === 0) {
          callback(
            Object.assign(new Error("No usable address"), {
              code: "ENOTFOUND",
            }),
            [],
          );
          return;
        }
        if (options.all) {
          callback(null, usable);
          return;
        }
        const [first] = usable as [ResolvedAddress];
        callback(null, first.address, first.family);
      },
      (error: unknown) => {
        const webhookCode =
          error instanceof WebhookDestinationError
            ? error.code
            : "unresolvable";
        callback(
          Object.assign(new Error("lookup refused"), {
            code: "ENOTFOUND",
            webhookCode,
          }),
          [],
        );
      },
    );
  };
}

export type ParsedWebhookUrl = { url: URL; secure: boolean };

/** Synchronous URL shape checks shared by the create route and the sender (`WH-12`). */
export function parseWebhookUrl(
  raw: string,
  env: WebhookEnv = currentEnv(),
): ParsedWebhookUrl {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebhookDestinationError("invalid_url", "Webhook URL is invalid");
  }
  const relaxed = developmentRelaxationActive(env);
  if (url.protocol !== "https:" && !(relaxed && url.protocol === "http:")) {
    throw new WebhookDestinationError(
      "scheme_not_allowed",
      "Webhook URL must use https",
    );
  }
  if (url.username !== "" || url.password !== "") {
    throw new WebhookDestinationError(
      "credentials_in_url",
      "Webhook URL must not contain credentials",
    );
  }
  if (url.hostname === "") {
    throw new WebhookDestinationError("invalid_url", "Webhook URL is invalid");
  }
  return { url, secure: url.protocol === "https:" };
}

/**
 * Save-time check (`WH-9`): shape plus a resolve-and-check. A hostname that resolves publicly
 * now may still rebind later, which is exactly what the connect-time check in
 * `sendWebhookRequest` covers.
 */
export async function assertWebhookDestination(
  raw: string,
  options: { resolver?: AddressResolver; env?: WebhookEnv } = {},
): Promise<void> {
  const env = options.env ?? currentEnv();
  const { url } = parseWebhookUrl(raw, env);
  await resolvePermittedAddresses(
    url.hostname,
    options.resolver ?? systemResolver,
    developmentRelaxationActive(env),
  );
}

export type WebhookSendResult = {
  statusCode: number | null;
  durationMs: number;
  responseBody: string | null;
  /** A bounded, non-sensitive failure label; null for a `2xx`. */
  error: string | null;
  success: boolean;
};

function errorLabel(error: unknown): string {
  if (error instanceof WebhookDestinationError) return error.code;
  const webhookCode = (error as { webhookCode?: unknown } | null)?.webhookCode;
  if (typeof webhookCode === "string") return webhookCode;
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (error.message === "webhook_timeout") return "timeout";
    if (typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code)) {
      if (code === "ENOTFOUND") return "unresolvable";
      return code.toLowerCase();
    }
    if (error.message === "webhook_connected_to_forbidden_address")
      return "destination_not_allowed";
  }
  return "request_failed";
}

export type GuardedOutboundResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: Buffer;
};

type SharedRequest = {
  url: URL;
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array | string | undefined;
  timeoutMs: number;
  maxResponseBytes: number;
  resolver: AddressResolver;
  relaxed: boolean;
  responseMode: "truncate" | "reject";
  rejectRedirect: boolean;
  signal?: AbortSignal | undefined;
};

/**
 * The socket-owning transport shared by webhooks and strict S3 probes. DNS is
 * checked before opening a socket and again by the connection's lookup, while
 * the deadline and abort signal apply to the entire operation, including DNS.
 */
function performGuardedRequest(
  input: SharedRequest,
): Promise<GuardedOutboundResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let request: http.ClientRequest | undefined;
    let response: http.IncomingMessage | undefined;
    const finish = (error?: unknown, result?: GuardedOutboundResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      input.signal?.removeEventListener("abort", onAbort);
      if (error !== undefined) reject(error);
      else if (result) resolve(result);
      else reject(new Error("outbound_request_failed"));
    };
    const fail = (error: unknown) => {
      if (settled) return;
      // Settle before destroying: a synchronous mock may emit an error or close.
      finish(error);
      response?.destroy();
      request?.destroy();
    };
    const onAbort = () => fail(new Error("outbound_request_aborted"));
    const deadline = setTimeout(
      () => fail(new Error("webhook_timeout")),
      input.timeoutMs,
    );
    input.signal?.addEventListener("abort", onAbort, { once: true });
    if (input.signal?.aborted) {
      onAbort();
      return;
    }

    void resolvePermittedAddresses(
      input.url.hostname,
      input.resolver,
      input.relaxed,
    )
      .then(() => {
        if (settled) return;
        const transport = input.url.protocol === "https:" ? https : http;
        try {
          request = transport.request(
            {
              protocol: input.url.protocol,
              hostname: input.url.hostname.replace(/^\[|\]$/g, ""),
              port: input.url.port || undefined,
              path: input.path,
              method: input.method,
              headers: input.headers,
              lookup: createGuardedLookup(
                input.resolver,
                input.relaxed,
              ) as unknown as net.LookupFunction,
              agent: false,
            },
            (incoming) => {
              response = incoming;
              const statusCode = incoming.statusCode ?? 0;
              if (
                input.rejectRedirect &&
                statusCode >= 300 &&
                statusCode < 400
              ) {
                fail(new Error("outbound_redirect_refused"));
                return;
              }
              const headers: Record<string, string> = {};
              for (const [key, value] of Object.entries(incoming.headers)) {
                if (value !== undefined)
                  headers[key] = Array.isArray(value)
                    ? value.join(",")
                    : String(value);
              }
              const chunks: Buffer[] = [];
              let received = 0;
              let ended = false;
              const done = () => {
                const body = Buffer.concat(chunks).subarray(
                  0,
                  input.maxResponseBytes,
                );
                finish(undefined, { statusCode, headers, body });
              };
              incoming.on("data", (chunk: Buffer) => {
                received += chunk.length;
                if (
                  input.responseMode === "reject" &&
                  received > input.maxResponseBytes
                ) {
                  fail(new Error("outbound_response_too_large"));
                  return;
                }
                chunks.push(Buffer.from(chunk));
                if (
                  input.responseMode === "truncate" &&
                  received >= input.maxResponseBytes
                )
                  incoming.destroy();
              });
              incoming.on("end", () => {
                ended = true;
                done();
              });
              incoming.on("close", () => {
                if (input.responseMode === "truncate") done();
                else if (!ended)
                  fail(new Error("outbound_response_incomplete"));
              });
              incoming.on("error", () => {
                if (input.responseMode === "truncate") done();
                else fail(new Error("outbound_response_failed"));
              });
              incoming.on("aborted", () => {
                if (input.responseMode === "reject")
                  fail(new Error("outbound_response_incomplete"));
              });
            },
          );
          request.on("socket", (socket) => {
            socket.once("connect", () => {
              if (
                !input.relaxed &&
                (!socket.remoteAddress ||
                  isForbiddenWebhookAddress(socket.remoteAddress))
              )
                fail(new Error("webhook_connected_to_forbidden_address"));
            });
          });
          request.on("error", (error) => fail(error));
          request.end(input.body);
        } catch (error) {
          fail(error);
        }
      })
      .catch(fail);
  });
}

/**
 * Strict outbound request for an already signed S3 operation. `path` includes
 * the raw signed query; it and the supplied headers/body are never rewritten.
 * The origin, host header, body length and policy are checked independently.
 */
export async function sendGuardedOutboundRequest(input: {
  origin: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array | string | undefined;
  policy: "strict-public-https" | "bundled-seaweedfs";
  timeoutMs: number;
  maxResponseBytes: number;
  signal?: AbortSignal | undefined;
  resolver?: AddressResolver | undefined;
}): Promise<GuardedOutboundResponse> {
  let url: URL;
  try {
    url = new URL(input.origin);
  } catch {
    throw new Error("outbound_invalid_request");
  }
  const fields = Object.entries(input.headers);
  const hosts = fields.filter(([key]) => key.toLowerCase() === "host");
  const lengths = fields.filter(
    ([key]) => key.toLowerCase() === "content-length",
  );
  const bodyLength =
    input.body === undefined ? 0 : Buffer.byteLength(input.body);
  const bundled = input.policy === "bundled-seaweedfs";
  if (
    (bundled
      ? input.origin !== "http://seaweedfs:8333"
      : input.policy !== "strict-public-https" || url.protocol !== "https:") ||
    (input.origin !== url.origin && input.origin !== `${url.origin}/`) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (!bundled && net.isIP(url.hostname.replace(/^\[|\]$/g, ""))) ||
    !input.path.startsWith("/") ||
    /[^\x21-\x7e]|[#\\]/u.test(input.path) ||
    !/^[A-Z]+$/u.test(input.method) ||
    hosts.length !== 1 ||
    hosts[0]?.[1].toLowerCase() !== url.host.toLowerCase() ||
    lengths.length > 1 ||
    (input.body !== undefined && lengths.length !== 1) ||
    (lengths.length === 1 && lengths[0]?.[1] !== String(bodyLength)) ||
    !Number.isFinite(input.timeoutMs) ||
    input.timeoutMs <= 0 ||
    !Number.isSafeInteger(input.maxResponseBytes) ||
    input.maxResponseBytes < 1
  )
    throw new Error("outbound_invalid_request");
  return performGuardedRequest({
    url,
    path: input.path,
    method: input.method,
    headers: input.headers,
    body: input.body,
    timeoutMs: input.timeoutMs,
    maxResponseBytes: input.maxResponseBytes,
    signal: input.signal,
    resolver: input.resolver ?? systemResolver,
    relaxed: bundled,
    responseMode: "reject",
    rejectRedirect: true,
  });
}

/**
 * POSTs one webhook delivery. Never throws: every outcome, including a refused destination,
 * is a `WebhookSendResult` so the caller records it. Only a `2xx` is success (`WH-5`).
 */
export async function sendWebhookRequest(input: {
  url: string;
  headers: Record<string, string>;
  rawBody: string;
  timeoutMs?: number;
  resolver?: AddressResolver;
  env?: WebhookEnv;
}): Promise<WebhookSendResult> {
  const env = input.env ?? currentEnv();
  const relaxed = developmentRelaxationActive(env);
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  let parsed: ParsedWebhookUrl;
  try {
    parsed = parseWebhookUrl(input.url, env);
  } catch (error) {
    return {
      statusCode: null,
      durationMs: elapsed(),
      responseBody: null,
      error: errorLabel(error),
      success: false,
    };
  }

  const body = Buffer.from(input.rawBody, "utf8");
  try {
    const response = await performGuardedRequest({
      url: parsed.url,
      path: `${parsed.url.pathname}${parsed.url.search}`,
      method: "POST",
      headers: { ...input.headers, "Content-Length": String(body.length) },
      body,
      timeoutMs: input.timeoutMs ?? WEBHOOK_TIMEOUT_MS,
      maxResponseBytes: WEBHOOK_RESPONSE_BODY_LIMIT,
      resolver: input.resolver ?? systemResolver,
      relaxed,
      responseMode: "truncate",
      rejectRedirect: false,
    });
    const success = response.statusCode >= 200 && response.statusCode < 300;
    const redirect = response.statusCode >= 300 && response.statusCode < 400;
    return {
      statusCode: response.statusCode,
      durationMs: elapsed(),
      responseBody: response.body.toString("utf8"),
      error: success
        ? null
        : redirect
          ? "redirect_not_followed"
          : `http_${response.statusCode}`,
      success,
    };
  } catch (error) {
    return {
      statusCode: null,
      durationMs: elapsed(),
      responseBody: null,
      error: errorLabel(error),
      success: false,
    };
  }
}
