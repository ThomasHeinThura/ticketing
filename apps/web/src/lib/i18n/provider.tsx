import { type PropsWithChildren, useEffect, useMemo } from "react";
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

  const resolvedLocale = useMemo(
    () => resolveLocale(user?.locale, getBrowserLocale()),
    [user?.locale],
  );

  useEffect(() => {
    void i18n
      .changeLanguage(resolvedLocale)
      .then(() => preloadNamespaces(resolvedLocale));
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
