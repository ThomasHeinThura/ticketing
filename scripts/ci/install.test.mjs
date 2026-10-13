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

// The registry bytes the stub serves for `buildx imagetools inspect --raw`. The digest
// deploy.sh must derive is the sha256 of exactly these bytes, with no trailing newline.
const RAW_MANIFEST =
  '{"schemaVersion":2,"mediaType":"application/vnd.oci.image.index.v1+json","manifests":[]}';
const RAW_DIGEST = `sha256:${createHash("sha256").update(RAW_MANIFEST).digest("hex")}`;

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
    "scripts/lib/deploy-checks.sh",
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
if [[ "$1" == buildx && "$2" == version ]]; then
  if [[ "\${FAKE_BUILDX_MISSING:-0}" == 1 ]]; then printf "docker: unknown command: docker buildx\\n" >&2; exit 1; fi
  printf 'github.com/docker/buildx v0.38.0 0dbe87f36ed472fe36b6796c3f70b4210a731fc5\\n'; exit 0
fi
if [[ "\${FAKE_DOCKER_FULL:-0}" == 1 ]]; then
  printf 'env-digest=%s args=%s\\n' "\${TASKDESK_IMAGE_DIGEST:-}" "$*" >> "$FAKE_DOCKER_LOG"
  if [[ "$1" == buildx && "$2" == imagetools && "$3" == inspect ]]; then
    # Only --raw is honest: human text and --format differ between buildx versions.
    [[ "$4" == --raw ]] || exit 2
    [[ "\${FAKE_RAW_RC:-0}" == 0 ]] || { printf 'ERROR: not found\\n' >&2; exit "$FAKE_RAW_RC"; }
    printf '%s' "\${FAKE_RAW:-}"
    exit 0
  fi
  if [[ "$1" == inspect ]]; then
    # docker inspect --type container --format <template> <id>
    [[ "\${FAKE_INSPECT_RC:-0}" == 0 ]] || { printf 'Error: No such container: %s\\n' "\${@: -1}" >&2; exit "$FAKE_INSPECT_RC"; }
    if [[ "\${@: -1}" == traefikid ]]; then
      if [[ "$*" == *'"80/tcp"'* ]]; then printf '%s \\n' "\${FAKE_TRAEFIK_HP80:-80}"; else printf '%s \\n' "\${FAKE_TRAEFIK_HP443:-443}"; fi
      exit 0
    fi
    # Published until the application is really started: only a check made on the
    # created, not yet started, containers can see it.
    if [[ "\${FAKE_PUBLISHED_UNTIL_START:-0}" == 1 && ! -f "$FAKE_DOCKER_LOG.started" ]]; then
      printf 'taskdesk_default|false|5173/tcp |\\n'; exit 0
    fi
    printf '%s\\n' "\${FAKE_INSPECT_LINE-taskdesk_default|false||}"
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
      # Real Compose v5.6.0 and 2.40.3: a port that is exposed but not published
      # prints ":0" with exit 0, so an exit-code test cannot tell the two apart.
      port) printf ':0\\n'; exit 0 ;;
      ps)
        if [[ "\${args[*]}" == *traefik* ]]; then
          if [[ "\${FAKE_ASSUME_LOCAL_PROXY:-0}" == 1 ]]; then printf 'traefikid\\n'; fi
          exit 0
        fi
        [[ "\${FAKE_PS_RC:-0}" == 0 ]] || exit "$FAKE_PS_RC"
        printf '%s' "\${FAKE_TASKDESK_IDS-tdid1
}"
        exit 0
        ;;
      up)
        if [[ "\${args[*]}" == "up -d --wait" || "\${args[*]}" == "up -d --wait taskdesk" ]]; then : > "$FAKE_DOCKER_LOG.started"; fi
        exit 0
        ;;
      logs) printf 'setup url: https://ticket.example.test/setup\\n'; exit 0 ;;
      *) exit 0 ;;
    esac
  fi
fi
exit 2
`,
  );
  await writeFile(
    path.join(bin, "getent"),
    `#!/usr/bin/env bash
