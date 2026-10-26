import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

export const CUSTOMER_INVITATION_DELIVERY_KEY_TTL_MS = 15 * 60 * 1000;
export const CUSTOMER_INVITATION_DELIVERY_KEY_CAPACITY = 10_000;

export type DeliveryKey = {
  id: string;
  ownerId: string;
  keyId: string;
  key: Buffer;
};

type KeyEntry = DeliveryKey & {
  expiresAt: number;
  active: boolean;
  expiryTimer: NodeJS.Timeout;
};

type CapacityEntry = {
  expiresAt: number;
  expiryTimer: NodeJS.Timeout;
};

type RegistryOptions = {
  ownerId?: string;
  capacity?: number;
  now?: () => number;
  cleanupIntervalMs?: number;
  scheduleCleanup?: boolean;
};

export type DeliveryCapacityReservation = {
  reserve(deliveryId: string): DeliveryKey;
  release(): void;
};

/** Process-local keys for one-use invitation delivery envelopes. Keys are never persisted. */
export class CustomerInvitationDeliveryKeyring {
  readonly ownerId: string;
  private readonly entries = new Map<string, KeyEntry>();
  private readonly reservations = new Map<symbol, CapacityEntry>();
  private readonly capacity: number;
  private readonly now: () => number;
  private readonly cleanupTimer: NodeJS.Timeout | null;

  constructor(options: RegistryOptions = {}) {
    this.ownerId = options.ownerId ?? randomUUID();
    this.capacity =
      options.capacity ?? CUSTOMER_INVITATION_DELIVERY_KEY_CAPACITY;
    this.now = options.now ?? (() => performance.now());
    if (options.scheduleCleanup === false) {
      this.cleanupTimer = null;
    } else {
      this.cleanupTimer = setInterval(
        () => this.expireKeys(),
        options.cleanupIntervalMs ?? 1_000,
      );
      this.cleanupTimer.unref();
    }
  }

  reserve(deliveryId: string): DeliveryKey {
    this.expireKeys();
    if (this.entries.size + this.reservations.size >= this.capacity)
      throw new Error("Customer invitation delivery is unavailable");
    return this.createReservedKey(
      deliveryId,
      this.now() + CUSTOMER_INVITATION_DELIVERY_KEY_TTL_MS,
    );
  }

  reserveCapacity(): DeliveryCapacityReservation {
    this.expireKeys();
    if (this.entries.size + this.reservations.size >= this.capacity)
      throw new Error("Customer invitation delivery is unavailable");

    const token = Symbol("customer-invitation-delivery-capacity");
    const expiresAt = this.now() + CUSTOMER_INVITATION_DELIVERY_KEY_TTL_MS;
    const expiryTimer = setTimeout(
      () => this.reservations.delete(token),
      CUSTOMER_INVITATION_DELIVERY_KEY_TTL_MS,
    );
    expiryTimer.unref();
    this.reservations.set(token, { expiresAt, expiryTimer });
    let complete = false;

    return {
      reserve: (deliveryId) => {
        const slot = this.reservations.get(token);
        if (complete || !slot || this.now() >= slot.expiresAt) {
          if (slot) clearTimeout(slot.expiryTimer);
          this.reservations.delete(token);
          complete = true;
          throw new Error(
            "Customer invitation delivery capacity is unavailable",
          );
        }
        clearTimeout(slot.expiryTimer);
        this.reservations.delete(token);
        complete = true;
        return this.createReservedKey(deliveryId, slot.expiresAt);
      },
      release: () => {
        if (complete) return;
        const slot = this.reservations.get(token);
        if (slot) clearTimeout(slot.expiryTimer);
        this.reservations.delete(token);
        complete = true;
      },
    };
  }

  private createReservedKey(
    deliveryId: string,
    expiresAt: number,
  ): DeliveryKey {
    if (this.entries.has(deliveryId))
      throw new Error("Customer invitation delivery key already exists");
    if (this.now() >= expiresAt)
      throw new Error("Customer invitation delivery capacity is unavailable");
    const expiryTimer = setTimeout(
      () => this.destroy(deliveryId),
      Math.max(0, expiresAt - this.now()),
    );
    expiryTimer.unref();
    const entry: KeyEntry = {
      id: deliveryId,
      ownerId: this.ownerId,
      keyId: randomUUID(),
      key: randomBytes(32),
      expiresAt,
      active: false,
      expiryTimer,
    };
    this.entries.set(deliveryId, entry);
    return entry;
  }

