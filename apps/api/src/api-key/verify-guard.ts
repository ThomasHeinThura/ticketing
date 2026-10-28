/**
 * R7-03: protection for the one expensive step of API key authentication, the Argon2id check
 * (19 MiB, 2 passes, on the libuv threadpool).
 *
 * The 12 character selector in `apikey.start` is not secret (the owner, key managers and instance
 * admins see it), so anyone holding one can send junk keys that all reach the hash. Three
 * cheap controls run before it, all in memory and per process (the same documented limitation as
 * `rate-limit.ts`: this app has no shared limiter storage):
 *
 *  1. `looksLikeApiKey`: a malformed string never reaches the database or the hash.
 *  2. `ArgonGate`: at most a few verifications in flight process-wide, a bounded queue behind
 *     them, and a small cap per selector. Overflow is refused at once (503), so a flood cannot
 *     occupy the threadpool that every other request (and the database driver) shares.
 *  3. `FailureLimiter` per client address: failed verifications from one address lock that
 *     address out of the hash for a short, doubling window.
 *
 * Trade-off, deliberately: there is NO failure lockout per selector. Locking a selector after
 * N wrong secrets would let an attacker who can read it lock the real key's owner out (a
 * denial of service on a credential). The per-selector control is a concurrency cap instead,
 * and a correct, already-verified secret is answered from `VerifiedSecretCache` before any
 * control applies, so a key in use is never held up by someone else's junk. A first-ever use
 * of a key during a flood on its own selector can still be refused for the moment (503).
 */

const KEY_PATTERN = /^[A-Za-z0-9_-]{16,200}$/;

/**
 * Keys are `tdk_` + 43 base64url characters. Keys rewritten from the pre-P4 SHA-256 form keep
 * their original (arbitrary base64url-ish) secret, so the check is the character class and a
 * sane length range, not the exact issued length.
 */
export function looksLikeApiKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

export class VerificationOverloadedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("verification_overloaded");
  }
}

export class VerificationThrottledError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("verification_throttled");
  }
}

type Waiter = { selector: string; resume: () => void };

/** A counting semaphore with a bounded queue and a per-selector in-flight cap. */
export class ArgonGate {
  private inFlight = 0;
  private readonly perSelector = new Map<string, number>();
  private readonly queue: Waiter[] = [];

  constructor(
    private readonly maxConcurrent = 3,
    private readonly maxQueued = 8,
    private readonly maxPerSelector = 2,
  ) {}

  get running(): number {
    return this.inFlight;
  }

  get waiting(): number {
    return this.queue.length;
  }

  /** Resolves with a release function, or throws `VerificationOverloadedError` at once. */
  async acquire(selector: string): Promise<() => void> {
    if ((this.perSelector.get(selector) ?? 0) >= this.maxPerSelector)
      throw new VerificationOverloadedError(1);
    this.perSelector.set(selector, (this.perSelector.get(selector) ?? 0) + 1);
    if (this.inFlight < this.maxConcurrent) {
      this.inFlight += 1;
      return this.releaser(selector);
    }
    if (this.queue.length >= this.maxQueued) {
      this.leaveSelector(selector);
      throw new VerificationOverloadedError(1);
    }
    await new Promise<void>((resume) => {
      this.queue.push({ selector, resume });
    });
    return this.releaser(selector);
  }

  private releaser(selector: string): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.leaveSelector(selector);
      const next = this.queue.shift();
      if (next) next.resume();
      else this.inFlight -= 1;
    };
  }

  private leaveSelector(selector: string): void {
    const left = (this.perSelector.get(selector) ?? 1) - 1;
    if (left <= 0) this.perSelector.delete(selector);
    else this.perSelector.set(selector, left);
  }
}

type Entry = {
  windowStart: number;
  count: number;
  blockedUntil: number;
  strikes: number;
  lastSeen: number;
};

export type FailureLimiterOptions = {
  /** Wrong secrets allowed per window before the address is locked out. */
  maxFailures?: number;
  windowMs?: number;
  baseLockoutMs?: number;
  maxLockoutMs?: number;
  maxTracked?: number;
  now?: () => number;
};

/**
 * Counts failed verifications per client address. `reserve` is called before the hash runs (so
 * concurrent attempts cannot all slip under the limit) and `refund` when it turned out valid.
 */
export class FailureLimiter {
  private readonly entries = new Map<string, Entry>();
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly baseLockoutMs: number;
  private readonly maxLockoutMs: number;
  private readonly maxTracked: number;
  private readonly now: () => number;

  constructor(options: FailureLimiterOptions = {}) {
    this.maxFailures = options.maxFailures ?? 10;
    this.windowMs = options.windowMs ?? 60_000;
    this.baseLockoutMs = options.baseLockoutMs ?? 60_000;
    this.maxLockoutMs = options.maxLockoutMs ?? 15 * 60_000;
    this.maxTracked = options.maxTracked ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  /** Seconds the address must wait, or 0 when it may verify. */
  blockedFor(id: string): number {
    const entry = this.entries.get(id);
    if (!entry) return 0;
    const wait = entry.blockedUntil - this.now();
    return wait > 0 ? Math.ceil(wait / 1000) : 0;
  }

  /** Counts one attempt; returns the lockout in seconds when it tips the address over. */
  reserve(id: string): number {
    const now = this.now();
    if (this.entries.size >= this.maxTracked) this.prune(now);
    let entry = this.entries.get(id);
    if (!entry) {
      entry = {
        windowStart: now,
        count: 0,
        blockedUntil: 0,
        strikes: 0,
        lastSeen: now,
      };
      this.entries.set(id, entry);
    }
    if (now - entry.windowStart >= this.windowMs) {
      entry.windowStart = now;
      entry.count = 0;
    }
    entry.lastSeen = now;
    entry.count += 1;
    if (entry.count <= this.maxFailures) return 0;
    const lockout = Math.min(
      this.baseLockoutMs * 2 ** entry.strikes,
      this.maxLockoutMs,
    );
    entry.strikes += 1;
    entry.blockedUntil = now + lockout;
    entry.count = 0;
    entry.windowStart = now;
    return Math.ceil(lockout / 1000);
  }

  /** The attempt was valid after all: it is not a failure. */
  refund(id: string): void {
    const entry = this.entries.get(id);
    if (entry && entry.count > 0) entry.count -= 1;
  }

  private prune(now: number): void {
    for (const [id, entry] of this.entries) {
      const idle = now - entry.lastSeen;
      if (entry.blockedUntil <= now && idle >= this.maxLockoutMs * 2)
        this.entries.delete(id);
    }
    // Still full of live entries: drop the oldest rather than grow without bound.
    while (this.entries.size >= this.maxTracked) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
