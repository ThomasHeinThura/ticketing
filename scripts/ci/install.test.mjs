import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
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
const installer = path.join(root, "install.sh");

async function fixture(
  t,
  {
    badChecksum = false,
    symlinkArchive = false,
    hardlinkArchive = false,
    unsafeMember = false,
    realDeployment = false,
  } = {},
) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "taskdesk-install-test-"));
  t.after(async () => rm(temp, { recursive: true, force: true }));
  const bin = path.join(temp, "bin");
  const content = path.join(temp, "source", "taskdesk-v1.2.3");
  const assets = path.join(temp, "assets");
  await mkdir(bin, { recursive: true });
  await mkdir(path.join(content, "scripts", "lib"), { recursive: true });
  await mkdir(path.join(content, "deploy", "traefik", "dynamic"), {
    recursive: true,
  });
  await mkdir(assets, { recursive: true });
  for (const file of [
    "compose.yml",
    "scripts/deploy.sh",
    "scripts/lib/local-certificate.sh",
    "deploy/.env.example",
    "deploy/compose.local.yml",
    "deploy/compose.prod.yml",
    "deploy/compose.traefik.yml",
    "deploy/traefik/dynamic/middlewares.yml",
  ]) {
    const target = path.join(content, file);
    await mkdir(path.dirname(target), { recursive: true });
    const contents = realDeployment
      ? await readFile(path.join(root, file))
      : file === "scripts/deploy.sh"
        ? '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$DEPLOY_LOG"\n'
        : `fixture ${file}\n`;
    await writeFile(target, contents);
  }
  await chmod(path.join(content, "scripts/deploy.sh"), 0o755);
  if (symlinkArchive)
    await symlink(
      "/tmp/taskdesk-install-test-outside",
      path.join(content, "deploy", "unsafe-link"),
    );
  if (hardlinkArchive) {
    await writeFile(
      path.join(content, "deploy", "hardlink-target"),
      "linked fixture\n",
    );
    await link(
      path.join(content, "deploy", "hardlink-target"),
      path.join(content, "deploy", "hardlink-copy"),
    );
  }
  const archive = path.join(assets, "taskdesk-v1.2.3.tar.gz");
  execFileSync("tar", [
    "-czf",
    archive,
    "-C",
    path.dirname(content),
    path.basename(content),
  ]);
  const digest = execFileSync("sha256sum", [archive], {
    encoding: "utf8",
  }).split(" ")[0];
  await writeFile(
    `${archive}.sha256`,
    `${badChecksum ? "0".repeat(64) : digest}  taskdesk-v1.2.3.tar.gz\n`,
  );
  await writeFile(`${archive}.sigstore.json`, "{}\n");
  await writeFile(`${archive}.sha256.sigstore.json`, "{}\n");
  await writeFile(
    path.join(bin, "curl"),
    `#!/usr/bin/env bash
set -euo pipefail
out=''
url=''
while (($#)); do if [[ "$1" == -o ]]; then out="$2"; shift 2; else url="$1"; shift; fi; done
if [[ "$url" == *stable.txt ]]; then printf 'v1.2.3\\n'; exit 0; fi
name="$(basename "$url")"
if [[ -n "$out" ]]; then cp "$FAKE_ASSETS/$name" "$out"; else cat "$FAKE_ASSETS/$name"; fi
`,
  );
  await writeFile(
    path.join(bin, "cosign"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$COSIGN_LOG"
[[ "$FAKE_COSIGN_FAIL" != 1 ]]
`,
  );
  await writeFile(
    path.join(bin, "docker"),
    `#!/usr/bin/env bash
[[ "\${FAKE_DOCKER_MISSING:-0}" != 1 ]] || exit 1
[[ "$1" == compose && "$2" == version ]] && { printf 'Docker Compose version test\n'; exit 0; }
[[ "$1" == info ]] && exit 0
if [[ "\${FAKE_DOCKER_FULL:-0}" == 1 ]]; then
  printf 'env-digest=%s args=%s\\n' "\${TASKDESK_IMAGE_DIGEST:-}" "$*" >> "$FAKE_DOCKER_LOG"
  if [[ "$1" == buildx && "$2" == imagetools && "$3" == inspect ]]; then
    printf '%b\\n' "\${FAKE_DIGEST_LINE:-Digest: $FAKE_RESOLVED_DIGEST}"
    exit 0
  fi
  if [[ "$1" == compose ]]; then
    shift
    args=()
    while (($#)); do
      case "$1" in
        -f|--profile) shift 2 ;;
        *) args+=("$1"); shift ;;
      esac
    done
    case "\${args[0]:-}" in
      port)
        if [[ "\${args[1]:-}" == traefik && "\${FAKE_ASSUME_LOCAL_PROXY:-0}" == 1 ]]; then exit 0; fi
        exit 1
        ;;
      logs) printf 'setup url: https://ticket.example.test/setup\\n'; exit 0 ;;
      *) exit 0 ;;
    esac
  fi
