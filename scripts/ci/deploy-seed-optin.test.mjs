// scripts/deploy.sh must never re-run the SIT account seeder on its own: the seeder resets
// passwords, turns off two-factor and deletes sessions. It runs only with --seed.
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
  const exec = body.indexOf("seed-sit-users");
  assert.ok(guard > 0, "guard is missing");
  assert.ok(exec > guard, "the seeder call must come after the guard");
  assert.match(
    body.slice(guard, exec),
    /return 0/,
    "the guard must return before the seeder runs",
  );
});
