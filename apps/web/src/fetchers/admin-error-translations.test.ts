import { beforeEach, describe, expect, it, vi } from "vitest";
import { localizedErrorMessage } from "@/lib/http-error";

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

import { createMyApiKey, revokeMyApiKey } from "./api-keys";
import { importServiceCalendarHolidays } from "./service-calendar";
import {
  requestWebhookDeletion,
  sendWebhookTestEvent,
  updateWebhook,
} from "./webhook/webhooks";
import { createRole, updateRole } from "./workspace-roles";

beforeEach(() => {
  mocks.fetch
    .mockReset()
    .mockImplementation(async () => new Response("", { status: 500 }));
  mocks.holidayImport
    .mockReset()
    .mockImplementation(async () => new Response("", { status: 500 }));
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
      expect(error).toHaveProperty("status", 500);
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
