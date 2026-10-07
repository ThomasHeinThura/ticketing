import type { Context } from "hono";
import { getUserRole } from "./repository";

export async function isInstanceAdmin(c: Context): Promise<boolean> {
  const user = c.get("user") as { role?: string | null } | null | undefined;
  if (user?.role) {
    return user.role === "admin";
  }

  const userId = c.get("userId");
  if (!userId) return false;

  const [row] = await getUserRole(userId);

  return row?.role === "admin";
}
