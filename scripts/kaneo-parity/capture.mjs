// Explicit local capture only; consumes existing persisted fixtures and private sessions.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  captureName,
  SCHEMES,
  sha256,
  sourceIdentity,
  UPSTREAM_SHA,
  VIEWPORTS,
  validatePlan,
} from "./manifest.mjs";

const { chromium } = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
)("@playwright/test");

async function main() {
  const [planFile, sourceDirectory, outputDirectory] = process.argv.slice(2);
  if (!planFile || !sourceDirectory || !outputDirectory)
    throw new Error(
      "Usage: node scripts/kaneo-parity/capture.mjs PLAN.json SOURCE_DIR OUTPUT_DIR",
    );
  const plan = validatePlan(JSON.parse(await readFile(planFile, "utf8")));
  const source = sourceIdentity(path.resolve(sourceDirectory));
  if (plan.side === "upstream" && (source.sha !== UPSTREAM_SHA || source.dirty))
    throw new Error("Upstream source must be the clean pinned snapshot");
  const out = path.resolve(outputDirectory);
  const relative = path.relative(path.resolve(sourceDirectory), out);
  if (!relative.startsWith(`..${path.sep}`) && relative !== "..")
    throw new Error("Capture output must be outside its source checkout");
  // A new directory prevents stale PNGs from satisfying a failed new capture.
  await mkdir(out, { recursive: false, mode: 0o700 });
  const base = path.dirname(path.resolve(planFile));
  const seedBytes = await readFile(path.resolve(base, plan.seed.file));
  JSON.parse(seedBytes.toString());
  const manifest = {
    version: 1,
    side: plan.side,
    source,
    seed: { kind: plan.seed.kind, sha256: sha256(seedBytes), probes: [] },
    render: {
      engine: "chromium",
      platform: process.platform,
      arch: process.arch,
      browserVersion: "",
      locale: "en-GB",
      timezoneId: "UTC",
      reducedMotion: "reduce",
      animations: "disabled",
    },
    captures: [],
  };
  await writeFile(path.join(out, "seed-export.json"), seedBytes, {
    mode: 0o600,
  });
  const browser = await chromium.launch({ args: ["--disable-partial-raster"] });
  manifest.render.browserVersion = browser.version();
  try {
    const session = path.resolve(base, plan.storageState);
    const probeContext = await browser.newContext({ storageState: session });
    try {
      for (const probe of plan.seed.probes) {
        const url = new URL(probe.path, plan.apiUrl);
        if (url.origin !== new URL(plan.apiUrl).origin)
          throw new Error("Cross-origin seed probe refused");
        const response = await probeContext.request.get(url.href, {
          headers: { Origin: new URL(plan.baseUrl).origin },
          maxRedirects: 0,
        });
        if (response.status() !== 200)
          throw new Error(
            `Seed probe failed HTTP ${response.status()} (${probe.path})`,
          );
        const bytes = await response.body();
        let observed = JSON.parse(bytes.toString());
        if (probe.pointer) {
          if (!probe.pointer.startsWith("/"))
            throw new Error("Seed pointer must be a JSON pointer");
          for (const token of probe.pointer.slice(1).split("/"))
            observed =
              observed?.[token.replaceAll("~1", "/").replaceAll("~0", "~")];
        }
        if (!isDeepStrictEqual(observed, probe.expected))
          throw new Error(
            `Persisted seed probe mismatch (${probe.path} ${probe.pointer})`,
          );
        const digest = sha256(JSON.stringify(observed));
        manifest.seed.probes.push({
          url: url.href,
          status: response.status(),
          pointer: probe.pointer,
          passed: true,
          responseSha256: sha256(bytes),
          expectedSha256: digest,
          observedSha256: digest,
        });
      }
    } finally {
      await probeContext.close();
    }
    for (const viewport of VIEWPORTS)
      for (const scheme of SCHEMES) {
        const context = await browser.newContext({
          storageState: session,
          viewport: { width: viewport.width, height: viewport.height },
          colorScheme: scheme,
          locale: "en-GB",
          timezoneId: "UTC",
          reducedMotion: "reduce",
          deviceScaleFactor: 1,
        });
        try {
          await context.addInitScript(
            (theme) =>
              localStorage.setItem(
                "user-preferences",
                JSON.stringify({ state: { theme }, version: 0 }),
              ),
            scheme,
          );
          const page = await context.newPage();
          for (const screen of plan.screens) {
            const file = captureName(screen.name, viewport.name, scheme);
            const expectedUrl = new URL(screen.expectedPath, plan.baseUrl).href;
            const capture = {
              screen: screen.name,
              viewport: viewport.name,
              scheme,
              file,
              status: "failed",
              expectedUrl,
              url: "",
              readySelector: screen.readySelector,
              readyText: screen.readyText,
            };
            try {
              await page.goto(new URL(screen.path, plan.baseUrl).href, {
                waitUntil: "domcontentloaded",
                timeout: 45_000,
              });
              await page.waitForURL(expectedUrl, {
                waitUntil: "domcontentloaded",
                timeout: 15_000,
              });
              const ready = page
                .locator(screen.readySelector)
                .filter({ hasText: screen.readyText });
              await ready
                .first()
                .waitFor({ state: "visible", timeout: 20_000 });
              await page.evaluate(async () => {
                await document.fonts.ready;
                await Promise.all(
                  [...document.images].map(async (image) => {
                    if (!image.complete) await image.decode();
                    if (image.naturalWidth === 0)
                      throw new Error(
                        "Visible page includes an unloaded image",
                      );
                  }),
                );
              });
              const options = {
                animations: "disabled",
                fullPage: false,
                caret: "hide",
              };
              let previous = await page.screenshot(options);
              let stable;
              for (let attempt = 0; attempt < 5; attempt++) {
                await page.evaluate(
                  () =>
                    new Promise((resolve) =>
                      requestAnimationFrame(() =>
                        requestAnimationFrame(resolve),
                      ),
                    ),
                );
                const next = await page.screenshot(options);
                if (previous.equals(next)) {
                  stable = next;
                  break;
                }
                previous = next;
              }
              if (!stable)
                throw new Error(
                  "Screen did not reach two identical rendered frames",
                );
              if (page.url() !== expectedUrl)
                throw new Error("Screen redirected after readiness");
              await writeFile(path.join(out, file), stable, { mode: 0o600 });
              Object.assign(capture, {
                status: "captured",
                url: page.url(),
                sha256: sha256(stable),
                fontsReady: true,
                imagesReady: true,
              });
              console.log(`captured ${file}`);
            } catch (error) {
              capture.url = page.url();
              capture.error =
                error instanceof Error ? error.message : "Capture failed";
              console.error(`FAILED ${file}`);
            }
            manifest.captures.push(capture);
          }
        } finally {
          await context.close();
        }
      }
  } finally {
    await browser.close();
    await writeFile(
      path.join(out, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      { mode: 0o600 },
    );
  }
  if (
    manifest.captures.length !== 120 ||
    manifest.captures.some((capture) => capture.status !== "captured")
  )
    throw new Error("Incomplete/failed capture set; see manifest.json");
  const after = sourceIdentity(path.resolve(sourceDirectory));
  if (!isDeepStrictEqual(source, after))
    throw new Error("Source changed during capture; recapture the candidate");
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
