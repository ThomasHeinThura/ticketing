import type { Session, User } from "better-auth/types";
import { vi } from "vitest";
import { auth } from "../../../apps/api/src/auth";

function createSession(userId: string): Session {
  const now = new Date();

  return {
    id: `session-${userId}`,
    token: `token-${userId}`,
    userId,
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
    ipAddress: null,
    userAgent: null,
  };
}

/**
 * The instance-admin bypass (`apps/api/src/utils/is-instance-admin.ts`) reads
 * `user.role` off the session with its own cast, because `role` is a plain
 * `userTable` column, not a better-auth `additionalFields` entry — so the
 * library's own `User` type never carries it. Mirroring that same optional,
 * nullable shape here (rather than widening to the full DB row) lets tests
 * mock a session with `role` set, unset, or explicitly `null`, without
 * masking a real narrowing defect behind a broader type.
 */
type MockSessionUser = User & { role?: string | null };

export function mockAuthenticatedSession(user: MockSessionUser) {
  return vi.spyOn(auth.api, "getSession").mockResolvedValue({
    session: createSession(user.id),
    user,
  });
}

export function mockAnonymousSession() {
  return vi.spyOn(auth.api, "getSession").mockResolvedValue(null);
}
