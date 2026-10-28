const DEFAULT_COOLDOWN_MS = 30_000;
const DEFAULT_ENTRY_TTL_MS = 30 * 60_000;
const DEFAULT_MAX_ENTRIES = 1_000;

type Bucket = { acceptedAt: number };

/** Process-local diagnostic throttle; it does not promise cross-replica coordination. */
export class StorageProbeLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private active = false;

  constructor(
    private readonly options: {
      cooldownMs?: number;
      entryTtlMs?: number;
      maxEntries?: number;
    } = {},
  ) {}

  acquire(
    actorId: string,
    now = Date.now(),
  ): { release: () => void } | { retryAfterSeconds: number } {
    const cooldownMs = this.options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    const entryTtlMs = this.options.entryTtlMs ?? DEFAULT_ENTRY_TTL_MS;
    const maxEntries = this.options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    for (const [id, bucket] of this.buckets) {
      if (now - bucket.acceptedAt >= entryTtlMs) this.buckets.delete(id);
    }

    const previous = this.buckets.get(actorId);
    const remaining = previous ? cooldownMs - (now - previous.acceptedAt) : 0;
    if (
      this.active ||
      remaining > 0 ||
      (!previous && this.buckets.size >= maxEntries)
    ) {
      return {
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((remaining > 0 ? remaining : cooldownMs) / 1_000),
        ),
      };
    }

    this.buckets.set(actorId, { acceptedAt: now });
    this.active = true;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.active = false;
      },
    };
  }

  get size() {
    return this.buckets.size;
  }
}

export const storageProbeLimiter = new StorageProbeLimiter();
