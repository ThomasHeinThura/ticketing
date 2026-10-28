import type { i18n as I18nInstance, TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { i18n as baseI18n } from "./index";

type PortalTranslate = TFunction;

/**
 * Add the closed customer request noun forms to each portal translation call.
 * Values are read from the provider's isolated i18next instance and override
 * caller values with the same names. i18next's skipOnVariables setting keeps
 * both these nouns and user supplied interpolation text literal.
 */
export function withPortalTerminology<T extends PortalTranslate>(
  translate: T,
  instance?: I18nInstance,
): T {
  if (!instance) return translate;
  const wrapped = ((key: string, options?: Record<string, unknown>) =>
    translate(key, {
      ...options,
      term_request_one: instance.t("customer.request", {
        ns: "term",
        count: 1,
      }),
      term_request_other: instance.t("customer.request", {
        ns: "term",
        count: 2,
      }),
    })) as T;
  return wrapped;
}

/** Resolve a shipped customer noun for the legacy/default tooltip on renamed controls. */
export function getDefaultPortalTerm(
  instance: I18nInstance | undefined,
  termKey: "request",
  count: number,
) {
  const locale =
    instance?.resolvedLanguage ?? instance?.language ?? baseI18n.language;
  return baseI18n.t(`customer.${termKey}`, {
    ns: "term",
    count,
    lng: locale,
  });
}

export function usePortalTranslation(namespace?: string | readonly string[]) {
  const translation = useTranslation(
    namespace as string | string[] | undefined,
  );
  return {
    ...translation,
    t: withPortalTerminology(translation.t, translation.i18n),
  };
}