  activate(deliveryId: string): boolean {
    const entry = this.getUsableEntry(deliveryId);
    if (!entry) return false;
    entry.active = true;
    return true;
  }

  get(deliveryId: string, ownerId: string, keyId: string): DeliveryKey | null {
    const entry = this.getUsableEntry(deliveryId);
    if (
      !entry?.active ||
      ownerId !== this.ownerId ||
      entry.ownerId !== ownerId ||
      entry.keyId !== keyId
    )
      return null;
    return entry;
  }

  remainingMs(deliveryId: string, ownerId: string, keyId?: string): number {
    const entry = this.getUsableEntry(deliveryId);
    if (
      !entry?.active ||
      ownerId !== this.ownerId ||
      entry.ownerId !== ownerId ||
      (keyId !== undefined && entry.keyId !== keyId)
    )
      return 0;
    return Math.max(0, entry.expiresAt - this.now());
  }

  /** True only when this process owns a live key that is already active for a committed row. */
  hasActiveKey(deliveryId: string, ownerId: string): boolean {
    const entry = this.getUsableEntry(deliveryId);
    return Boolean(
      entry?.active && ownerId === this.ownerId && entry.ownerId === ownerId,
    );
  }

  /** Returns bounded process-local IDs for rows whose delivery keys are active. */
  activeOwnedUnexpiredIds(
    limit = CUSTOMER_INVITATION_DELIVERY_KEY_CAPACITY,
  ): string[] {
    this.expireKeys();
    const boundedLimit = Math.min(
      Math.max(0, Math.floor(limit)),
      CUSTOMER_INVITATION_DELIVERY_KEY_CAPACITY,
    );
    if (boundedLimit === 0) return [];
    const ids: string[] = [];
    for (const entry of this.entries.values()) {
      if (!entry.active || entry.ownerId !== this.ownerId) continue;
      ids.push(entry.id);
      if (ids.length >= boundedLimit) break;
    }
    return ids;
  }

  reservationRemainingMs(key: DeliveryKey): number {
    const entry = this.getUsableEntry(key.id);
    if (!entry || entry.key !== key.key || entry.keyId !== key.keyId) return 0;
    return Math.max(0, entry.expiresAt - this.now());
  }

  destroy(deliveryId: string): void {
    const entry = this.entries.get(deliveryId);
    if (!entry) return;
    clearTimeout(entry.expiryTimer);
    entry.key.fill(0);
    this.entries.delete(deliveryId);
  }

  destroyAll(): void {
    for (const entry of this.entries.values()) {
      clearTimeout(entry.expiryTimer);
      entry.key.fill(0);
    }
    for (const reservation of this.reservations.values())
      clearTimeout(reservation.expiryTimer);
    this.entries.clear();
    this.reservations.clear();
  }

  dispose(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.destroyAll();
  }

  /** Exposed for bounded tests and shutdown cleanup; expired keys are always zeroed. */
  expireKeys(): number {
    const now = this.now();
    let expired = 0;
    for (const [id, entry] of this.entries) {
      if (now < entry.expiresAt) continue;
      clearTimeout(entry.expiryTimer);
      entry.key.fill(0);
      this.entries.delete(id);
      expired += 1;
    }
    for (const [token, reservation] of this.reservations) {
      if (now < reservation.expiresAt) continue;
      clearTimeout(reservation.expiryTimer);
      this.reservations.delete(token);
    }
    return expired;
  }

  private getUsableEntry(deliveryId: string): KeyEntry | null {
    const entry = this.entries.get(deliveryId);
    if (!entry) return null;
    if (this.now() >= entry.expiresAt) {
      clearTimeout(entry.expiryTimer);
      entry.key.fill(0);
      this.entries.delete(deliveryId);
      return null;
    }
    return entry;
  }
}

export const customerInvitationDeliveryKeyring =
  new CustomerInvitationDeliveryKeyring();

process.once("exit", () => customerInvitationDeliveryKeyring.destroyAll());
