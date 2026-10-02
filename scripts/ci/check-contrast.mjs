#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot, violation } from "./lib/repo.mjs";

const manifestPath = "packages/ui/src/styles/pairs.json";
const requireFromWeb = createRequire(
  path.join(repoRoot, "apps/web/package.json"),
);

export function validatePairManifest(pairs, readUsage, observedPairs) {
  const failures = [];
  const seen = new Set();
  for (const [index, pair] of pairs.entries()) {
    const label = `${manifestPath} entry ${index + 1}`;
    if (!pair || typeof pair.fg !== "string" || typeof pair.bg !== "string") {
      failures.push(
        violation(manifestPath, `${label} needs fg and bg tokens.`),
      );
      continue;
    }
    const key = `${pair.fg}|${pair.bg}|${pair.backgroundClass?.light}|${pair.backgroundClass?.dark}`;
    if (seen.has(key))
      failures.push(violation(manifestPath, `${label} duplicates ${key}.`));
    seen.add(key);
    const expectedRatio = pair.category === "body" ? 4.5 : 3;
    if (
      !["body", "large-text", "non-text"].includes(pair.category) ||
      pair.minRatio !== expectedRatio
    ) {
      failures.push(
        violation(
          manifestPath,
          `${label} has invalid WCAG category/threshold.`,
        ),
      );
    }
    if (
      !Array.isArray(pair.themes) ||
      !["light", "dark"].every((theme) => pair.themes.includes(theme))
    ) {
      failures.push(
        violation(
          manifestPath,
          `${label} must cover both light and dark themes.`,
        ),
      );
    }
    if (!pair.usage || !pair.backdrop)
      failures.push(
        violation(
          manifestPath,
          `${label} needs a real usage owner and opaque backdrop token.`,
        ),
      );
    const usage = pair.usage ? readUsage(pair.usage) : "";
    const fgClass = pair.fg.replace(/^--color-/, "text-");
    const bgClass = pair.bg.replace(/^--color-/, "bg-");
    if (pair.foregroundClass !== fgClass)
      failures.push(
        violation(
          manifestPath,
          `${label} foregroundClass must map to ${fgClass}.`,
        ),
      );
    const surfaceClasses = pair.backgroundClass && [
      pair.backgroundClass.light,
      pair.backgroundClass.dark,
    ];
    if (
      !usage ||
      !surfaceClasses?.every(
        (surfaceClass) =>
          typeof surfaceClass === "string" && usage.includes(surfaceClass),
      ) ||
      !usage.includes(fgClass) ||
      !usage.includes(bgClass)
    ) {
      failures.push(
        violation(
          manifestPath,
          `${label} is not grounded in both ${fgClass} and ${bgClass} in ${pair.usage ?? "its usage owner"}.`,
        ),
      );
    }
  }
  for (const key of observedPairs) {
    if (!seen.has(key))
      failures.push(
        violation(manifestPath, `used pair ${key} has no manifest entry.`),
      );
  }
  if (pairs.length === 0)
    failures.push(
      violation(manifestPath, "must contain at least one used contrast pair."),
    );
  return failures;
}