for missing in \${FAKE_DNS_MISSING:-}; do [[ "$2" != "$missing" ]] || exit 2; done
exit 0
`,
  );
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
  assert.match(dockerLog, /args=compose .* ps -q traefik/);
  assert.match(dockerLog, /args=inspect .*PortBindings "80\/tcp".* traefikid/);
  assert.doesNotMatch(dockerLog, / port traefik /);
  assert.match(dockerLog, /args=compose .* up -d --wait/);
  assert.equal(
    (await stat(path.join(f.path, "deploy/local/certs/local.crt"))).isFile(),
    true,
  );
});

test("production repeat install resolves and verifies the selected tag, not a rollback digest", async (t) => {
  const f = await fixture(t, { realDeployment: true });
  const oldDigest = `sha256:${"b".repeat(64)}`;
  const selectedDigest = RAW_DIGEST;
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
      FAKE_RAW: RAW_MANIFEST,
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
    /buildx imagetools inspect --raw ghcr\.io\/thomasheinthura\/taskdesk:v1\.2\.3/,
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

const PROD_ARGS = (f) => [
  "--env",
  "production",
  "--domain",
  "example.test",
  "--version",
  "1.2.3",
  "--dir",
  f.path,
  "--yes",
];

async function productionRun(t, extraEnv = {}) {
  const f = await fixture(t, { realDeployment: true });
  const result = run(f, PROD_ARGS(f), {
    FAKE_DOCKER_FULL: "1",
    FAKE_PRODUCTION_HOST: "1",
    FAKE_RAW: RAW_MANIFEST,
    FAKE_DOCKER_LOG: path.join(f.temp, "docker.log"),
    ...extraEnv,
  });
  const read = (name) =>
    readFile(path.join(f.temp, name), "utf8").catch(() => "");
  return { f, result, output: `${result.stdout}${result.stderr}`, read };
}

test("production install derives the digest from the sha256 of the raw registry bytes", async (t) => {
  const { result, read } = await productionRun(t);
  assert.equal(result.status, 0, result.stderr);
  assert.match(await read("cosign.log"), new RegExp(`taskdesk@${RAW_DIGEST}`));
  const dockerLog = await read("docker.log");
  assert.match(dockerLog, /buildx imagetools inspect --raw /);
  assert.doesNotMatch(dockerLog, /imagetools inspect[^\n]*--format/);
  assert.doesNotMatch(dockerLog, /imagetools inspect ghcr[^\n]*$/m);
});

for (const [label, env, message] of [
  [
    "empty registry output",
    { FAKE_RAW: "" },
    /could not resolve .* immutable digest/,
  ],
  [
    "a failed inspect (tag not found)",
    { FAKE_RAW_RC: "1" },
    /could not resolve .* immutable digest/,
  ],
]) {
  test(`production install refuses ${label} and never verifies an image`, async (t) => {
    const { result, output, read } = await productionRun(t, env);
    assert.notEqual(result.status, 0);
    assert.match(output, message);
    assert.doesNotMatch(await read("cosign.log"), /thomasheinthura\/taskdesk@/);
    assert.doesNotMatch(await read("cosign.log"), /^verify /m);
  });
}

// Real `docker inspect` answers (template: mode|publishAll|configured ports|live ports)
// for the cases the whole-path diagnosis ran against Compose v5.6.0 and 2.40.3.
const UNPUBLISHED = "taskdesk_default|false||";
for (const [label, env] of [
  ["a created, unpublished container", { FAKE_INSPECT_LINE: UNPUBLISHED }],
  [
    "a running, exposed-but-unpublished container (compose port prints :0)",
    { FAKE_INSPECT_LINE: UNPUBLISHED },
  ],
]) {
  test(`production install accepts ${label}`, async (t) => {
    const { result, output } = await productionRun(t, env);
    assert.equal(result.status, 0, output);
    assert.match(output, /no application port is published/);
  });
}

for (const [label, env] of [
  [
    "a published port",
    { FAKE_INSPECT_LINE: "taskdesk_default|false|5173/tcp |5173/tcp " },
  ],
  [
    "a configured-only binding (created, not started)",
    { FAKE_INSPECT_LINE: "taskdesk_default|false|5173/tcp |" },
  ],
  [
    "a published other container port",
    { FAKE_INSPECT_LINE: "taskdesk_default|false|8080/tcp |8080/tcp " },
  ],
  [
    "an ephemeral host port (PublishAllPorts)",
    { FAKE_INSPECT_LINE: "taskdesk_default|true||" },
  ],
  ["host networking", { FAKE_INSPECT_LINE: "host|false||" }],
  [
    "a shared network stack (network_mode: service:<name> inspects as container:<id>)",
    { FAKE_INSPECT_LINE: "container:0123456789ab|false||" },
  ],
  [
    "a live port mapping with no configured binding",
    { FAKE_INSPECT_LINE: "taskdesk_default|false||5173/tcp " },
  ],
  ["no taskdesk container", { FAKE_TASKDESK_IDS: "" }],
  ["an inspect error", { FAKE_INSPECT_RC: "1" }],
  ["unparsable inspect output", { FAKE_INSPECT_LINE: "garbage" }],
  ["a failing container listing", { FAKE_PS_RC: "1" }],
]) {
  test(`production install fails closed on ${label}`, async (t) => {
    const { result, output } = await productionRun(t, env);
    assert.notEqual(result.status, 0);
    assert.match(
      output,
      /not proven unpublished|cannot list the taskdesk containers/,
    );
    assert.doesNotMatch(output, /the API answers/);
  });
}

test("the port check also runs on the created, not yet started, containers", async (t) => {
  const { result, read } = await productionRun(t, {
    FAKE_INSPECT_LINE: "taskdesk_default|false|5173/tcp |",
  });
  assert.notEqual(result.status, 0);
  const dockerLog = await read("docker.log");
  assert.match(dockerLog, / up --no-start$/m);
  assert.doesNotMatch(dockerLog, / up -d --wait$/m);
});

// The pre-start check must exist in every mode that starts taskdesk. The stub reports a
// published port until the application is really started, so deleting the call that
// follows `up --no-start` lets the run succeed and these tests fail.
for (const mode of ["production", "upgrade", "rollback"]) {
  test(`${mode}: a port published at creation is refused before taskdesk is started`, async (t) => {
    const installed = await productionRun(t);
    assert.equal(installed.result.status, 0, installed.output);
    const f = installed.f;
    const args =
      mode === "rollback"
        ? ["rollback", `sha256:${"d".repeat(64)}`, "v1.2.2"]
        : [mode];
    await rm(path.join(f.temp, "docker.log"), { force: true });
    await rm(path.join(f.temp, "docker.log.started"), { force: true });
    const result = spawnSync(
      "bash",
      [path.join(f.path, "scripts/deploy.sh"), ...args],
      {
        cwd: f.path,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${f.bin}:${process.env.PATH}`,
          HOME: f.temp,
          COSIGN_LOG: path.join(f.temp, "cosign.log"),
          FAKE_DOCKER_FULL: "1",
          FAKE_PRODUCTION_HOST: "1",
          FAKE_RAW: RAW_MANIFEST,
          FAKE_PUBLISHED_UNTIL_START: "1",
          FAKE_DOCKER_LOG: path.join(f.temp, "docker.log"),
        },
      },
    );
    const out = `${result.stdout}${result.stderr}`;
    assert.notEqual(result.status, 0, out);
    assert.match(out, /not proven unpublished/);
    const dockerLog = await readFile(path.join(f.temp, "docker.log"), "utf8");
    assert.match(dockerLog, / up --no-start/);
    assert.doesNotMatch(dockerLog, / up -d --wait( taskdesk)?$/m);
  });
}

