import { describe, expect, it } from "vitest";
import { buildFullTaskUpdateBody } from "./task-helpers.js";

describe("buildFullTaskUpdateBody", () => {
  it("merges patch onto existing task", () => {
    // Arrange
    const original = {
      title: "T",
      description: "D",
      status: "open",
      priority: "low",
      projectId: "p1",
      position: 1,
      userId: "u1",
      version: 2,
    };
    const patch = { status: "done" as const };

    // Act
    const body = buildFullTaskUpdateBody(original, patch);

    // Assert
    expect(body.status).toBe("done");
    expect(body.title).toBe("T");
    expect(body.position).toBe(1);
    expect(body.version).toBe(2);
  });
});

describe("full task update version", () => {
  it("requires the version from the task snapshot used for a full PUT", () => {
    expect(() =>
      buildFullTaskUpdateBody(
        {
          title: "T",
          status: "open",
          priority: "low",
          projectId: "p1",
          position: 1,
        },
        {},
      ),
    ).toThrow("missing integer `version`");
  });
});
