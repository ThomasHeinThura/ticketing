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

// The real-backend fixture signs users up with generated passwords. Playwright's
// failure context prints form VALUES, so any spec using it can publish them.
const REAL_BACKEND_FIXTURE = "mfa-csrf-app-fixture";

// A password field filled from a variable (a generated or fixture credential).
// The statement must name the password before `.fill(` and pass a non-literal
// argument, so mocked specs that only render a password input, or fill a
// hard-coded placeholder string, are not flagged.
const PASSWORD_FILL = /password[^;]*?\.fill\(\s*[A-Za-z_$]/iu;

const stem = (path: string) =>
  path.replace(/\.ts$/u, "").split("/").pop() as string;
const importsModule = (source: string, name: string) =>
  new RegExp(`from\\s+"[^"]*/${name}(\\.ts)?"`, "u").test(source);

const rendersSecret = (source: string) =>
  SECRET_SCREEN_MARKERS.some((marker) => source.includes(marker)) ||
  PASSWORD_FILL.test(source) ||
  importsModule(source, REAL_BACKEND_FIXTURE);

// A spec counts as rendering secrets when it does itself (an MFA marker, a
// password fill, or an import of the real-backend fixture) or imports a non-spec
// e2e helper that does, directly or through other helpers.
function renderingSpecs(): string[] {
  const all = e2eRoots.flatMap(tsFiles);
  const sources = new Map(
    all.map((path) => [path, readFileSync(path, "utf8")]),
  );
  const secretHelpers = new Set<string>([REAL_BACKEND_FIXTURE]);
  const usesSecret = (source: string) =>
    rendersSecret(source) ||
    [...secretHelpers].some((helper) => importsModule(source, helper));
  for (let grew = true; grew; ) {
    grew = false;
    for (const path of all) {
      if (isSpec(path) || secretHelpers.has(stem(path))) continue;
      if (usesSecret(sources.get(path) as string)) {
        secretHelpers.add(stem(path));
        grew = true;
      }
    }
  }
  return all.filter(
    (path) => isSpec(path) && usesSecret(sources.get(path) as string),
  );
}

describe("end-to-end specs that render secrets (MFA codes or passwords)", () => {
  const rendering = renderingSpecs();

  it("are found, so the guard is not vacuous", () => {
    expect(rendering.map((path) => relative(repoRoot, path)).sort()).toEqual(
      expect.arrayContaining([
        "apps/web/e2e/instance-users-journey.spec.ts",
        "apps/web/e2e/mfa-csrf-journey.spec.ts",
        "apps/web/e2e/realtime.spec.ts",
        "apps/web/e2e/work-item-comments-journey.spec.ts",
        "tests/e2e/approvals-primary-journey.spec.ts",
        "tests/e2e/approver-email-not-leaked.spec.ts",
        "tests/e2e/customer-cannot-request-cab.spec.ts",
        "tests/e2e/intake-primary-journey.spec.ts",
        "tests/e2e/requester-cannot-self-approve.spec.ts",
        "tests/e2e/service-operations-primary-journey.spec.ts",
        "tests/e2e/users-primary-journey.spec.ts",
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
