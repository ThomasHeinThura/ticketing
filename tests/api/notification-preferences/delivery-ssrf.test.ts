/**
 * Legacy notification senders must use the guarded webhook transport, reject production
 * private targets even when the old override is set, and preserve their provider request shape.
 * The local receiver exercises the real transport only under exact development mode.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { deliverNotification } from "../../../apps/api/src/notification-preferences/delivery";
import { assertPublicWebhookDestination } from "../../../apps/api/src/utils/assert-public-destination";

const notification = {
  id: "notif-1",
  userId: "user-1",
  type: "task.assigned",
  title: "A task",
  content: "was assigned to you",
  eventData: null,
  // A workspace-scoped notification: resolveNotificationContext takes the simple
  // select().from().where().limit() path for it, rather than the three-table join
  // the task path needs. Fewer fixture moving parts between here and the sender.
  resourceId: "ws-1",
  resourceType: "workspace",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

let selectCall = 0;

/** Swapped per test so one fixture can drive each sender in turn. */
let preference: Record<string, unknown> = {};

const rule = {
  userId: "user-1",
  workspaceId: "ws-1",
  isActive: true,
  projectMode: "all",
  selectedProjects: [],
  emailEnabled: false,
  ntfyEnabled: true,
  gotifyEnabled: true,
  webhookEnabled: true,
};

vi.mock("../../../apps/api/src/database", async () => {
  // The delivery path now uses the shared workspace-reach SQL predicate; provide
  // real Drizzle table metadata so the test reaches each sender instead of failing
  // while constructing the query it is meant to exercise.
  const schema = await import("../../../apps/api/src/database/schema");
  return {
    default: {
      query: {
        notificationTable: { findFirst: async () => notification },
        userNotificationPreferenceTable: { findFirst: async () => preference },
        userNotificationWorkspaceRuleTable: { findFirst: async () => rule },
        taskTable: { findFirst: async () => null },
      },
      // Two select() chains run per delivery, in order: the workspace context, then
      // the user row. Answering by call order keeps the fixture honest about which
      // query is which instead of returning one shape to both.
      select: () => {
        selectCall += 1;
        const rows =
          selectCall === 1
            ? [{ workspaceId: "ws-1", workspaceName: "Acme" }]
            : [{ email: "u@example.com", name: "U", locale: "en" }];
        const chain = {
          from: () => chain,
          innerJoin: () => chain,
          where: () => chain,
          limit: async () => rows,
        };
        return chain;
      },
    },
    schema,
  };
});

// The secrets module reaches for TASKDESK_ENCRYPTION_KEY; these tests care about
// destinations, not envelopes, so decryption is the identity function here.
vi.mock("../../../apps/api/src/notification-preferences/secrets", () => ({
  decryptSecret: (value: string | null) => value,
  encryptSecret: (value: string | null) => value,
}));

// resolveNotificationContext needs a resolvable task; short-circuit to a fixed one.
vi.mock("../../../apps/api/src/notification-preferences/context", () => ({}));

