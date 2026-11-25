import { APIError, type createAuthMiddleware } from "better-auth/api";
import { TRUSTED_CLIENT_IP_HEADER } from "../utils/resolve-client-ip";
import {
  type AuthRateLimitCoordinator,
  type AuthRateLimitRule,
  consumeSharedAuthRateLimit,
  resetSharedAuthRateLimit,
} from "./rate-limit-storage";

/**
 * Per-account sign-in throttle with two counters per attempt, both in the shared auth rate-limit
 * store (so they hold across replicas): 10 failures / 15 minutes for one normalised email (password)
 * or account (TOTP, backup code) from one client IP, and 100 / 15 minutes for that email across all
 * IPs. The per-IP counter means a stranger who knows an email cannot lock the owner out from
 * another address; the wide one stops distributed guessing. Over budget answers 429 even for the
 * right secret. A success resets the email+IP counter only; the wide one expires. The key is the
 * email whether or not the account exists, so an unknown email answers like a known one. The
 * per-IP limiter in `rate-limit-rules.ts` is unchanged.
 */
export const ACCOUNT_THROTTLE_RULE: AuthRateLimitRule = {
  window: 15 * 60,
  max: 10,
};
export const ACCOUNT_THROTTLE_ALL_IPS_RULE: AuthRateLimitRule = {
  window: 15 * 60,
  max: 100,
};

type Kind = "account-password" | "account-totp";
type Throttle = Pick<AuthRateLimitCoordinator, "consume" | "reset">;

export const normaliseAccountKey = (value: string) =>
  value.trim().toLowerCase();

const perIpKey = (key: string, ip: string | null) =>
  `${normaliseAccountKey(key)}\0${ip ?? "unknown"}`;

export function createAccountThrottle(
  store: Throttle = {
    consume: consumeSharedAuthRateLimit,
    reset: resetSharedAuthRateLimit,
  },
) {
  const refuse = () =>
    new APIError("TOO_MANY_REQUESTS", {
      message: "Too many requests. Please try again later.",
    });
  return {
    /** Counts one attempt; throws the limiter's own 429 once either budget is spent. */
    async attempt(kind: Kind, key: string, ip: string | null) {
      const own = await store.consume(
        kind,
        perIpKey(key, ip),
        ACCOUNT_THROTTLE_RULE,
      );
      if (!own.allowed) throw refuse();
      // A blocked IP does not drain the shared budget, so it cannot lock out the others.
      const wide = await store.consume(
        kind,
        normaliseAccountKey(key),
        ACCOUNT_THROTTLE_ALL_IPS_RULE,
      );
      if (!wide.allowed) throw refuse();
    },
    succeeded: (kind: Kind, key: string, ip: string | null) =>
      store.reset(kind, perIpKey(key, ip), ACCOUNT_THROTTLE_RULE),
  };
}

const SIGN_IN = "/sign-in/email";
const FACTOR_PATHS = [
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
];

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

// The same resolved address the per-IP limiter keys on (see `advanced.ipAddress` in auth.ts).
const clientIp = (ctx: HookContext) =>
  ctx.headers?.get(TRUSTED_CLIENT_IP_HEADER) ?? null;

/** `hooks.before` step: counts the attempt and refuses it with 429 once the budget is spent. */
export async function accountThrottleBefore(
  ctx: HookContext,
  throttle = createAccountThrottle(),
) {
  if (ctx.path === SIGN_IN) {
    if (typeof ctx.body?.email === "string")
      await throttle.attempt("account-password", ctx.body.email, clientIp(ctx));
    return;
  }
  if (!FACTOR_PATHS.includes(ctx.path ?? "")) return;
  // The pending challenge names the account; with none the endpoint answers 401 anyway.
  const cookie = ctx.context.createAuthCookie("two_factor");
  const id = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  const pending = id
    ? await ctx.context.internalAdapter.findVerificationValue(id)
    : null;
  if (pending)
    await throttle.attempt("account-totp", pending.value, clientIp(ctx));
}

/** `hooks.after` step: a success clears the counter, a failure leaves it counted. */
export async function accountThrottleAfter(
  ctx: HookContext,
  throttle = createAccountThrottle(),
) {
  if (ctx.context.returned instanceof Error) return;
  if (ctx.path === SIGN_IN) {
    if (typeof ctx.body?.email === "string")
      await throttle.succeeded(
        "account-password",
        ctx.body.email,
        clientIp(ctx),
      );
    return;
  }
  const userId = FACTOR_PATHS.includes(ctx.path ?? "")
    ? ctx.context.newSession?.user.id
    : undefined;
  if (userId) await throttle.succeeded("account-totp", userId, clientIp(ctx));
}
