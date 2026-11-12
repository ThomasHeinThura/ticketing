import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  localizedAdminErrorMessage,
  localizedErrorMessage,
} from "@/lib/http-error";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), holidayImport: vi.fn() }));
vi.mock("@taskdesk/libs", () => ({
  apiFetch: mocks.fetch,
  client: {
    "service-calendars": {
      ":id": { holidays: { import: { $post: mocks.holidayImport } } },
    },
  },
}));
vi.mock("@/fetchers/get-api-url", () => ({
  getApiUrl: (path: string) => path,
}));

import {
  createMyApiKey,
  requestDeleteMyApiKey,
  revokeMyApiKey,
} from "./api-keys";
import { importServiceCalendarHolidays } from "./service-calendar";
import {
  createServiceKey,
  requestServiceKeyDeletion,
  revokeServiceKey,
} from "./service-keys";
import {
  listWebhookDeliveries,
  redeliverWebhookDelivery,
  requestWebhookDeletion,
  sendWebhookTestEvent,
  updateWebhook,
} from "./webhook/webhooks";
import {
  createRole,
  reassignRole,
  requestRoleDeletion,
  updateRole,
} from "./workspace-roles";

beforeEach(() => {
  mocks.fetch
    .mockReset()
    .mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ message: "private", requestId: "a".repeat(32) }),
          { status: 500 },
        ),
    );
  mocks.holidayImport
    .mockReset()
    .mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ message: "private", requestId: "a".repeat(32) }),
          { status: 500 },
        ),
    );
});

const cases: Array<[string, () => Promise<unknown>, string]> = [
  [
    "API-key create",
    () => createMyApiKey({ name: "key", expiresIn: null }),
    "settings:apiKey.createDialog.failedCreate",
  ],
  [
    "API-key revoke",
    () => revokeMyApiKey("key"),
    "settings:apiKey.table.toastRevokeError",
  ],
  [
    "role create",
    () => createRole("ws", { role: "role" }),
    "roles:clientErrors.create",
  ],
  [
    "role impact",
    () => updateRole("ws", "role", {}, undefined, { dryRun: true }),
    "roles:clientErrors.previewImpact",
  ],
  ["role save", () => updateRole("ws", "role", {}), "roles:clientErrors.save"],
  [
    "webhook update",
    () => updateWebhook("id", { active: false }),
    "webhooks:clientErrors.update",
  ],
  [
    "webhook test",
    () => sendWebhookTestEvent("id"),
    "webhooks:clientErrors.test",
  ],
  [
    "webhook deletion",
    () => requestWebhookDeletion("id"),
    "settings:serviceKeys.deleteFailed",
  ],
  [
    "holiday import",
    () => importServiceCalendarHolidays({ id: "id", version: 1, ics: "" }),
    "serviceCalendars:clientErrors.importHolidays",
  ],
];

describe("localized administrative failures", () => {
  it.each(cases)(
    "translates the client fallback for %s",
    async (_name, action, key) => {
      const error = await action().catch((cause: unknown) => cause);
      expect(
        localizedErrorMessage(
          error,
          (value) => `localized:${value}`,
          "generic",
        ),
      ).toBe(`localized:${key}`);
      expect(error).toMatchObject({
        status: 500,
        requestId: "a".repeat(32),
        fallbackKey: key,
      });
    },
  );

  it("retains a server refusal and its status for permission handling", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({ error: "rank_guard", message: "Specific refusal" }),
        { status: 403 },
      ),
    );
    const error = await createRole("ws", { role: "role" }).catch(
      (cause: unknown) => cause,
    );
    expect(
      localizedErrorMessage(error, () => "translated fallback", "generic"),
    ).toBe("Specific refusal");
    expect(error).toMatchObject({ status: 403, code: "rank_guard" });
  });
});

const reviewedCases: Array<[string, () => Promise<unknown>, string]> = [
  [
    "service key creation",
    () =>
      createServiceKey(
        "ws",
        { name: "service", expiresIn: null, capabilities: [] },
        "proof",
      ),
    "settings:serviceKeys.create.failed",
  ],
  [
    "service key revocation",
    () => revokeServiceKey("ws", "id"),
    "settings:serviceKeys.toastRevokeError",
  ],
  [
    "service key deletion",
    () => requestServiceKeyDeletion("ws", "id"),
    "settings:serviceKeys.deleteFailed",
  ],
  [
    "personal key deletion",
    () => requestDeleteMyApiKey("id"),
    "settings:apiKey.table.toastDeleteError",
  ],
  [
    "role reassignment",
    () => reassignRole("ws", "id", { toRoleId: "new" }),
    "roles:people.moveFailed",
  ],
  [
    "role deletion",
    () => requestRoleDeletion("ws", "id"),
    "roles:delete.failed",
  ],
  [
    "webhook history",
    () => listWebhookDeliveries("id"),
    "webhooks:deliveries.loadErrorDescription",
  ],
  [
    "webhook redelivery",
    () => redeliverWebhookDelivery("id"),
    "webhooks:deliveries.redeliveryFailed",
  ],
];

describe("round-two admin failure boundaries", () => {
  it.each(reviewedCases)(
    "selects the translated fallback for %s",
    async (_label, request, key) => {
      const error = await request().catch((cause: unknown) => cause);
      expect(error).toMatchObject({
        status: 500,
        requestId: "a".repeat(32),
        fallbackKey: key,
      });
      expect(
        localizedAdminErrorMessage(
          error,
          (value) => `translated:${value}`,
          "generic",
        ),
      ).toBe(`translated:${key}`);
    },
  );

  it("hides raw server errors while preserving status and structured role code", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({ error: "rank_guard", message: "raw refusal" }),
        { status: 403 },
      ),
    );
    const error = await reassignRole("ws", "id", { toRoleId: "new" }).catch(
      (cause: unknown) => cause,
    );
    expect(error).toMatchObject({ status: 403, code: "rank_guard" });
    expect(
      localizedAdminErrorMessage(
        error,
        () => "translated",
        "localized fallback",
      ),
    ).toBe("localized fallback");
  });

  it("still opens the existing pending action on a repeated deletion", async () => {
    mocks.fetch.mockResolvedValue(
      new Response("pending_approval: existing-1", { status: 409 }),
    );
    await expect(requestDeleteMyApiKey("id")).resolves.toEqual({
      pendingActionId: "existing-1",
    });
    mocks.fetch.mockResolvedValue(
      new Response("pending_approval: existing-2", { status: 409 }),
    );
    await expect(requestServiceKeyDeletion("ws", "id")).resolves.toEqual({
      pendingActionId: "existing-2",
    });
    mocks.fetch.mockResolvedValue(
      new Response("pending_approval: existing-3", { status: 409 }),
    );
    await expect(requestRoleDeletion("ws", "id")).resolves.toEqual({
      pendingActionId: "existing-3",
    });
  });
});
