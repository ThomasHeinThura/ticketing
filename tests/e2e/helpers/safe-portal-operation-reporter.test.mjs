import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const temp = mkdtempSync(join(tmpdir(), "portal-reporter-"));
const token = "synthetic-token-for-reporter-test";
const cookie = "synthetic-cookie-for-reporter-test";
try {
  const spec = join(temp, "transport.spec.ts");
  const config = join(temp, "playwright.config.ts");
  const playwright = resolve(repo, "apps/web/node_modules/@playwright/test");
  const helper = resolve(repo, "tests/e2e/helpers/safe-portal-operation.ts");
  writeFileSync(
    config,
    `export default { testDir: ${JSON.stringify(temp)}, reporter: 'list', workers: 1 };\n`,
  );
  writeFileSync(
    spec,
    `
import { createServer } from 'node:http';
import { test } from ${JSON.stringify(playwright)};
import { safePortalOperation } from ${JSON.stringify(helper)};
test('redirect followed by transport failure', async ({ request }) => {
  const destination = 'http://127.0.0.1:1/download?token=' + process.env.TEST_FAKE_TOKEN;
  const server = createServer((_req, res) => { res.writeHead(302, { Location: destination }); res.end(); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Server address unavailable');
    const run = () => request.get('http://127.0.0.1:' + address.port + '/issue', { headers: { Cookie: 'session=' + process.env.TEST_FAKE_COOKIE }, timeout: 2000 });
    if (process.env.TEST_UNSAFE) await run();
    else await safePortalOperation(run);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
`,
  );
  const cli = resolve(playwright, "cli.js");
  const run = (unsafe) =>
    spawnSync(process.execPath, [cli, "test", "--config", config], {
      encoding: "utf8",
      env: {
        ...process.env,
        FORCE_COLOR: "0",
        TEST_FAKE_TOKEN: token,
        TEST_FAKE_COOKIE: cookie,
        TEST_UNSAFE: unsafe ? "1" : "",
      },
    });
  const unsafe = run(true);
  const safe = run(false);
  assert.equal(unsafe.status, 1, "Unwrapped synthetic failure should fail");
  assert.equal(safe.status, 1, "Wrapped synthetic failure should fail");
  const unsafeOutput = unsafe.stdout + unsafe.stderr;
  const safeOutput = safe.stdout + safe.stderr;
  assert.ok(
    unsafeOutput.includes(token),
    "Control must expose the synthetic token",
  );
  assert.ok(
    unsafeOutput.includes(cookie),
    "Control must expose the synthetic cookie",
  );
  assert.ok(
    safeOutput.includes(
      "Portal attachment operation failed; sensitive details omitted.",
    ),
  );
  assert.ok(
    !safeOutput.includes(`http://127.0.0.1:1/download?token=${token}`),
    "Wrapped reporter output exposed the synthetic signed URL",
  );
  assert.ok(
    !safeOutput.includes(token),
    "Wrapped reporter output exposed the synthetic token",
  );
  assert.ok(
    !safeOutput.includes(cookie),
    "Wrapped reporter output exposed the synthetic cookie",
  );
  console.log(
    "List reporter transport-failure redaction: passed (unsafe control and wrapped case).",
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
