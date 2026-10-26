import {
  AnnotationMode,
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import {
  isPdfPreviewNonce,
  PDF_PREVIEW_LIMITS,
  PDF_PREVIEW_PROTOCOL,
} from "./protocol";

type ViewerInitMessage = {
  protocol: typeof PDF_PREVIEW_PROTOCOL;
  type: "init";
  nonce: string;
};

type ViewerDocumentMessage = {
  protocol: typeof PDF_PREVIEW_PROTOCOL;
  type: "document";
  nonce: string;
  bytes: ArrayBuffer;
};

type ViewerPageMessage = {
  protocol: typeof PDF_PREVIEW_PROTOCOL;
  type: "page";
  nonce: string;
  pageNumber: number;
  scale: number;
};

type ViewerDisposeMessage = {
  protocol: typeof PDF_PREVIEW_PROTOCOL;
  type: "dispose";
  nonce: string;
};

type ViewerInputMessage =
  | ViewerDocumentMessage
  | ViewerPageMessage
  | ViewerDisposeMessage;

let trustedParentOrigin: string | null = null;
let channel: MessagePort | null = null;
let nonce: string | null = null;
let loadingTask: ReturnType<typeof getDocument> | null = null;
let documentProxy: PDFDocumentProxy | null = null;
let renderTask: RenderTask | null = null;
let disposed = false;
let generation = 0;

GlobalWorkerOptions.workerSrc = workerUrl;

function setCanvasLayout() {
  const body = document.body;
  body.style.boxSizing = "border-box";
  body.style.display = "flex";
  body.style.justifyContent = "center";
  body.style.alignItems = "flex-start";
  body.style.width = "100%";
  body.style.minHeight = "100vh";
  body.style.margin = "0";
  body.style.padding = "8px";
  const canvas = document.getElementById("pdf-page");
  if (canvas instanceof HTMLCanvasElement) canvas.style.display = "block";
}

setCanvasLayout();

function getTrustedParentOrigin() {
  if (trustedParentOrigin) return trustedParentOrigin;
  const referrer = document.referrer;
  if (!referrer) return null;
  try {
    const parsed = new URL(referrer);
    if (
      parsed.protocol !== "https:" &&
      !(
        parsed.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
      )
    )
      return null;
    trustedParentOrigin = parsed.origin;
    return trustedParentOrigin;
  } catch {
    return null;
  }
}

function send(
  type: "connected" | "disposed" | "loaded" | "rendered" | "failed",
  detail: {
    pageCount?: number;
    pageNumber?: number;
    scale?: number;
    reason?: "unavailable" | "resource_limit" | "timeout";
  } = {},
) {
  if (!channel || !nonce) return;
  channel.postMessage({
    protocol: PDF_PREVIEW_PROTOCOL,
    nonce,
    type,
    ...detail,
  });
}

function isInitMessage(value: unknown): value is ViewerInitMessage {
  return (
    isRecord(value) &&
    value.protocol === PDF_PREVIEW_PROTOCOL &&
    value.type === "init" &&
    isPdfPreviewNonce(value.nonce)
  );
}

function isInputMessage(value: unknown): value is ViewerInputMessage {
  if (
    !isRecord(value) ||
    value.protocol !== PDF_PREVIEW_PROTOCOL ||
    !isPdfPreviewNonce(value.nonce)
  )
    return false;
  if (value.type === "document") return value.bytes instanceof ArrayBuffer;
  if (value.type === "page")
    return (
      Number.isSafeInteger(value.pageNumber) && typeof value.scale === "number"
    );
  return value.type === "dispose";
}

function isPdfDocument(bytes: ArrayBuffer) {
  if (bytes.byteLength < 4 || bytes.byteLength > PDF_PREVIEW_LIMITS.bytes)
    return false;
  const view = new Uint8Array(bytes, 0, 4);
  return (
    view[0] === 0x25 && view[1] === 0x50 && view[2] === 0x44 && view[3] === 0x46
  );
}

async function destroyDocument() {
  generation += 1;
  renderTask?.cancel();
  renderTask = null;
  const previousLoadingTask = loadingTask;
  loadingTask = null;
  documentProxy = null;
  if (previousLoadingTask) await previousLoadingTask.destroy().catch(() => {});
}

async function loadDocument(bytes: ArrayBuffer) {
  if (!isPdfDocument(bytes)) {
    send("failed", { reason: "unavailable" });
    return;
  }

  await destroyDocument();
  const task = getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    enableXfa: false,
    useWorkerFetch: false,
    useWasm: false,
    disableRange: true,
    disableAutoFetch: true,
    disableStream: true,
    maxImageSize: PDF_PREVIEW_LIMITS.pixelsPerPage,
    verbosity: 0,
  });
  loadingTask = task;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void task.destroy().catch(() => {});
  }, PDF_PREVIEW_LIMITS.loadMs);

  try {
    const loaded = await task.promise;
    if (disposed || loadingTask !== task) {
      await task.destroy();
      return;
    }
    if (loaded.numPages < 1 || loaded.numPages > PDF_PREVIEW_LIMITS.pages) {
      await destroyDocument();
      send("failed", { reason: "resource_limit" });
      return;
    }
    documentProxy = loaded;
    send("loaded", { pageCount: loaded.numPages });
    await renderPage(1, 1);
  } catch {
    if (!disposed) {
      await destroyDocument();
      send("failed", { reason: timedOut ? "timeout" : "unavailable" });
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function renderPage(pageNumber: number, scale: number) {
  const pdf = documentProxy;
  if (
    disposed ||
    !pdf ||
    !Number.isSafeInteger(pageNumber) ||
    pageNumber < 1 ||
    pageNumber > pdf.numPages ||
    !Number.isFinite(scale) ||
    scale < PDF_PREVIEW_LIMITS.scaleMin ||
    scale > PDF_PREVIEW_LIMITS.scaleMax
  ) {
    return;
  }

  renderTask?.cancel();
  renderTask = null;
  const renderGeneration = ++generation;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    renderTask?.cancel();
    void loadingTask?.destroy().catch(() => {});
  }, PDF_PREVIEW_LIMITS.renderMs);
  try {
    const page: PDFPageProxy = await pdf.getPage(pageNumber);
    if (disposed || renderGeneration !== generation) {
      await page.cleanup();
      return;
    }
    const viewport = page.getViewport({ scale });
    if (viewport.width * viewport.height > PDF_PREVIEW_LIMITS.pixelsPerPage) {
      send("failed", { reason: "resource_limit" });
      await page.cleanup();
      return;
    }
    const canvas = document.getElementById("pdf-page");
    if (!(canvas instanceof HTMLCanvasElement)) {
      send("failed", { reason: "unavailable" });
      return;
    }
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      send("failed", { reason: "unavailable" });
      return;
    }
    const task = page.render({
      canvas,
      canvasContext: context,
      viewport,
      annotationMode: AnnotationMode.DISABLE,
    });
    renderTask = task;
    try {
      await task.promise;
      if (!disposed && renderGeneration === generation)
        send("rendered", { pageNumber, scale });
    } catch {
      if (!disposed && renderGeneration === generation)
        send("failed", { reason: timedOut ? "timeout" : "unavailable" });
    } finally {
      if (renderTask === task) renderTask = null;
      await page.cleanup();
    }
  } catch {
    if (!disposed && renderGeneration === generation)
      send("failed", { reason: timedOut ? "timeout" : "unavailable" });
  } finally {
    clearTimeout(timeout);
  }
}

