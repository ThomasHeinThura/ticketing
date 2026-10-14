import {
  type AppLocale,
  defaultLocale,
  isSupportedLocale,
  loadLocale,
  supportedLocales,
} from "@i18n/resources";
import i18n from "i18next";
import resourcesToBackend from "i18next-resources-to-backend";
import { initReactI18next } from "react-i18next";
import { afterFirstPaint } from "./after-first-paint";
import {
  WORK_LIST_PATH_PATTERN,
  WORK_ROUTE_I18N_NAMESPACES,
} from "./work-route-namespaces";

function getLanguageCode(locale: string) {
  return locale.toLowerCase().split("-")[0];
}

export function resolveLocale(
  preferredLocale?: string | null,
  browserLocale?: string | null,
): AppLocale {
  const candidates = [preferredLocale, browserLocale].filter(
    (value): value is string => Boolean(value),
  );

  for (const candidate of candidates) {
    const normalizedCandidate = candidate.toLowerCase();
    const exactMatch = supportedLocales.find(
      (locale) => locale.toLowerCase() === normalizedCandidate,
    );
    if (exactMatch) return exactMatch;

    const languageMatch = supportedLocales.find(
      (locale) => getLanguageCode(locale) === getLanguageCode(candidate),
    );
    if (languageMatch) return languageMatch;
  }

  return defaultLocale;
}

export function getBrowserLocale(): string | null {
  if (typeof navigator === "undefined") return null;
  return navigator.language || navigator.languages?.[0] || null;
}

// A direct visit to the work-list route loads only the namespaces that route paints with and
// the rest after its first paint, so the full catalog is not on the route's critical path (G11).
// Every other entry point keeps loading the whole locale before it renders.
const useNamespaceGroups =
  typeof window !== "undefined" &&
  WORK_LIST_PATH_PATTERN.test(window.location.pathname);

type NamespaceGroup = "slim" | "rest";

const groupResources = new Map<string, Promise<Record<string, unknown>>>();

// Two separate call sites: the bundler preloads a dynamic import's dependencies per call, and a
// conditional expression would make the first-paint group also fetch the deferred one's loader.
function importGroupLoaders(group: NamespaceGroup) {
  if (group === "slim") return import("virtual:taskdesk-i18n/loaders-slim");
  return import("virtual:taskdesk-i18n/loaders-rest");
}

function loadGroup(
  group: NamespaceGroup,
  locale: AppLocale,
): Promise<Record<string, unknown>> {
  const key = `${group}:${locale}`;
  const cached = groupResources.get(key);
  if (cached) return cached;
  const pending = importGroupLoaders(group)
    .then((loaders) => loaders.default[locale]())
    .then((module) => module.default)
    .catch((error: unknown) => {
      groupResources.delete(key);
      throw error;
    });
  groupResources.set(key, pending);
  return pending;
}

async function loadNamespaceFromGroups(locale: AppLocale, namespace: string) {
  const slim = await loadGroup("slim", locale);
  if (namespace in slim) return slim[namespace];
  return (await loadGroup("rest", locale))[namespace];
}

// Components subscribe to the default namespace only, so any other namespace
// they reference through `t("ns:key")` must be preloaded after init and on
// every locale change. The lazy backend already returns the whole locale JSON,
// so cache it once per locale to avoid a fresh dynamic import per namespace.
const localeResources = new Map<AppLocale, Promise<Record<string, unknown>>>();

function loadLocaleResources(
  locale: AppLocale,
): Promise<Record<string, unknown>> {
  const cached = localeResources.get(locale);
  if (cached) return cached;
  const pending = loadLocale(locale).then(
    (resources) => resources as Record<string, unknown>,
  );
  localeResources.set(locale, pending);
  return pending;
}

export function preloadNamespaces(locale: AppLocale): Promise<void> {
  if (useNamespaceGroups)
    return afterFirstPaint()
      .then(() => loadGroup("rest", locale))
      .then((resources) => i18n.loadNamespaces(Object.keys(resources)));
  return loadLocaleResources(locale).then((resources) =>
    i18n.loadNamespaces(Object.keys(resources)),
  );
}

const initialLocale = resolveLocale(null, getBrowserLocale());

void i18n
  .use(
    resourcesToBackend((language: string, namespace: string) => {
      const locale = isSupportedLocale(language) ? language : defaultLocale;
      if (useNamespaceGroups) return loadNamespaceFromGroups(locale, namespace);
      return loadLocaleResources(locale).then(
        (resources) => resources[namespace],
      );
    }),
  )
  .use(initReactI18next)
  .init({
    lng: initialLocale,
    fallbackLng: defaultLocale,
    defaultNS: "common",
    ...(useNamespaceGroups
      ? {
          ns: [...WORK_ROUTE_I18N_NAMESPACES],
          // A namespace that arrives after first paint re-renders the components that
          // already asked for it instead of leaving their keys on screen.
          react: { bindI18nStore: "added" },
        }
      : {}),
    interpolation: {
      escapeValue: false,
    },
  })
  .then(() => preloadNamespaces(initialLocale));

export { i18n };