export function observedPairsInSources(sources, tokenNames) {
  const foregrounds = new Set(
    [...tokenNames].filter(
      (token) =>
        token === "white" ||
        token === "foreground" ||
        token.endsWith("-foreground"),
    ),
  );
  const backgrounds = new Set(
    [...tokenNames].filter((token) => !foregrounds.has(token)),
  );
  const observed = new Set();
  const literal = /(["'`])([\s\S]*?)\1/g;
  for (const source of sources) {
    for (const match of source.matchAll(literal)) {
      const textNames = [
        ...match[2].matchAll(/(?:^|\s)(?:[a-z][a-z0-9-]*:)*text-([a-z0-9-]+)/g),
      ]
        .map((item) => item[1])
        .filter((name) => foregrounds.has(name));
      const bgNames = [
        ...match[2].matchAll(
          /(?:^|\s)((?:[a-z][a-z0-9-]*:)*bg-([a-z0-9-]+)(?:\/\d+)?)/g,
        ),
      ]
        .map((item) => ({ className: item[1], name: item[2] }))
        .filter(({ name }) => backgrounds.has(name));
      for (const fg of textNames) {
        const byToken = new Map();
        for (const entry of bgNames) {
          const pair = byToken.get(entry.name) ?? {
            light: undefined,
            dark: undefined,
          };
          if (entry.className.startsWith("dark:"))
            pair.dark ??= entry.className.slice(5);
          else pair.light ??= entry.className;
          byToken.set(entry.name, pair);
        }
        for (const [bg, classes] of byToken) {
          const light = classes.light ?? classes.dark;
          const dark = classes.dark ?? classes.light;
          observed.add(`--color-${fg}|--color-${bg}|${light}|${dark}`);
        }
      }
    }
  }
  return observed;
}

export function luminance(rgb) {
  const linear = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function contrastRatio(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

export function composite(fg, bg) {
  const alpha = fg[3] ?? 1;
  return [0, 1, 2].map((index) =>
    Math.round(fg[index] * alpha + bg[index] * (1 - alpha)),
  );
}

function parseColor(value) {
  const match = value.match(/^rgba?\(([^)]+)\)$/);
  if (!match) {
    const srgb = value.match(
      /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/,
    );
    if (srgb)
      return [
        Number(srgb[1]) * 255,
        Number(srgb[2]) * 255,
        Number(srgb[3]) * 255,
        Number(srgb[4] ?? 1),
      ];
    const oklab = value.match(
      /^oklab\(\s*([\d.]+)(%?)\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)(?:\s*\/\s*([\d.]+)(%?))?\s*\)$/,
    );
    const oklch = value.match(
      /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+|none)(?:\s*\/\s*([\d.]+)(%?))?\s*\)$/,
    );
    if (!oklab && !oklch)
      throw new Error(
        `Chromium returned an unsupported computed color: ${value}`,
      );
    const lightness =
      Number((oklab ?? oklch)[1]) / ((oklab ?? oklch)[2] ? 100 : 1);
    const a = oklab
      ? Number(oklab[3])
      : Number(oklch[3]) *
        Math.cos((Number(oklch[4] === "none" ? 0 : oklch[4]) * Math.PI) / 180);
    const b = oklab
      ? Number(oklab[4])
      : Number(oklch[3]) *
        Math.sin((Number(oklch[4] === "none" ? 0 : oklch[4]) * Math.PI) / 180);
    const l_ = lightness + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = lightness - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = lightness - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ ** 3;
    const m = m_ ** 3;
    const s = s_ ** 3;
    const linear = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
    const encoded = linear.map((channel) => {
      const value =
        channel <= 0.0031308
          ? 12.92 * channel
          : 1.055 * channel ** (1 / 2.4) - 0.055;
      return Math.min(255, Math.max(0, value * 255));
    });
    const color = oklab ?? oklch;
    const alpha =
      color[5] === undefined ? 1 : Number(color[5]) / (color[6] ? 100 : 1);
    return [...encoded, alpha];
  }
  const components = match[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  return [components[0], components[1], components[2], components[3] ?? 1];
}

async function main() {
  const pairs = JSON.parse(
    await readFile(path.join(repoRoot, manifestPath), "utf8"),
  );
  const sourcePaths = [
    "packages/ui/src/components/button.tsx",
    "packages/ui/src/components/badge.tsx",
    "packages/ui/src/components/input.tsx",
  ];
  const sourceText = await Promise.all(
    sourcePaths.map((file) => readFile(path.join(repoRoot, file), "utf8")),
  );
  const theme = await readFile(
    path.join(repoRoot, "packages/ui/src/styles/theme.css"),
    "utf8",
  );
  const tokenNames = new Set(
    [...theme.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((match) => match[1]),
  );
  tokenNames.add("white");
  const observedPairs = observedPairsInSources(sourceText, tokenNames);
  const failures = validatePairManifest(
    pairs,
    (file) => {
      try {
        return requireFromWeb("node:fs").readFileSync(
          path.join(repoRoot, file),
          "utf8",
        );
      } catch {
        return "";
      }
    },
    observedPairs,
  );
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
    return;
  }

  // G3 deliberately measures the production CSS output, not source token expressions.
  execFileSync("pnpm", ["--filter", "@taskdesk/web...", "build"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  const assetDir = path.join(repoRoot, "apps/web/dist/assets");
  const cssFiles = (await readdir(assetDir)).filter((name) =>
    name.endsWith(".css"),
  );
  if (cssFiles.length === 0)
    throw new Error(
      "Web build produced no CSS assets for the G3 computed-style check.",
    );
  const css = (
    await Promise.all(
      cssFiles.map((name) => readFile(path.join(assetDir, name), "utf8")),
    )
  ).join("\n");
  const { chromium } = requireFromWeb("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(
      "<!doctype html><html><head></head><body></body></html>",
    );
    await page.addStyleTag({ content: css });
    for (const [index, pair] of pairs.entries()) {
      for (const theme of pair.themes) {
        await page.evaluate(
          (name) =>
            document.documentElement.classList.toggle("dark", name === "dark"),
          theme,
        );
        const values = await page.evaluate(
          ({ bg, backdrop, foregroundClass, backgroundClass, theme }) => {
            const node = document.createElement("span");
            if (foregroundClass) node.className = foregroundClass;
            if (backgroundClass)
              node.className = `${node.className} ${backgroundClass[theme]}`;
            node.id = "contrast-probe";
            node.textContent = "Contrast";
            node.style.display = "inline-block";
            node.style.padding = "1rem";
            if (!backgroundClass) node.style.backgroundColor = `var(${bg})`;
            document.body.append(node);
            const style = getComputedStyle(node);
            const backdropNode = document.createElement("span");
            backdropNode.style.backgroundColor = `var(${backdrop})`;
            document.body.append(backdropNode);
            const backdropColor =
              getComputedStyle(backdropNode).backgroundColor;
            const result = {
              fg: style.color,
              bg: style.backgroundColor,
              backdrop: backdropColor,
            };
            backdropNode.remove();
            return result;
          },
          { ...pair, theme },
        );
        if (pair.backgroundClass?.[theme]?.includes("hover:")) {
          await page.locator("#contrast-probe").hover();
          values.bg = await page
            .locator("#contrast-probe")
            .evaluate((node) => getComputedStyle(node).backgroundColor);
        }
        const backdrop = parseColor(values.backdrop);
        const background = parseColor(values.bg);
        const opaqueBg =
          background[3] < 1
            ? composite(background, backdrop)
            : background.slice(0, 3);
        const foreground = parseColor(values.fg);
        const opaqueFg =
          foreground[3] < 1
            ? composite(foreground, opaqueBg)
            : foreground.slice(0, 3);
        const ratio = contrastRatio(opaqueFg, opaqueBg);
        if (ratio + 1e-6 < pair.minRatio) {
          failures.push(
            violation(
              manifestPath,
              `entry ${index + 1} ${pair.fg} on ${pair.bg} is ${ratio.toFixed(2)}:1 in ${theme} (computed ${values.fg} on ${values.bg}, backdrop ${values.backdrop}); needs ${pair.minRatio}:1.`,
            ),
          );
        }
        await page.locator("#contrast-probe").evaluate((node) => node.remove());
      }
    }
    const density = await page.evaluate(() => {
      document.body.innerHTML =
        '<table><tr class="td-density-row"><td data-slot="table-cell">row</td></tr></table><div id="field" class="td-density-field">field</div><div id="card" class="td-density-card">card</div>';
      const measure = () => ({
        row: getComputedStyle(document.querySelector("[data-slot=table-cell]"))
          .paddingBlockStart,
        field: getComputedStyle(document.querySelector("#field"))
          .paddingBlockStart,
        card: getComputedStyle(document.querySelector("#card"))
          .paddingBlockStart,
      });
      document.documentElement.classList.remove("compact-mode");
      const comfortable = measure();
      document.documentElement.classList.add("compact-mode");
      const compact = measure();
      return { comfortable, compact };
    });
    for (const [name, expected] of Object.entries({
      row: ["12px", "8px"],
      field: ["8px", "6px"],
      card: ["16px", "12px"],
    })) {
      if (
        density.comfortable[name] !== expected[0] ||
        density.compact[name] !== expected[1]
      ) {
        failures.push(
          violation(
            "packages/ui/src/styles/density.css",
            `${name} density computed ${density.comfortable[name]} comfortable and ${density.compact[name]} compact; expected ${expected.join(" / ")}.`,
          ),
        );
      }
    }
  } finally {
    await browser.close();
  }
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(
      `check:contrast: ${pairs.length} declared, source-grounded pairs meet thresholds in light/dark built CSS.`,
    );
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
)
  await main();
