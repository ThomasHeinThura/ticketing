import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

// EV-1 / NO-8 source guard (DB-free). The behavioural proof (notification row exists after
// create, none after rollback) is in tests/api-integration/workspace-write-create-*.test.ts.
describe("workspace.created notification is transactional", () => {
  const controller = read(
    "../../apps/api/src/workspace/controllers/create-workspace.ts",
  );

  it("fans the owner notification out inside the creation transaction", () => {
    expect(controller).toContain("enqueueNotificationEvent(tx");
    expect(controller).toContain("resolveWorkspaceCreatedRecipient");
    // The fan-out call sits inside the db.transaction callback, before it returns.
    const txStart = controller.indexOf("db.transaction(");
    const fanout = controller.indexOf("enqueueNotificationEvent(tx");
    const txReturn = controller.indexOf("return { workspace, team }");
    expect(txStart).toBeGreaterThan(-1);
    expect(fanout).toBeGreaterThan(txStart);
    expect(fanout).toBeLessThan(txReturn);
  });

  it("has no fire-and-forget publish and no legacy subscriber for this kind", () => {
    expect(controller).not.toMatch(/publishEvent\(/);
    const notificationIndex = read("../../apps/api/src/notification/index.ts");
    expect(notificationIndex).not.toMatch(
      /subscribeToEvent<[^>]*>\(\s*"workspace\.created"/s,
    );
    expect(notificationIndex).not.toContain('"workspace.created", async');
  });
});
