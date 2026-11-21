/** A fake file target that records received bytes and whether it was closed or aborted. */
export function fakeFile(failWriteAt?: number) {
  const file = {
    bytes: [] as string[],
    closed: false,
    aborted: false,
    writable: undefined as unknown as WritableStream<Uint8Array>,
  };
  file.writable = new WritableStream<Uint8Array>({
    write(chunk) {
      if (file.bytes.length === failWriteAt) {
        // A write that fails errors the stream, so abort() is never reached; like the
        // browser's file stream, the target is then discarded without being closed.
        file.aborted = true;
        throw new Error("disk full");
      }
      file.bytes.push(new TextDecoder().decode(chunk));
    },
    close() {
      file.closed = true;
    },
    abort() {
      file.aborted = true;
    },
  });
  return file;
}

/** A response that delivers its parts, then (optionally) breaks like a dropped connection. */
export function chunkedResponse(parts: string[], failAfter = false) {
  const queue = [...parts];
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const part = queue.shift();
        if (part !== undefined)
          controller.enqueue(new TextEncoder().encode(part));
        else if (failAfter) controller.error(new TypeError("network error"));
        else controller.close();
      },
    }),
  );
}
