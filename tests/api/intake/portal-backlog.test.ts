import { describe, expect, it } from "vitest";
import { decodePortalBacklogCursor } from "../../../apps/api/src/intake/portal-backlog";

describe("portal backlog cursor", () => {
  it("accepts a correctly scoped concrete-state position cursor", () => {
    const scope = "portal-backlog:org-a:person-a:50";
    const cursor = Buffer.from(
      JSON.stringify({
        v: 1,
        scope,
        projectId: "project-a",
        statePosition: 0,
        stateId: "state-backlog-a",
        position: "12.5000000000",
        id: "item-a",
      }),
    ).toString("base64url");
    expect(decodePortalBacklogCursor(cursor, scope)).toMatchObject({
      scope,
      projectId: "project-a",
      stateId: "state-backlog-a",
      position: "12.5000000000",
    });
  });

  it("rejects another caller's cursor and malformed tuple values", () => {
    const scope = "portal-backlog:org-a:person-a:50";
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    expect(() =>
      decodePortalBacklogCursor(
        encode({
          v: 1,
          scope: "portal-backlog:org-b:person-b:50",
          projectId: "project-a",
          statePosition: 0,
          stateId: "state-a",
          position: "1",
          id: "item-a",
        }),
        scope,
      ),
    ).toThrow("Invalid backlog cursor");
    expect(() =>
      decodePortalBacklogCursor(
        encode({
          v: 1,
          scope,
          projectId: "project-a",
          statePosition: 0,
          stateId: "state-a",
          position: "NaN",
          id: "item-a",
        }),
        scope,
      ),
    ).toThrow("Invalid backlog cursor");
    expect(() => decodePortalBacklogCursor("x".repeat(2049), scope)).toThrow(
      "Invalid backlog cursor",
    );
  });
});
