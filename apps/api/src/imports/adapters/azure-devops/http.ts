/**
 * Read-only JSON transport for the Azure DevOps and Plane adapters (P6 Lane C3).
 *
 * The method type is `GET | POST` only: the Azure DevOps query endpoints (WIQL and work items
 * batch) are POST but read-only, and each adapter whitelists the exact paths it may POST to. No
 * PUT, PATCH or DELETE exists in the type, so an adapter cannot write to a source.
 *
 * The default transport reuses the webhook SSRF guard (WH-9..WH-12): https only, the destination
 * resolved and checked before connecting AND at connect time, the connected socket's address
 * verified, redirects never followed, a response byte cap and a timeout. Errors carry a fixed code
 * only, never a URL, header or credential. Tests inject a recorded-fixture transport instead.
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

export type SourceHttpRequest = {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  /** JSON body (POST only). */
  body?: unknown;
};
export type SourceHttpResponse = { status: number; json: unknown };
export type SourceTransport = (
  request: SourceHttpRequest,
) => Promise<SourceHttpResponse>;

/** A failure with a fixed lower_snake code; the message never contains a URL or credential. */
export class SourceHttpError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SourceHttpError";
  }
}

const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export function createGuardedTransport(
  options: {
    resolver?: AddressResolver;
    env?: { NODE_ENV?: string | undefined };
    timeoutMs?: number;
    maxBytes?: number;
  } = {},
): SourceTransport {
  return async (input) => {
    // Strict whatever NODE_ENV says (like Jira's client): `env` exists only so a unit test can reach
    // a loopback server. A development process never relaxes import egress.
    const env = options.env ?? { NODE_ENV: "production" };
    const relaxed = developmentRelaxationActive(env);
    const resolver = options.resolver ?? systemResolver;
    let parsed: ReturnType<typeof parseWebhookUrl>;
    try {
      parsed = parseWebhookUrl(input.url, env);
      await resolvePermittedAddresses(parsed.url.hostname, resolver, relaxed);
    } catch {
      throw new SourceHttpError("destination_not_allowed");
    }
    const payload =
      input.body === undefined
        ? null
        : Buffer.from(JSON.stringify(input.body), "utf8");
    const transport = parsed.secure ? https : http;
    const maxBytes = options.maxBytes ?? MAX_RESPONSE_BYTES;
    return new Promise<SourceHttpResponse>((resolve, reject) => {
      let settled = false;
      const chunks: Buffer[] = [];
      let received = 0;
      const fail = (code: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        reject(new SourceHttpError(code));
      };
      const request = transport.request(
        {
          protocol: parsed.url.protocol,
          hostname: parsed.url.hostname.replace(/^\[|\]$/g, ""),
          port: parsed.url.port || undefined,
          path: `${parsed.url.pathname}${parsed.url.search}`,
          method: input.method,
          headers: {
            accept: "application/json",
            ...input.headers,
            ...(payload
              ? {
                  "content-type": "application/json",
                  "content-length": String(payload.length),
                }
              : {}),
          },
          lookup: createGuardedLookup(
            resolver,
            relaxed,
          ) as unknown as net.LookupFunction,
          agent: false,
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            response.resume();
            request.destroy();
            fail("redirect_not_followed");
            return;
          }
          response.on("data", (chunk: Buffer) => {
            received += chunk.length;
            if (received > maxBytes) {
              request.destroy();
              fail("response_too_large");
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () => {
            if (settled) return;
            settled = true;
            clearTimeout(deadline);
            const text = Buffer.concat(chunks).toString("utf8");
            let json: unknown = null;
            if (text.length > 0) {
              try {
                json = JSON.parse(text);
              } catch {
                json = null;
              }
            }
            resolve({ status, json });
          });
          response.on("error", () => fail("response_failed"));
          response.on("aborted", () => fail("response_failed"));
        },
      );
      request.on("socket", (socket) => {
        socket.once("connect", () => {
          const remote = socket.remoteAddress;
          if (
            !relaxed &&
            (remote === undefined || isForbiddenWebhookAddress(remote))
          )
            request.destroy(new Error("connected_to_forbidden_address"));
        });
      });
      request.on("error", () => fail("request_failed"));
      const deadline = setTimeout(() => {
        request.destroy();
        fail("timeout");
      }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      if (payload) request.end(payload);
      else request.end();
    });
  };
}

/** Narrowing helpers for untyped source JSON. Never throw. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
export const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;
export const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** An ISO 8601 datetime with offset, or undefined. Normalised through Date. */
export function isoDate(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/** https, no credentials, no credential-like query key, no fragment; else undefined. */
export function safeHttpsUrl(value: string | undefined): string | undefined {
  if (!value || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    const credentialKey = [...url.searchParams.keys()].some((key) =>
      /(?:token|secret|password|authorization|api[-_]?key|credential|signature|^sig$)/iu.test(
        key,
      ),
    );
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !credentialKey &&
      !url.hash
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

/** Removes control characters (and NUL in particular); optionally keeps tab and newline. */
export function stripControl(value: string, keepWhitespace = false): string {
  return [...value]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      if (keepWhitespace && (code === 9 || code === 10)) return true;
      return code >= 32 && code !== 127;
    })
    .join("");
}

const ENTITY: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
};

/**
 * HTML to plain text with paragraph breaks. `lossy` is true when the source used formatting that
 * plain text cannot carry (tables, images, links, lists, emphasis, code), so the record is
 * flagged `rich_text_lossy` rather than claiming a faithful conversion.
 */
export function htmlToText(html: string): { text: string; lossy: boolean } {
  const lossy =
    /<(?:table|img|a\s|ul|ol|li|strong|b>|em|i>|code|pre|h[1-6])/iu.test(html);
  let stripped = html
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/giu, "\n")
    .replace(/<li[^>]*>/giu, "- ");
  // Strip to a fixed point so no removal can leave a tag behind for a later reader.
  for (let previous = ""; previous !== stripped; ) {
    previous = stripped;
    stripped = stripped.replace(/<[^>]*>/gu, "");
  }
  const text = stripped
    .replace(/&(#?\w+);/gu, (whole, name: string) => ENTITY[name] ?? whole)
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  return { text: stripControl(text, true), lossy };
}
