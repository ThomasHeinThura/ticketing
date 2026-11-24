import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { redactSecretErrorContext } from "../../e2e/helpers/redact-secret-error-context";

const repoRoot = resolve(__dirname, "../../../..");
const webRoot = resolve(repoRoot, "apps/web");
const configs = [
  resolve(webRoot, "playwright.config.ts"),
  resolve(repoRoot, "tests/e2e/playwright.approvals.config.ts"),
];

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
const collected = configs.flatMap(collectedFiles);

describe("files Playwright collects for the default and approvals configs", () => {
  it("are found, so the guard is not vacuous", () => {
    const names = collected.map((path) => relative(repoRoot, path));
    expect(names).toEqual(
      expect.arrayContaining([
        "apps/web/e2e/mfa-csrf-journey.spec.ts",
        "tests/e2e/users-primary-journey.spec.ts",
      ]),
    );
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
      /\b(trace|video|screenshot)\s*:(?!\s*"off")/u,
    );
  });
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
