import { describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_THROTTLE_ALL_IPS_RULE,
  ACCOUNT_THROTTLE_RULE,
  accountThrottleAfter,
  accountThrottleBefore,
  createAccountThrottle,
} from "../../../apps/api/src/auth/account-throttle";
import {
  createAuthRateLimitCoordinator,
  type ValkeyEvalClient,
} from "../../../apps/api/src/auth/rate-limit-storage";
import { TRUSTED_CLIENT_IP_HEADER } from "../../../apps/api/src/utils/resolve-client-ip";

const coordinator = () =>
  createAuthRateLimitCoordinator({
    isDistributedConfigured: () => false,
    setUnsharedMetric: () => {},
    emitWarning: () => {},
  });
const setup = () => createAccountThrottle(coordinator());
type T = ReturnType<typeof setup>;

const IP = "198.51.100.7";
const fail = async (t: T, email: string, n: number, ip: string | null = IP) => {
  for (let i = 0; i < n; i++) await t.attempt("account-password", email, ip);
};
const body429 = {
  statusCode: 429,
  body: { message: "Too many requests. Please try again later." },
};

describe("per-account sign-in throttle", () => {
  it("is 10 per email+IP and 100 per email, per 15 minutes", () => {
    expect(ACCOUNT_THROTTLE_RULE).toEqual({ window: 900, max: 10 });
    expect(ACCOUNT_THROTTLE_ALL_IPS_RULE).toEqual({ window: 900, max: 100 });
  });

  it("answers 429 after 10 failures from one IP, even for the right password", async () => {
    const t = setup();
    await fail(t, "a@example.com", 10);
    await expect(
      t.attempt("account-password", "a@example.com", IP),
    ).rejects.toMatchObject(body429);
  });

  it("does not let one IP lock the account out for another IP", async () => {
    const t = setup();
    await fail(t, "a@example.com", 10);
    await expect(
      t.attempt("account-password", "a@example.com", "203.0.113.9"),
    ).resolves.toBeUndefined();
  });

  it("stops distributed guessing at 100 per email across IPs", async () => {
    const t = setup();
    for (let i = 0; i < 100; i++)
      await t.attempt("account-password", "a@example.com", `10.0.0.${i}`);
    await expect(
      t.attempt("account-password", "a@example.com", "10.9.9.9"),
    ).rejects.toMatchObject({ statusCode: 429 });
  });

  it("normalises the email so case and spaces do not dodge the counter", async () => {
    const t = setup();
    await fail(t, "a@example.com", 10);
    await expect(
      t.attempt("account-password", "  A@Example.COM ", IP),
    ).rejects.toMatchObject({ statusCode: 429 });
  });

  it("resets the email+IP counter on success", async () => {
    const t = setup();
    await fail(t, "a@example.com", 9);
    await t.succeeded("account-password", "a@example.com", IP);
    await fail(t, "a@example.com", 10);
    await expect(
      t.attempt("account-password", "a@example.com", IP),
    ).rejects.toMatchObject({ statusCode: 429 });
  });

  it("treats an unknown email, and an unknown IP, like a known one", async () => {
    const t = setup();
    await fail(t, "nobody@example.com", 10, null);
    await expect(
      t.attempt("account-password", "nobody@example.com", null),
    ).rejects.toMatchObject({ statusCode: 429 });
  });

  it("leaves a different account unaffected", async () => {
    const t = setup();
    await fail(t, "a@example.com", 10);
    await expect(
      t.attempt("account-password", "b@example.com", IP),
    ).resolves.toBeUndefined();
  });

  it("keeps password and TOTP budgets apart, so a password success cannot refill TOTP", async () => {
    const t = setup();
    for (let i = 0; i < 10; i++) await t.attempt("account-totp", "user_1", IP);
    await t.succeeded("account-password", "user_1", IP);
    await expect(t.attempt("account-totp", "user_1", IP)).rejects.toMatchObject(
      { statusCode: 429 },
    );
  });

  it("shares the counter across replicas through Valkey and clears it there", async () => {
    const counts = new Map<string, number>();
    const client: ValkeyEvalClient = {
      async eval(script, _n, key) {
        if (script.includes("DEL")) {
          counts.delete(key);
          return [0, 0];
        }
        const n = (counts.get(key) ?? 0) + 1;
        counts.set(key, n);
        return [n, 900_000];
      },
    };
    const replica = () =>
      createAccountThrottle(
        createAuthRateLimitCoordinator({
          isDistributedConfigured: () => true,
          getDistributedClient: () => client,
          setUnsharedMetric: () => {},
          emitWarning: () => {},
        }),
      );
    const [a, b] = [replica(), replica()];
    for (let i = 0; i < 5; i++)
      await a.attempt("account-password", "x@example.com", IP);
    for (let i = 0; i < 5; i++)
      await b.attempt("account-password", "x@example.com", IP);
    await expect(
      a.attempt("account-password", "x@example.com", IP),
    ).rejects.toMatchObject({ statusCode: 429 });
    await b.succeeded("account-password", "x@example.com", IP);
    await expect(
      a.attempt("account-password", "x@example.com", IP),
    ).resolves.toBeUndefined();
  });
});

