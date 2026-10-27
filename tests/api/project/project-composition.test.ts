import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compositionWarnings } from "../../../apps/api/src/project/composition";
import {
  projectDetailSchema,
  projectSchema,
} from "../../../apps/api/src/project/response";

const repoRoot = resolve(__dirname, "../../..");

describe("project composition warnings (PR-6, PR-7, PR-10)", () => {
  it("warns about everything on a bare project", () => {
    expect(
      compositionWarnings({ managerId: null, startDate: null, memberCount: 0 }),
    ).toEqual(["PR-6", "PR-7", "PR-10"]);
  });

  it("clears each rule as it is satisfied", () => {
    expect(
      compositionWarnings({
        managerId: "p1",
        startDate: null,
        memberCount: 0,
      }),
    ).toEqual(["PR-7", "PR-10"]);
    expect(
      compositionWarnings({
        managerId: "p1",
        startDate: "2026-01-01",
        memberCount: 0,
      }),
    ).toEqual(["PR-7"]);
    expect(
      compositionWarnings({
        managerId: "p1",
        startDate: "2026-01-01",
        memberCount: 1,
      }),
    ).toEqual([]);
  });

  it("does not require an end date", () => {
    expect(
      compositionWarnings({
        managerId: "p1",
        startDate: "2026-01-01",
        memberCount: 3,
      }),
    ).toEqual([]);
  });
});

describe("GET /project/{id} contract shape", () => {
  it("ProjectDetail is one flat object: every Project field plus compositionWarnings, no allOf", () => {
    const spec = JSON.parse(
      readFileSync(join(repoRoot, "tests/api-contract/openapi.json"), "utf8"),
    ) as {
      components: {
        schemas: Record<
          string,
          { type?: string; allOf?: unknown; required?: string[] }
        >;
      };
    };
    const detail = spec.components.schemas.ProjectDetail;
    expect(detail?.allOf).toBeUndefined();
    expect(detail?.type).toBe("object");
    expect(detail?.required).toEqual(
      expect.arrayContaining([
        ...(spec.components.schemas.Project?.required ?? []),
        "compositionWarnings",
      ]),
    );
    expect(Object.keys(projectDetailSchema.shape)).toEqual([
      ...Object.keys(projectSchema.shape),
      "compositionWarnings",
    ]);
  });
});