describe("SSRF regression guard — notification delivery (H10/H12)", () => {
  let server: http.Server;
  let base = "";
  let connectionCount = 0;
  const seen: Array<{
    method: string | undefined;
    url: string | undefined;
    headers: http.IncomingHttpHeaders;
    body: string;
  }> = [];
  let originalNodeEnv: string | undefined;
  let originalPrivateOverride: string | undefined;

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        seen.push({
          method: request.method,
          url: request.url,
          headers: request.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
        if (request.url === "/redirect") {
          response.statusCode = 302;
          response.setHeader("Location", `${base}/redirected`);
          response.end();
        } else if (request.url?.startsWith("/error/message?token=")) {
          response.statusCode = 503;
          response.end("provider echoed gotify-token");
        } else {
          response.statusCode = 204;
          response.end();
        }
      });
    });
    server.on("connection", () => {
      connectionCount += 1;
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    originalPrivateOverride =
      process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;
    process.env.NODE_ENV = "production";
    delete process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;
    preference = {};
    selectCall = 0;
    seen.length = 0;
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalPrivateOverride === undefined)
      delete process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;
    else
      process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS =
        originalPrivateOverride;
  });

  describe.each([
    {
      sender: "ntfy",
      pref: (url: string) => ({
        ntfyEnabled: true,
        ntfyServerUrl: url,
        ntfyTopic: "t",
        ntfyToken: null,
      }),
    },
    {
      sender: "gotify",
      pref: (url: string) => ({
        gotifyEnabled: true,
        gotifyServerUrl: url,
        gotifyToken: "tok",
      }),
    },
    {
      sender: "webhook",
      pref: (url: string) => ({ webhookEnabled: true, webhookUrl: url }),
    },
  ])("$sender", ({ pref }) => {
    it.each(["true", "1"])(
      "refuses a private destination in production even with legacy override %s",
      async (override) => {
        const connectionsBefore = connectionCount;
        process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS = override;
        preference = {
          emailEnabled: false,
          ...pref(base.replace("http:", "https:")),
        };

        await deliverNotification("notif-1");

        expect(seen).toHaveLength(0);
        expect(connectionCount).toBe(connectionsBefore);
      },
    );
  });

  it("refuses plain HTTP in production even with the legacy override", async () => {
    const connectionsBefore = connectionCount;
    process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS = "true";
    preference = {
      emailEnabled: false,
      webhookEnabled: true,
      webhookUrl: `${base}/notify`,
      webhookSecret: null,
    };

    await deliverNotification("notif-1");

    expect(seen).toHaveLength(0);
    expect(connectionCount).toBe(connectionsBefore);
  });

  it("redacts a Gotify token echoed by the provider before error logging", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.NODE_ENV = "development";
    process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS = "true";
    preference = {
      emailEnabled: false,
      gotifyEnabled: true,
      gotifyServerUrl: `${base}/error`,
      gotifyToken: "gotify-token",
      ntfyEnabled: false,
      webhookEnabled: false,
    };

    await deliverNotification("notif-1");

    const logged = errorSpy.mock.calls
      .map((call) => {
        const details = call[1] as { error?: unknown } | undefined;
        return details?.error instanceof Error
          ? details.error.message
          : String(details?.error ?? "");
      })
      .join(" ");
    expect(logged).toContain("[redacted]");
    expect(logged).not.toContain("gotify-token");
    errorSpy.mockRestore();
  });

  it("rejects URL credentials before resolving or connecting", async () => {
    const connectionsBefore = connectionCount;
    const credentialedUrl = base.replace("http://", "https://user:password@");

    await expect(
      assertPublicWebhookDestination(credentialedUrl),
    ).rejects.toThrow("URL must not contain credentials");
    expect(connectionCount).toBe(connectionsBefore);
  });

  it("delivers all three POST payloads to a local receiver only in development", async () => {
    process.env.NODE_ENV = "development";
    process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS = "true";
    preference = {
      emailEnabled: false,
      ntfyEnabled: true,
      ntfyServerUrl: base,
      ntfyTopic: "topic",
      ntfyToken: "ntfy-token",
      gotifyEnabled: true,
      gotifyServerUrl: base,
      gotifyToken: "gotify-token",
      webhookEnabled: true,
      webhookUrl: `${base}/notify`,
      webhookSecret: "test-secret",
    };

    await deliverNotification("notif-1");

    expect(seen).toHaveLength(3);
    expect(seen.every((request) => request.method === "POST")).toBe(true);
    const ntfy = seen.find((request) => request.url === "/topic");
    expect(ntfy?.headers.authorization).toBe("Bearer ntfy-token");
    expect(ntfy?.headers.title).toBe("A task");
    expect(ntfy?.body).toBe("was assigned to you");
    const gotify = seen.find(
      (request) => request.url === "/message?token=gotify-token",
    );
    expect(JSON.parse(gotify?.body ?? "{}")).toMatchObject({
      title: "A task",
      message: "was assigned to you",
      priority: 5,
    });
    const webhook = seen.find((request) => request.url === "/notify");
    expect(webhook?.headers["x-taskdesk-signature"]).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(webhook?.body ?? "{}")).toMatchObject({
      notification: { id: "notif-1", type: "task.assigned" },
      workspace: { id: "ws-1", name: "Acme" },
    });
  });

  it("does not follow notification webhook redirects", async () => {
    process.env.NODE_ENV = "development";
    process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS = "true";
    preference = {
      emailEnabled: false,
      webhookEnabled: true,
      webhookUrl: `${base}/redirect`,
      webhookSecret: null,
    };

    await deliverNotification("notif-1");

    expect(seen.map((request) => request.url)).toEqual(["/redirect"]);
  });
});
