import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { describe, expect, it } from "vitest";

/**
 * Production-module-graph proof for issue #8 Slice 0: "the production module graph is
 * tested for this, not only a test-side import."
 *
 * `apps/api/package.json`'s `build` script is the one that actually produces the artifact
 * this repository ships (`docs/05-operations/container-image.md`'s Dockerfile runs it). This
 * test parses that script's own command line -- rather than hand-copying its flags into a
 * second, driftable esbuild config -- and re-runs the exact same esbuild invocation
 * in-process with `metafile: true`, then asserts `apps/api/src/policy-registry.ts` is one of
 * the real bundle's inputs. If a future edit changes the build script's flags, this test
 * picks the change up automatically instead of silently testing a stale copy.
 *
 * A mutation check (making the `index.ts` reference to `policy-registry` type-only, so
 * esbuild's tree-shaking drops the module entirely) must make this test fail; see the PR
 * description for that result.
 */

const apiRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../apps/api",
);

/**
 * Splits `apps/api/package.json`'s `scripts.build` command line into esbuild's JS-API
 * options -- entry points, and every `--flag` / `--flag=value` / `--external:x` argument the
 * script actually passes -- without hand-maintaining a second list of flags. Deliberately
 * narrow: it only understands the option shapes this one build script currently uses, and
 * throws on anything else so a genuinely new flag shape gets a human's attention here rather
 * than being silently ignored.
 */
function parseEsbuildBuildScript(command: string): {
  entryPoints: string[];
  options: esbuild.BuildOptions;
} {
  const tokens = command.trim().split(/\s+/);
  if (tokens[0] !== "esbuild") {
    throw new Error(
      `expected the build script to start with "esbuild", got: ${command}`,
    );
  }

  const entryPoints: string[] = [];
  const external: string[] = [];
  const options: esbuild.BuildOptions = {};

  for (const token of tokens.slice(1)) {
    if (!token.startsWith("--")) {
      entryPoints.push(token);
      continue;
    }
    if (token === "--bundle") {
      options.bundle = true;
    } else if (token === "--packages=external") {
      options.packages = "external";
    } else if (token.startsWith("--platform=")) {
      options.platform = token.slice("--platform=".length) as esbuild.Platform;
    } else if (token.startsWith("--format=")) {
      options.format = token.slice("--format=".length) as esbuild.Format;
    } else if (token.startsWith("--outdir=")) {
      // Intentionally not applied to the test's own esbuild call -- see below.
    } else if (token.startsWith("--external:")) {
      external.push(token.slice("--external:".length));
    } else {
      throw new Error(
        `production-bundle.test.ts's parser does not understand build-script flag "${token}" -- ` +
          "update the parser (not a hardcoded flag list) so this test keeps exercising the real script",
      );
    }
  }

  if (external.length > 0) {
    options.external = external;
  }
  if (entryPoints.length === 0) {
    throw new Error(`no entry point found in build script: ${command}`);
  }

  return { entryPoints, options };
}

function readBuildScript(): string {
  const packageJson = JSON.parse(
    readFileSync(join(apiRoot, "package.json"), "utf-8"),
  ) as { scripts?: Record<string, string> };
  const script = packageJson.scripts?.build;
  if (!script) {
    throw new Error("apps/api/package.json has no scripts.build to parse");
  }
  return script;
}

describe("production bundle (real esbuild build script)", () => {
  it("includes apps/api/src/policy-registry.ts among the bundle's real inputs", async () => {
    const { entryPoints, options } = parseEsbuildBuildScript(readBuildScript());

    const result = await esbuild.build({
      ...options,
      entryPoints,
      absWorkingDir: apiRoot,
      metafile: true,
      // Same bundling/resolution behaviour as the real `build` script; only the output
      // destination differs, so this test never touches the real `dist/` artifact.
      write: false,
      outdir: "dist-test-metafile-only",
    });

    expect(result.metafile).toBeDefined();

    const inputs = Object.keys(result.metafile?.inputs ?? {}).map((path) =>
      // esbuild reports inputs relative to `absWorkingDir`; normalise to a
      // repo-relative path for a readable, unambiguous assertion.
      join("apps/api", path).replaceAll("\\", "/"),
    );

    expect(inputs).toContain("apps/api/src/policy-registry.ts");
  });
});
