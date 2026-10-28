const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46] as const;

/** Keep browser parsing memory bounded even when instance upload limits are raised. */
export const MAX_PDF_PREVIEW_BYTES = 25 * 1024 * 1024;

export class PdfPreviewUnavailableError extends Error {
  constructor(
    readonly reason: "unsupported" | "too_large" | "invalid" = "invalid",
  ) {
    super("PDF preview is unavailable.");
    this.name = "PdfPreviewUnavailableError";
  }
}

export function assertPdfPreviewMetadata(input: {
  mimeType: string;
  size: number;
}) {
  if (input.mimeType.trim().toLowerCase() !== "application/pdf")
    throw new PdfPreviewUnavailableError("unsupported");
  if (input.size > MAX_PDF_PREVIEW_BYTES)
    throw new PdfPreviewUnavailableError("too_large");
  if (!Number.isSafeInteger(input.size) || input.size < PDF_MAGIC.length)
    throw new PdfPreviewUnavailableError("invalid");
}

/**
 * Verify the stored PDF signature and stream-size boundary before returning bytes. The
 * wrapper never buffers the full object; it retains only the first storage chunks needed
 * to validate `%PDF` and counts all subsequent chunks as the browser consumes them.
 */
export async function createVerifiedPdfPreviewStream(input: {
  body: unknown;
  size: number;
  signal?: AbortSignal;
}): Promise<ReadableStream<Uint8Array>> {
  if (
    !Number.isSafeInteger(input.size) ||
    input.size < PDF_MAGIC.length ||
    input.size > MAX_PDF_PREVIEW_BYTES ||
    !input.body ||
    typeof input.body !== "object" ||
    !("getReader" in input.body) ||
    typeof input.body.getReader !== "function"
  ) {
    throw new PdfPreviewUnavailableError(
      input.size > MAX_PDF_PREVIEW_BYTES ? "too_large" : "invalid",
    );
  }

  const reader =
    input.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const prefix: Uint8Array[] = [];
  const magic = new Uint8Array(PDF_MAGIC.length);
  let magicLength = 0;
  let streamedBytes = 0;
  let sourceDone = false;
  let released = false;

  const release = () => {
    if (released) return;
    released = true;
    input.signal?.removeEventListener("abort", onAbort);
    try {
      reader.releaseLock();
    } catch {
      // The read lock can already be released when a source errors.
    }
  };
  const onAbort = () => {
    void reader.cancel(input.signal?.reason).catch(() => {});
  };
  if (input.signal?.aborted) {
    onAbort();
    throw new PdfPreviewUnavailableError();
  }
  input.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    while (magicLength < PDF_MAGIC.length) {
      const next = await reader.read();
      if (next.done) {
        sourceDone = true;
        break;
      }
      if (!(next.value instanceof Uint8Array))
        throw new PdfPreviewUnavailableError();
      streamedBytes += next.value.byteLength;
      if (streamedBytes > input.size || streamedBytes > MAX_PDF_PREVIEW_BYTES) {
        throw new PdfPreviewUnavailableError();
      }
      prefix.push(next.value);
      for (
        let index = 0;
        index < next.value.byteLength && magicLength < PDF_MAGIC.length;
        index += 1
      ) {
        const byte = next.value[index];
        if (byte === undefined) throw new PdfPreviewUnavailableError();
        magic[magicLength] = byte;
        magicLength += 1;
      }
    }

    if (
      input.signal?.aborted ||
      magicLength !== PDF_MAGIC.length ||
      !PDF_MAGIC.every((byte, index) => magic[index] === byte)
    ) {
      throw new PdfPreviewUnavailableError();
    }
    if (sourceDone && streamedBytes !== input.size)
      throw new PdfPreviewUnavailableError();
  } catch {
    await reader.cancel().catch(() => {});
    release();
    throw new PdfPreviewUnavailableError();
  }

  let deliveredBytes = 0;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of prefix) {
        deliveredBytes += chunk.byteLength;
        controller.enqueue(chunk);
      }
      if (sourceDone) {
        release();
        controller.close();
      }
    },
    async pull(controller) {
      if (input.signal?.aborted) {
        controller.error(new PdfPreviewUnavailableError());
        await reader.cancel().catch(() => {});
        release();
        return;
      }
      try {
        const next = await reader.read();
        if (next.done) {
          if (deliveredBytes !== input.size)
            controller.error(new PdfPreviewUnavailableError());
          else controller.close();
          release();
          return;
        }
        if (!(next.value instanceof Uint8Array))
          throw new PdfPreviewUnavailableError();
        deliveredBytes += next.value.byteLength;
        if (
          deliveredBytes > input.size ||
          deliveredBytes > MAX_PDF_PREVIEW_BYTES
        ) {
          throw new PdfPreviewUnavailableError();
        }
        controller.enqueue(next.value);
      } catch {
        controller.error(new PdfPreviewUnavailableError());
        await reader.cancel().catch(() => {});
        release();
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => {});
      release();
    },
  });
}