test("local mode treats traefik's own port binding as ours and ignores compose port's exit code", async (t) => {
  const f = await fixture(t, { realDeployment: true });
  const result = run(
    f,
    ["--env", "local", "--version", "1.2.3", "--dir", f.path, "--yes"],
    {
      FAKE_DOCKER_FULL: "1",
      FAKE_ASSUME_LOCAL_PROXY: "1",
      FAKE_DOCKER_LOG: path.join(f.temp, "docker.log"),
    },
  );
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});

test("deploy.sh requires buildx up front, with a message naming the cause", async () => {
  const source = await readFile(path.join(root, "scripts/deploy.sh"), "utf8");
  assert.match(
    source,
    /docker buildx version[^\n]*\n\s*\|\| die "docker buildx is required/,
  );
});

test("installer requires buildx and installs it only on Ubuntu", async () => {
  const source = await readFile(installer, "utf8");
  assert.match(source, /docker buildx version/);
  const ubuntu = source.match(/Linux:ubuntu\)[^\n]*/)?.[0] ?? "";
  assert.match(
    ubuntu,
    /apt-get install -y docker\.io docker-compose-v2 docker-buildx/,
  );
  const others = source.match(/Linux:debian\|Linux:fedora[^\n]*/)?.[0] ?? "";
  assert.match(others, /die .*Docker's official repository/);
  assert.doesNotMatch(others, /apt-get|dnf install/);
});

