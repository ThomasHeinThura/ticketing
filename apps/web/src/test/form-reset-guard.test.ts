import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Issue #697. The app builds with the React Compiler, which memoises
// `form.register()` props. react-hook-form's reset(values) then discards the
// field refs and the registered inputs stay blank after values load post-mount
// (found in #696). Forms driven by <Controller>/<FormField> hold their value in
// React state and are not affected (proved by e2e/settings-forms-direct-load).
//
// So: `register()` is only allowed where every reset passes keepFieldsRef.
// A new register() form must be added to this allowlist deliberately, after its
// reset(values, { keepFieldsRef: true }) calls and a direct-load browser test.

const srcRoot = path.resolve(__dirname, "..");

// register() consumer file -> file that owns that form's reset() calls.
const REGISTER_FORMS: Record<string, string> = {
  "components/service-calendar/calendar-details-card.tsx":
    "hooks/use-service-calendar-editor.ts",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [full]
      : [];
  });
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function resetCallsWithValues(source: string): string[] {
  const calls: string[] = [];
  const pattern = /\.reset\(/g;
  for (const match of source.matchAll(pattern)) {
    const start = match.index + match[0].length;
    let depth = 1;
    let end = start;
    while (end < source.length && depth > 0) {
      const char = source[end];
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      end += 1;
    }
    const args = source.slice(start, end - 1).trim();
    if (args) calls.push(args);
  }
  return calls;
}

describe("react-hook-form reset under the React Compiler", () => {
  it("only lets allowlisted forms use register()", () => {
    const registerUsers = sourceFiles(srcRoot)
      .filter((file) =>
        /\.register\(/.test(stripComments(readFileSync(file, "utf8"))),
      )
      .map((file) => path.relative(srcRoot, file).split(path.sep).join("/"));
    expect(registerUsers.sort()).toEqual(Object.keys(REGISTER_FORMS).sort());
  });

  it("keeps field refs on every reset(values) of a register() form", () => {
    for (const resetFile of new Set(Object.values(REGISTER_FORMS))) {
      const calls = resetCallsWithValues(
        stripComments(readFileSync(path.join(srcRoot, resetFile), "utf8")),
      );
      expect(calls.length).toBeGreaterThan(0);
      for (const args of calls) {
        expect(args, `${resetFile}: reset(${args})`).toMatch(
          /keepFieldsRef|RESET_KEEP_FIELD_REFS/,
        );
      }
    }
  });
});
