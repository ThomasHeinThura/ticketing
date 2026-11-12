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
  const body = script.slice(script.indexOf("seed_if_permitted() {"));
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
