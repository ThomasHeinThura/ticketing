import { QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@taskdesk/ui";
import { type PropsWithChildren, useEffect } from "react";
import { I18nextProvider } from "react-i18next";
import { ServerErrorNotifications } from "@/components/errors/server-error-notifications";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { getBrowserLocale, i18n, resolveLocale } from "@/lib/i18n";
import { TerminologyProvider } from "@/lib/i18n/terminology-provider";
import queryClient from "@/query-client";

export function PortalApplicationProviders({ children }: PropsWithChildren) {
  const locale = resolveLocale(null, getBrowserLocale());

  useEffect(() => {
    void i18n.changeLanguage(locale);
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider followSystemWhenUnset>
        <I18nextProvider i18n={i18n}>
          <TerminologyProvider audience="customer" locale={locale}>
            <ToastProvider position="bottom-right">
              <ServerErrorNotifications />
              {children}
            </ToastProvider>
          </TerminologyProvider>
        </I18nextProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
