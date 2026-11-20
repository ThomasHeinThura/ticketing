import { describe, expect, it, vi } from "vitest";
import audit from "../../../apps/api/src/audit";
import { settingsHistoryResponseSchema } from "../../../apps/api/src/audit/response";
import { apiRouter } from "../../../apps/api/src/openapi";

const readSettingsHistory = vi.hoisted(() => vi.fn());
vi.mock("../../../apps/api/src/audit/settings-history", () => ({
  settingsHistoryScope: async (_c: unknown, next: () => Promise<void>) =>
    next(),
  readSettingsHistory,
}));

describe("GET /audit response", () => {
  const app = apiRouter().route("/api", audit);
  it("serves staff attribution from the newest projected row", async () => {
    readSettingsHistory.mockResolvedValueOnce({
      entityType: "workspace",
      entityId: "workspace-1",
      rows: [
        {
          at: "2026-11-16T10:00:00Z",
          actor: { kind: "person", name: "Ada" },
          action: "workspace.settings_updated",
          changedFields: ["name"],
        },
      ],
    });
    const response = await app.request(
      "http://localhost/api/audit?entity_type=workspace&entity_id=workspace-1",
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(settingsHistoryResponseSchema.safeParse(body).success).toBe(true);
    expect(body.lastChanged).toEqual({
      actor: { kind: "person", name: "Ada" },
      at: "2026-11-16T10:00:00Z",
    });
  });

  it("returns null attribution when no entity rows exist", async () => {
    readSettingsHistory.mockResolvedValueOnce({
      entityType: "workspace",
      entityId: "workspace-1",
      rows: [],
    });
    const response = await app.request(
      "http://localhost/api/audit?entity_type=workspace&entity_id=workspace-1",
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(settingsHistoryResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({
      entityType: "workspace",
      entityId: "workspace-1",
      lastChanged: null,
      rows: [],
    });
  });

  it("serves the closed P1 shape with no-store and newest attribution", async () => {
    readSettingsHistory.mockResolvedValueOnce({
      entityType: "hourly_rate",
      entityId: "rate-1",
      rows: [
        {
          at: "2026-11-17T10:00:00Z",
          actor: { kind: "person", name: "Ada" },
          action: "hourly_rate.created",
          changedFields: ["rateSet"],
        },
      ],
    });
    const response = await app.request(
      "http://localhost/api/audit?entity_type=hourly_rate&entity_id=rate-1",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json();
    expect(settingsHistoryResponseSchema.safeParse(body).success).toBe(true);
    expect(body.lastChanged).toEqual({
      at: "2026-11-17T10:00:00Z",
      actor: { kind: "person", name: "Ada" },
    });
  });

  it("serves P2 row IDs through the same closed staff response", async () => {
    readSettingsHistory.mockResolvedValueOnce({
      entityType: "project_membership",
      entityId: "membership-row-1",
      rows: [
        {
          at: "2026-11-17T10:00:00Z",
          actor: { kind: "person", name: "Ada" },
          action: "membership.changed",
          changedFields: ["role"],
        },
      ],
    });
    const response = await app.request(
      "http://localhost/api/audit?entity_type=project_membership&entity_id=membership-row-1",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json();
    expect(settingsHistoryResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({
      entityType: "project_membership",
      entityId: "membership-row-1",
      rows: [{ changedFields: ["role"] }],
    });
    expect(body.rows[0]).not.toHaveProperty("auditId");
  });

  it("serves P3 action-time metadata with no-store and no raw audit payload", async () => {
    readSettingsHistory.mockResolvedValueOnce({
      entityType: "instance_storage_draft",
      entityId: "storage-row-1",
      rows: [
        {
          at: "2026-11-17T10:00:00Z",
          actor: { kind: "person", name: "Admin" },
          action: "plugin.changed",
          changedFields: [],
        },
      ],
    });
    const response = await app.request(
      "http://localhost/api/audit?entity_type=instance_storage_draft&entity_id=storage-row-1",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json();
    expect(settingsHistoryResponseSchema.safeParse(body).success).toBe(true);
    expect(body.rows).toEqual([
      {
        at: "2026-11-17T10:00:00Z",
        actor: { kind: "person", name: "Admin" },
        action: "plugin.changed",
        changedFields: [],
      },
    ]);
    expect(body.rows[0]).not.toHaveProperty("after");
  });
});
