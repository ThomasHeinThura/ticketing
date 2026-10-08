import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const digest = `sha256:${"a".repeat(64)}`;

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", ...options });
}

async function composeConfig(t, overrides = {}) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "taskdesk-image-ref-"));
  t.after(async () => rm(temp, { recursive: true, force: true }));
  const envFile = path.join(temp, ".env");
  const values = {
    POSTGRES_PASSWORD: "placeholder",
    TASKDESK_APP_DB_PASSWORD: "placeholder",
    TASKDESK_ENCRYPTION_KEY: "a".repeat(64),
    TASKDESK_AUTH_SECRET: "b".repeat(64),
    TASKDESK_AGENT_URL: "https://ticket.example.test",
    TASKDESK_PORTAL_URL: "https://portal.example.test",
    ...overrides,
  };
  await writeFile(
    envFile,
    `${Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")}\n`,
  );
  const result = run(
    "docker",
    [
      "compose",
      "--env-file",
      envFile,
      "-f",
      "compose.yml",
      "config",
      "--format",
      "json",
    ],
    { cwd: root },
  );
  return { result, temp };
}

async function deployFixture(
  t,
  { repository, tag = "v2.0.0", imageDigest = "", dockerMode = "normal" },
) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "taskdesk-deploy-image-"));
  t.after(async () => rm(temp, { recursive: true, force: true }));
  const deployDir = path.join(temp, "deploy");
  const scriptsDir = path.join(temp, "scripts");
  const binDir = path.join(temp, "bin");
  await Promise.all([mkdir(deployDir), mkdir(scriptsDir), mkdir(binDir)]);
  await writeFile(
    path.join(scriptsDir, "deploy.sh"),
    await readFile(path.join(root, "scripts/deploy.sh")),
  );
  await chmod(path.join(scriptsDir, "deploy.sh"), 0o755);
  const env = [
    `TASKDESK_ENCRYPTION_KEY=${"a".repeat(64)}`,
    `TASKDESK_AUTH_SECRET=${"b".repeat(64)}`,
    "POSTGRES_PASSWORD=placeholder",
    "TASKDESK_APP_DB_PASSWORD=placeholder",
    "TASKDESK_AGENT_URL=https://ticket.example.test",
    "TASKDESK_PORTAL_URL=https://portal.example.test",
    `TASKDESK_IMAGE_TAG='${tag}'`,
    `TASKDESK_IMAGE_DIGEST='${imageDigest}'`,
    ...(repository ? [`TASKDESK_IMAGE_REPOSITORY='${repository}'`] : []),
  ];
  await writeFile(path.join(temp, ".env"), `${env.join("\n")}\n`);
  const dockerLog = path.join(temp, "docker.log");
  const cosignLog = path.join(temp, "cosign.log");
  await writeFile(
    path.join(binDir, "docker"),
    `#!/usr/bin/env bash
printf '%s\n' "$*" >> "$DOCKER_LOG"
case "$*" in
  'compose version'|'info') exit 0 ;;
  *' buildx imagetools inspect '*) printf 'Digest: ${digest}\\n'; exit 0 ;;
  *' compose '* )
    [[ "$*" == *' images -q taskdesk'* ]] && exit 0
    [[ "$*" == *' ps -q taskdesk'* ]] && exit 0
    [[ "$*" == *' pull '* ]] && exit 0
    exit 0 ;;
  inspect*) exit 1 ;;
  *) exit 0 ;;
esac
`,
  );
  await writeFile(
    path.join(binDir, "cosign"),
    `#!/usr/bin/env bash
printf '%s\n' "$*" >> "$COSIGN_LOG"
[[ "$COSIGN_FAIL" != 1 ]]
`,
  );
  await Promise.all([
    chmod(path.join(binDir, "docker"), 0o755),
    chmod(path.join(binDir, "cosign"), 0o755),
  ]);
  const result = run("bash", [path.join(scriptsDir, "deploy.sh"), "upgrade"], {
    cwd: temp,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      DOCKER_LOG: dockerLog,
      COSIGN_LOG: cosignLog,
      COSIGN_FAIL: dockerMode === "signature-failure" ? "1" : "0",
    },
  });
  return {
    result,
    dockerLog: await readFile(dockerLog, "utf8").catch(() => ""),
    cosignLog: await readFile(cosignLog, "utf8").catch(() => ""),
  };
}

test("deployment uses the default repository for both Compose application services", async (t) => {
  const { result } = await composeConfig(t);
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  assert.equal(
    config.services.migrate.image,
    "ghcr.io/thomasheinthura/taskdesk:v2.0.0",
  );
  assert.equal(config.services.taskdesk.image, config.services.migrate.image);
});

test("deployment resolves a custom repository and digest consistently in Compose", async (t) => {
  const { result } = await composeConfig(t, {
    TASKDESK_IMAGE_REPOSITORY: "docker.io/bimdevops/taskdesk",
    TASKDESK_IMAGE_TAG: "sha-3096cb044bdf6ae98488bfc385f532fa6386343a",
    TASKDESK_IMAGE_DIGEST: digest,
  });
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  const expected = `docker.io/bimdevops/taskdesk:sha-3096cb044bdf6ae98488bfc385f532fa6386343a@${digest}`;
  assert.equal(config.services.migrate.image, expected);
  assert.equal(config.services.taskdesk.image, expected);
});

test("deploy verifier and Compose pull target share the custom repository", async (t) => {
  const { result, cosignLog, dockerLog } = await deployFixture(t, {
    repository: "docker.io/bimdevops/taskdesk",
    imageDigest: digest,
    dockerMode: "signature-failure",
  });
  assert.notEqual(result.status, 0);
  assert.match(
    cosignLog,
    /--certificate-oidc-issuer https:\/\/token\.actions\.githubusercontent\.com/,
  );
  assert.match(
    cosignLog,
    /--certificate-identity https:\/\/github\.com\/ThomasHeinThura\/ticketing\/\.github\/workflows\/release\.yml@refs\/heads\/main/,
  );
  assert.match(cosignLog, /--annotations tag=v2\.0\.0/);
  assert.match(
    cosignLog,
    new RegExp(
      `docker\\.io/bimdevops/taskdesk\\@${digest.replace(":", "\\:")}`,
    ),
  );
  assert.doesNotMatch(dockerLog, /compose .* pull/);
});

test("deploy rejects malformed repository, tag, and digest before image resolution", async (t) => {
  for (const values of [
    { repository: "docker.io/bimdevops/taskdesk;echo" },
    { repository: "docker.io/bimdevops/taskdesk", tag: "bad tag" },
    { repository: "docker.io/bimdevops/taskdesk", imageDigest: "sha256:ABC" },
  ]) {
    const { result, dockerLog } = await deployFixture(t, values);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(dockerLog, /buildx imagetools inspect|compose .* pull/);
  }
});
