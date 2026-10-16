import type { Context } from "hono";
import { findUserRole } from "./access-lookups.repository";

export async function isInstanceAdmin(c: Context): Promise<boolean> {
  const user = c.get("user") as { role?: string | null } | null | undefined;
  if (user?.role) {
    return user.role === "admin";
  }

  const userId = c.get("userId");
  if (!userId) return false;

  const row = await findUserRole(userId);

  return row?.role === "admin";
}