fi
exit 2
`,
  );
  await writeFile(path.join(bin, "getent"), "#!/usr/bin/env bash\nexit 0\n");
  await writeFile(path.join(bin, "ss"), "#!/usr/bin/env bash\nexit 0\n");
  await writeFile(
    path.join(bin, "uname"),
    `#!/usr/bin/env bash
case "$1" in
  -s) [[ "\${FAKE_PRODUCTION_HOST:-0}" == 1 ]] && printf 'Linux\\n' || /usr/bin/uname -s ;;
  -m) [[ "\${FAKE_PRODUCTION_HOST:-0}" == 1 ]] && printf 'x86_64\\n' || /usr/bin/uname -m ;;
  *) /usr/bin/uname "$@" ;;
esac
`,
  );
  await Promise.all(
    ["curl", "cosign", "docker", "getent", "ss", "uname"].map((name) =>
      chmod(path.join(bin, name), 0o755),
    ),
  );
  if (unsafeMember) {
    const realTar = execFileSync("which", ["tar"], { encoding: "utf8" }).trim();
    await writeFile(
      path.join(bin, "tar"),
      `#!/usr/bin/env bash
if [[ "$1" == -tzf ]]; then printf 'taskdesk-v1.2.3/../../outside\n'; exit 0; fi
exec '${realTar}' "$@"
`,
    );
    await chmod(path.join(bin, "tar"), 0o755);
  }
  return { temp, bin, assets, archive, path: path.join(temp, "taskdesk") };
}

function run(f, args, extraEnv = {}, input = "") {
  return spawnSync("bash", [installer, ...args], {
    cwd: root,
    encoding: "utf8",
    input,
    env: {
      ...process.env,
      PATH: `${f.bin}:${process.env.PATH}`,
      HOME: f.temp,
      FAKE_ASSETS: f.assets,
      COSIGN_LOG: path.join(f.temp, "cosign.log"),
      DEPLOY_LOG: path.join(f.temp, "deploy.log"),
      ...extraEnv,
    },
  });
}

async function writeExistingEnv(
  directory,
  { tag, digest, domain = "localhost" },
) {
  let env = await readFile(path.join(root, "deploy/.env.example"), "utf8");
  env = env
    .replace(
      /^TASKDESK_ENCRYPTION_KEY=$/m,
      "TASKDESK_ENCRYPTION_KEY=test-encryption-secret",
    )
    .replace(
      /^TASKDESK_AUTH_SECRET=$/m,
      "TASKDESK_AUTH_SECRET=test-auth-secret",
    )
    .replace(/^POSTGRES_PASSWORD=$/m, "POSTGRES_PASSWORD=test-postgres-secret")
    .replace(
      /^TASKDESK_APP_DB_PASSWORD=$/m,
      "TASKDESK_APP_DB_PASSWORD=test-app-db-secret",
    )
    .replace(/^DOMAIN=.*$/m, `DOMAIN=${domain}`)
    .replace(/^TASKDESK_IMAGE_TAG=.*$/m, `TASKDESK_IMAGE_TAG=${tag}`)
    .replace(/^TASKDESK_IMAGE_DIGEST=.*$/m, `TASKDESK_IMAGE_DIGEST=${digest}`);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, ".env"), env, { mode: 0o600 });
}

async function failFirstEnvSelectionRename(f) {
  const mvPath = path.join(f.bin, "mv");
  await writeFile(
    mvPath,
    `#!/usr/bin/env bash
