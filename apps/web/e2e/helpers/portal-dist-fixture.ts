import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

/**
 * Serves the built portal (`dist/portal`, made by `pnpm build`) from disk on a portal origin and
 * answers every `/api/*` read from `apiBody`. Returns the list of API reads with no fixture, which
 * a spec asserts is empty.
 */
export const PORTAL_ORIGIN = "http://portal.localhost:4180";
const PORTAL_DIST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../dist/portal",
);

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

export async function mountBuiltPortal(
  page: Page,
  apiBody: (pathname: string) => unknown,
): Promise<string[]> {
  if (!existsSync(path.join(PORTAL_DIST, "index.html")))
    throw new Error(
      `The built portal is missing at ${PORTAL_DIST}; run \`pnpm build\` first.`,
    );
  const indexHtml = readFileSync(path.join(PORTAL_DIST, "index.html"));
  const unmatched: string[] = [];
  await page.route(`${PORTAL_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/api/")) {
      const body = apiBody(url.pathname);
      if (body === undefined) {
        unmatched.push(`${route.request().method()} ${url.pathname}`);
        return route.fulfill({ status: 404, body: "" });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    }
    const file = path.join(PORTAL_DIST, path.normalize(url.pathname));
    if (
      file.startsWith(PORTAL_DIST) &&
      url.pathname !== "/" &&
      existsSync(file) &&
      statSync(file).isFile()
    )
      return route.fulfill({
        status: 200,
        contentType:
          CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
        body: readFileSync(file),
      });
    // Single-page fallback: every screen URL serves the portal shell.
    return route.fulfill({
      status: 200,
      contentType: CONTENT_TYPES[".html"],
      body: indexHtml,
    });
  });
  return unmatched;
}
