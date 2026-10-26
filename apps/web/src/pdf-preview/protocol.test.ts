import { describe, expect, it } from "vitest";
import {
  isPdfPreviewNonce,
  isPdfPreviewPortMessage,
  isPdfPreviewReadyMessage,
  PDF_PREVIEW_LIMITS,
  PDF_PREVIEW_PROTOCOL,
} from "./protocol";

describe("sandboxed PDF preview protocol", () => {
  it("accepts only the static viewer readiness message", () => {
    expect(
      isPdfPreviewReadyMessage({
        protocol: PDF_PREVIEW_PROTOCOL,
        type: "ready",
      }),
    ).toBe(true);
    expect(isPdfPreviewReadyMessage({ protocol: "other", type: "ready" })).toBe(
      false,
    );
    expect(
      isPdfPreviewReadyMessage({
        protocol: PDF_PREVIEW_PROTOCOL,
        type: "init",
      }),
    ).toBe(false);
  });

  it("validates a one-use nonce and the matching transferred-port messages", () => {
    const nonce = "a".repeat(43);
    expect(isPdfPreviewNonce(nonce)).toBe(true);
    expect(isPdfPreviewNonce("short")).toBe(false);
    expect(isPdfPreviewNonce("z".repeat(65))).toBe(false);
    expect(
      isPdfPreviewPortMessage(
        { protocol: PDF_PREVIEW_PROTOCOL, nonce, type: "loaded", pageCount: 1 },
        nonce,
      ),
    ).toBe(true);
    expect(
      isPdfPreviewPortMessage(
        {
          protocol: PDF_PREVIEW_PROTOCOL,
          nonce: "x".repeat(43),
          type: "loaded",
        },
        nonce,
      ),
    ).toBe(false);
    expect(
      isPdfPreviewPortMessage(
        { protocol: PDF_PREVIEW_PROTOCOL, nonce, type: "download" },
        nonce,
      ),
    ).toBe(false);
    expect(
      isPdfPreviewPortMessage(
        { protocol: PDF_PREVIEW_PROTOCOL, nonce, type: "loaded" },
        nonce,
      ),
    ).toBe(false);
    expect(
      isPdfPreviewPortMessage(
        {
          protocol: PDF_PREVIEW_PROTOCOL,
          nonce,
          type: "rendered",
          pageNumber: 201,
          scale: 1,
        },
        nonce,
      ),
    ).toBe(false);
  });

  it("sets fixed browser parsing limits", () => {
    expect(PDF_PREVIEW_LIMITS).toEqual({
      bytes: 25 * 1024 * 1024,
      pages: 200,
      pixelsPerPage: 16_000_000,
      scaleMin: 0.75,
      scaleMax: 2,
      loadMs: 20_000,
      renderMs: 15_000,
    });
  });
});
