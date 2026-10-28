import { describe, expect, it } from "vitest";
import {
  assertPdfPreviewMetadata,
  createVerifiedPdfPreviewStream,
  MAX_PDF_PREVIEW_BYTES,
  PdfPreviewUnavailableError,
} from "../../../apps/api/src/attachment/pdf-preview";

function byteStream(
  chunks: readonly Uint8Array[],
  options?: { onCancel?: () => void },
) {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel() {
      options?.onCancel?.();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

describe("PDF attachment preview stream", () => {
  it("accepts only declared PDF data within the fixed preview bound", () => {
    expect(() =>
      assertPdfPreviewMetadata({ mimeType: "application/pdf", size: 4 }),
    ).not.toThrow();
    expect(() =>
      assertPdfPreviewMetadata({
        mimeType: "application/octet-stream",
        size: 4,
      }),
    ).toThrow(PdfPreviewUnavailableError);
    expect(() =>
      assertPdfPreviewMetadata({
        mimeType: "application/pdf",
        size: MAX_PDF_PREVIEW_BYTES + 1,
      }),
    ).toThrow(PdfPreviewUnavailableError);
  });

  it("checks the stored PDF signature and preserves the original streamed bytes", async () => {
    const expected = Buffer.from("%PDF-1.7\nbody");
    const result = await createVerifiedPdfPreviewStream({
      body: byteStream([
        new Uint8Array(expected.subarray(0, 2)),
        new Uint8Array(expected.subarray(2, 7)),
        new Uint8Array(expected.subarray(7)),
      ]),
      size: expected.byteLength,
    });
    expect(await collect(result)).toEqual(expected);
  });

  it("rejects a non-PDF object before returning any body bytes and cancels storage read", async () => {
    let cancelled = false;
    await expect(
      createVerifiedPdfPreviewStream({
        body: byteStream([new TextEncoder().encode("MZ executable")], {
          onCancel: () => {
            cancelled = true;
          },
        }),
        size: 13,
      }),
    ).rejects.toBeInstanceOf(PdfPreviewUnavailableError);
    expect(cancelled).toBe(true);
  });

  it("rejects short and oversized streams while the client consumes them", async () => {
    const shortBody = new TextEncoder().encode("%PDF-short");
    const short = await createVerifiedPdfPreviewStream({
      body: byteStream([shortBody]),
      size: shortBody.byteLength + 1,
    });
    await expect(collect(short)).rejects.toBeInstanceOf(
      PdfPreviewUnavailableError,
    );

    const longBody = new TextEncoder().encode("%PDF-long");
    const long = await createVerifiedPdfPreviewStream({
      body: byteStream([longBody.subarray(0, 4), longBody.subarray(4)]),
      size: longBody.byteLength - 1,
    });
    await expect(collect(long)).rejects.toBeInstanceOf(
      PdfPreviewUnavailableError,
    );
  });

  it("cancels the underlying storage stream when the request aborts", async () => {
    let cancelled = false;
    const controller = new AbortController();
    let sentHeader = false;
    const body = new ReadableStream<Uint8Array>({
      pull(streamController) {
        if (sentHeader) return;
        sentHeader = true;
        streamController.enqueue(new TextEncoder().encode("%PDF"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const verified = await createVerifiedPdfPreviewStream({
      body,
      size: 8,
      signal: controller.signal,
    });
    const reader = verified.getReader();
    await reader.read();
    controller.abort();
    await expect(reader.read()).rejects.toBeInstanceOf(
      PdfPreviewUnavailableError,
    );
    expect(cancelled).toBe(true);
  });
});
