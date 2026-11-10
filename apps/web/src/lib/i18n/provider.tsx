import { type PropsWithChildren, useEffect, useMemo, useRef } from "react";
import { I18nextProvider } from "react-i18next";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import {
  getBrowserLocale,
  i18n,
  preloadNamespaces,
  resolveLocale,
} from "./index";
import { TerminologyProvider } from "./terminology-provider";

export function AppI18nProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const pendingLocale = useRef<string | null>(null);

  const resolvedLocale = useMemo(
    () => resolveLocale(user?.locale, getBrowserLocale()),
    [user?.locale],
  );

  useEffect(() => {
    if (i18n.language !== resolvedLocale || pendingLocale.current !== null) {
      pendingLocale.current = resolvedLocale;
      void i18n.changeLanguage(resolvedLocale).then(() => {
        if (pendingLocale.current === resolvedLocale)
          pendingLocale.current = null;
        return preloadNamespaces(resolvedLocale);
      });
    } else {
      void preloadNamespaces(resolvedLocale);
    }
    document.documentElement.lang = resolvedLocale;
  }, [resolvedLocale]);

  return (
    <I18nextProvider i18n={i18n}>
      <TerminologyProvider audience="agent" locale={resolvedLocale}>
        {children}
      </TerminologyProvider>
    </I18nextProvider>
  );
}
