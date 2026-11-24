// Canary for #709: fails if a Playwright change stops errorContext redaction
// working. Run by `pnpm test:e2e`; needs the installed Chromium.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const playwright = resolve(repo, "apps/web/node_modules/@playwright/test");
const helper = resolve(
  repo,
  "apps/web/e2e/helpers/redact-secret-error-context.ts",
);
const secret = "canary-secret-7f3a91-do-not-leak";
const temp = mkdtempSync(join(tmpdir(), "redact-canary-"));

const files = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });

// Fails on purpose with the secret in a form field, so Playwright writes it
// into the page snapshot of error-context.md. The secret comes from the
// environment so the spec source (shown in code frames) never contains it.
const run = (name, redact) => {
  const dir = join(temp, name);
  const out = join(dir, "out");
  writeFileSync(
    join(temp, `${name}.config.ts`),
    `export default { testDir: ${JSON.stringify(dir)}, outputDir: ${JSON.stringify(out)}, reporter: [['json', { outputFile: ${JSON.stringify(join(dir, "report.json"))} }]], workers: 1, use: { trace: 'off', video: 'off', screenshot: 'off' } };\n`,
  );
  const spec = `
import { expect, test } from ${JSON.stringify(playwright)};
${redact ? `import { redactSecretErrorContext } from ${JSON.stringify(helper)};\ntest.afterEach(({ browserName: _b }, testInfo) => { redactSecretErrorContext(testInfo); });` : ""}
test('fails with a secret on screen', async ({ page }) => {
  await page.setContent('<label>Password <input type="text" value="' + process.env.CANARY_SECRET + '"></label>');
  await expect(page.getByText('never rendered')).toBeVisible({ timeout: 500 });
});
`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "canary.spec.ts"), spec);
  const result = spawnSync(
    process.execPath,
    [
      resolve(playwright, "cli.js"),
      "test",
      "--config",
      join(temp, `${name}.config.ts`),
    ],
    {
      encoding: "utf8",
      env: { ...process.env, FORCE_COLOR: "0", CANARY_SECRET: secret },
    },
  );
  assert.equal(result.status, 1, `${name}: the canary spec must fail`);
  return files(dir)
    .map((path) => readFileSync(path, "utf8"))
    .join("\n")
    .concat(result.stdout, result.stderr);
};

try {
  assert.ok(
    run("control", false).includes(secret),
    "Control must expose the secret, or the canary proves nothing",
  );
  assert.ok(
    !run("redacted", true).includes(secret),
    "errorContext redaction no longer hides the secret",
  );
  console.log("E2E secret redaction canary: passed (control and redacted).");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
