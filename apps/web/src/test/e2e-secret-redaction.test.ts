import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { redactSecretErrorContext } from "../../e2e/helpers/redact-secret-error-context";

const repoRoot = resolve(__dirname, "../../../..");
const webRoot = resolve(repoRoot, "apps/web");
// Every Playwright config in the repo, found by name or import so a new one cannot be missed.
const configs = execFileSync(
  "git",
  [
    "ls-files",
    "-co",
    "--exclude-standard",
    "--",
    "*.config.ts",
    "*.config.mjs",
  ],
  { cwd: repoRoot, encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean)
  .map((name) => resolve(repoRoot, name))
  .filter(
    (path) =>
      /playwright[^/]*\.config\./u.test(path) ||
      readFileSync(path, "utf8").includes("@playwright/test"),
  )
  .sort();

// Factory configs need arguments, so `--list` cannot load them; their specs
// are named here and the guard checks them statically.
const staticOnly: Record<string, string[]> = {
  "apps/web/playwright.perf-sit.config.ts": [
    "apps/web/e2e/performance.persisted.bench.ts",
  ],
  "scripts/kaneo-parity/playwright.config.mjs": [],
};

function e2eSources(): string[] {
  return ["apps/web/e2e", "apps/web/e2e-sit", "tests/e2e"].flatMap((dir) =>
    (readdirSync(resolve(repoRoot, dir), { recursive: true }) as string[])
      .filter((name) => name.endsWith(".ts"))
      .map((name) => resolve(repoRoot, dir, name)),
  );
}

type ListedSuite = { file?: string; suites?: ListedSuite[] };

// The files Playwright itself collects for a config (`--list` needs no browser
// or server). Importing specs needs the built permissions package.
function collectedFiles(config: string): string[] {
  const out = join(mkdtempSync(join(tmpdir(), "pw-list-")), "list.json");
  execFileSync(
    "pnpm",
    [
      "exec",
      "playwright",
      "test",
      "--list",
      "--reporter=json",
      "--config",
      config,
    ],
    {
      cwd: webRoot,
      stdio: "ignore",
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: out },
    },
  );
  const report = JSON.parse(readFileSync(out, "utf8")) as {
    config: { rootDir: string };
    suites: ListedSuite[];
    errors: unknown[];
  };
  rmSync(resolve(out, ".."), { recursive: true, force: true });
  expect(report.errors).toEqual([]);
  const files = new Set<string>();
  const walk = (suite: ListedSuite) => {
    if (suite.file) files.add(resolve(report.config.rootDir, suite.file));
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites) walk(suite);
  return [...files].sort();
}

execFileSync("pnpm", ["--filter", "@taskdesk/permissions", "build"], {
  cwd: repoRoot,
  stdio: "ignore",
});
const listable = configs.filter(
  (path) => !(relative(repoRoot, path) in staticOnly),
);
const collected = [
  ...new Set([
    ...listable.flatMap(collectedFiles),
    ...Object.values(staticOnly)
      .flat()
      .map((name) => resolve(repoRoot, name)),
  ]),
].sort();

describe("files Playwright collects for every config", () => {
  it("are found, so the guard is not vacuous", () => {
    const names = collected.map((path) => relative(repoRoot, path));
    expect(names).toEqual(
      expect.arrayContaining([
        "apps/web/e2e/mfa-csrf-journey.spec.ts",
        "apps/web/e2e/visual.spec.ts",
        "apps/web/e2e/storybook-visual.spec.ts",
        "apps/web/e2e/performance.initial-page-diagnostic.ts",
        "apps/web/e2e-sit/mermaid-runtime.spec.ts",
        "tests/e2e/users-primary-journey.spec.ts",
      ]),
    );
    const configNames = configs.map((path) => relative(repoRoot, path));
    expect(configNames).toEqual(
      expect.arrayContaining([
        "apps/web/playwright.storybook.config.ts",
        "apps/web/e2e-sit/mermaid-runtime.config.ts",
        "apps/web/playwright.perf-sit.config.ts",
      ]),
    );
    // Static-only configs are an allowlist, not a way to skip a config.
    for (const name of Object.keys(staticOnly))
      expect(configNames).toContain(name);
  });

  it.each(collected.map((path) => [relative(repoRoot, path), path] as const))(
    "%s redacts the failure snapshot",
    (_name, path) => {
      expect(readFileSync(path, "utf8")).toMatch(
        /test\.afterEach\([^)]*testInfo\)\s*=>\s*\{\s*redactSecretErrorContext\(testInfo\);/u,
      );
    },
  );

  // Anywhere in the file, so a second test.use({ trace: "on" }) cannot slip by.
  it.each(
    [...collected, ...configs].map(
      (path) => [relative(repoRoot, path), path] as const,
    ),
  )("%s only sets trace, video and screenshot to off", (_name, path) => {
    expect(readFileSync(path, "utf8")).not.toMatch(
      /\b(?:trace|video|screenshot)\s*:\s*(?:"(?!off")[^"]*"|'[^']*'|\{)/u,
    );
  });
});

