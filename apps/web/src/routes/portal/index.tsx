import { createFileRoute, redirect } from "@tanstack/react-router";
import { portalAuthClient } from "@/lib/portal-auth-client";

// The portal host root sends a signed-in customer to the request catalogue and everyone
// else to sign-in (decision log 2026-10-20: the portal uses host-root URLs).
export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    let signedIn = false;
    try {
      const session = await portalAuthClient.getSession();
      signedIn = Boolean(!session.error && session.data?.session);
    } catch {
      signedIn = false;
    }
    throw redirect({ to: signedIn ? "/catalogue" : "/sign-in" });
  },
});
