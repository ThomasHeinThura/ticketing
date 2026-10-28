import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const UPSTREAM_SHA = "42bb801114aa1ae499228a53180f0cdbc5607964";
export const SCREENS = [
  "workspace-home",
  "project-board",
  "project-backlog",
  "project-calendar",
  "project-gantt",
  "task-page",
  "workspace-search",
  "workspace-members",
  "invitations",
  "settings-account-information",
  "settings-account-notifications",
  "settings-account-developer",
  "settings-account-preferences",
  "settings-account-security",
  "settings-workspace-general",
  "settings-workspace-labels",
  "settings-workspace-roles",
  "settings-project-general",
  "settings-project-workflow",
  "settings-project-labels",
];
export const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "mobile", width: 390, height: 844 },
];
export const SCHEMES = ["light", "dark"];
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export const captureName = (screen, viewport, scheme) =>
  `${screen}.${viewport}.${scheme}.png`;
export const expectedCaptures = () =>
  SCREENS.flatMap((screen) =>
    VIEWPORTS.flatMap((viewport) =>
      SCHEMES.map((scheme) => ({
        screen,
        viewport,
        scheme,
        file: captureName(screen, viewport.name, scheme),
      })),
    ),
  );
const hashPattern = /^[a-f0-9]{64}$/;
function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}

export function sourceIdentity(directory) {
  const git = (...args) =>
    execFileSync("git", ["-C", directory, ...args], {
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
    });
  const sha = git("rev-parse", "HEAD").trim();
  const diff = git("diff", "--binary", "HEAD", "--");
  const untracked = git("ls-files", "--others", "--exclude-standard", "-z")
    .split("\0")
    .filter(Boolean)
    .sort();
  const hash = createHash("sha256").update(diff);
  for (const file of untracked)
    hash
      .update(file)
      .update("\0")
      .update(readFileSync(path.join(directory, file)))
      .update("\0");
  return {
    sha,
    worktreeSha256: hash.digest("hex"),
    dirty: Boolean(diff || untracked.length),
  };
}

export function validatePlan(plan) {
  requireThat(plan?.version === 1, "Capture plan version must be 1");
  requireThat(
    ["upstream", "candidate"].includes(plan.side),
    "Plan side must be upstream or candidate",
  );
  const origin = new URL(plan.baseUrl).origin;
  requireThat(
    ["http:", "https:"].includes(new URL(plan.baseUrl).protocol),
    "baseUrl must use HTTP(S)",
  );
  requireThat(
    new URL(plan.baseUrl).pathname === "/",
    "baseUrl must be an origin",
  );
  requireThat(
    plan.seed?.kind === "persisted-api-export" &&
      typeof plan.seed.file === "string",
    "Plan requires a persisted API seed export file",
  );
  requireThat(
    Array.isArray(plan.seed.probes) && plan.seed.probes.length > 0,
    "Seed export requires real API verification probes",
  );
  for (const probe of plan.seed.probes) {
    requireThat(
      typeof probe.path === "string" &&
        probe.path.startsWith("/api/") &&
        typeof probe.pointer === "string" &&
        Object.hasOwn(probe, "expected"),
      "Invalid seed API probe",
    );
  }
  requireThat(
    typeof plan.apiUrl === "string" && new URL(plan.apiUrl).pathname === "/",
    "Plan requires an API origin",
  );
  requireThat(
    typeof plan.storageState === "string",
    "Plan requires private authenticated storageState",
  );
  requireThat(
    Array.isArray(plan.screens) && plan.screens.length === SCREENS.length,
    "Plan requires all 20 common screen mappings",
  );
  const names = new Set();
  for (const screen of plan.screens) {
    requireThat(
      SCREENS.includes(screen.name) && !names.has(screen.name),
      `Unknown/duplicate screen mapping: ${screen.name}`,
    );
    names.add(screen.name);
    requireThat(
      typeof screen.path === "string" &&
        screen.path.startsWith("/") &&
        new URL(screen.path, origin).origin === origin,
      `Invalid path for ${screen.name}`,
    );
    requireThat(
      typeof screen.expectedPath === "string" &&
        screen.expectedPath.startsWith("/") &&
        new URL(screen.expectedPath, origin).origin === origin,
      `Missing expected final path for ${screen.name}`,
    );
    requireThat(
      typeof screen.readySelector === "string" &&
        screen.readySelector.trim() &&
        !["html", "body", "*", "#root"].includes(screen.readySelector.trim()),
      `Specific content readiness required for ${screen.name}`,
    );
    requireThat(
      typeof screen.readyText === "string" && screen.readyText.trim(),
      `Expected persisted content/landmark text required for ${screen.name}`,
    );
  }
  return plan;
}

