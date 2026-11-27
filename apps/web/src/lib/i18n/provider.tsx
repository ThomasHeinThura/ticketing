import { type PropsWithChildren, useEffect, useMemo, useState } from "react";
import { I18nextProvider } from "react-i18next";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import {
  getBrowserLocale,
  i18n,
  preloadNamespaces,
  resolveLocale,
  switchLanguage,
} from "./index";
import { TerminologyProvider } from "./terminology-provider";

export function AppI18nProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();

  const resolvedLocale = useMemo(
    () => resolveLocale(user?.locale, getBrowserLocale()),
    [user?.locale],
  );
  // The language the page actually shows. It follows `resolvedLocale` only after the complete
  // new locale has loaded, so terminology clones and the document never run ahead of the base
  // instance and no frame mixes two languages.
  const [activeLocale, setActiveLocale] = useState(() =>
    resolveLocale(i18n.language, getBrowserLocale()),
  );

  useEffect(() => {
    let current = true;
    void switchLanguage(resolvedLocale).then((applied) => {
      if (!current || !applied) return;
      setActiveLocale(resolvedLocale);
      document.documentElement.lang = resolvedLocale;
      return preloadNamespaces(resolvedLocale);
    });
    return () => {
      current = false;
    };
  }, [resolvedLocale]);

  return (
    <I18nextProvider i18n={i18n}>
      <TerminologyProvider audience="agent" locale={activeLocale}>
        {children}
      </TerminologyProvider>
    </I18nextProvider>
  );
}
