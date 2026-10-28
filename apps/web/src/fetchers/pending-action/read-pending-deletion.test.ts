import { describe, expect, it } from "vitest";
import { readPendingDeletion } from "./read-pending-deletion";

describe("readPendingDeletion", () => {
  it("returns the pending action reference for an accepted request", async () => {
    await expect(
      readPendingDeletion(
        Response.json(
          { pendingActionId: "pa-1", action: "delete" },
          { status: 202 },
        ),
        "failed",
      ),
    ).resolves.toEqual({ pendingActionId: "pa-1" });
  });

  it("never treats a direct 200 as a requested deletion", async () => {
    await expect(
      readPendingDeletion(Response.json({ id: "x" }), "failed"),
    ).rejects.toMatchObject({ status: 200 });
  });

  it.each([{}, { pendingActionId: "" }, { pendingActionId: 1 }])(
    "rejects a malformed accepted response %j",
    async (body) => {
      await expect(
        readPendingDeletion(Response.json(body, { status: 202 }), "failed"),
      ).rejects.toThrow("Missing pending action reference");
    },
  );

  it("preserves the refusal status and message, or the fallback", async () => {
    await expect(
      readPendingDeletion(
        new Response("Workspace not found", { status: 404 }),
        "failed",
      ),
    ).rejects.toMatchObject({ status: 404, message: "Workspace not found" });
    await expect(
      readPendingDeletion(
        new Response("", { status: 502 }),
        "Failed to delete",
      ),
    ).rejects.toMatchObject({ status: 502, message: "Failed to delete" });
  });
});

describe("readPendingDeletion repeat request", () => {
  it("returns the requester's existing pending action for a 409 pending_approval", async () => {
    await expect(
      readPendingDeletion(
        new Response("pending_approval: pa_existing-1", { status: 409 }),
        "failed",
      ),
    ).resolves.toEqual({ pendingActionId: "pa_existing-1" });
    await expect(
      readPendingDeletion(
        Response.json(
          { message: "pending_approval: pa_existing-1" },
          { status: 409 },
        ),
        "failed",
      ),
    ).resolves.toEqual({ pendingActionId: "pa_existing-1" });
  });

  it("keeps other conflicts and malformed references as errors", async () => {
    await expect(
      readPendingDeletion(
        new Response("pending_approval: not an id", { status: 409 }),
        "failed",
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      readPendingDeletion(
        new Response("pending_approval: pa-1", { status: 403 }),
        "failed",
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});
