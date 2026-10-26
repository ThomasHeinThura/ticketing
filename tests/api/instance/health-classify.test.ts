import { describe, expect, it } from "vitest";
import {
  classifyDatabase,
  classifyDeliveries,
  classifySecrets,
} from "../../../apps/api/src/instance/health/classify";
import type { RekeyProgress } from "../../../apps/api/src/secrets/rekey";

const progress = (over: Partial<RekeyProgress>): RekeyProgress => ({
  currentKeyId: "aabbccdd00112233",
  previousKeyConfigured: true,
  expiredInvitationDeliveryEnvelopes: 0,
  total: { plugins: 2, identityConnections: 1, textSecrets: 3 },
  pending: { plugins: 0, identityConnections: 0, textSecrets: 0 },
  complete: true,
  ...over,
});

describe("God Mode health classification", () => {
  it("database is ok, degraded over 100 ms, failing when unreachable", () => {
    expect(classifyDatabase(5).state).toBe("ok");
    expect(classifyDatabase(100).state).toBe("ok");
    expect(classifyDatabase(101).state).toBe("degraded");
    expect(classifyDatabase(null).state).toBe("failing");
  });

  it("GM-14: complete rekey is ok and says the previous key may be removed", () => {
    const check = classifySecrets(progress({}));
    expect(check.state).toBe("ok");
    expect(check.detail.safeToRemovePreviousKey).toBe(true);
    expect(check.detail.secretsPendingRekey).toBe(0);
  });

  it("GM-14: a pending rekey is degraded while the previous key is configured", () => {
    const check = classifySecrets(
      progress({
        pending: { plugins: 1, identityConnections: 1, textSecrets: 0 },
        complete: false,
      }),
    );
    expect(check.state).toBe("degraded");
    expect(check.detail.safeToRemovePreviousKey).toBe(false);
  });

  it("GM-14: secrets under an unreadable key are failing", () => {
    expect(
      classifySecrets(
        progress({
          previousKeyConfigured: false,
          pending: { plugins: 1, identityConnections: 0, textSecrets: 0 },
          complete: false,
        }),
      ).state,
    ).toBe("failing");
    expect(
      classifySecrets(progress({ currentKeyId: null, complete: false })).state,
    ).toBe("failing");
  });

  it("marks expired invitation ciphertext as degraded until cleanup erases it", () => {
    const check = classifySecrets(
      progress({
        expiredInvitationDeliveryEnvelopes: 2,
        total: { plugins: 0, identityConnections: 0, textSecrets: 2 },
        complete: false,
      }),
    );
    expect(check.state).toBe("degraded");
    expect(check.detail.expiredInvitationDeliveryEnvelopes).toBe(2);
    expect(check.detail.safeToRemovePreviousKey).toBe(false);
  });

  it("with no key and no secrets the check is unknown, not ok", () => {
    expect(
      classifySecrets(
        progress({
          currentKeyId: null,
          previousKeyConfigured: false,
          total: { plugins: 0, identityConnections: 0, textSecrets: 0 },
          complete: false,
        }),
      ).state,
    ).toBe("unknown");
  });

  it("never carries a key id or secret in its detail", () => {
    const text = JSON.stringify(classifySecrets(progress({})));
    expect(text).not.toContain("aabbccdd");
  });

  it("any dead letter makes the outbox failing", () => {
    const base = {
      outboxDead: 0,
      outboxPending: 3,
      deliveriesDead: 0,
      deliveriesPending: 9,
    };
    expect(classifyDeliveries(base).state).toBe("ok");
    expect(classifyDeliveries({ ...base, deliveriesDead: 1 }).state).toBe(
      "failing",
    );
    expect(classifyDeliveries({ ...base, outboxDead: 2 }).state).toBe(
      "failing",
    );
  });
});
