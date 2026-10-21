import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");
function stage(name) {
  return source.split(/(?=^FROM\s)/mu).find(block => new RegExp(`^FROM[^\\n]+ AS ${name}\\s*$`, "mu").test(block));
}

test("CPU-independent builds run natively, while production dependencies and runtime retain target architecture", () => {
  assert.match(stage("base"), /^FROM --platform=\$BUILDPLATFORM \$\{NODE_IMAGE\} AS base/mu);
  assert.match(stage("deps"), /^FROM base AS deps/mu);
  assert.match(stage("build"), /^FROM deps AS build/mu);
  assert.match(stage("build"), /RUN pnpm turbo build/u);
  assert.match(stage("proddeps"), /^FROM \$\{NODE_IMAGE\} AS proddeps/mu);
  assert.match(stage("proddeps"), /pnpm install --prod --frozen-lockfile --no-optional --ignore-scripts/u);
  assert.match(stage("runtime"), /^FROM \$\{NODE_IMAGE\} AS runtime/mu);
  assert.match(stage("runtime"), /COPY --from=proddeps[^\n]+node_modules/u);
  assert.doesNotMatch(stage("runtime"), /COPY --from=(?:base|deps|build)[^\n]+node_modules/u);
});
