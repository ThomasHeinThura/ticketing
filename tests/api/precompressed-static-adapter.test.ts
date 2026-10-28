import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { expect, it, vi } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { precompressGeneratedAssets } from "../../apps/api/src/static/precompressed-assets";

vi.mock("../../apps/api/src/feature-flag/enforce", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../apps/api/src/feature-flag/enforce")
  >()),
  featureStateSomewhere: async () => "on" as const,
  customerPortalStateForUser: async () => null,
  customerPortalStateForSubmission: async () => "on" as const,
}));

it("serves host-selected compressed assets and preserves CORS and HTML handling", async () => {
  const dir = await mkdtemp(join(tmpdir(), "taskdesk-static-adapter-"));
  const agent = join(dir, "agent");
  const portal = join(dir, "portal");
  try {
    for (const [root, label] of [
      [agent, "agent"],
      [portal, "portal"],
    ] as const) {
      await mkdir(join(root, "assets"), { recursive: true });
      await writeFile(
        join(root, "index.html"),
        '<!doctype html><script src="/assets/main.js"></script>',
      );
      await writeFile(
        join(root, "assets/main.js"),
        `const text = '${label}';`.repeat(100),
      );
      await writeFile(join(root, `assets/${label}-only.js`), label.repeat(100));
      await precompressGeneratedAssets(root);
    }
    const { app } = createApp({ staticRoot: agent, portalStaticRoot: portal });
    for (const [host, label, foreign] of [
      ["localhost:5173", "agent", "portal"],
      ["portal.localhost:5174", "portal", "agent"],
    ] as const) {
      const headers = {
        host,
        origin: "https://client.example",
        "accept-encoding": "br",
      };
      const response = await app.request("/assets/main.js", { headers });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-encoding")).toBe("br");
      expect(response.headers.get("vary")?.toLowerCase()).toContain(
        "accept-encoding",
      );
      expect(response.headers.get("vary")?.toLowerCase()).toContain("origin");
      expect(
        brotliDecompressSync(
          Buffer.from(await response.arrayBuffer()),
        ).toString(),
      ).toBe(`const text = '${label}';`.repeat(100));
      expect(
        (await app.request(`/assets/${foreign}-only.js`, { headers })).status,
      ).toBe(404);
      for (const alias of [
        "/assets/main.js.br",
        "/%61ssets/main.js.br",
        "/assets/%6dain.js.br",
        "/assets/main.js.%62r",
      ]) {
        expect(
          (
            await app.request(alias, {
              headers: { ...headers, range: "bytes=0-5" },
            })
          ).status,
        ).toBe(404);
      }
      const head = await app.request("/assets/main.js", {
        method: "HEAD",
        headers,
      });
      expect(head.status).toBe(200);
      expect(head.headers.get("content-encoding")).toBe("br");
      expect(head.headers.get("vary")?.toLowerCase()).toContain("origin");
      expect(head.headers.get("vary")?.toLowerCase()).toContain(
        "accept-encoding",
      );
      expect(await head.text()).toBe("");
      const modifiedSince = head.headers.get("last-modified");
      if (!modifiedSince) throw new Error("Missing asset modification date");
      const notModified = await app.request("/assets/main.js", {
        headers: {
          ...headers,
          "if-modified-since": modifiedSince,
        },
      });
      expect(notModified.status).toBe(304);
      expect(notModified.headers.get("vary")?.toLowerCase()).toContain(
        "origin",
      );
      expect(notModified.headers.get("vary")?.toLowerCase()).toContain(
        "accept-encoding",
      );
      const unacceptable = await app.request("/assets/main.js", {
        headers: { ...headers, "accept-encoding": "*;q=0" },
      });
      expect(unacceptable.status).toBe(406);
      expect(unacceptable.headers.get("vary")?.toLowerCase()).toContain(
        "origin",
      );
      expect(unacceptable.headers.get("vary")?.toLowerCase()).toContain(
        "accept-encoding",
      );
      const html = await app.request("/", { headers });
      expect(html.status).toBe(200);
      expect(html.headers.get("content-encoding")).not.toBe("br");
      expect(await html.text()).toContain("nonce=");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
