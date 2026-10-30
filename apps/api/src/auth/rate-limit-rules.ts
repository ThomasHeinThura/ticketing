/**
 * better-auth per-client-IP rate limits (keyed by the trusted client IP; see auth.ts).
 *
 * The default (100 requests per 10 s) covers every /api/auth/* path. `/get-session` is a
 * read of the caller's own session, needs a valid session cookie to return anything, and is
 * called on most screen loads. Counting it put every user behind one office IP (NAT, VPN)
 * into one shared 10 s budget, so a busy office got 429s and error screens. It is exempt
 * (Thomas, 30 Oct 2026); sign-in, sign-up, invitations and every other auth path keep the
 * limit.
 */
export const AUTH_RATE_LIMIT = {
  enabled: true,
  window: 10,
  max: 100,
  customRules: {
    "/sign-up/email": { window: 60, max: 3 },
    "/get-session": false,
  },
} as const;