export function validateManifest(directory, side) {
  const manifest = JSON.parse(
    readFileSync(path.join(directory, "manifest.json"), "utf8"),
  );
  requireThat(
    manifest.version === 1 && manifest.side === side,
    `Invalid ${side} manifest`,
  );
  requireThat(
    /^[a-f0-9]{40}$/.test(manifest.source?.sha) &&
      hashPattern.test(manifest.source?.worktreeSha256),
    `Missing ${side} source identity`,
  );
  requireThat(
    typeof manifest.source.dirty === "boolean",
    `Missing ${side} dirty state`,
  );
  if (side === "upstream")
    requireThat(
      manifest.source.sha === UPSTREAM_SHA && !manifest.source.dirty,
      "Upstream must be the clean pinned snapshot",
    );
  requireThat(
    manifest.seed?.kind === "persisted-api-export" &&
      hashPattern.test(manifest.seed.sha256),
    `Missing ${side} persisted seed provenance`,
  );
  requireThat(
    Array.isArray(manifest.seed.probes) &&
      manifest.seed.probes.length > 0 &&
      manifest.seed.probes.every(
        (probe) =>
          probe.status === 200 &&
          probe.passed === true &&
          hashPattern.test(probe.responseSha256) &&
          hashPattern.test(probe.expectedSha256) &&
          probe.expectedSha256 === probe.observedSha256,
      ),
    `${side}: missing/failed persisted seed API verification`,
  );
  const seed = readFileSync(path.join(directory, "seed-export.json"));
  requireThat(
    sha256(seed) === manifest.seed.sha256,
    `${side} seed export hash mismatch`,
  );
  requireThat(
    manifest.render?.engine === "chromium" &&
      typeof manifest.render.browserVersion === "string" &&
      manifest.render.browserVersion.length > 0 &&
      typeof manifest.render.platform === "string" &&
      typeof manifest.render.arch === "string",
    `Missing ${side} render identity`,
  );
  requireThat(
    manifest.render.locale === "en-GB" &&
      manifest.render.timezoneId === "UTC" &&
      manifest.render.reducedMotion === "reduce" &&
      manifest.render.animations === "disabled",
    `Invalid ${side} render configuration`,
  );
  requireThat(
    Array.isArray(manifest.captures) && manifest.captures.length === 120,
    `${side}: expected exactly 120 captures`,
  );
  const expected = new Map(
    expectedCaptures().map((capture) => [capture.file, capture]),
  );
  const seen = new Set();
  for (const capture of manifest.captures) {
    const spec = expected.get(capture.file);
    requireThat(
      spec && !seen.has(capture.file),
      `${side}: unknown/duplicate capture ${capture.file}`,
    );
    seen.add(capture.file);
    requireThat(
      capture.status === "captured",
      `${side}: failed capture ${capture.file}`,
    );
    requireThat(
      capture.screen === spec.screen &&
        capture.viewport === spec.viewport.name &&
        capture.scheme === spec.scheme,
      `${side}: capture metadata mismatch ${capture.file}`,
    );
    requireThat(
      capture.fontsReady === true &&
        capture.imagesReady === true &&
        typeof capture.readySelector === "string" &&
        capture.readySelector.length > 0 &&
        typeof capture.readyText === "string" &&
        capture.readyText.length > 0,
      `${side}: missing content readiness ${capture.file}`,
    );
    requireThat(
      typeof capture.url === "string" &&
        typeof capture.expectedUrl === "string" &&
        capture.url === capture.expectedUrl,
      `${side}: wrong destination ${capture.file}`,
    );
    const url = new URL(capture.url);
    requireThat(
      ["http:", "https:"].includes(url.protocol),
      `${side}: invalid capture origin`,
    );
    requireThat(
      !/\/(?:auth|sign-in|login)(?:\/|$)/i.test(url.pathname),
      `${side}: authentication fallback ${capture.file}`,
    );
    const bytes = readFileSync(path.join(directory, capture.file));
    requireThat(
      sha256(bytes) === capture.sha256,
      `${side}: PNG hash mismatch ${capture.file}`,
    );
    requireThat(
      bytes.length >= 24 &&
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
        bytes.readUInt32BE(16) === spec.viewport.width &&
        bytes.readUInt32BE(20) === spec.viewport.height,
      `${side}: invalid PNG dimensions ${capture.file}`,
    );
  }
  const actualPngs = readdirSync(directory).filter((file) =>
    file.endsWith(".png"),
  );
  requireThat(
    actualPngs.length === 120 && actualPngs.every((file) => seen.has(file)),
    `${side}: stale/unexpected/missing PNG files`,
  );
  return manifest;
}

export function validatePair(
  upstreamDirectory,
  candidateDirectory,
  candidateSource,
) {
  const upstream = validateManifest(upstreamDirectory, "upstream");
  const candidate = validateManifest(candidateDirectory, "candidate");
  requireThat(
    upstream.seed.sha256 === candidate.seed.sha256,
    "Seed content differs: paired screenshots cannot establish parity",
  );
  requireThat(
    JSON.stringify(upstream.render) === JSON.stringify(candidate.render),
    "Render environment differs: regenerate both sets on the same laptop/browser",
  );
  if (candidateSource) {
    const current = sourceIdentity(candidateSource);
    requireThat(
      current.sha === candidate.source.sha &&
        current.worktreeSha256 === candidate.source.worktreeSha256 &&
        current.dirty === candidate.source.dirty,
      "Candidate capture is stale for the current source/worktree",
    );
  }
  return { upstream, candidate };
}
