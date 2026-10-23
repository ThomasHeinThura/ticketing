import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { updateCommentBody } from "../../apps/api/src/work-item/comment-schema";

const repoRoot = resolve(__dirname, "../..");

describe("CA-4 comment visibility cannot change after posting", () => {
  it("the PATCH body schema has no visibility field, so a supplied one is stripped, not applied", () => {
    const parsed = updateCommentBody.parse({
      body: { type: "doc", content: [] },
      visibility: "public",
    });
    expect(Object.keys(parsed)).toEqual(["body"]);
    expect("visibility" in parsed).toBe(false);
  });

  it("a visibility-only PATCH degrades to the write-free no-op, never a visibility change", () => {
    expect(updateCommentBody.parse({ visibility: "public" })).toEqual({});
  });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe("CA-10 activity is never edited or deleted", () => {
  it("the published API exposes only GET for the work-item activity feed", () => {
    const spec = JSON.parse(
      readFileSync(join(repoRoot, "tests/api-contract/openapi.json"), "utf8"),
    ) as { paths: Record<string, Record<string, unknown>> };
    const workItemActivityPaths = Object.keys(spec.paths).filter(
      (path) => path.startsWith("/work-items/") && path.includes("/activity"),
    );
    expect(workItemActivityPaths.length).toBeGreaterThan(0);
    for (const path of workItemActivityPaths) {
      const methods = Object.keys(spec.paths[path] ?? {}).filter((key) =>
        ["get", "put", "post", "patch", "delete"].includes(key),
      );
      expect(methods, path).toEqual(["get"]);
    }
  });

  it("no API source updates or deletes rows of the activity table", () => {
    const writes = sourceFiles(join(repoRoot, "apps/api/src")).filter((file) =>
      /\.(update|delete)\(\s*(schema\.)?activityTable\b/.test(
        readFileSync(file, "utf8"),
      ),
    );
    expect(writes).toEqual([]);
  });
});
