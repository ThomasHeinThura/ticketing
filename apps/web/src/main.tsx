import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { Button, ToastProvider } from "@taskdesk/ui";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";
import queryClient from "@/query-client";
import "@/index.css";
import { useAuth } from "@/components/providers/auth-provider/hooks/use-auth";
import { AppErrorBoundary } from "./components/app-error-boundary";
import { ServerErrorNotifications } from "./components/errors/server-error-notifications";
import KeyboardShortcutsHelpLauncher from "./components/keyboard-shortcuts-help-launcher";
import { PageLoadingAnnouncer } from "./components/page-loading-announcer";
import AuthProvider from "./components/providers/auth-provider";
import { DeferredUserPreferencesSync } from "./components/providers/deferred-user-preferences-sync";
import { ThemeProvider } from "./components/providers/theme-provider";
import { UserPreferencesEffects } from "./components/providers/user-preferences-effects";
import { KeyboardShortcutsProvider } from "./hooks/use-keyboard-shortcuts";
import { followAgentSession } from "./lib/agent-session";
import { AppI18nProvider } from "./lib/i18n/provider";
import { initializeNotificationPreferenceHandoff } from "./lib/notification-preference-handoff";
import { capturePasswordResetToken } from "./lib/password-reset-token";
import { createRouterParseSearch } from "./lib/project-board-search";
import { routePendingOptions } from "./lib/route-pending";
import { parseWorkItemListSearchFromQueryString } from "./lib/routes";
import { routeTree } from "./routeTree.agent.gen";

// UX-8: the branded not-found page is fetched only when an unknown address is opened, so it
// stays out of the entry and the work route's first-paint chunks (G11). A failed chunk reaches
// the route error component like any other.
const LazyAgentNotFound = lazy(() =>
  import("./components/agent-not-found").then((module) => ({
    default: module.AgentNotFound,
  })),
);

function AgentNotFoundPage() {
  return (
    <Suspense fallback={null}>
      <LazyAgentNotFound />
    </Suspense>
  );
}

// Strip signed email fragments synchronously, then finish the bounded cookie
// handoff before any router or authentication redirect can run.
capturePasswordResetToken();
void initializeNotificationPreferenceHandoff().then(
  bootstrapApplication,
  () => {},
);

function bootstrapApplication() {
  console.log(`
                     ////////  
              /////  ////////  
            //////// ////////  
  //////// ///////// ///////   
  //////// ///////// //////    
  //////// ///////// ////      
  //////// ///////// ///       
  //////// ///////// /////     
  //////// ///////// //////    
  //////// ///////// ////////  
  //////// ///////// ////////  
  //////// ///////// ////////  
  //////// ////////            
  ////////  /////              
  ///////                      
                   
  
  All you need. Nothing you don't.
`);

  const router = createRouter({
    routeTree,
    parseSearch: createRouterParseSearch(() =>
      typeof window === "undefined" ? undefined : window.location.pathname,
    ),
    defaultPreload: "intent",
    ...routePendingOptions,
    defaultPreloadStaleTime: 0,
    // UX-8: an unknown address shows the branded page inside whichever shell caught it, never
    // the router's bare "Not Found" text.
    defaultNotFoundComponent: AgentNotFoundPage,
    context: {
      user: null,
      queryClient,
    },
  });

  // The route checks use the session kept in the query client (S7b). Better Auth's session
  // store seeds it, and a sign-out, revoked session or identity change re-runs the checks.
  followAgentSession(queryClient, () => {
    void router.invalidate();
  });

  // The project work route is the agent's primary seeded list surface. TanStack's
  // automatic route splitting puts its screen component behind a separate chunk;
  // preload that chunk as soon as the router is created on a direct work-list visit
  // so it can download while the router/provider mounts, before the route renders.
  const workRoute = location.pathname.match(
    /^\/agent\/projects\/([^/]+)\/work\/?$/,
  );
  if (workRoute) {
    try {
      const projectKey = decodeURIComponent(workRoute[1]);
      // Route preloading still executes route `beforeLoad` checks; it does not mount
      // the screen or run its query hooks. A malformed URL simply skips this hint.
      void router
        .preloadRoute({
          to: "/agent/projects/$projectKey/work",
          params: { projectKey },
          search: parseWorkItemListSearchFromQueryString(location.search),
        })
        .catch(() => {});
    } catch {
      // Leave malformed percent-encoding to normal router error handling.
    }
  }

  function App() {
    const { user } = useAuth();

    return <RouterProvider router={router} context={{ user }} />;
  }

  // Root boundary fallback: shows a generic message and a refresh button,
  // without rendering the raw error.message. The full error is still
  // handled by the boundary itself.
  function RootCrashFallback({
    resetError,
  }: {
    error: Error;
    resetError: () => void;
  }) {
    const { t } = useTranslation();

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold text-foreground">
            {t("common:error.title")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("common:error.description")}
          </p>
          <Button
            variant="default"
            type="button"
            onClick={resetError}
            className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t("common:error.refreshPage")}
          </Button>
        </div>
      </div>
    );
  }

  const rootElement = document.getElementById("root") as HTMLElement;
  if (!rootElement.innerHTML) {
    const root = createRoot(rootElement);
    root.render(
      <StrictMode>
        <AppErrorBoundary fallback={RootCrashFallback}>
          <QueryClientProvider client={queryClient}>
            <ThemeProvider>
              <ToastProvider position="bottom-right">
                <ServerErrorNotifications />
                <UserPreferencesEffects />
                <AuthProvider>
                  <DeferredUserPreferencesSync />
                  <AppI18nProvider>
                    <PageLoadingAnnouncer>
                      <KeyboardShortcutsProvider>
                        <App />
                        <KeyboardShortcutsHelpLauncher />
                      </KeyboardShortcutsProvider>
                    </PageLoadingAnnouncer>
                  </AppI18nProvider>
                </AuthProvider>
              </ToastProvider>
            </ThemeProvider>
          </QueryClientProvider>
        </AppErrorBoundary>
      </StrictMode>,
    );
  }
}
