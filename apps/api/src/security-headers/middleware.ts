import { randomBytes } from "node:crypto";
import type { Context, MiddlewareHandler, Next } from "hono";
import {
  applyPdfPreviewAssetResponseHeaders,
  isPdfPreviewDocumentPath,
  isPotentialSpaDocumentRequest,
  rememberCspNonce,
} from "./html-nonce";
import {
  buildContentSecurityPolicy,
  buildPdfPreviewContentSecurityPolicy,
  type CspMode,
  reportingEndpointsHeader,
  SECURITY_RESPONSE_HEADERS,
  type SecurityOrigins,
  type SecuritySurface,
  validateSecurityOrigins,
} from "./policy-builder";

export type SecurityHeadersOptions = {
  /** The validated host-routing decision already stored on the request context. */
  surfaceForContext: (context: Context) => SecuritySurface | undefined;
  /** Origins are captured from validated application configuration at boot. */
  origins: SecurityOrigins;
  /** Called only after an actual SPA HTML response, never for API/search traffic. */
  readCspMode: () => Promise<CspMode | string>;
  /** Injection point for deterministic tests; production uses a fresh CSPRNG nonce. */
  createNonce?: () => string;
};

function newNonce() {
  return randomBytes(24).toString("base64url");
}

function replaceRequestWithoutValidators(context: Context) {
  const headers = new Headers(context.req.raw.headers);
  headers.delete("if-none-match");
  headers.delete("if-modified-since");
  context.req.raw = new Request(context.req.raw, { headers });
}

function validMode(mode: string): mode is CspMode {
  return mode === "report_only" || mode === "enforce";
}

function setBaselineHeaders(headers: Headers, origin: string) {
  for (const [name, value] of Object.entries(SECURITY_RESPONSE_HEADERS)) {
    headers.set(name, value);
  }
  if (new URL(origin).protocol === "https:") {
    // includeSubDomains and preload remain operator opt-ins at Traefik.
    headers.set("Strict-Transport-Security", "max-age=63072000");
  }
}

export function createSecurityHeadersMiddleware(
  options: SecurityHeadersOptions,
): MiddlewareHandler {
  const origins = validateSecurityOrigins(options.origins);
  const createNonce = options.createNonce ?? newNonce;

  return async (context: Context, next: Next) => {
    const surface = options.surfaceForContext(context);
    if (!surface) return next();

    const candidateDocument = isPotentialSpaDocumentRequest(context.req.raw);
    const pdfPreviewDocument =
      candidateDocument && isPdfPreviewDocumentPath(context.req.path);
    const nonce = candidateDocument ? createNonce() : undefined;
    if (nonce) {
      rememberCspNonce(context, nonce);
      // Static-file validators can otherwise return a 304 with the old shell nonce.
      replaceRequestWithoutValidators(context);
    }

    await next();

    const response = context.res;
    const publicAssetResponse = applyPdfPreviewAssetResponseHeaders(
      response,
      context.req.path,
    );
    const headers = new Headers(publicAssetResponse.headers);
    setBaselineHeaders(headers, origins[surface]);
    const isHtml = headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("text/html");
    const hasCsp =
      headers.has("Content-Security-Policy") ||
      headers.has("Content-Security-Policy-Report-Only");

    if (pdfPreviewDocument && isHtml && nonce) {
      headers.set(
        "Content-Security-Policy",
        buildPdfPreviewContentSecurityPolicy({ surface, nonce, origins }),
      );
      headers.delete("Content-Security-Policy-Report-Only");
      headers.set("X-Frame-Options", "SAMEORIGIN");
      headers.set("Referrer-Policy", "origin");
      headers.set("Cache-Control", "no-store");
    } else if (candidateDocument && isHtml && nonce && !hasCsp) {
      let mode: CspMode = "enforce";
      try {
        const configuredMode = await options.readCspMode();
        if (validMode(configuredMode)) mode = configuredMode;
      } catch {
        // A settings read failure must not silently disable enforcement.
      }
      const policy = buildContentSecurityPolicy({
        surface,
        nonce,
        origins,
      });
      headers.set(
        mode === "report_only"
          ? "Content-Security-Policy-Report-Only"
          : "Content-Security-Policy",
        policy,
      );
      headers.set(
        "Reporting-Endpoints",
        reportingEndpointsHeader(origins[surface]),
      );
      headers.set("Cache-Control", "no-store");
    }

    // Apply the final policy to Hono's context. Replacing the Response alone
    // restores its previous headers, including credentialed CORS on public assets.
    for (const name of response.headers.keys())
      if (!headers.has(name)) context.header(name, undefined);
    for (const [name, value] of headers) {
      // This middleware never changes cookies; preserve separate Set-Cookie rows.
      if (name === "set-cookie") continue;
      if (context.res.headers.get(name) !== value) context.header(name, value);
    }
    return context.res;
  };
}
