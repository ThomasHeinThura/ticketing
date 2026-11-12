// Deployment only runs the current clean-install demo after an explicit --seed.
// The historical SIT password/session reset utility must never be invoked here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const script = readFileSync(path.join(root, "scripts/deploy.sh"), "utf8");

test("the seeder is off by default and enabled only by --seed", () => {
  assert.match(script, /^SEED=0$/m);
  assert.match(script, /--seed\) SEED=1; shift ;;/);
});

test("seed_if_permitted returns before touching the container unless --seed is set", () => {
  const body = script.slice(script.indexOf("seed_if_permitted() ("));
  const guard = body.indexOf('if [ "$SEED" -ne 1 ]; then');
  const exec = body.indexOf("seed-uat");
  assert.ok(guard > 0, "guard is missing");
  assert.ok(exec > guard, "the seeder call must come after the guard");
  assert.match(
    body.slice(guard, exec),
    /return 0/,
    "the guard must return before the seeder runs",
  );
});

test("the opt-in uses the current demo and reuses its private credentials", () => {
  assert.match(
    script,
    /node apps\/api\/dist\/seed-uat\.js --uat --credentials-file/,
  );
  assert.doesNotMatch(script, /node apps\/api\/dist\/seed-sit-users/);
  assert.match(script, /umask 077; cat > "\$1"/);
  assert.match(script, /< "\$credentials"/);
});

test("a failed seed recovers private credentials, cleans plaintext, and permits retry", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, mkdirSync, writeFileSync, statSync, rmSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const directory = mkdtempSync(path.join(tmpdir(), "deploy-demo-failure-"));
  try {
    mkdirSync(path.join(directory, "container"));
    const functionBody = script.slice(
      script.indexOf("seed_if_permitted() ("),
      script.indexOf("\nprint_urls()"),
    );
    const mock = `set -Eeuo pipefail
MODE=local
SEED=1
say() { :; }
ok() { :; }
warn() { :; }
die() { exit 1; }
dc() {
  shift 3
  case "$1" in
    node) printf '%s' 'private fixture' > "$HOME/container/credentials"; return 1 ;;
    test) test -f "$HOME/container/credentials" ;;
    cat) cat "$HOME/container/credentials" ;;
    rm) rm -f "$HOME/container/credentials" ;;
    sh) cat > "$HOME/container/credentials" ;;
    *) return 2 ;;
  esac
}
${functionBody}
seed_if_permitted
`;
    const filename = path.join(directory, "test.sh");
    writeFileSync(filename, mock);
    for (let run = 0; run < 2; run++) {
      assert.throws(() =>
        execFileSync("bash", [filename], {
          env: { ...process.env, HOME: directory },
          stdio: "pipe",
        }),
      );
      const credentials = path.join(
        directory,
        ".taskdesk/demo-credentials.json",
      );
      assert.equal(readFileSync(credentials, "utf8"), "private fixture");
      assert.equal(statSync(credentials).mode & 0o777, 0o600);
      assert.throws(() =>
        statSync(path.join(directory, "container/credentials")),
      );
      // Retry also tightens a previously loose host file.
      const { chmodSync } = await import("node:fs");
      chmodSync(credentials, 0o644);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
