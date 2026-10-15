import useAuth from "@/components/providers/auth-provider/hooks/use-auth";

/**
 * The instance-administrator signal the app already uses client-side (the session user's
 * `role === "admin"`, as in the workspace switcher and approvals). It only decides what is
 * rendered; every request is still authorised by the API, whose 403 is handled as before.
 */
export function useInstanceAdminSignal(): boolean {
  const { user } = useAuth();
  return (
    (user as { role?: string | null } | null | undefined)?.role === "admin"
  );
}
