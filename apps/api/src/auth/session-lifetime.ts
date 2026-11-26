import { invalidateNativeAuthorization } from "../ws";
import { deleteSessionById, getStaffSessionMaxDaysSetting } from "./repository";

export const STAFF_SESSION_MAX_DAYS_DEFAULT = 30;
export const STAFF_SESSION_MAX_DAYS_MIN = 1;
export const STAFF_SESSION_MAX_DAYS_MAX = 90;

const DAY_MS = 86_400_000;
// shortcut: per-replica cache, a lowered cap reaches other replicas within this many ms.
const CAP_CACHE_MS = 15_000;
let cached: { days: number; at: number } | null = null;

/** The PATCH route calls this so the replica that saved the cap applies it at once. */
export function resetStaffSessionCapCache() {
  cached = null;
}

async function readStaffSessionMaxDays(): Promise<number> {
  if (cached && Date.now() - cached.at < CAP_CACHE_MS) return cached.days;
  const days =
    (await getStaffSessionMaxDaysSetting()) ?? STAFF_SESSION_MAX_DAYS_DEFAULT;
  cached = { days, at: Date.now() };
  return days;
}

async function revokeSession(session: { id: string; userId: string }) {
  await deleteSessionById(session.id);
  await invalidateNativeAuthorization({ userId: session.userId });
}

export type StaffSessionCapDeps = {
  getMaxDays?: () => Promise<number>;
  revoke?: (session: { id: string; userId: string }) => Promise<void>;
  now?: () => number;
};

/**
 * True when a staff (agent portal) session is older than the instance cap by its creation time,
 * regardless of sliding refresh; the session is revoked before returning. Portal sessions are
 * never touched.
 */
export async function enforceStaffSessionCap(
  session: { id: string; userId: string; portal?: string; createdAt: Date },
  deps: StaffSessionCapDeps = {},
): Promise<boolean> {
  if (session.portal !== "agent") return false;
  const maxDays = await (deps.getMaxDays ?? readStaffSessionMaxDays)();
  const ageMs = (deps.now ?? Date.now)() - session.createdAt.getTime();
  if (ageMs <= maxDays * DAY_MS) return false;
  await (deps.revoke ?? revokeSession)(session);
  return true;
}