// The hooks as auth.ts calls them: `accountThrottleBefore(ctx)` / `accountThrottleAfter(ctx)`.
function hookCtx(
  path: string,
  extra: {
    body?: unknown;
    returned?: unknown;
    pendingValue?: string | null;
    newUserId?: string;
    ip?: string;
  } = {},
) {
  const headers = new Headers();
  if (extra.ip) headers.set(TRUSTED_CLIENT_IP_HEADER, extra.ip);
  return {
    path,
    body: extra.body,
    headers,
    getSignedCookie: async () => (extra.pendingValue ? "challenge" : null),
    context: {
      secret: "s",
      returned: extra.returned,
      newSession: extra.newUserId ? { user: { id: extra.newUserId } } : null,
      createAuthCookie: () => ({ name: "two_factor" }),
      internalAdapter: {
        findVerificationValue: async () =>
          extra.pendingValue ? { value: extra.pendingValue } : null,
      },
    },
    // biome-ignore lint/suspicious/noExplicitAny: a minimal better-auth hook context
  } as any;
}

describe("account throttle hooks as auth.ts wires them", () => {
  it("counts /sign-in/email by body email and the trusted client IP, then 429s with the standard body", async () => {
    const t = setup();
    const ctx = () =>
      hookCtx("/sign-in/email", {
        body: { email: "A@example.com" },
        ip: IP,
      });
    for (let i = 0; i < 10; i++) await accountThrottleBefore(ctx(), t);
    await expect(accountThrottleBefore(ctx(), t)).rejects.toMatchObject(
      body429,
    );
    // Another address is still served.
    await expect(
      accountThrottleBefore(
        hookCtx("/sign-in/email", {
          body: { email: "a@example.com" },
          ip: "203.0.113.9",
        }),
        t,
      ),
    ).resolves.toBeUndefined();
  });

  it("ignores other paths and a sign-in body without an email", async () => {
    const t = setup();
    for (let i = 0; i < 20; i++) {
      await accountThrottleBefore(
        hookCtx("/sign-up/email", { body: { email: "a@example.com" } }),
        t,
      );
      await accountThrottleBefore(hookCtx("/sign-in/email", { body: {} }), t);
    }
  });

  it.each(["/two-factor/verify-totp", "/two-factor/verify-backup-code"])(
    "counts %s against the pending challenge's account",
    async (path) => {
      const t = setup();
      const ctx = () => hookCtx(path, { pendingValue: "user_1", ip: IP });
      const noSession = async () => null;
      for (let i = 0; i < 10; i++)
        await accountThrottleBefore(ctx(), t, noSession);
      await expect(
        accountThrottleBefore(ctx(), t, noSession),
      ).rejects.toMatchObject(body429);
    },
  );

  it.each(["/two-factor/verify-totp", "/two-factor/verify-backup-code"])(
    "%s charges the signed-in account, not a pending challenge for another account",
    async (path) => {
      const t = setup();
      const session = async () => ({ user: { id: "user_A" } });
      const ctx = () => hookCtx(path, { pendingValue: "user_B", ip: IP });
      for (let i = 0; i < 10; i++)
        await accountThrottleBefore(ctx(), t, session);
      await expect(
        accountThrottleBefore(ctx(), t, session),
      ).rejects.toMatchObject(body429);
      // B's budget was never touched.
      await expect(
        accountThrottleBefore(ctx(), t, async () => ({
          user: { id: "user_B" },
        })),
      ).resolves.toBeUndefined();
    },
  );

  it("lets a factor request with no pending challenge through to the endpoint's own 401", async () => {
    const t = setup();
    for (let i = 0; i < 20; i++)
      await accountThrottleBefore(
        hookCtx("/two-factor/verify-totp", { pendingValue: null }),
        t,
        async () => null,
      );
  });

  it.each(["/two-factor/verify-totp", "/two-factor/verify-backup-code"])(
    "counts %s against the signed-in session's account when no challenge is pending",
    async (path) => {
      const t = setup();
      const session = async () => ({ user: { id: "user_1" } });
      const ctx = () => hookCtx(path, { pendingValue: null, ip: IP });
      for (let i = 0; i < 10; i++)
        await accountThrottleBefore(ctx(), t, session);
      await expect(
        accountThrottleBefore(ctx(), t, session),
      ).rejects.toMatchObject(body429);
      // A success on the same session resets that same counter.
      await accountThrottleAfter(ctx(), t, session);
      await expect(
        accountThrottleBefore(ctx(), t, session),
      ).resolves.toBeUndefined();
    },
  );

  it("after: a success resets the email+IP counter, a returned Error does not", async () => {
    const t = setup();
    const before = () =>
      hookCtx("/sign-in/email", { body: { email: "a@example.com" }, ip: IP });
    for (let i = 0; i < 9; i++) await accountThrottleBefore(before(), t);

    await accountThrottleAfter(
      hookCtx("/sign-in/email", {
        body: { email: "a@example.com" },
        ip: IP,
        returned: new Error("bad password"),
      }),
      t,
    );
    await accountThrottleBefore(before(), t); // 10th, still allowed
    await expect(accountThrottleBefore(before(), t)).rejects.toMatchObject({
      statusCode: 429,
    });

    await accountThrottleAfter(
      hookCtx("/sign-in/email", {
        body: { email: "a@example.com" },
        ip: IP,
        returned: { ok: true },
      }),
      t,
    );
    await expect(accountThrottleBefore(before(), t)).resolves.toBeUndefined();
  });

  it("after: a verified factor resets the TOTP counter for that user and IP", async () => {
    const t = setup();
    const path = "/two-factor/verify-totp";
    const before = () => hookCtx(path, { pendingValue: "user_1", ip: IP });
    for (let i = 0; i < 10; i++) await accountThrottleBefore(before(), t);
    await accountThrottleAfter(
      hookCtx(path, { newUserId: "user_1", ip: IP }),
      t,
    );
    await expect(accountThrottleBefore(before(), t)).resolves.toBeUndefined();
  });
});

describe("auth rate-limit reset with a stalled Valkey", () => {
  it("returns within the bounded timeout, clears memory, and swallows a late rejection", async () => {
    let rejectEval: ((e: Error) => void) | undefined;
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const c = createAuthRateLimitCoordinator({
        isDistributedConfigured: () => true,
        getDistributedClient: () => ({
          eval: () =>
            new Promise<unknown>((_, reject) => {
              rejectEval = reject;
            }),
        }),
        distributedTimeoutMs: 10,
        setUnsharedMetric: () => {},
        emitWarning: () => {},
      });
      const rule = { window: 10, max: 1 };
      await c.consume("agent", "k", rule); // stalled: falls back to memory
      const started = Date.now();
      await c.reset("agent", "k", rule);
      expect(Date.now() - started).toBeLessThan(500);
      rejectEval?.(new Error("late"));
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).not.toHaveBeenCalled();
      expect((await c.consume("agent", "k", rule)).allowed).toBe(true);
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
