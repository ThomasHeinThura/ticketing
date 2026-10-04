import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { getBrowserLocale, i18n, resolveLocale } from "@/lib/i18n";
import { routeTree } from "../src/routeTree.portal.gen";
import "@/index.css";

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

function PortalApplication() {
  const locale = resolveLocale(null, getBrowserLocale());

  useEffect(() => {
    void i18n.changeLanguage(locale);
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Portal root element is missing.");

createRoot(rootElement).render(
  <StrictMode>
    <PortalApplication />
  </StrictMode>,
);
