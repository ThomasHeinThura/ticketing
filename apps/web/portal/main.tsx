import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { capturePasswordResetToken } from "../src/lib/password-reset-token";
import { portalRoutePendingOptions } from "../src/lib/route-pending";
import { PortalApplicationProviders } from "../src/portal/portal-application-providers";
import { routeTree } from "../src/routeTree.portal.gen";
import "@/portal.css";

capturePasswordResetToken();

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  ...portalRoutePendingOptions,
  // The server registers portal routes case-sensitively (CP-19): a mis-cased address is a 404
  // there, so the client shows the not-found page for it too instead of the real page.
  caseSensitive: true,
});

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Portal root element is missing.");

createRoot(rootElement).render(
  <StrictMode>
    <PortalApplicationProviders>
      <RouterProvider router={router} />
    </PortalApplicationProviders>
  </StrictMode>,
);
