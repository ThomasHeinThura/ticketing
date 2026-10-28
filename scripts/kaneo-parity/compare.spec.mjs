import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { expectedCaptures, validatePair } from "./manifest.mjs";

const { test, expect } = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
)("@playwright/test");
let candidateDirectory;
test.beforeAll(() => {
  const metadata = test.info().project.metadata;
  validatePair(metadata.upstreamDirectory, metadata.candidateDirectory);
  candidateDirectory = metadata.candidateDirectory;
});
for (const capture of expectedCaptures()) {
  test(capture.file, () => {
    expect(
      readFileSync(path.join(candidateDirectory, capture.file)),
    ).toMatchSnapshot([capture.file], { threshold: 0, maxDiffPixels: 0 });
  });
}
