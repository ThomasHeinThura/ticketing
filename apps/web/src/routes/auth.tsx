import { createFileRoute, redirect } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/auth")({
  beforeLoad: async ({ location }) => {
    let session = null;
    try {
      const { data } = await authClient.getSession();
      session = data;
    } catch (error) {
      if (import.meta.env.DEV) console.warn("getSession failed", error);
      // getSession() rejected (e.g. network error) — treat as unauthenticated, allow auth pages to render
    }
    // Enrollment is the one authenticated screen under the auth path. The page
    // verifies its own session before exposing any setup material.
    if (session && location.pathname !== "/auth/mfa/enrol") {
      throw redirect({
        to: "/dashboard",
      });
    }
    return { session };
  },
});
