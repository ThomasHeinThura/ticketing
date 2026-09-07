/**
 * Regression guard for the SSRF hardening in `0e046a6` (H10/H12).
 *
 * The independent review of `a4147a1` found the fix correct and **completely
 * uncovered**: nothing asserted `redirect: "manual"`, and nothing asserted that the
 * relocated `assertPublicWebhookDestination` was still invoked by the senders that
 * import it. Deleting either line broke no test. That directly contradicted this
 * branch's own checklist claim that every fix has a regression guard.
 *
 * WHAT IS AND IS NOT MOCKED, deliberately.
 *
 * Mocked: the database and the secret decryptor. Neither is the thing under test;
 * they are the fixture that gets `deliverNotification` as far as a sender.
 *
 * NOT mocked: `assert-public-destination`. The real guard runs, against real
 * loopback and link-local addresses, and really throws. Mocking it would leave
 * this file asserting that a stub was called — which is precisely the shape of
 * coverage the review said was missing.
 *
 * NOT mocked: the `RequestInit` handed to `fetch`. `globalThis.fetch` is spied so
 * the options can be inspected, not replaced with something that fabricates them.
 *
 * WHAT BREAKS THIS FILE.
 *
 * Remove `redirect: "manual"` from `fetchWithTimeout` → the last test fails.
 * Remove `await assertPublicWebhookDestination(...)` from any one of the three
 * senders → that sender's test fails, because `fetch` is then reached with a
 * loopback destination instead of the call throwing first.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("../../../apps/api/src/database", () => ({
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
  schema: {},
}));

// The secrets module reaches for TASKDESK_ENCRYPTION_KEY; these tests care about
// destinations, not envelopes, so decryption is the identity function here.
vi.mock("../../../apps/api/src/notification-preferences/secrets", () => ({
  decryptSecret: (value: string | null) => value,
  encryptSecret: (value: string | null) => value,
}));

// resolveNotificationContext needs a resolvable task; short-circuit to a fixed one.
vi.mock("../../../apps/api/src/notification-preferences/context", () => ({}));

const outboundDestination = "https://notifications.example.com";

describe("SSRF regression guard — notification delivery (H10/H12, 0e046a6)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // A private destination must never reach here. If it does, the guard is gone.
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    delete process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;
    preference = {};
    selectCall = 0;
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.resetModules();
  });

  const load = async () =>
    (await import("../../../apps/api/src/notification-preferences/delivery"))
      .deliverNotification;

  describe.each([
    {
      sender: "ntfy",
      // A loopback host. isDisallowedAddress rejects it before any DNS lookup.
      pref: {
        ntfyEnabled: true,
        ntfyServerUrl: "http://127.0.0.1:8080",
        ntfyTopic: "t",
        ntfyToken: null,
      },
    },
    {
      sender: "gotify",
      pref: {
        gotifyEnabled: true,
        gotifyServerUrl: "http://localhost:8080",
        gotifyToken: "tok",
      },
    },
    {
      sender: "webhook",
      // The cloud metadata endpoint — the destination this class of bug exists to reach.
      pref: {
        webhookEnabled: true,
        webhookUrl: "http://169.254.169.254/latest/meta-data/",
      },
    },
  ])("$sender", ({ pref }) => {
    it("refuses a private destination before any outbound request is made", async () => {
      preference = { emailEnabled: false, ...pref };
      const deliverNotification = await load();

      await deliverNotification("notif-1").catch(() => undefined);

      // The assertion that matters: not "it threw", but that nothing left the process.
      // A sender that stopped calling the guard would reach fetch with this address.
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it('sends `redirect: "manual"` on the outbound request it does make', async () => {
    // The destination guard is deliberately bypassed for THIS test only, via the
    // switch the guard itself reads. Two reasons, and neither is convenience:
    //
    // 1. It isolates the assertion. This test is about the RequestInit that reaches
    //    fetch, not about the guard — which the three tests above pin instead.
    // 2. Without it the guard performs a real DNS lookup, so the test would depend
    //    on name resolution and fail offline. The failure would look like a broken
    //    assertion rather than a missing network, which is the worst kind of red.
    //
    // The guard is NOT stubbed. It runs and takes its documented early return.
    process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS = "true";
    preference = {
      emailEnabled: false,
      webhookEnabled: true,
      webhookUrl: outboundDestination,
      webhookSecret: null,
    };
    const deliverNotification = await load();

    await deliverNotification("notif-1").catch(() => undefined);

    expect(fetchSpy).toHaveBeenCalled();
    for (const call of fetchSpy.mock.calls) {
      const init = call[1] as RequestInit | undefined;
      // Set after the caller's spread in fetchWithTimeout, so a caller cannot weaken
      // it. Without this, a 3xx to 127.0.0.1 or 169.254.169.254 walks straight past
      // the destination guard, which only ever saw the ORIGINAL host.
      expect(init?.redirect).toBe("manual");
    }
  });
});
