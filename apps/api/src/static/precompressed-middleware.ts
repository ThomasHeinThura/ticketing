import type { IncomingMessage, ServerResponse } from "node:http";
import { servePrecompressedAsset } from "./precompressed-assets";

export function createPrecompressedAssetsMiddleware(root: string) {
  return (
    req: IncomingMessage,
    res: ServerResponse,
    next: (error?: unknown) => void,
  ) => {
    const controller = new AbortController();
    res.once("close", () => controller.abort());
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (Array.isArray(value))
        for (const entry of value) headers.append(name, entry);
      else if (value !== undefined) headers.set(name, value);
    }
    const request = new Request(new URL(req.url ?? "/", "http://localhost"), {
      method: req.method ?? "GET",
      headers,
      signal: controller.signal,
    });
    void servePrecompressedAsset(request, root)
      .then(async (response) => {
        if (res.destroyed || controller.signal.aborted) {
          await response?.body?.cancel();
          return;
        }
        if (!response) {
          next();
          return;
        }
        const bytes = response.body
          ? Buffer.from(await response.arrayBuffer())
          : undefined;
        if (res.destroyed || controller.signal.aborted) return;
        const vary = [
          res.getHeader("Vary")?.toString(),
          response.headers.get("Vary"),
        ]
          .flatMap((value) => value?.split(",") ?? [])
          .map((value) => value.trim())
          .filter(Boolean);
        if (vary.length) {
          response.headers.set(
            "Vary",
            vary.includes("*")
              ? "*"
              : [
                  ...new Map(
                    vary.map((value) => [value.toLowerCase(), value]),
                  ).values(),
                ].join(", "),
          );
        }
        res.statusCode = response.status;
        response.headers.forEach((value, name) => {
          res.setHeader(name, value);
        });
        res.end(bytes);
      })
      .catch((error: unknown) => {
        const code =
          error && typeof error === "object" && "code" in error
            ? String(error.code)
            : "";
        const name = error instanceof Error ? error.name : "";
        const expectedAbort = name === "AbortError" || code === "ABORT_ERR";
        if (!(expectedAbort && (res.destroyed || controller.signal.aborted)))
          next(error);
      });
  };
}