set -euo pipefail
destination="\${@: -1}"
if [[ "$destination" == "$FAKE_INSTALL_DIR/.env" && ! -e "$FAKE_ENV_RENAME_FAILED" ]]; then
  cp "$1" "$FAKE_IMAGE_SELECTION_CANDIDATE"
  : > "$FAKE_ENV_RENAME_FAILED"
  exit 91
fi
exec /bin/mv "$@"
`,
  );
  await chmod(mvPath, 0o755);
}

test("installer verifies both release signatures, digest, paths, prompts, preserves .env, and delegates deployment", async (t) => {
  const f = await fixture(t);
  const first = run(f, ["--version", "1.2.3", "--dir", f.path, "--yes"]);
  assert.equal(first.status, 0, first.stderr);
  const cosignArgs = await readFile(path.join(f.temp, "cosign.log"), "utf8");
  assert.match(
    cosignArgs,
    /taskdesk-v1\.2\.3\.tar\.gz\.sigstore\.json.*--certificate-oidc-issuer https:\/\/token\.actions\.githubusercontent\.com.*--certificate-identity https:\/\/github\.com\/ThomasHeinThura\/ticketing\/\.github\/workflows\/release\.yml@refs\/heads\/main/,
  );
  assert.equal((cosignArgs.match(/verify-blob/g) ?? []).length, 2);
  assert.match(
    await readFile(path.join(f.temp, "deploy.log"), "utf8"),
    /^local$/m,
  );
  const envPath = path.join(f.path, ".env");
  const envMode = (await stat(envPath)).mode & 0o777;
  assert.equal(envMode, 0o600);
  let env = await readFile(envPath, "utf8");
  assert.match(env, /^TASKDESK_IMAGE_TAG=v1\.2\.3$/m);
  assert.match(env, /^TASKDESK_AGENT_URL=https:\/\/ticket\.localhost$/m);
  assert.match(env, /^TASKDESK_PORTAL_HOST=portal\.localhost$/m);
  env += "\nTASKDESK_AUTH_SECRET=retained-test-secret\n";
  env = env.replace("DOMAIN=localhost", "DOMAIN=keep.example.test");
  env = env.replace(
    "TASKDESK_AGENT_URL=https://ticket.localhost",
    "TASKDESK_AGENT_URL=https://custom.example.test:8443",
  );
  const retainedRollbackDigest = `sha256:${"c".repeat(64)}`;
  env = env.replace(
    /^TASKDESK_IMAGE_DIGEST=.*$/m,
    `TASKDESK_IMAGE_DIGEST=${retainedRollbackDigest}`,
  );
  await writeFile(envPath, env, { mode: 0o600 });
  const second = run(f, ["--version", "1.2.3", "--dir", f.path, "--yes"]);
  assert.equal(second.status, 0, second.stderr);
  env = await readFile(envPath, "utf8");
  assert.match(env, /^TASKDESK_AUTH_SECRET=retained-test-secret$/m);
  assert.match(env, /^DOMAIN=keep\.example\.test$/m);
  assert.match(
    env,
    /^TASKDESK_AGENT_URL=https:\/\/custom\.example\.test:8443$/m,
  );
  assert.match(
    env,
    new RegExp(`^TASKDESK_IMAGE_DIGEST=${retainedRollbackDigest}$`, "m"),
  );
});

test("installer local mode reaches the real deploy script with rollback digest cleared", async (t) => {
  const f = await fixture(t, { realDeployment: true });
  const oldDigest = `sha256:${"b".repeat(64)}`;
  await writeExistingEnv(f.path, { tag: "v9.8.7", digest: oldDigest });
  const result = run(f, ["--version", "1.2.3", "--dir", f.path, "--yes"], {
    FAKE_DOCKER_FULL: "1",
    FAKE_ASSUME_LOCAL_PROXY: "1",
    FAKE_DOCKER_LOG: path.join(f.temp, "docker.log"),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /certificate in deploy\/local\/certs/);
  assert.match(result.stdout, /TaskDesk is up/);
  const env = await readFile(path.join(f.path, ".env"), "utf8");
  assert.match(env, /^TASKDESK_IMAGE_TAG=v1\.2\.3$/m);
  assert.match(env, /^TASKDESK_IMAGE_DIGEST=$/m);
  assert.match(env, /^TASKDESK_AUTH_SECRET=test-auth-secret$/m);
  const dockerLog = await readFile(path.join(f.temp, "docker.log"), "utf8");
  assert.doesNotMatch(dockerLog, new RegExp(oldDigest));
  assert.match(dockerLog, /args=compose .* port traefik 80/);
  assert.match(dockerLog, /args=compose .* up -d --wait/);
  assert.equal(
    (await stat(path.join(f.path, "deploy/local/certs/local.crt"))).isFile(),
    true,
  );
});

test("production repeat install resolves and verifies the selected tag, not a rollback digest", async (t) => {
  const f = await fixture(t, { realDeployment: true });
  const oldDigest = `sha256:${"b".repeat(64)}`;
  const selectedDigest = `sha256:${"a".repeat(64)}`;
  await writeExistingEnv(f.path, {
    tag: "v9.8.7",
    digest: oldDigest,
    domain: "example.test",
  });
  const result = run(
    f,
    [
      "--env",
      "production",
      "--domain",
      "example.test",
      "--version",
      "1.2.3",
      "--dir",
      f.path,
      "--yes",
    ],
    {
      FAKE_DOCKER_FULL: "1",
      FAKE_PRODUCTION_HOST: "1",
      FAKE_RESOLVED_DIGEST: selectedDigest,
      FAKE_DOCKER_LOG: path.join(f.temp, "docker.log"),
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /signature verified/);
  assert.match(result.stdout, /no application port is published/);
  const env = await readFile(path.join(f.path, ".env"), "utf8");
  assert.match(env, /^TASKDESK_IMAGE_TAG=v1\.2\.3$/m);
  assert.match(env, /^TASKDESK_IMAGE_DIGEST=$/m);
  assert.match(env, /^DOMAIN=example\.test$/m);
  const dockerLog = await readFile(path.join(f.temp, "docker.log"), "utf8");
  assert.match(
    dockerLog,
    /buildx imagetools inspect ghcr\.io\/thomasheinthura\/taskdesk:v1\.2\.3/,
  );
  assert.match(dockerLog, new RegExp(`env-digest=${selectedDigest}`));
  assert.doesNotMatch(dockerLog, new RegExp(oldDigest));
  const cosignLog = await readFile(path.join(f.temp, "cosign.log"), "utf8");
  assert.match(
    cosignLog,
    new RegExp(`ghcr.io/thomasheinthura/taskdesk@${selectedDigest}`),
  );
  assert.doesNotMatch(cosignLog, new RegExp(oldDigest));
});

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_FORMS = [
  ["legacy single-space", `Digest: ${DIGEST_A}`],
  ["buildx v0.38 padded", `Digest:    ${DIGEST_A}`],
  ["tab separated", `Digest:\\t${DIGEST_A}`],
  ["mixed tab and spaces", `Digest: \\t  ${DIGEST_A}`],
];

for (const [label, line] of DIGEST_FORMS) {
  test(`production install resolves the digest from ${label} imagetools output`, async (t) => {
    const f = await fixture(t, { realDeployment: true });
    const result = run(
      f,
      ["--env", "production", "--domain", "example.test", "--version", "1.2.3", "--dir", f.path, "--yes"],
      {
        FAKE_DOCKER_FULL: "1",
        FAKE_PRODUCTION_HOST: "1",
        FAKE_RESOLVED_DIGEST: DIGEST_A,
        FAKE_DIGEST_LINE: line,
        FAKE_DOCKER_LOG: path.join(f.temp, "docker.log"),
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const cosignLog = await readFile(path.join(f.temp, "cosign.log"), "utf8");
    assert.match(cosignLog, new RegExp(`ghcr.io/thomasheinthura/taskdesk@${DIGEST_A}`));
  });
}

const INDEX_DIGEST = `sha256:${"1".repeat(64)}`;
const PLATFORM_DIGEST = `sha256:${"2".repeat(64)}`;
const ATTEST_DIGEST = `sha256:${"3".repeat(64)}`;
const multiManifest = (...extraTop) =>
  [
    "Name:      ghcr.io/thomasheinthura/taskdesk:v1.2.3",
    "MediaType: application/vnd.oci.image.index.v1+json",
    `Digest:    ${INDEX_DIGEST}`,
    ...extraTop,
    "           ",
    "Manifests: ",
    "  Name:        ghcr.io/thomasheinthura/taskdesk:v1.2.3@" + PLATFORM_DIGEST,
    "  MediaType:   application/vnd.oci.image.manifest.v1+json",
    `  Digest:      ${PLATFORM_DIGEST}`,
    "  Platform:    linux/amd64",
    "  Name:        ghcr.io/thomasheinthura/taskdesk:v1.2.3@" + ATTEST_DIGEST,
    `  Digest:      ${ATTEST_DIGEST}`,
    "  Platform:    unknown/unknown",
  ].join("\\n");

for (const [label, line, expected] of [
  ["a multi-manifest index", multiManifest(), INDEX_DIGEST],
  [
    "a later injected Digest line",
    multiManifest(`Digest:    ${DIGEST_A}`),
    INDEX_DIGEST,
  ],
]) {
  test(`production install verifies the top-level digest from ${label}`, async (t) => {
    const f = await fixture(t, { realDeployment: true });
    const result = run(
      f,
      ["--env", "production", "--domain", "example.test", "--version", "1.2.3", "--dir", f.path, "--yes"],
      {
        FAKE_DOCKER_FULL: "1",
        FAKE_PRODUCTION_HOST: "1",
        FAKE_RESOLVED_DIGEST: DIGEST_A,
        FAKE_DIGEST_LINE: line,
        FAKE_DOCKER_LOG: path.join(f.temp, "docker.log"),
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const cosignLog = await readFile(path.join(f.temp, "cosign.log"), "utf8");
    assert.match(cosignLog, new RegExp(`ghcr.io/thomasheinthura/taskdesk@${expected}`));
    assert.doesNotMatch(cosignLog, new RegExp(`${PLATFORM_DIGEST}|${ATTEST_DIGEST}`));
    if (expected !== DIGEST_A) assert.doesNotMatch(cosignLog, new RegExp(DIGEST_A));
  });
}

test("release workflow immutability check parses the padded Digest line, not the legacy sed", async () => {
  const workflow = await readFile(path.join(root, ".github/workflows/release.yml"), "utf8");
  assert.doesNotMatch(workflow, /sed -n 's\/\^Digest: \/\/p'/);
  assert.match(workflow, /existing_digest="\$\(awk '\/\^Digest:\/ && \$1 == "Digest:" && NF == 2/);
});

for (const [label, line] of [
  ["a missing Digest line", "Name:      ghcr.io/thomasheinthura/taskdesk:v1.2.3"],
  ["a truncated digest", `Digest:    sha256:${"a".repeat(63)}`],
  ["an uppercase digest", `Digest:    sha256:${"A".repeat(64)}`],
  ["a non-sha256 digest", `Digest:    md5:${"a".repeat(64)}`],
  ["an empty digest value", "Digest:    "],
  ["a digest with trailing junk", `Digest:    ${DIGEST_A} extra`],
]) {
  test(`production install refuses ${label} and never reaches image verification`, async (t) => {
    const f = await fixture(t, { realDeployment: true });
    const result = run(
      f,
      ["--env", "production", "--domain", "example.test", "--version", "1.2.3", "--dir", f.path, "--yes"],
      {
        FAKE_DOCKER_FULL: "1",
        FAKE_PRODUCTION_HOST: "1",
        FAKE_RESOLVED_DIGEST: DIGEST_A,
        FAKE_DIGEST_LINE: line,
        FAKE_DOCKER_LOG: path.join(f.temp, "docker.log"),
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /must be a full lowercase sha256 digest/);
    let cosignLog = "";
    try { cosignLog = await readFile(path.join(f.temp, "cosign.log"), "utf8"); } catch {}
    assert.doesNotMatch(cosignLog, /thomasheinthura\/taskdesk@/);
    assert.doesNotMatch(cosignLog, /^verify /m);
  });
}

test("release tag and rollback digest commit atomically and retry after rename interruption", async (t) => {
  const f = await fixture(t, { realDeployment: true });
  const oldDigest = `sha256:${"b".repeat(64)}`;
  await writeExistingEnv(f.path, { tag: "v9.8.7", digest: oldDigest });
  const envPath = path.join(f.path, ".env");
  const originalEnv = await readFile(envPath, "utf8");
  await failFirstEnvSelectionRename(f);

  const installArgs = ["--version", "1.2.3", "--dir", f.path, "--yes"];
  const injected = {
    FAKE_DOCKER_FULL: "1",
    FAKE_ASSUME_LOCAL_PROXY: "1",
    FAKE_DOCKER_LOG: path.join(f.temp, "docker.log"),
    FAKE_INSTALL_DIR: f.path,
    FAKE_ENV_RENAME_FAILED: path.join(f.temp, "rename-failed"),
    FAKE_IMAGE_SELECTION_CANDIDATE: path.join(
      f.temp,
      "selection-candidate.env",
    ),
  };
  const interrupted = run(f, installArgs, injected);
  assert.notEqual(interrupted.status, 0);
  assert.equal(await readFile(envPath, "utf8"), originalEnv);

  const candidateEnv = await readFile(
    injected.FAKE_IMAGE_SELECTION_CANDIDATE,
    "utf8",
  );
  const expectedCandidateEnv = originalEnv
    .replace(/^TASKDESK_IMAGE_TAG=.*$/m, "TASKDESK_IMAGE_TAG=v1.2.3")
    .replace(/^TASKDESK_IMAGE_DIGEST=.*$/m, "TASKDESK_IMAGE_DIGEST=");
  assert.equal(candidateEnv, expectedCandidateEnv);
  assert.match(candidateEnv, /^TASKDESK_IMAGE_TAG=v1\.2\.3$/m);
  assert.match(candidateEnv, /^TASKDESK_IMAGE_DIGEST=$/m);
  assert.match(candidateEnv, /^TASKDESK_AUTH_SECRET=test-auth-secret$/m);

  const retried = run(f, installArgs, injected);
  assert.equal(retried.status, 0, retried.stderr);
  const envAfterRetry = await readFile(envPath, "utf8");
  assert.match(envAfterRetry, /^TASKDESK_IMAGE_TAG=v1\.2\.3$/m);
  assert.match(envAfterRetry, /^TASKDESK_IMAGE_DIGEST=$/m);
  assert.match(envAfterRetry, /^TASKDESK_AUTH_SECRET=test-auth-secret$/m);
  const dockerLog = await readFile(injected.FAKE_DOCKER_LOG, "utf8");
  assert.doesNotMatch(dockerLog, new RegExp(oldDigest));
});

test("stable pointer is HTTPS-fetched and normalized to a validated versioned asset path", async (t) => {
  const f = await fixture(t);
  const result = run(f, ["--dir", f.path, "--yes"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /resolving the published stable release pointer/);
  assert.ok(
    (await readFile(path.join(f.temp, "cosign.log"), "utf8")).includes(
      "taskdesk-v1.2.3.tar.gz",
    ),
  );
});

test("dry-run prints the selected release plan without downloading or writing", async (t) => {
  const f = await fixture(t);
  const result = run(f, ["--version", "1.2.3", "--dir", f.path, "--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /releases\/download\/v1\.2\.3/);
  assert.match(result.stdout, /cosign verify-blob/);
  assert.equal(await stat(f.path).catch(() => null), null);
  assert.equal(
    await stat(path.join(f.temp, "cosign.log")).catch(() => null),
    null,
  );
  assert.equal(
    await stat(path.join(f.temp, "deploy.log")).catch(() => null),
    null,
  );
});

test("cosign rejection stops before creating or changing the install directory", async (t) => {
  const f = await fixture(t);
  const result = run(f, ["--version", "1.2.3", "--dir", f.path, "--yes"], {
    FAKE_COSIGN_FAIL: "1",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cosign verification failed/);
  assert.equal(await stat(f.path).catch(() => null), null);
});

test("checksum mismatch is rejected even when signatures are explicitly skipped", async (t) => {
  const f = await fixture(t, { badChecksum: true });
  const result = run(f, [
    "--version",
    "1.2.3",
    "--dir",
    f.path,
    "--yes",
    "--skip-verify",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SHA-256 does not match/);
  assert.equal(await stat(f.path).catch(() => null), null);
});

test("symbolic links in a signed archive are rejected before persistent writes", async (t) => {
  const f = await fixture(t, { symlinkArchive: true });
  const result = run(f, ["--version", "1.2.3", "--dir", f.path, "--yes"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symbolic link/);
  assert.equal(await stat(f.path).catch(() => null), null);
});

test("hardlinks in a signed archive are rejected before extraction or persistent writes", async (t) => {
  const f = await fixture(t, { hardlinkArchive: true });
  const result = run(f, ["--version", "1.2.3", "--dir", f.path, "--yes"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /hardlink|special file/);
  assert.equal(await stat(f.path).catch(() => null), null);
});

test("unsupported release tags and host injection fail before downloads", async (t) => {
  const f = await fixture(t);
  const badTag = run(f, ["--version", "../main", "--dir", f.path, "--yes"]);
  assert.notEqual(badTag.status, 0);
  assert.match(badTag.stderr, /SemVer/);
  const badHost = run(f, [
    "--version",
    "1.2.3",
    "--dir",
    f.path,
    "--yes",
    "--domain",
    "good.test;touch-pwned",
  ]);
  assert.notEqual(badHost.status, 0);
  assert.match(badHost.stderr, /valid DNS name/);
  assert.equal(await stat(f.path).catch(() => null), null);
});

test("declining the install prompt leaves no target files", async (t) => {
  const f = await fixture(t);
  const result = run(f, ["--version", "1.2.3", "--dir", f.path], {}, "n\n");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /installation declined/);
  assert.equal(await stat(f.path).catch(() => null), null);
});

test("archive parent traversal is rejected before extraction or target creation", async (t) => {
  const f = await fixture(t, { unsafeMember: true });
  const result = run(f, ["--version", "1.2.3", "--dir", f.path, "--yes"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unsafe path/);
  assert.equal(await stat(f.path).catch(() => null), null);
});

test("missing Docker requires separate consent before any persistent writes", async (t) => {
  const f = await fixture(t);
  const result = run(
    f,
    ["--version", "1.2.3", "--dir", f.path],
    { FAKE_DOCKER_MISSING: "1" },
    "y\nn\n",
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Docker installation declined/);
  assert.equal(await stat(f.path).catch(() => null), null);
});

test("production requires a valid domain before resolving or downloading assets", async (t) => {
  const f = await fixture(t);
  const result = run(f, [
    "--env",
    "production",
    "--version",
    "1.2.3",
    "--dir",
    f.path,
    "--yes",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /production requires --domain/);
  assert.equal(
    await stat(path.join(f.temp, "cosign.log")).catch(() => null),
    null,
  );
});

test("a symbolic-link .env is rejected without replacing it or copying deployment files", async (t) => {
  const f = await fixture(t);
  await mkdir(f.path);
  const outside = path.join(f.temp, "outside-env");
  await writeFile(outside, "TASKDESK_AUTH_SECRET=do-not-touch\n");
  await symlink(outside, path.join(f.path, ".env"));
  const result = run(f, ["--version", "1.2.3", "--dir", f.path, "--yes"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symbolic links/);
  assert.equal(
    await readFile(outside, "utf8"),
    "TASKDESK_AUTH_SECRET=do-not-touch\n",
  );
  assert.equal(
    await stat(path.join(f.path, "compose.yml")).catch(() => null),
    null,
  );
});

test("custom local route hosts are kept in .env and credentials never appear in installer output", async (t) => {
  const f = await fixture(t);
  const result = run(f, [
    "--version",
    "1.2.3",
    "--dir",
    f.path,
    "--yes",
    "--domain",
    "dev.example.test",
    "--agent-host",
    "agent.custom.test",
    "--portal-host",
    "portal.custom.test",
    "--profile",
    "s3",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const env = await readFile(path.join(f.path, ".env"), "utf8");
  assert.match(env, /^TASKDESK_AGENT_URL=https:\/\/agent\.custom\.test$/m);
  assert.match(env, /^TASKDESK_PORTAL_URL=https:\/\/portal\.custom\.test$/m);
  assert.match(env, /^TASKDESK_FILES_HOST=files\.dev\.example\.test$/m);
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    /do-not-touch|TASKDESK_AUTH_SECRET=|POSTGRES_PASSWORD=/,
  );
  assert.match(
    await readFile(path.join(f.temp, "deploy.log"), "utf8"),
    /local --profile s3/,
  );
});

test("release workflow packages only versioned releases and signs checksum plus archive", async () => {
  const workflow = await readFile(
    path.join(root, ".github/workflows/release.yml"),
    "utf8",
  );
  const rootPrefix = `${String.fromCharCode(36)}{root}/`;
  const archiveSha = `${String.fromCharCode(36)}{archive}.sha256`;
  assert.ok(
    workflow.includes(`git archive --format=tar --prefix="${rootPrefix}"`),
  );
  assert.ok(workflow.includes(`sha256sum "$archive" > "${archiveSha}"`));
  assert.match(workflow, /cosign sign-blob --yes --bundle/);
  assert.match(workflow, /cosign verify-blob --bundle/);
  assert.match(workflow, /taskdesk-\$\{tag\}\.tar\.gz\.sha256\.sigstore\.json/);
  const archiveStep = workflow.slice(
    workflow.indexOf("name: Build the versioned deployment archive"),
    workflow.indexOf("name: Sign and verify release archive"),
  );
  assert.match(
    archiveStep,
    /if: needs\.build-scan\.outputs\.is_release == 'true'/,
  );
});

test("Arch Docker bootstrap fails closed without a partial system upgrade", async () => {
  const source = await readFile(installer, "utf8");
  const archCase = source.match(/Linux:arch\)[^\n]*/)?.[0];
  assert.ok(archCase, "Arch must have an explicit installer path");
  assert.match(archCase, /die .*Arch Linux.*synchronized full-system update/);
  assert.doesNotMatch(archCase, /pacman\s+-Sy\b/);
});

test("published source installer hash in the runbook matches install.sh byte-for-byte", async () => {
  const source = await readFile(installer);
  const digest = createHash("sha256").update(source).digest("hex");
  const guide = await readFile(
    path.join(root, "docs/05-operations/one-line-install.md"),
    "utf8",
  );
  assert.ok(
    guide.includes(digest),
    "installer source hash must be refreshed when install.sh changes",
  );
});
