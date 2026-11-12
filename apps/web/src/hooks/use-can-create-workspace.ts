import { authClient } from "@/lib/auth-client";

/**
 * Whether to offer "create workspace" at all. Only an instance administrator may create a
 * workspace (owner decision D-A, 12 Nov 2026), so every entry point (the workspace switcher,
 * the command palette, the shortcut, the `/dashboard/workspace/create` route and onboarding)
 * asks this one question. The server stays the authority: it re-reads the role from the
 * database on every create and refuses anyone else.
 */
export default function useCanCreateWorkspace(): boolean {
  const { data: session } = authClient.useSession();
  return session?.user?.role === "admin";
}
