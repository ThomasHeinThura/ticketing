import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants, deflate, gzip } from "node:zlib";

const compressBrotli = promisify(brotliCompress);
const compressGzip = promisify(gzip);
const compressDeflate = promisify(deflate);
const ASSET = /^\/assets\/[A-Za-z0-9_-]+\.(?:js|css)$/;
const SIDECAR = /^\/assets\/[A-Za-z0-9_-]+\.(?:js|css)\.(?:br|gz|deflate)$/i;
const SUFFIX = { br: ".br", gzip: ".gz", deflate: ".deflate" } as const;
type Encoding = keyof typeof SUFFIX;

async function regularFile(path: string) {
  try {
    const stat = await lstat(path);
    return stat.isFile() ? stat : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function assetsDirectory(root: string) {
  const stat = await lstat(join(root, "assets")).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    },
  );
  return stat?.isDirectory() ? join(root, "assets") : undefined;
}

/** Build only flat generated JavaScript and CSS siblings. */
export async function precompressGeneratedAssets(root: string): Promise<void> {
  const dir = await assetsDirectory(root);
  if (!dir) return;
  const names = (await readdir(dir)).filter((name) =>
    ASSET.test(`/assets/${name}`),
  );
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, names.length) }, async () => {
      while (next < names.length) {
        const name = names[next++];
        if (!name) continue;
        const path = join(dir, name);
        if (!(await regularFile(path))) continue;
        const bytes = await readFile(path);
        const [br, gz, deflated] = await Promise.all([
          compressBrotli(bytes, {
            params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
          }),
          compressGzip(bytes, { level: 9 }),
          compressDeflate(bytes, { level: 9 }),
        ]);
        // Do not follow a pre-existing symlink at a generated sidecar path.
        for (const [suffix, data] of [
          [".br", br],
          [".gz", gz],
          [".deflate", deflated],
        ] as const) {
          const target = path + suffix;
          const existing = await lstat(target).catch(
            (error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") return undefined;
              throw error;
            },
          );
          if (existing && !existing.isFile())
            throw new Error("Invalid compressed asset target");
          await writeFile(target, data, { flag: existing ? "w" : "wx" });
        }
      }
    }),
  );
}

function qualities(header: string | null) {
  const explicit = new Map<string, number>();
  if (header?.trim()) {
    for (const part of header.split(",")) {
      const [rawName, ...parameters] = part.trim().split(";");
      const name = (rawName ?? "").trim().toLowerCase();
      if (!name) continue;
      let q = 1;
      if (parameters.length) {
        const match = parameters
          .join(";")
          .trim()
          .match(/^q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/i);
        q = match ? Number(match[1]) : 0;
      }
      explicit.set(name, Math.max(explicit.get(name) ?? 0, q));
    }
  }
  const wildcard = explicit.get("*");
  return (name: string) =>
    explicit.get(name) ??
    (name === "identity" ? (wildcard === 0 ? 0 : 1) : (wildcard ?? 0));
}

/** Serve an eligible static representation, or defer to the existing static handler. */
export async function servePrecompressedAsset(
  request: Request,
  root: string,
): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const path = new URL(request.url).pathname;
  // Static adapters disagree on URL decoding. Generated flat asset names are
  // ASCII: reject encoded aliases before either adapter can serve a sidecar.
  if (path.includes("%")) {
    try {
      const decoded = decodeURIComponent(path);
      if (ASSET.test(decoded) || SIDECAR.test(decoded))
        return new Response(null, { status: 404 });
    } catch {
      // Leave unrelated paths to the existing static handler.
    }
  }
  if (SIDECAR.test(path)) return new Response(null, { status: 404 });
  if (!ASSET.test(path) || request.headers.has("range")) return null;
  const dir = await assetsDirectory(root);
  if (!dir) return null;
  const file = join(dir, path.slice("/assets/".length));
  const original = await regularFile(file);
  if (!original) return null;
  const q = qualities(request.headers.get("accept-encoding"));
  const candidates: Array<{
    encoding?: Encoding;
    path: string;
    stat: typeof original;
    q: number;
  }> = [];
  for (const encoding of ["br", "gzip", "deflate"] as const) {
    const stat = await regularFile(file + SUFFIX[encoding]);
    if (stat && q(encoding) > 0)
      candidates.push({
        encoding,
        path: file + SUFFIX[encoding],
        stat,
        q: q(encoding),
      });
  }
  if (q("identity") > 0)
    candidates.push({ path: file, stat: original, q: q("identity") });
  candidates.sort((a, b) => b.q - a.q);
  const headers = new Headers({
    Vary: "Accept-Encoding",
    "Cache-Control": "no-transform",
    "Content-Type": path.endsWith(".css")
      ? "text/css; charset=UTF-8"
      : "text/javascript; charset=UTF-8",
    "Last-Modified": original.mtime.toUTCString(),
  });
  const selected = candidates[0];
  if (!selected) return new Response(null, { status: 406, headers });
  if (selected.encoding) headers.set("Content-Encoding", selected.encoding);
  const inm = request.headers.get("if-none-match");
  const modifiedSince = request.headers.get("if-modified-since");
  if (
    inm?.split(",").some((value) => value.trim() === "*") ||
    (inm === null &&
      modifiedSince &&
      Number.isFinite(Date.parse(modifiedSince)) &&
      Math.floor(original.mtimeMs / 1000) * 1000 <= Date.parse(modifiedSince))
  )
    return new Response(null, { status: 304, headers });
  headers.set("Content-Length", String(selected.stat.size));
  if (request.method === "HEAD")
    return new Response(null, { status: 200, headers });
  // Read trusted build assets before constructing the response so a client disconnect
  // cannot leave an orphaned file stream in the HTTP adapter.
  const bytes = await readFile(selected.path, { signal: request.signal });
  return new Response(new Uint8Array(bytes), { status: 200, headers });
}
