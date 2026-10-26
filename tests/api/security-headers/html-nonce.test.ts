import { describe, expect, it } from "vitest";
import {
  applyPdfPreviewAssetResponseHeaders,
  injectCspNonceIntoHtmlResponse,
  isPotentialSpaDocumentRequest,
} from "../../../apps/api/src/security-headers/html-nonce";

describe("trusted SPA HTML nonce helper", () => {
  it("replaces stale script nonces, adds a nonce to every script, and disables shell caching", async () => {
    const response = new Response(
      '<html><script src="/assets/a.js"></script><script nonce="old">boot()</script></html>',
      {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-length": "99",
          etag: '"old"',
          "last-modified": "Sun, 25 Oct 2026 00:00:00 GMT",
        },
      },
    );

    const result = await injectCspNonceIntoHtmlResponse(
      response,
      "A1234567890123456789_abcd",
    );
    const html = await result.text();
    expect(html.match(/nonce="A1234567890123456789_abcd"/g)).toHaveLength(2);
    expect(html).not.toContain('nonce="old"');
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(result.headers.has("content-length")).toBe(false);
    expect(result.headers.has("etag")).toBe(false);
    expect(result.headers.has("last-modified")).toBe(false);
  });

  it("leaves non-HTML responses untouched", async () => {
    const response = new Response("download", {
      headers: { "content-type": "application/octet-stream" },
    });
    expect(
      await injectCspNonceIntoHtmlResponse(
        response,
        "A1234567890123456789_abcd",
      ),
    ).toBe(response);
  });

  it("selects SPA document paths and excludes API/file paths", () => {
    expect(
      isPotentialSpaDocumentRequest(new Request("https://agent.test/")),
    ).toBe(true);
    expect(
      isPotentialSpaDocumentRequest(
        new Request("https://agent.test/agent/projects/key/work"),
      ),
    ).toBe(true);
    expect(
      isPotentialSpaDocumentRequest(
        new Request("https://agent.test/index.html"),
      ),
    ).toBe(true);
    expect(
      isPotentialSpaDocumentRequest(
        new Request("https://agent.test/pdf-preview.html"),
      ),
    ).toBe(true);
    expect(
      isPotentialSpaDocumentRequest(
        new Request("https://agent.test/api/attachment/download"),
      ),
    ).toBe(false);
    expect(
      isPotentialSpaDocumentRequest(
        new Request("https://agent.test/assets/app.js"),
      ),
    ).toBe(false);
    expect(
      isPotentialSpaDocumentRequest(
        new Request("https://agent.test/", { method: "POST" }),
      ),
    ).toBe(false);
  });

  it("adds null-origin CORS only to PDF JavaScript and module worker assets", () => {
    const response = new Response("export {}", {
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        "access-control-allow-credentials": "true",
      },
    });
    const isolated = applyPdfPreviewAssetResponseHeaders(
      response,
      "/assets/pdf-preview/pdf.worker-abc123.mjs",
    );
    expect(isolated.headers.get("access-control-allow-origin")).toBe("null");
    expect(isolated.headers.get("access-control-allow-credentials")).toBeNull();
    expect(isolated.headers.get("cross-origin-resource-policy")).toBe(
      "cross-origin",
    );

    const cached = applyPdfPreviewAssetResponseHeaders(
      new Response(null, {
        status: 304,
        headers: { etag: '"viewer-asset"' },
      }),
      "/assets/pdf-preview/viewer-abc123.js",
    );
    expect(cached.status).toBe(304);
    expect(cached.headers.get("access-control-allow-origin")).toBe("null");
    expect(cached.body).toBeNull();

    for (const [pathname, status] of [
      ["/assets/app.js", 200],
      ["/assets/pdf-preview/private.json", 200],
      ["/assets/pdf-preview/../app.js", 200],
      ["/api/assets/pdf-preview/app.js", 200],
      ["/assets/pdf-preview/app.js", 404],
    ] as const) {
      const untouched = applyPdfPreviewAssetResponseHeaders(
        new Response("payload", {
          status,
          headers: { "content-type": "text/javascript" },
        }),
        pathname,
      );
      expect(untouched.headers.has("access-control-allow-origin")).toBe(false);
    }

    const wrongMime = applyPdfPreviewAssetResponseHeaders(
      new Response("payload", {
        headers: { "content-type": "text/html" },
      }),
      "/assets/pdf-preview/viewer-abc123.js",
    );
    expect(wrongMime.headers.has("access-control-allow-origin")).toBe(false);
  });
});
