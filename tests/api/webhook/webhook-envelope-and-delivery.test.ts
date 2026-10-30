import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  WEBHOOK_AUTO_DISABLE_AFTER_MS,
  WEBHOOK_EVENT_KEYS,
  WEBHOOK_EXCLUDED_W_EVENT_KEYS,
} from "../../../apps/api/src/webhook/constants";
import {
  nextFailureStreak,
  outcomeAfterAttempt,
  webhookEditorPath,
} from "../../../apps/api/src/webhook/delivery";
import {
  absoluteUrl,
  type InternalEnvelope,
  projectWebhookEnvelope,
  visibleChanges,
} from "../../../apps/api/src/webhook/envelope";
import { receivesEverything } from "../../../apps/api/src/webhook/reach";

const EVENTS_MD = fileURLToPath(
  new URL("../../../docs/technical/events.md", import.meta.url),
);

/** The W column of the events.md Catalogue, parsed rather than copied. */
function catalogueWebhookKeys(): string[] {
  const doc = readFileSync(EVENTS_MD, "utf8");
  const start = doc.indexOf("## Catalogue");
  const keys: string[] = [];
  for (const line of doc.slice(start).split("\n").slice(1)) {
    if (line.startsWith("## ")) break;
    const match = /^\| `([a-z_]+\.[a-z_]+)` \|/.exec(line);
    if (!match?.[1]) continue;
    const cells = line
      .slice(1, line.lastIndexOf("|"))
      .split("|")
      .map((cell) => cell.trim());
    if (cells[3]?.startsWith("✅")) keys.push(match[1]);
  }
  return keys;
}

describe("webhook events are the W column of events.md", () => {
  it("matches the catalogue W column minus the documented exclusions, both ways", () => {
    const catalogue = catalogueWebhookKeys();
    expect(catalogue.length).toBeGreaterThan(20);
    const excluded = new Set<string>(WEBHOOK_EXCLUDED_W_EVENT_KEYS);
    const deliverable = catalogue.filter((key) => !excluded.has(key));
    expect([...WEBHOOK_EVENT_KEYS].sort()).toEqual([...deliverable].sort());
    // Every exclusion is a real W-column key, so a rename cannot orphan the exclusion list.
    for (const key of excluded) expect(catalogue).toContain(key);
  });
});

describe("delivery outcome (WH-4, WH-5)", () => {
  it("is delivered on success at any attempt", () => {
    expect(outcomeAfterAttempt(1, true)).toEqual({ state: "delivered" });
    expect(outcomeAfterAttempt(6, true)).toEqual({ state: "delivered" });
  });

  it("retries with the documented backoff then dies after the sixth failed attempt", () => {
    expect(outcomeAfterAttempt(1, false)).toEqual({
      state: "pending",
      delayMs: 30_000,
    });
    expect(outcomeAfterAttempt(5, false)).toEqual({
      state: "pending",
      delayMs: 21_600_000,
    });
    expect(outcomeAfterAttempt(6, false)).toEqual({ state: "dead" });
  });
});

describe("continuous failure window (WH-7)", () => {
  const now = new Date("2026-10-23T12:00:00.000Z");

  it("starts the window at the first failure", () => {
    expect(
      nextFailureStreak({ failingSince: null, success: false, now }),
    ).toEqual({ failingSince: now, autoDisable: false });
  });

  it("does not disable just short of 24 hours", () => {
    const since = new Date(now.getTime() - WEBHOOK_AUTO_DISABLE_AFTER_MS + 1);
    expect(
      nextFailureStreak({ failingSince: since, success: false, now })
        .autoDisable,
    ).toBe(false);
  });

  it("disables at 24 hours of continuous failure", () => {
    const since = new Date(now.getTime() - WEBHOOK_AUTO_DISABLE_AFTER_MS);
    expect(
      nextFailureStreak({ failingSince: since, success: false, now })
        .autoDisable,
    ).toBe(true);
  });

  it("is reset by any success", () => {
    const since = new Date(now.getTime() - 2 * WEBHOOK_AUTO_DISABLE_AFTER_MS);
    expect(
      nextFailureStreak({ failingSince: since, success: true, now }),
    ).toEqual({ failingSince: null, autoDisable: false });
  });
});

const baseEnvelope: InternalEnvelope = {
  id: "evt_1",
  kind: "work_item.created",
  occurredAt: "2026-10-23T10:00:00.000Z",
  actor: { type: "person", id: "p1", name: "Jane Smith" },
  scope: { workspaceId: "ws1", projectId: "pr1" },
  payload: {
    key: "SUP-1",
    url: "/agent/work-items/SUP-1",
    typeId: "t1",
  },
};

describe("auto-disable notice link (WH-7)", () => {
  it("points at the agent webhook editor route, not a non-existent integrations path", () => {
    expect(webhookEditorPath("wh_1")).toBe(
      "/dashboard/settings/workspace/webhooks/wh_1",
    );
    expect(webhookEditorPath("a/b c")).toBe(
      "/dashboard/settings/workspace/webhooks/a%2Fb%20c",
    );
  });
});