// A failed expect prints its received value, so a secret must never be the
// argument of expect() or compared with a value-printing matcher.
describe("secret assertions in e2e sources", () => {
  const sources = e2eSources();

  it.each(sources.map((path) => [relative(repoRoot, path), path] as const))(
    "%s never asserts a secret value with a value-printing matcher",
    (_name, path) => {
      const text = readFileSync(path, "utf8");
      const offending = [
        /toContain\(\s*[\w.]*secretAccessKey/u,
        /\.credentials\)\.toEqual\(/u,
        /\.toEqual\(challenge\.request\)/u,
        // toHaveLength prints the whole array, and captured writes hold the credentials.
        /expect\(writes\)\.toHaveLength\(/u,
      ].some((pattern) => pattern.test(text));
      // Boolean, so a failure does not print the source either.
      expect(offending).toBe(false);
    },
  );
});

// An axe violation keeps the failing element's HTML, which includes a filled
// field's value; keep rule ids, impact and target selectors only.
describe("axe output in e2e sources", () => {
  it.each(
    e2eSources().map((path) => [relative(repoRoot, path), path] as const),
  )("%s keeps no element HTML or failure summary from axe", (_name, path) => {
    const text = readFileSync(path, "utf8");
    if (!text.includes("axe.run")) return;
    expect(
      /\b(?:n|node)\.html\b|failureSummary|\bnodes\s*\}\)\)/u.test(text),
    ).toBe(false);
  });
});

// A failed expect prints its received value; a raw response body or parsed
// JSON can carry a submitted secret, so these go through expectPrivately.
describe("response bodies in e2e assertions", () => {
  it.each(
    e2eSources().map((path) => [relative(repoRoot, path), path] as const),
  )("%s never passes a raw response body to expect()", (_name, path) => {
    const text = readFileSync(path, "utf8");
    // Not preceded by "=>", so the check inside expectPrivately is allowed.
    const received =
      /(?<!=>\s*)(?<![.\w])expect\(\s*(?:await\s+[\w.]+\.(?:json|text)\(\)|JSON\.parse\([^)]*\)|[\w.]*(?:[Bb]ody|[Tt]ext|[Jj]son))\s*\)\s*\.(?!toBe\((?:true|false)\))/u;
    // expect(value, message) prints the message too.
    const message =
      /(?<![.\w])expect\([^;]*?,\s*(?:text|body|\w*Body|\w*Text)\s*\)\s*\./u;
    expect(received.test(text) || message.test(text)).toBe(false);
  });
});

// Console output ends up in CI logs, and a thrown message in the report.
describe("log and error output in e2e sources", () => {
  it.each(
    e2eSources().map((path) => [relative(repoRoot, path), path] as const),
  )("%s logs and throws no secret or response body", (_name, path) => {
    const text = readFileSync(path, "utf8");
    const word =
      "password|secret|totpURI|backupCode|accessKey|[Bb]earer|\\.text\\(\\)|\\.json\\(\\)";
    // Static text may name a field; an interpolated or passed value may not be one.
    const offending =
      new RegExp(
        `console\\.\\w+\\([^;]*(?:\\$\\{[^}]*(?:${word})[^}]*\\}|,\\s*\\w*(?:${word}))`,
        "iu",
      ).test(text) ||
      new RegExp(
        `new Error\\(\\s*\`[^\`]*\\$\\{[^}]*(?:${word}|[Bb]ody)`,
        "iu",
      ).test(text);
    expect(offending).toBe(false);
  });
});

// A rejected raw fill puts its argument in Playwright's call log.
describe("secret form input in e2e sources", () => {
  const sources = e2eSources();

  it.each(sources.map((path) => [relative(repoRoot, path), path] as const))(
    "%s fills secrets only through fillSensitive",
    (_name, path) => {
      // Boolean, so a failure does not print the source.
      expect(
        /\.fill\(\s*[^)]*(?:password|totpForUri|backupCode|secret|accessKey)/iu.test(
          readFileSync(path, "utf8"),
        ),
      ).toBe(false);
    },
  );
});

describe("redactSecretErrorContext", () => {
  it("replaces every error snapshot, including nested causes", () => {
    const secret = "otpauth://totp/x?secret=ABC and backup code abcd-efgh";
    const errors = [
      { errorContext: secret, cause: { errorContext: secret } },
      { errorContext: secret },
    ];
    redactSecretErrorContext({ errors } as never);
    const serialized = JSON.stringify(errors);
    expect(serialized).not.toContain("otpauth://");
    expect(serialized).not.toContain("abcd-efgh");
    expect(errors[0]?.cause?.errorContext).toMatch(/omitted/u);
  });
});
