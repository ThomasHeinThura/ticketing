import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PortalApplicationProviders } from "../src/portal/portal-application-providers";
import { routeTree } from "../src/routeTree.portal.gen";
import "@/index.css";

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
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