async function dispose() {
  if (disposed) return;
  disposed = true;
  await destroyDocument();
  send("disposed");
  channel?.close();
  channel = null;
  window.removeEventListener("message", onWindowMessage);
}

function onPortMessage(event: MessageEvent<unknown>) {
  if (!nonce || !isInputMessage(event.data) || event.data.nonce !== nonce)
    return;
  switch (event.data.type) {
    case "document":
      void loadDocument(event.data.bytes);
      return;
    case "page":
      void renderPage(event.data.pageNumber, event.data.scale);
      return;
    case "dispose":
      void dispose();
      return;
  }
}

function onWindowMessage(event: MessageEvent<unknown>) {
  const parentOrigin = getTrustedParentOrigin();
  if (
    disposed ||
    !parentOrigin ||
    event.source !== window.parent ||
    event.origin !== parentOrigin ||
    !isInitMessage(event.data) ||
    event.ports.length !== 1
  ) {
    return;
  }
  nonce = event.data.nonce;
  channel = event.ports[0];
  channel.onmessage = onPortMessage;
  channel.start();
  send("connected");
  window.removeEventListener("message", onWindowMessage);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const parentOrigin = getTrustedParentOrigin();
if (parentOrigin) {
  window.addEventListener("message", onWindowMessage);
  window.addEventListener("pagehide", () => void dispose(), { once: true });
  window.parent.postMessage(
    { protocol: PDF_PREVIEW_PROTOCOL, type: "ready" },
    parentOrigin,
  );
}
