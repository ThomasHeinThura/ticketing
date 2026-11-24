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
  // Exit 1 alone also means a broken import or config. Require the one test to
  // run and fail at the designated assertion, with no collection errors.
  const report = JSON.parse(readFileSync(join(dir, "report.json"), "utf8"));
  assert.deepEqual(report.errors, [], `${name}: collection or setup errors`);
  assert.equal(report.stats.unexpected, 1, `${name}: one failed test expected`);
  assert.equal(report.stats.expected + report.stats.skipped, 0, name);
  const attempt = report.suites[0]?.specs[0]?.tests[0]?.results[0];
  assert.equal(attempt?.status, "failed", `${name}: the test must have run`);
  assert.match(
    attempt.error?.message ?? "",
    /toBeVisible[\s\S]*never rendered/u,
    `${name}: must fail at the designated assertion`,
  );
  return files(dir)
    .map((path) => readFileSync(path, "utf8"))
    .join("\n")
    .concat(result.stdout, result.stderr);
};

// Channels other than errorContext: each failing spec must keep the secret out
// of every artifact and of stdout/stderr. The control runs the leaky pattern.
const fixture = resolve(repo, "apps/web/e2e/helpers/identity-admin-fixture.ts");
const fillSensitive = resolve(repo, "tests/e2e/helpers/fill-sensitive.ts");
const channels = {
  // An axe failure used to keep the element HTML, including a field's value.
  axe: {
    setup: `await page.setContent('<input type="password" value="' + process.env.CANARY_SECRET + '">');`,
    leaky: `const v = await page.evaluate(async () => { await new Promise((r) => { const s = document.createElement('script'); s.textContent = ${JSON.stringify(
      readFileSync(
        resolve(repo, "packages/ui/node_modules/axe-core/axe.min.js"),
        "utf8",
      ),
    )}; document.head.append(s); r(0); }); const out = await window.axe.run(document); return out.violations.map(({ id, nodes }) => ({ id, nodes })); });
    expect(v).toEqual([]);`,
    safe: "await expectNoSeriousAxeViolations(page);",
    imports: `import { expectNoSeriousAxeViolations } from ${JSON.stringify(fixture)};`,
  },
  // A failed expect prints its received value; a raw response body can hold a secret.
  body: {
    setup:
      "const body = JSON.stringify({ echoed: process.env.CANARY_SECRET });",
    leaky: `expect(body).toContain("never present");`,
    safe: `expectPrivately(body.includes("never present"), "Private assertion failed.");`,
    imports: `import { expectPrivately } from ${JSON.stringify(fillSensitive)};`,
  },
};

// The JSON reporter omits expectation steps, but HTML reports serialize them.
// This reporter writes every step error and result error to steps.txt.
const stepReporter = join(temp, "step-reporter.mjs");
writeFileSync(
  stepReporter,
  `import { appendFileSync } from "node:fs";
import { join } from "node:path";
export default class StepReporter {
  onBegin(config) { this.file = join(config.projects[0].testDir, "steps.txt"); appendFileSync(this.file, "steps\\n"); }
  onStepEnd(_test, _result, step) { if (step.error) appendFileSync(this.file, (step.error.message ?? "") + "\\n"); }
  onTestEnd(_test, result) { for (const e of result.errors) appendFileSync(this.file, (e.message ?? "") + "\\n"); }
}
`,
);

const runChannel = (name, { setup, imports }, check) => {
  const dir = join(temp, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // The fixture helpers use import.meta, so the spec must be an ES module.
  writeFileSync(join(dir, "package.json"), '{"type":"module"}');
  writeFileSync(
    join(temp, `${name}.config.ts`),
    `export default { testDir: ${JSON.stringify(dir)}, outputDir: ${JSON.stringify(join(dir, "out"))}, reporter: [['json', { outputFile: ${JSON.stringify(join(dir, "report.json"))} }], ['list'], [${JSON.stringify(stepReporter)}]], workers: 1, use: { trace: 'off', video: 'off', screenshot: 'off' } };\n`,
  );
  writeFileSync(
    join(dir, "canary.spec.ts"),
    `import { expect, test } from ${JSON.stringify(`${playwright}/index.mjs`)};\n${imports}\nimport { redactSecretErrorContext } from ${JSON.stringify(helper)};\ntest.afterEach(({ browserName: _b }, testInfo) => { redactSecretErrorContext(testInfo); });\ntest('fails with a secret', async ({ page }) => {\n${setup}\n${check}\n});\n`,
  );
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
  const report = JSON.parse(readFileSync(join(dir, "report.json"), "utf8"));
  assert.deepEqual(report.errors, [], `${name}: collection or setup errors`);
  assert.equal(report.stats.unexpected, 1, `${name}: one failed test expected`);
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
  for (const [name, channel] of Object.entries(channels)) {
    assert.ok(
      runChannel(`${name}-control`, channel, channel.leaky).includes(secret),
      `${name}: control must expose the secret, or the canary proves nothing`,
    );
    assert.ok(
      !runChannel(`${name}-safe`, channel, channel.safe).includes(secret),
      `${name}: the repaired channel still exposes the secret`,
    );
  }
  // Step errors alone: the control must leak, the repaired call must not.
  const steps = (name) => readFileSync(join(temp, name, "steps.txt"), "utf8");
  assert.ok(
    steps("body-control").includes(secret),
    "Control step errors must expose the secret, or the step check proves nothing",
  );
  assert.ok(
    !steps("body-safe").includes(secret),
    "expectPrivately still leaks the value through a recorded step error",
  );
  console.log("E2E secret redaction canary: passed (control and redacted).");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