test("an existing Docker and Compose without buildx stop with the buildx package names before any persistent writes", async (t) => {
  const f = await fixture(t);
  const result = run(
    f,
    ["--version", "1.2.3", "--dir", f.path],
    { FAKE_BUILDX_MISSING: "1" },
    "y\nn\n",
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /docker-buildx-plugin.*docker-buildx/);
  assert.equal(await stat(f.path).catch(() => null), null);
});

test("release workflow immutability check parses the padded Digest line, not the legacy sed", async () => {
  const workflow = await readFile(
    path.join(root, ".github/workflows/release.yml"),
    "utf8",
  );
  assert.doesNotMatch(workflow, /sed -n 's\/\^Digest: \/\/p'/);
  assert.match(
    workflow,
    /existing_digest="\$\(awk '\/\^Digest:\/ \{ if \(\$1 == "Digest:" && NF == 2\) print \$2; exit \}'/,
  );
});

test("release archive and installer both carry the deploy-checks helper", async () => {
  const workflow = await readFile(
    path.join(root, ".github/workflows/release.yml"),
    "utf8",
  );
  const source = await readFile(installer, "utf8");
  assert.match(workflow, /scripts\/lib\/deploy-checks\.sh \| gzip/);
  const lists = source.match(/^for (required|member) in [^\n]*/gm) ?? [];
  assert.equal(lists.length, 2);
  for (const list of lists)
    assert.match(list, /scripts\/lib\/deploy-checks\.sh/);
});

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

test("production first install and re-run without a files DNS record or S3 profile both succeed", async (t) => {
  const f = await fixture(t, { realDeployment: true });
  const env = {
    FAKE_DOCKER_FULL: "1",
    FAKE_PRODUCTION_HOST: "1",
    FAKE_RAW: RAW_MANIFEST,
    FAKE_DOCKER_LOG: path.join(f.temp, "docker.log"),
    FAKE_DNS_MISSING: "files.example.test",
  };
  const first = run(f, PROD_ARGS(f), env);
  assert.equal(first.status, 0, first.stderr);
  const second = run(f, PROD_ARGS(f), env);
  assert.equal(second.status, 0, second.stderr);
  const rerun = run(
    f,
    ["--env", "production", "--version", "1.2.3", "--dir", f.path, "--yes"],
    env,
  );
  assert.equal(rerun.status, 0, rerun.stderr);
  assert.doesNotMatch(`${rerun.stdout}${rerun.stderr}`, /files\.example\.test/);
});

test("production S3 profile and an explicit --files-host still require the files DNS record", async (t) => {
  const f = await fixture(t, { realDeployment: true });
  const env = {
    FAKE_DOCKER_FULL: "1",
    FAKE_PRODUCTION_HOST: "1",
    FAKE_RAW: RAW_MANIFEST,
    FAKE_DOCKER_LOG: path.join(f.temp, "docker.log"),
    FAKE_DNS_MISSING: "files.example.test files.custom.test",
  };
  const s3 = run(f, [...PROD_ARGS(f), "--profile", "s3"], env);
  assert.notEqual(s3.status, 0);
  assert.match(
    `${s3.stdout}${s3.stderr}`,
    /DNS name files\.example\.test does not resolve/,
  );
  const explicit = run(
    f,
    [...PROD_ARGS(f), "--files-host", "files.custom.test"],
    env,
  );
  assert.notEqual(explicit.status, 0);
  assert.match(
    `${explicit.stdout}${explicit.stderr}`,
    /DNS name files\.custom\.test does not resolve/,
  );
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
