import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  decryptDeliveryEnvelope,
  encryptDeliveryEnvelope,
  reencryptDeliveryEnvelope,
} from "../../../apps/api/src/customer-invitation/delivery/envelope";
import {
  CUSTOMER_INVITATION_DELIVERY_KEY_TTL_MS,
  CustomerInvitationDeliveryKeyring,
} from "../../../apps/api/src/customer-invitation/delivery/keyring";
import { hashCredential } from "../../../apps/api/src/customer-invitation/logic";
import { decryptIdentityClientSecret } from "../../../apps/api/src/identity/client-secret";

const originalKey = process.env.TASKDESK_ENCRYPTION_KEY;
const originalPreviousKey = process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS;
const deliveryId = randomUUID();
const invitationId = randomUUID();
const ownerId = randomUUID();
const credential = "A".repeat(43);
const credentialHash = hashCredential(credential);

afterEach(() => {
  if (originalKey === undefined) delete process.env.TASKDESK_ENCRYPTION_KEY;
  else process.env.TASKDESK_ENCRYPTION_KEY = originalKey;
  if (originalPreviousKey === undefined)
    delete process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS;
  else process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS = originalPreviousKey;
});

function outerAad() {
  return `taskdesk:customer-invitation-delivery:v2:${deliveryId}:${invitationId}:${credentialHash}`;
}

