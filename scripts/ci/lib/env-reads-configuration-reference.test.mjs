import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, realpath, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  configurationReferencePath,
  parseConfigurationReference,
  readConfigurationReference,
} from "./configuration-reference.mjs";
import { repoRoot } from "./repo.mjs";

test("maintained environment contract preserves bootstrap and external-reader boundaries", async () => {
  assert.equal(
    configurationReferencePath,
    path.join(repoRoot, "docs/technical/configuration.md"),
  );
  const reference = await readConfigurationReference();
  assert.deepEqual(
    [...reference.required],
    [
      "TASKDESK_DATABASE_URL",
      "TASKDESK_ENCRYPTION_KEY",
      "TASKDESK_AUTH_SECRET",
      "TASKDESK_AGENT_URL",
      "TASKDESK_PORTAL_URL",
    ],
  );
  assert.equal(reference.optional.size, 13);
  for (const name of [
    "TASKDESK_MIGRATION_DATABASE_URL",
    "TASKDESK_ROLE",
    "TASKDESK_STORAGE_DRIVER",
    "TASKDESK_STORAGE_FILESYSTEM_ROOT",
    "TASKDESK_POLICY_SHADOW",
    "TASKDESK_POLICY_ENFORCE",
  ])
    assert.ok(reference.optional.has(name));
  assert.deepEqual(
    [...reference.postgresImage],
    ["POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD"],
  );
  assert.equal(reference.notReadByApplication.size, 11);
  for (const name of [
    "DOMAIN",
    "TASKDESK_IMAGE_DIGEST",
    "TASKDESK_API_URL",
    "TASKDESK_API_KEY",
  ]) {
    assert.ok(reference.notReadByApplication.has(name));
    assert.equal(
      reference.required.has(name) || reference.optional.has(name),
      false,
    );
  }
});

test("parser reads registered table names without admitting prose, examples or runtime keys", () => {
  const reference = parseConfigurationReference(`### Required
| Variable | Purpose |
| --- | --- |
| \`TASKDESK_DATABASE_URL\` | Example uses \`NOT_A_REGISTERED_NAME\`. |
### Optional
| Variable | Purpose |
| --- | --- |
| \`TASKDESK_PORT\` | Bind port |
### Postgres container
| Variable | Purpose |
| --- | --- |
| \`POSTGRES_DB\` · \`POSTGRES_USER\` | Image only |
### Variables the application does not read
| Variable | Reader |
| --- | --- |
| \`DOMAIN\` | Compose |
## Runtime configuration
| Area | Required settings |
| --- | --- |
| Branding | \`NOT_BOOTSTRAP\` |
`);
  assert.deepEqual([...reference.required], ["TASKDESK_DATABASE_URL"]);
  assert.deepEqual([...reference.optional], ["TASKDESK_PORT"]);
  assert.deepEqual(
    [...reference.postgresImage],
    ["POSTGRES_DB", "POSTGRES_USER"],
  );
  assert.deepEqual(
    [...reference.notReadByApplication],
    [["DOMAIN", "Compose"]],
  );
});

test("missing or renamed bootstrap sections fail closed instead of authorizing an empty contract", () => {
  for (const source of [
    "",
    "### Required\n| `TASKDESK_DATABASE_URL` | Database |",
    "### Optional\n| `TASKDESK_PORT` | Port |",
    "### Legacy Required\n| `TASKDESK_DATABASE_URL` | Database |\n### Legacy Optional\n| `TASKDESK_PORT` | Port |",
  ])
    assert.throws(
      () => parseConfigurationReference(source),
      /refuses to run against an unparsed authority document/,
    );
});

test("reader runs in an isolated checkout without archive and fails if the maintained contract disappears", async (t) => {
  const scratch = await mkdtemp(
    path.join(os.tmpdir(), "taskdesk-config-contract-"),
  );
  t.after(() => rm(scratch, { recursive: true, force: true }));
  for (const name of [
    "scripts/ci/lib/repo.mjs",
    "scripts/ci/lib/configuration-reference.mjs",
    "docs/technical/configuration.md",
  ]) {
    const target = path.join(scratch, name);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(repoRoot, name), target);
  }
  execFileSync("git", ["init", "--quiet"], { cwd: scratch });
  const script =
    'import {readConfigurationReference,configurationReferencePath} from "./scripts/ci/lib/configuration-reference.mjs"; import {existsSync} from "node:fs"; const parsed=await readConfigurationReference(); console.log(JSON.stringify({path:configurationReferencePath,archivePresent:existsSync("archive"),required:[...parsed.required],optional:[...parsed.optional]}));';
  const run = () =>
    spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: scratch,
      encoding: "utf8",
    });
  const success = run();
  assert.equal(success.status, 0, success.stderr);
  const result = JSON.parse(success.stdout);
  assert.equal(result.archivePresent, false);
  assert.equal(
    result.path,
    path.join(await realpath(scratch), "docs/technical/configuration.md"),
  );
  assert.equal(result.required.length, 5);
  assert.equal(result.optional.length, 13);
  await rename(
    path.join(scratch, "docs/technical/configuration.md"),
    path.join(scratch, "docs/technical/configuration.missing"),
  );
  const missing = run();
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /ENOENT/);
  assert.match(missing.stderr, /docs\/technical\/configuration\.md/);
});
