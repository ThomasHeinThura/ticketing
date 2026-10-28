import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  precompressGeneratedAssets,
  servePrecompressedAsset,
} from "../../apps/api/src/static/precompressed-assets";

let root: string;
const content = "console.log('hello');\n".repeat(100);
const request = (
  path: string,
  headers: Record<string, string> = {},
  method = "GET",
) => new Request(`https://example.test${path}`, { method, headers });
async function serve(headers: Record<string, string> = {}, method = "GET") {
  return servePrecompressedAsset(
    request("/assets/main-abc.js", headers, method),
    root,
  );
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "taskdesk-compressed-test-"));
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "assets/main-abc.js"), content);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("precompressed assets", () => {
  it("builds only flat JS/CSS files and serves each encoding with original bytes and MIME", async () => {
    await writeFile(join(root, "assets/style.css"), "body { color: red; }");
    await writeFile(join(root, "assets/map.js.map"), "map");
    await mkdir(join(root, "assets/pdf-preview"));
    await writeFile(join(root, "assets/pdf-preview/viewer.js"), "viewer");
    await precompressGeneratedAssets(root);
    expect(await readFile(join(root, "assets/style.css.br"))).toBeDefined();
    await expect(
      readFile(join(root, "assets/map.js.map.br")),
    ).rejects.toThrow();
    await expect(
      readFile(join(root, "assets/pdf-preview/viewer.js.br")),
    ).rejects.toThrow();
    for (const [encoding, decompress] of [
      ["br", brotliDecompressSync],
      ["gzip", gunzipSync],
      ["deflate", inflateSync],
    ] as const) {
      const res = await serve({
        "accept-encoding": `${encoding}, identity;q=0`,
      });
      if (!res) throw new Error("Missing generated asset response");
      expect(res.headers.get("content-encoding")).toBe(encoding);
      expect(res?.headers.get("content-type")).toContain("javascript");
      expect(res?.headers.get("vary")).toBe("Accept-Encoding");
      expect(res?.headers.get("cache-control")).toBe("no-transform");
      expect(decompress(Buffer.from(await res.arrayBuffer())).toString()).toBe(
        content,
      );
    }
  });
  it("negotiates weights, exclusions, wildcard, unavailable variants and identity", async () => {
    await precompressGeneratedAssets(root);
    expect((await serve())?.headers.get("content-encoding")).toBeNull();
    expect(
      (
        await serve({
          "accept-encoding": "BR;q=0.8, gzip;q=0.9, identity;q=0.1",
        })
      )?.headers.get("content-encoding"),
    ).toBe("gzip");
    expect(
      (
        await serve({ "accept-encoding": "*;q=0.7, br;q=0, identity;q=0" })
      )?.headers.get("content-encoding"),
    ).toBe("gzip");
    expect(
      (
        await serve({ "accept-encoding": "br;q=0.4, identity;q=0.8" })
      )?.headers.get("content-encoding"),
    ).toBeNull();
    expect(
      (await serve({ "accept-encoding": "br;q=bogus, identity;q=0" }))?.status,
    ).toBe(406);
    await rm(join(root, "assets/main-abc.js.br"));
    expect(
      (
        await serve({ "accept-encoding": "br, gzip, identity;q=0" })
      )?.headers.get("content-encoding"),
    ).toBe("gzip");
    expect(
      (
        await serve({
          "accept-encoding": "br, gzip;q=0, deflate;q=0, identity;q=0",
        })
      )?.status,
    ).toBe(406);
  });
  it("handles HEAD and conditional dates without applying IMS over If-None-Match", async () => {
    await precompressGeneratedAssets(root);
    const head = await serve({ "accept-encoding": "br" }, "HEAD");
    expect(head?.headers.get("content-encoding")).toBe("br");
    expect(Number(head?.headers.get("content-length"))).toBe(
      (await readFile(join(root, "assets/main-abc.js.br"))).length,
    );
    expect(await head?.text()).toBe("");
    const date = head?.headers.get("last-modified");
    if (!date) throw new Error("Missing generated asset modification date");
    expect((await serve({ "if-modified-since": date }))?.status).toBe(304);
    expect(
      (await serve({ "if-modified-since": date, "if-none-match": '"unknown"' }))
        ?.status,
    ).toBe(200);
    expect((await serve({ "if-none-match": "*" }))?.status).toBe(304);
  });
  it("denies sidecars and delegates symlinks, other paths and ranges", async () => {
    await precompressGeneratedAssets(root);
    expect(
      (
        await servePrecompressedAsset(
          request("/assets/main-abc.js.br", { range: "bytes=0-5" }),
          root,
        )
      )?.status,
    ).toBe(404);
    for (const path of [
      "/assets/main-abc.js.%62r",
      "/assets/%6dain-abc.js.br",
      "/%61ssets/main-abc.js.br",
      "/assets%2fmain-abc.js.br",
      "/assets/%6dain-abc.js",
    ]) {
      expect(
        (
          await servePrecompressedAsset(
            request(path, { range: "bytes=0-5" }),
            root,
          )
        )?.status,
      ).toBe(404);
    }
    expect(await serve({ range: "bytes=0-5" })).toBeNull();
    expect(
      await servePrecompressedAsset(
        request("/assets/pdf-preview/viewer.js"),
        root,
      ),
    ).toBeNull();
    expect(
      await servePrecompressedAsset(request("/index.html"), root),
    ).toBeNull();
    expect(
      await servePrecompressedAsset(request("/assets/%2e%2e/secret.js"), root),
    ).toBeNull();
    await symlink(
      join(root, "assets/main-abc.js"),
      join(root, "assets/link.js"),
    );
    expect(
      await servePrecompressedAsset(request("/assets/link.js"), root),
    ).toBeNull();
    await rm(join(root, "assets/main-abc.js"));
    expect(await serve()).toBeNull();
  });
});
