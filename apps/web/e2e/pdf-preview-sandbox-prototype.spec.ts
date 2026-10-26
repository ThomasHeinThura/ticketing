import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const origin = "http://127.0.0.1:4178";
const here = path.dirname(fileURLToPath(import.meta.url));
const pdfjsRoot = path.resolve(here, "../node_modules/pdfjs-dist/build");

function singlePagePdf() {
  const content = "BT /F1 20 Tf 72 100 Td (sandbox-render-ok) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 180] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

const viewerModule = `import * as pdfjsLib from "/__pdfjs/pdf.mjs";
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/__pdfjs/pdf.worker.mjs";
  let port;
  let nonce;
  let loadingTask;
  const parentOrigin = new URL(document.referrer).origin;
  const send = (type, detail = {}) => port?.postMessage({ type, nonce, ...detail });
  let cookieReadable = false;
  let storageAvailable = false;
  let parentDomAccessible = false;
  try { cookieReadable = document.cookie.length > 0; } catch {}
  try { localStorage.getItem("probe"); storageAvailable = true; } catch {}
  try { window.parent.document.body; parentDomAccessible = true; } catch {}
  const apiBlockCheck = fetch("/api/attachments/pdf-preview-probe/preview")
    .then(() => false, () => true);

  window.addEventListener("message", (event) => {
    if (event.source !== parent || event.origin !== parentOrigin ||
        event.data?.type !== "pdf-preview-init" || event.ports.length !== 1 ||
        typeof event.data.nonce !== "string" || !/^[A-Za-z0-9_-]{32,64}$/.test(event.data.nonce)) return;
    nonce = event.data.nonce;
    port = event.ports[0];
    port.onmessage = async (message) => {
      if (message.data?.nonce !== nonce) return;
      if (message.data.type === "dispose") {
        await loadingTask?.destroy();
        send("disposed");
        port.close();
        return;
      }
      if (message.data.type !== "document" || !(message.data.bytes instanceof ArrayBuffer)) return;
      try {
        const apiBlocked = await apiBlockCheck;
        loadingTask = pdfjsLib.getDocument({
          data: new Uint8Array(message.data.bytes),
          isEvalSupported: false,
          enableXfa: false,
          useWorkerFetch: false,
          disableAutoFetch: true,
          disableStream: true,
          maxImageSize: 4000000,
          verbosity: 0,
        });
        const document = await loadingTask.promise;
        if (document.numPages > 20) throw new Error("page_limit");
        const page = await document.getPage(1);
        const viewport = page.getViewport({ scale: 1 });
        if (viewport.width * viewport.height > 4000000) throw new Error("pixel_limit");
        const canvas = document.defaultView?.document.getElementById("page") ?? window.document.getElementById("page");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport, annotationMode: pdfjsLib.AnnotationMode.DISABLE }).promise;
        send("rendered", {
          pageCount: document.numPages,
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
          cookieReadable,
          storageAvailable,
          parentDomAccessible,
          apiBlocked,
          origin: window.origin,
        });
      } catch {
        send("render_failed");
      }
    };
    port.start();
    send("connected");
  }, { once: true });

  window.parent.postMessage({ type: "pdf-preview-ready" }, parentOrigin);`;

const childHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>PDF preview</title></head>
<body><canvas id="page"></canvas>
<script type="module" src="/__pdf-preview-viewer.mjs"></script>
</body></html>`;

test("sandboxed PDF.js frame renders transferred bytes without page origin or credentials", async ({
  page,
}) => {
  const bytes = singlePagePdf();
  const diagnostics = {
    pageErrors: [] as string[],
    consoleErrors: [] as string[],
    failedRequests: [] as string[],
  };
  const apiRequests: string[] = [];
  page.on("pageerror", (error) => diagnostics.pageErrors.push(error.name));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    diagnostics.consoleErrors.push(
      message.text().includes("Content Security Policy")
        ? "csp"
        : "console_error",
    );
  });
  page.on("requestfailed", (request) => {
    diagnostics.failedRequests.push(
      `${request.method()} ${new URL(request.url()).pathname}`,
    );
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) apiRequests.push(url.pathname);
  });
  const observedAssetRequests: Array<{
    path: string;
    hasCookie: boolean;
    origin: string | null;
  }> = [];
  const observedViewerCookie = { requested: false, present: false };
  const viewerPath = "/__pdf-preview-viewer";
  const viewerUrl = `${origin}${viewerPath}`;
  const viewerCsp = [
    "default-src 'none'",
    `script-src ${origin}/__pdf-preview-viewer.mjs ${origin}/__pdfjs/pdf.mjs ${origin}/__pdfjs/pdf.worker.mjs`,
    "worker-src blob:",
    "connect-src 'none'",
    "img-src 'none'",
    "style-src 'none'",
    "font-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${origin}`,
  ].join("; ");
  const parentCsp = [
    "default-src 'none'",
    "script-src 'nonce-parent-probe'",
    `frame-src ${viewerUrl}`,
    "connect-src 'none'",
    "img-src 'none'",
    "style-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  const parentHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Host</title></head><body>
    <iframe id="viewer" title="PDF preview" sandbox="allow-scripts" credentialless referrerpolicy="origin"></iframe>
    <output id="result">waiting</output>
    <output id="disposed"></output>
    <script nonce="parent-probe">
      const frame = document.getElementById("viewer");
      const result = document.getElementById("result");
      const nonce = crypto.randomUUID().replaceAll("-", "_");
      const channel = new MessageChannel();
      window.startPreview = () => { frame.src = "${viewerPath}"; };
      window.addEventListener("message", (event) => {
        if (event.source !== frame.contentWindow || event.origin !== "null" || event.data?.type !== "pdf-preview-ready") return;
        frame.contentWindow.postMessage({ type: "pdf-preview-init", nonce }, "*", [channel.port2]);
      });
      channel.port1.onmessage = (event) => {
        const data = event.data;
        if (data?.nonce !== nonce) return;
        if (data.type === "connected") channel.port1.postMessage({ type: "document", nonce, bytes: window.fixtureBytes }, [window.fixtureBytes]);
        if (data.type === "rendered") result.textContent = JSON.stringify(data);
        if (data.type === "disposed") document.getElementById("disposed").textContent = "disposed";
      };
      channel.port1.start();
      window.disposePreview = () => channel.port1.postMessage({ type: "dispose", nonce });
    </script></body></html>`;

  await page.route(`${origin}/__pdf-preview-parent`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      headers: {
        "Content-Security-Policy": parentCsp,
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
        "Set-Cookie": "pdf_probe_only=fixture; Path=/; SameSite=Lax",
      },
      body: parentHtml,
    }),
  );
  await page.route(`${origin}${viewerPath}`, (route) => {
    observedViewerCookie.requested = true;
    observedViewerCookie.present = Boolean(route.request().headers().cookie);
    return route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      headers: {
        "Content-Security-Policy": viewerCsp,
        "X-Frame-Options": "SAMEORIGIN",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "origin",
        "Cache-Control": "no-store",
      },
      body: childHtml,
    });
  });
  for (const asset of ["pdf.mjs", "pdf.worker.mjs"] as const) {
    const body = await readFile(path.join(pdfjsRoot, asset));
    await page.route(`${origin}/__pdfjs/${asset}`, (route) => {
      const headers = route.request().headers();
      observedAssetRequests.push({
        path: new URL(route.request().url()).pathname,
        hasCookie: Boolean(headers.cookie),
        origin: headers.origin ?? null,
      });
      return route.fulfill({
        status: 200,
        contentType: "text/javascript; charset=utf-8",
        headers: {
          "Access-Control-Allow-Origin": "null",
          "Cross-Origin-Resource-Policy": "cross-origin",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
        },
        body,
      });
    });
  }
  await page.route(`${origin}/__pdf-preview-viewer.mjs`, (route) => {
    const headers = route.request().headers();
    observedAssetRequests.push({
      path: new URL(route.request().url()).pathname,
      hasCookie: Boolean(headers.cookie),
      origin: headers.origin ?? null,
    });
    return route.fulfill({
      status: 200,
      contentType: "text/javascript; charset=utf-8",
      headers: {
        "Access-Control-Allow-Origin": "null",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
      body: viewerModule,
    });
  });

  await page.goto(`${origin}/__pdf-preview-parent`);
  await page.evaluate((base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) =>
      character.charCodeAt(0),
    );
    (window as typeof window & { fixtureBytes?: ArrayBuffer }).fixtureBytes =
      bytes.buffer;
    (window as typeof window & { startPreview?: () => void }).startPreview?.();
  }, Buffer.from(bytes).toString("base64"));

  try {
    await expect(page.locator("#result")).toContainText('"pageCount":1', {
      timeout: 15_000,
    });
  } catch {
    throw new Error(
      JSON.stringify({
        stage: "renderer_result_timeout",
        diagnostics,
        viewerRequested: observedViewerCookie,
        assetRequestCount: observedAssetRequests.length,
      }),
    );
  }
  const result = JSON.parse(
    (await page.locator("#result").textContent()) ?? "{}",
  );
  expect(result).toMatchObject({
    pageCount: 1,
    canvasWidth: 300,
    canvasHeight: 180,
    cookieReadable: false,
    storageAvailable: false,
    parentDomAccessible: false,
    apiBlocked: true,
    origin: "null",
  });
  expect(await page.locator("#viewer").getAttribute("sandbox")).toBe(
    "allow-scripts",
  );
  // The browser sends ambient same-origin cookies on this constant static document request;
  // the sandboxed opaque-origin renderer cannot read them, and no API request uses them.
  expect(observedViewerCookie).toEqual({ requested: true, present: true });
  expect(observedAssetRequests.length).toBeGreaterThanOrEqual(2);
  expect(observedAssetRequests.every((request) => !request.hasCookie)).toBe(
    true,
  );
  expect(
    observedAssetRequests.every((request) => request.origin === "null"),
  ).toBe(true);
  expect(
    observedAssetRequests.some((request) =>
      request.path.endsWith("/pdf.worker.mjs"),
    ),
  ).toBe(true);
  expect(apiRequests).toEqual([]);
  await page.evaluate(() => {
    (
      window as typeof window & { disposePreview?: () => void }
    ).disposePreview?.();
  });
  await expect(page.locator("#disposed")).toHaveText("disposed");
});
