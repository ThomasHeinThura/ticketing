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
  WebhookDestinationError,
} from "../../webhook/safe-http";

export type SafeDownloadResult =
  | { ok: true; bytes: Uint8Array; contentType: string | null }
  | { ok: false; code: "failed" | "too_large" };

/**
 * Source credentials for a download, supplied at download time by the adapter (never stored with the
 * job, the preview or the report). `headers` are sent only to a request whose host is one of `hosts`
 * (the source's own configured host); a redirect to any other host is fetched without them.
 */
export type ImportAttachmentAuth = {
  headers: Record<string, string>;
  hosts: readonly string[];
};

export type SafeDownloadOptions = {
  maxBytes: number;
  timeoutMs?: number;
  resolver?: AddressResolver;
  env?: { NODE_ENV?: string | undefined };
  auth?: ImportAttachmentAuth | null;
  /** Follow at most this many SAME-HOST redirects, each re-validated like the first request. Default 0. */
  maxRedirects?: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Download one source attachment over the same guarded egress as webhook delivery (WH-9 to WH-12):
 * HTTPS only, destination resolved and checked before connecting AND again at connect time (no DNS
 * rebinding window), the connected socket's address verified, redirects never followed, a hard byte
 * cap that aborts mid-stream, and a timeout. Never throws: every refusal or failure is a result,
 * so the caller records a loss with the source URL instead of failing the import.
 */
export async function safeDownload(
  rawUrl: string,
  options: SafeDownloadOptions,
): Promise<SafeDownloadResult> {
  let url = rawUrl;
  const redirects = Math.max(0, options.maxRedirects ?? 0);
  for (let hop = 0; hop <= redirects; hop += 1) {
    const result = await downloadOnce(url, options, hop < redirects);
    if (!("redirect" in result)) return result;
    try {
      const next = new URL(result.redirect, url);
      // Never follow a redirect to a new host (SSRF policy); only a same-host redirect is allowed,
      // and it is validated like the first request.
      if (next.host.toLowerCase() !== new URL(url).host.toLowerCase())
        return { ok: false, code: "failed" };
      url = next.toString();
    } catch {
      return { ok: false, code: "failed" };
    }
  }
  return { ok: false, code: "failed" };
}

function authHeadersFor(
  url: URL,
  auth: ImportAttachmentAuth | null | undefined,
) {
  if (!auth) return {};
  const host = url.hostname.toLowerCase();
  return auth.hosts.some((allowed) => allowed.toLowerCase() === host)
    ? auth.headers
    : {};
}

async function downloadOnce(
  rawUrl: string,
  options: SafeDownloadOptions,
  followRedirect: boolean,
): Promise<SafeDownloadResult | { redirect: string }> {
  // Strict whatever NODE_ENV says: `env` exists only so a unit test can reach a loopback server.
  const env = options.env ?? { NODE_ENV: "production" };
  const relaxed = developmentRelaxationActive(env);
  const resolver = options.resolver ?? systemResolver;
  let parsed: ReturnType<typeof parseWebhookUrl>;
  try {
    parsed = parseWebhookUrl(rawUrl, env);
    await resolvePermittedAddresses(parsed.url.hostname, resolver, relaxed);
  } catch (error) {
    if (error instanceof WebhookDestinationError)
      return { ok: false, code: "failed" };
    return { ok: false, code: "failed" };
  }
  const transport = parsed.secure ? https : http;
  return new Promise<SafeDownloadResult | { redirect: string }>((resolve) => {
    let settled = false;
    const chunks: Buffer[] = [];
    let received = 0;
    const finish = (result: SafeDownloadResult | { redirect: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(result);
    };
    const request = transport.request(
      {
        protocol: parsed.url.protocol,
        hostname: parsed.url.hostname.replace(/^\[|\]$/g, ""),
        port: parsed.url.port || undefined,
        path: `${parsed.url.pathname}${parsed.url.search}`,
        method: "GET",
        headers: {
          accept: "*/*",
          ...authHeadersFor(parsed.url, options.auth),
        },
        lookup: createGuardedLookup(
          resolver,
          relaxed,
        ) as unknown as net.LookupFunction,
        agent: false,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if (
          followRedirect &&
          [301, 302, 303, 307, 308].includes(status) &&
          typeof location === "string"
        ) {
          response.resume();
          finish({ redirect: location });
          request.destroy();
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          finish({ ok: false, code: "failed" }); // includes any 3xx: redirects are never followed
          request.destroy();
          return;
        }
        const declared = Number(response.headers["content-length"]);
        if (Number.isFinite(declared) && declared > options.maxBytes) {
          finish({ ok: false, code: "too_large" });
          request.destroy();
          return;
        }
        response.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > options.maxBytes) {
            finish({ ok: false, code: "too_large" });
            request.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          const type = response.headers["content-type"];
          finish({
            ok: true,
            bytes: new Uint8Array(Buffer.concat(chunks)),
            contentType: typeof type === "string" ? type : null,
          });
        });
        response.on("error", () => finish({ ok: false, code: "failed" }));
        response.on("aborted", () => finish({ ok: false, code: "failed" }));
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
    request.on("error", () => finish({ ok: false, code: "failed" }));
    const deadline = setTimeout(() => {
      finish({ ok: false, code: "failed" });
      request.destroy();
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    request.end();
  });
}
