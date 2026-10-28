import type { Context } from "hono";

const documentNonces = new WeakMap<object, string>();
const PDF_PREVIEW_PATH = "/pdf-preview.html";
const PDF_PREVIEW_ASSET_PREFIX = "/assets/pdf-preview/";

/** Nonce shared by the CSP header and the trusted agent/portal SPA shell. */
export function cspNonceForContext(context: Context): string | undefined {
  return documentNonces.get(context);
}

export function isPotentialSpaDocumentRequest(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const pathname = new URL(request.url).pathname;
  if (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/scim" ||
    pathname.startsWith("/scim/")
  ) {
    return false;
  }
  if (pathname === "/index.html" || pathname === PDF_PREVIEW_PATH) return true;
  const lastSegment = pathname.split("/").pop() ?? "";
  return !lastSegment.includes(".");
}

export function isPdfPreviewDocumentPath(pathname: string) {
  return pathname === PDF_PREVIEW_PATH;
}

function isPdfPreviewJavaScriptAsset(pathname: string) {
  if (!pathname.startsWith(PDF_PREVIEW_ASSET_PREFIX)) return false;
  const relativePath = pathname.slice(PDF_PREVIEW_ASSET_PREFIX.length);
  const segments = relativePath.split("/");
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        !/^[A-Za-z0-9._-]+$/.test(segment),
    )
  ) {
    return false;
  }
  return /\.(?:js|mjs)$/i.test(relativePath);
}

/** CORS is limited to public PDF.js build assets used by an opaque sandbox origin. */
export function applyPdfPreviewAssetResponseHeaders(
  response: Response,
  pathname: string,
): Response {
  const contentType = response.headers.get("content-type") ?? "";
  if (
    (response.status !== 200 && response.status !== 304) ||
    !isPdfPreviewJavaScriptAsset(pathname) ||
    (response.status === 200 &&
      !/^(?:text|application)\/(?:javascript|ecmascript|x-javascript)(?:;|$)/i.test(
        contentType,
      ))
  ) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "null");
  headers.delete("Access-Control-Allow-Credentials");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  return new Response(response.status === 304 ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Adds a fresh nonce only to the static agent or portal shell. Call from the
 * SPA index fallback before compression; API/file responses never use this.
 */
export async function injectCspNonceIntoHtmlResponse(
  response: Response,
  nonce: string,
): Promise<Response> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(nonce)) {
    throw new Error("CSP nonce must be a base64url token");
  }
  const headers = new Headers(response.headers);
  if (!headers.get("content-type")?.toLowerCase().startsWith("text/html")) {
    return response;
  }

  headers.set("Cache-Control", "no-store");
  headers.delete("Content-Length");
  headers.delete("ETag");
  headers.delete("Last-Modified");
  if (response.body === null) {
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const escapedNonce = nonce.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const html = await response.text();
  const noncedHtml = html.replace(/<script\b[^>]*>/gi, (tag) => {
    const withoutOldNonce = tag.replace(
      /\snonce\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i,
      "",
    );
    return withoutOldNonce.replace(
      /^<script\b/i,
      `<script nonce="${escapedNonce}"`,
    );
  });

  return new Response(noncedHtml, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function rememberCspNonce(context: Context, nonce: string) {
  documentNonces.set(context, nonce);
}