describe("envelope projection", () => {
  const context = {
    instance: "https://ticket.example.com/",
    workItem: { key: "SUP-1", title: "Printer offline" },
    project: { key: "SUP", name: "Contoso Support" },
  };

  it("projects id, event, occurredAt, instance, actor and data with a url", () => {
    const projected = projectWebhookEnvelope(baseEnvelope, context);
    if (projected.kind !== "deliver") throw new Error("expected delivery");
    expect(projected.body).toMatchObject({
      id: "evt_1",
      event: "work_item.created",
      occurredAt: "2026-10-23T10:00:00.000Z",
      instance: "https://ticket.example.com/",
      actor: { id: "p1", name: "Jane Smith" },
      data: {
        workItem: {
          key: "SUP-1",
          title: "Printer offline",
          url: "https://ticket.example.com/agent/work-items/SUP-1",
        },
        project: { key: "SUP", name: "Contoso Support" },
        url: "https://ticket.example.com/agent/work-items/SUP-1",
      },
    });
  });

  it("never sends the internal-only fields", () => {
    const projected = projectWebhookEnvelope(
      {
        ...baseEnvelope,
        causationId: "evt_0",
        depth: 3,
        originAutomationId: "am_1",
      } as InternalEnvelope,
      context,
    );
    if (projected.kind !== "deliver") throw new Error("expected delivery");
    const text = JSON.stringify(projected.body);
    expect(text).not.toContain("causationId");
    expect(text).not.toContain("depth");
    expect(text).not.toContain("originAutomationId");
  });

  it("renders a system actor as null", () => {
    const projected = projectWebhookEnvelope(
      { ...baseEnvelope, actor: { type: "system", id: null, name: "System" } },
      context,
    );
    if (projected.kind !== "deliver") throw new Error("expected delivery");
    expect(projected.body.actor).toBeNull();
  });

  it("puts SLA fields under `sla`", () => {
    const projected = projectWebhookEnvelope(
      {
        ...baseEnvelope,
        kind: "sla.breached",
        payload: {
          key: "SUP-1",
          url: "/agent/work-items/SUP-1",
          metric: "resolution",
          breachedByMinutes: 45,
        },
      },
      context,
    );
    if (projected.kind !== "deliver") throw new Error("expected delivery");
    expect(projected.body.data.sla).toEqual({
      metric: "resolution",
      breachedByMinutes: 45,
    });
  });

  it("drops internal change entries from work_item.updated (NO-19)", () => {
    const projected = projectWebhookEnvelope(
      {
        ...baseEnvelope,
        kind: "work_item.updated",
        payload: {
          key: "SUP-1",
          url: "/agent/work-items/SUP-1",
          changes: [
            { field: "title", from: "a", to: "b", visibility: "public" },
            { field: "costCentre", from: 1, to: 2, visibility: "internal" },
          ],
        },
      },
      context,
    );
    if (projected.kind !== "deliver") throw new Error("expected delivery");
    expect(JSON.stringify(projected.body)).not.toContain("costCentre");
    expect(JSON.stringify(projected.body)).toContain("title");
  });

  it("delivers nothing when every change is internal", () => {
    expect(
      projectWebhookEnvelope(
        {
          ...baseEnvelope,
          kind: "work_item.updated",
          payload: {
            key: "SUP-1",
            changes: [{ field: "x", visibility: "internal" }],
          },
        },
        context,
      ),
    ).toEqual({ kind: "nothing_visible" });
  });

  it("filters changes defensively", () => {
    expect(visibleChanges(undefined)).toEqual([]);
    expect(visibleChanges([null, 3, { field: "a" }])).toEqual([]);
    const publicChange = {
      field: "title",
      visibility: "public",
      to: "Visible title",
    };
    const changes = [
      publicChange,
      { field: "private", to: "INTERNAL_ONLY_VALUE", visibility: "internal" },
      { field: "unclassified", to: "UNCLASSIFIED_VALUE" },
      {
        field: "unknown",
        to: "UNKNOWN_VISIBILITY_VALUE",
        visibility: "unknown",
      },
      { visibility: "public", to: "MALFORMED_VALUE" },
      [],
    ];
    expect(visibleChanges(changes)).toEqual([publicChange]);
    const projected = projectWebhookEnvelope(
      {
        ...baseEnvelope,
        kind: "work_item.updated",
        payload: { key: "SUP-1", changes },
      },
      context,
    );
    if (projected.kind !== "deliver")
      throw new Error("expected public change delivery");
    expect(projected.body.data.details).toEqual({ changes: [publicChange] });
    expect(
      projectWebhookEnvelope(
        {
          ...baseEnvelope,
          kind: "work_item.updated",
          payload: { key: "SUP-1", changes: changes.slice(1) },
        },
        context,
      ),
    ).toEqual({ kind: "nothing_visible" });
  });

  it("makes only same-origin relative links absolute", () => {
    expect(absoluteUrl("https://x.test/", "/agent/a")).toBe(
      "https://x.test/agent/a",
    );
    expect(absoluteUrl("https://x.test", "https://y.test/a")).toBe(
      "https://y.test/a",
    );
    expect(absoluteUrl("https://x.test", "javascript:1")).toBeNull();
    expect(absoluteUrl("https://x.test", 5)).toBeNull();
  });
});

describe("WH-14/WH-15 'receives everything'", () => {
  const none = { reach: { kind: "membership" as const }, memberships: [] };

  it("is true for instance-wide reach and for sees_all on this workspace only", () => {
    expect(
      receivesEverything({ reach: { kind: "all" }, memberships: [] }, "ws1"),
    ).toBe(true);
    expect(
      receivesEverything(
        {
          reach: { kind: "membership" },
          memberships: [{ scope: "workspace", scopeId: "ws1", seesAll: true }],
        },
        "ws1",
      ),
    ).toBe(true);
    expect(
      receivesEverything(
        {
          reach: { kind: "membership" },
          memberships: [{ scope: "workspace", scopeId: "ws2", seesAll: true }],
        },
        "ws1",
      ),
    ).toBe(false);
  });

  it("is false for an ordinary member, even with project memberships", () => {
    expect(receivesEverything(none, "ws1")).toBe(false);
    expect(
      receivesEverything(
        {
          reach: { kind: "membership" },
          memberships: [{ scope: "project", scopeId: "pr1", seesAll: false }],
        },
        "ws1",
      ),
    ).toBe(false);
  });
});
