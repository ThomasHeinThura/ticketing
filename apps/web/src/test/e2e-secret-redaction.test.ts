import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { redactSecretErrorContext } from "../../e2e/helpers/redact-secret-error-context";

const repoRoot = resolve(__dirname, "../../../..");
const e2eRoots = [
  resolve(repoRoot, "apps/web/e2e"),
  resolve(repoRoot, "tests/e2e"),
];

// UI text that only appears while a spec has an MFA secret on screen: the
// enrollment step shows the TOTP provisioning URI and the backup-code list.
const SECRET_SCREEN_MARKERS = [
  "I saved these codes",
  "Verify and enable",
  "#enrollment-code",
  "otpauth://",
];

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return name === "node_modules" ? [] : tsFiles(path);
    return /\.ts$/u.test(name) && !/\.d\.ts$/u.test(name) ? [path] : [];
  });
}
const isSpec = (path: string) => /\.(spec|bench)\.ts$/u.test(path);
const showsSecret = (path: string) =>
  SECRET_SCREEN_MARKERS.some((marker) =>
    readFileSync(path, "utf8").includes(marker),
  );

// A spec counts as rendering secrets when it contains a marker itself or imports
// a non-spec e2e helper module that does (for example a shared enrollment helper).
function renderingSpecs(): string[] {
  const all = e2eRoots.flatMap(tsFiles);
  const secretHelpers = all
    .filter((path) => !isSpec(path) && showsSecret(path))
    .map((path) => path.replace(/\.ts$/u, "").split("/").pop() as string);
  return all.filter(
    (path) =>
      isSpec(path) &&
      (showsSecret(path) ||
        secretHelpers.some((helper) =>
          new RegExp(`from\\s+"[^"]*/${helper}(\\.ts)?"`, "u").test(
            readFileSync(path, "utf8"),
          ),
        )),
  );
}

describe("end-to-end specs that render MFA secrets", () => {
  const rendering = renderingSpecs();

  it("are found, so the guard is not vacuous", () => {
    expect(rendering.map((path) => relative(repoRoot, path)).sort()).toEqual(
      expect.arrayContaining([
        "apps/web/e2e/instance-users-journey.spec.ts",
        "apps/web/e2e/mfa-csrf-journey.spec.ts",
      ]),
    );
  });

  it.each(rendering.map((path) => [relative(repoRoot, path), path] as const))(
    "%s turns off traces, video and screenshots and redacts the failure snapshot",
    (_name, path) => {
      const source = readFileSync(path, "utf8");
      expect(source).toMatch(
        /test\.use\(\{\s*trace:\s*"off",\s*video:\s*"off",\s*screenshot:\s*"off"\s*\}\)/u,
      );
      expect(source).toMatch(
        /test\.afterEach\([^)]*testInfo\)\s*=>\s*\{\s*redactSecretErrorContext\(testInfo\);/u,
      );
    },
  );
});

describe("redactSecretErrorContext", () => {
  it("replaces every error snapshot, including nested causes", () => {
    const secret = "otpauth://totp/x?secret=ABC and backup code abcd-efgh";
    const errors = [
      { errorContext: secret, cause: { errorContext: secret } },
      { errorContext: secret },
    ];
    redactSecretErrorContext({ errors } as never);
    const serialized = JSON.stringify(errors);
    expect(serialized).not.toContain("otpauth://");
    expect(serialized).not.toContain("abcd-efgh");
    expect(errors[0]?.cause?.errorContext).toMatch(/omitted/u);
  });
});