describe("customer invitation delivery envelope", () => {
  it("keeps the credential opaque to the persistent encryption key", () => {
    process.env.TASKDESK_ENCRYPTION_KEY = "11".repeat(32);
    delete process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS;
    const keyring = new CustomerInvitationDeliveryKeyring({
      ownerId,
      scheduleCleanup: false,
    });
    const key = keyring.reserve(deliveryId);
    const envelope = encryptDeliveryEnvelope({
      deliveryId,
      invitationId,
      credentialHash,
      credential,
      key,
    });
    keyring.activate(deliveryId);

    const outerPlaintext = decryptIdentityClientSecret(
      outerAad(),
      Buffer.from(envelope, "base64url"),
    );
    expect(outerPlaintext).not.toContain(credential);
    expect(JSON.parse(outerPlaintext)).toMatchObject({
      version: 2,
      deliveryId,
      invitationId,
      credentialHash,
      ownerId,
      inner: {
        iv: expect.any(String),
        ciphertext: expect.any(String),
        tag: expect.any(String),
      },
    });
    expect(
      decryptDeliveryEnvelope({
        deliveryId,
        invitationId,
        credentialHash,
        envelope,
        ownerId,
        keyring,
      }).credential,
    ).toBe(credential);

    keyring.dispose();
  });

  it("expires by monotonic time and cannot decrypt after restart", () => {
    process.env.TASKDESK_ENCRYPTION_KEY = "22".repeat(32);
    delete process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS;
    let monotonicNow = 100;
    const keyring = new CustomerInvitationDeliveryKeyring({
      ownerId,
      scheduleCleanup: false,
      now: () => monotonicNow,
    });
    const key = keyring.reserve(deliveryId);
    const envelope = encryptDeliveryEnvelope({
      deliveryId,
      invitationId,
      credentialHash,
      credential,
      key,
    });
    keyring.activate(deliveryId);

    const restarted = new CustomerInvitationDeliveryKeyring({
      ownerId: randomUUID(),
      scheduleCleanup: false,
    });
    expect(() =>
      decryptDeliveryEnvelope({
        deliveryId,
        invitationId,
        credentialHash,
        envelope,
        ownerId,
        keyring: restarted,
      }),
    ).toThrow("Customer invitation delivery envelope is unavailable");

    monotonicNow += CUSTOMER_INVITATION_DELIVERY_KEY_TTL_MS;
    expect(keyring.expireKeys()).toBe(1);
    expect(key.key.every((byte) => byte === 0)).toBe(true);
    expect(() =>
      decryptDeliveryEnvelope({
        deliveryId,
        invitationId,
        credentialHash,
        envelope,
        ownerId,
        keyring,
      }),
    ).toThrow("Customer invitation delivery envelope is unavailable");

    keyring.dispose();
    restarted.dispose();
  });

  it("bounds reservations and zeroes released capacity", () => {
    const keyring = new CustomerInvitationDeliveryKeyring({
      ownerId,
      capacity: 1,
      scheduleCleanup: false,
    });
    const key = keyring.reserve(deliveryId);
    expect(() => keyring.reserve(randomUUID())).toThrow(
      "Customer invitation delivery is unavailable",
    );
    keyring.destroy(deliveryId);
    expect(key.key.every((byte) => byte === 0)).toBe(true);
    expect(() => keyring.reserve(randomUUID())).not.toThrow();
    keyring.dispose();
  });

  it("reserves capacity before address classification and releases inert capacity", () => {
    const keyring = new CustomerInvitationDeliveryKeyring({
      ownerId,
      capacity: 1,
      scheduleCleanup: false,
    });
    const admission = keyring.reserveCapacity();
    expect(() => keyring.reserve(randomUUID())).toThrow(
      "Customer invitation delivery is unavailable",
    );
    admission.release();
    expect(() => keyring.reserve(randomUUID())).not.toThrow();
    keyring.dispose();
  });

  it("does not extend the deadline while a transaction holds admission", () => {
    let monotonicNow = 10;
    const keyring = new CustomerInvitationDeliveryKeyring({
      ownerId,
      now: () => monotonicNow,
      scheduleCleanup: false,
    });
    const admission = keyring.reserveCapacity();
    monotonicNow += CUSTOMER_INVITATION_DELIVERY_KEY_TTL_MS - 100;
    const key = admission.reserve(deliveryId);
    expect(keyring.reservationRemainingMs(key)).toBe(100);
    expect(keyring.activate(deliveryId)).toBe(true);
    expect(keyring.remainingMs(deliveryId, ownerId, key.keyId)).toBe(100);
    monotonicNow += 100;
    expect(keyring.remainingMs(deliveryId, ownerId, key.keyId)).toBe(0);
    expect(key.key.every((byte) => byte === 0)).toBe(true);
    keyring.dispose();
  });

  it("rekeys the outer envelope without requiring or recovering the inner key", () => {
    process.env.TASKDESK_ENCRYPTION_KEY = "33".repeat(32);
    delete process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS;
    const keyring = new CustomerInvitationDeliveryKeyring({
      ownerId,
      scheduleCleanup: false,
    });
    const key = keyring.reserve(deliveryId);
    const envelope = encryptDeliveryEnvelope({
      deliveryId,
      invitationId,
      credentialHash,
      credential,
      key,
    });
    keyring.activate(deliveryId);

    process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS =
      process.env.TASKDESK_ENCRYPTION_KEY;
    process.env.TASKDESK_ENCRYPTION_KEY = "44".repeat(32);
    const rekeyed = reencryptDeliveryEnvelope({
      deliveryId,
      invitationId,
      credentialHash,
      envelope,
    });
    const opaqueBefore = JSON.parse(
      decryptIdentityClientSecret(
        outerAad(),
        Buffer.from(envelope, "base64url"),
      ),
    ) as { inner: unknown };
    const opaqueAfter = JSON.parse(
      decryptIdentityClientSecret(
        outerAad(),
        Buffer.from(rekeyed, "base64url"),
      ),
    ) as { inner: unknown };
    expect(opaqueAfter.inner).toEqual(opaqueBefore.inner);
    expect(
      decryptDeliveryEnvelope({
        deliveryId,
        invitationId,
        credentialHash,
        envelope: rekeyed,
        ownerId,
        keyring,
      }).credential,
    ).toBe(credential);

    keyring.destroy(deliveryId);
    const rekeyedAfterDestroy = reencryptDeliveryEnvelope({
      deliveryId,
      invitationId,
      credentialHash,
      envelope: rekeyed,
    });
    expect(() =>
      decryptDeliveryEnvelope({
        deliveryId,
        invitationId,
        credentialHash,
        envelope: rekeyedAfterDestroy,
        ownerId,
        keyring,
      }),
    ).toThrow("Customer invitation delivery envelope is unavailable");
    expect(
      decryptIdentityClientSecret(
        outerAad(),
        Buffer.from(rekeyedAfterDestroy, "base64url"),
      ),
    ).not.toContain(credential);
    keyring.dispose();
  });
});
