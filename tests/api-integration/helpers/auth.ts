import type { Session, User } from "better-auth/types";
import { afterEach, vi } from "vitest";
import { auth, portalAuth } from "../../../apps/api/src/auth";

function createSession(
  userId: string,
  overrides: { impersonatedBy?: string; portal?: "agent" | "customer" } = {},
): Session & { impersonatedBy?: string; portal: "agent" | "customer" } {
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
    portal: overrides.portal ?? "agent",
    ...overrides,
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
type MockSessionUser = Omit<User, "twoFactorEnabled"> & {
  role?: string | null;
  twoFactorEnabled?: boolean | null;
};

type ActiveSessionMock = {
  baseAgent: typeof auth;
  basePortal: typeof portalAuth;
  agentSpy: unknown;
  portalSpy: unknown;
  reboundAgents: Map<typeof auth, unknown>;
  reboundPortals: Map<typeof portalAuth, unknown>;
};

let activeSessionMock: ActiveSessionMock | undefined;

function restoreReboundInstances(state: ActiveSessionMock) {
  for (const spy of state.reboundAgents.values()) {
    (spy as { mockRestore?: () => void }).mockRestore?.();
  }
  for (const spy of state.reboundPortals.values()) {
    (spy as { mockRestore?: () => void }).mockRestore?.();
  }
  state.reboundAgents.clear();
  state.reboundPortals.clear();
}

function rebindCurrentAuthInstances() {
  const state = activeSessionMock;
  if (!state) return;

  // `vi.restoreAllMocks()` restores the original fixture targets. This check prevents
  // a stale session mock from being copied into a replacement auth object afterward.
  if (
    !vi.isMockFunction(state.baseAgent.api.getSession) ||
    !vi.isMockFunction(state.basePortal.api.getSession)
  ) {
    restoreReboundInstances(state);
    activeSessionMock = undefined;
    return;
  }

  if (auth !== state.baseAgent && !state.reboundAgents.has(auth)) {
    const relay = vi
      .spyOn(auth.api, "getSession")
      .mockImplementation(state.agentSpy as never);
    state.reboundAgents.set(auth, relay);
  }
  if (
    portalAuth !== state.basePortal &&
    !state.reboundPortals.has(portalAuth)
  ) {
    const relay = vi
      .spyOn(portalAuth.api, "getSession")
      .mockImplementation(state.portalSpy as never);
    state.reboundPortals.set(portalAuth, relay);
  }
}

/** Rebind active explicit fixture spies after auth configuration replaces its instances. */
export function rebindMockAuthenticatedSession() {
  rebindCurrentAuthInstances();
}

afterEach(() => {
  if (activeSessionMock) {
    restoreReboundInstances(activeSessionMock);
    activeSessionMock = undefined;
  }
});

export function mockAuthenticatedSession(
  user: MockSessionUser,
  sessionOverrides: {
    impersonatedBy?: string;
    portal?: "agent" | "customer";
  } = {},
) {
  if (activeSessionMock) {
    restoreReboundInstances(activeSessionMock);
    activeSessionMock = undefined;
  }
  const result = {
    session: createSession(user.id, sessionOverrides),
    user: { ...user, twoFactorEnabled: user.twoFactorEnabled ?? false },
  };
  const baseAgent = auth;
  const basePortal = portalAuth;
  const agentMock = vi
    .spyOn(baseAgent.api, "getSession")
    .mockResolvedValue(result);
  const portalMock = vi
    .spyOn(basePortal.api, "getSession")
    .mockResolvedValue(result);
  activeSessionMock = {
    baseAgent,
    basePortal,
    agentSpy: agentMock,
    portalSpy: portalMock,
    reboundAgents: new Map(),
    reboundPortals: new Map(),
  };
  return agentMock;
}

export function mockAnonymousSession() {
  if (activeSessionMock) {
    restoreReboundInstances(activeSessionMock);
    activeSessionMock = undefined;
  }
  const baseAgent = auth;
  const basePortal = portalAuth;
  const agentMock = vi
    .spyOn(baseAgent.api, "getSession")
    .mockResolvedValue(null);
  const portalMock = vi
    .spyOn(basePortal.api, "getSession")
    .mockResolvedValue(null);
  activeSessionMock = {
    baseAgent,
    basePortal,
    agentSpy: agentMock,
    portalSpy: portalMock,
    reboundAgents: new Map(),
    reboundPortals: new Map(),
  };
  return agentMock;
}
