import {
  type AppLocale,
  defaultLocale,
  isSupportedLocale,
  loadLocale,
  supportedLocales,
} from "@i18n/resources";
import type { i18n as I18nInstance, Resource } from "i18next";
import i18n from "i18next";
import resourcesToBackend from "i18next-resources-to-backend";
import { initReactI18next } from "react-i18next";
import { afterFirstPaint } from "./after-first-paint";
import slimGroupLoaders from "./group-loaders-slim";
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
  import.meta.env.MODE !== "portal" &&
  typeof window !== "undefined" &&
  WORK_LIST_PATH_PATTERN.test(window.location.pathname);

type NamespaceGroup = "slim" | "rest";

const groupResources = new Map<string, Promise<Record<string, unknown>>>();

// The first-paint group's loader table is part of the entry: fetched as its own chunk it was
// the last of the work route's preloads, and every translated component waited for it (G11
// work-list LCP). It is a few hundred bytes of `() => import(...)` per locale (an empty table in
// the portal build); the locale chunks themselves stay separate. The deferred group's table
// stays a separate call site, so loading it never makes the first-paint group fetch it.
function importGroupLoaders(group: NamespaceGroup) {
  if (group === "slim") return Promise.resolve({ default: slimGroupLoaders });
  return import("./group-loaders-rest");
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

// Locales whose deferred group could not be fetched; they are served from the full catalog.
const fullCatalogFallback = new Set<AppLocale>();

async function loadNamespaceFromGroups(locale: AppLocale, namespace: string) {
  if (fullCatalogFallback.has(locale))
    return (await loadLocaleResources(locale))[namespace];
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
  // A failed fetch must not be remembered, or a later retry would never reach the network.
  pending.catch(() => localeResources.delete(locale));
  return pending;
}

const allNamespaces = new Map<AppLocale, Promise<void>>();
const loadedNamespaces = new Set<AppLocale>();

export function areAllNamespacesLoaded(localeInput = i18n.language): boolean {
  return (
    !useNamespaceGroups ||
    loadedNamespaces.has(resolveLocale(localeInput, getBrowserLocale()))
  );
}

/**
 * Runtime-scoped instances (terminology clones) created in group mode. They are seeded with the
 * first-paint namespaces only, and components under them read `t("ns:key")` through their own
 * store, so every namespace the base instance loads must reach them too.
 */
const scopedGroupInstances = new Map<AppLocale, Set<I18nInstance>>();

/** The deferred group of a locale: one retry, then the full catalog from its own chunk. */
async function loadRestResources(
  locale: AppLocale,
): Promise<Record<string, unknown>> {
  try {
    return await loadGroup("rest", locale);
  } catch {
    try {
      return await loadGroup("rest", locale);
    } catch {
      fullCatalogFallback.add(locale);
      return loadLocaleResources(locale);
    }
  }
}

/**
 * Loads every namespace of a locale in group mode: the deferred group, one retry, then the full
 * catalog from its own chunk. Rejects only if all three fail; a screen must never render raw
 * keys because a fetch failed.
 */
function ensureAllNamespaces(locale: AppLocale): Promise<void> {
  const cached = allNamespaces.get(locale);
  if (cached) return cached;
  const pending = (async () => {
    const namespaces = Object.keys(await loadRestResources(locale));
    await i18n.loadNamespaces(namespaces);
    await Promise.all(
      [...(scopedGroupInstances.get(locale) ?? [])].map((scoped) =>
        scoped.loadNamespaces(namespaces),
      ),
    );
    loadedNamespaces.add(locale);
  })();
  allNamespaces.set(locale, pending);
  pending.catch(() => allNamespaces.delete(locale));
  return pending;
}

/**
 * Resolves once every namespace of the active locale is loaded; immediately outside group mode.
 * Gate any navigation off the work list on it: components reference other namespaces through
 * `t("ns:key")` and would otherwise render raw keys until the deferred group lands.
 */
export function whenAllNamespacesLoaded(): Promise<void> {
  if (!useNamespaceGroups) return Promise.resolve();
  return ensureAllNamespaces(resolveLocale(i18n.language, getBrowserLocale()));
}

export function preloadNamespaces(locale: AppLocale): Promise<void> {
  if (useNamespaceGroups)
    return afterFirstPaint()
      .then(() => ensureAllNamespaces(locale))
      .catch(() => undefined);
  return loadLocaleResources(locale).then((resources) =>
    i18n.loadNamespaces(Object.keys(resources)),
  );
}

let languageSwitch = 0;

/**
 * Switches the base instance to `localeInput` only once the complete new locale (eager and
 * deferred namespaces) is in its store, so the page never shows a mix of two languages. Until
 * then everything stays in the current language. Every call is a new request that cancels any
 * switch still loading, including a request for the language already shown (a quick
 * English, German, English never ends in German). If the complete locale cannot be loaded the
 * language is NOT switched and this returns false, so the caller can retry later. Also returns
 * false when a newer request superseded this one.
 */
export async function switchLanguage(localeInput: string): Promise<boolean> {
  const locale = resolveLocale(localeInput, getBrowserLocale());
  const request = ++languageSwitch;
  if (i18n.language === locale) return true;
  try {
    const resources: Record<string, unknown> = useNamespaceGroups
      ? {
          ...(await loadGroup("slim", locale)),
          ...(await loadRestResources(locale)),
        }
      : await loadLocaleResources(locale);
    if (request !== languageSwitch) return false;
    for (const [namespace, bundle] of Object.entries(resources))
      if (!i18n.hasResourceBundle(locale, namespace))
        i18n.addResourceBundle(locale, namespace, bundle, false, false);
  } catch {
    return false;
  }
  if (request !== languageSwitch) return false;
  await i18n.changeLanguage(locale);
  return true;
}

/**
 * Create a runtime-scoped i18next instance with its own backend connector and resource store.
 * Loaded locale bundles are copied by value; lazy namespaces use the shared immutable group
 * loaders but are added only to this instance.
 */
export async function createScopedI18n(
  localeInput: string,
  initialNamespacesOverride?: readonly string[],
): Promise<I18nInstance> {
  const locale = resolveLocale(localeInput);
  const scopedI18n = i18n.createInstance();
  const initialNamespaces = initialNamespacesOverride
    ? [...initialNamespacesOverride]
    : useNamespaceGroups
      ? [...WORK_ROUTE_I18N_NAMESPACES]
      : Object.keys(await loadLocaleResources(locale));
  // Seed every bundle the base instance has already loaded, for every language: the fallback
  // language's deferred namespaces must be available at once, or content that stays mounted across
  // a language change would show raw keys until this instance fetched them. Bundles are cloned,
  // so the instance's own terminology overlays never touch the shared store.
  const seedResources: Resource = {};
  for (const language of Object.keys(i18n.store?.data ?? {})) {
    const loaded = i18n.getDataByLanguage(language);
    if (!loaded) continue;
    seedResources[language] = Object.fromEntries(
      Object.entries(loaded).map(([namespace, bundle]) => [
        namespace,
        structuredClone(bundle),
      ]),
    );
  }
  const hasSeed = Object.keys(seedResources).length > 0;

  await scopedI18n
    .use(
      resourcesToBackend((language: string, namespace: string) => {
        const resolved = isSupportedLocale(language) ? language : defaultLocale;
        // Portal builds intentionally omit agent group loader tables.
        if (useNamespaceGroups)
          return loadNamespaceFromGroups(resolved, namespace);
        return loadLocaleResources(resolved).then(
          (resources) => resources[namespace],
        );
      }),
    )
    .init({
      lng: locale,
      fallbackLng: defaultLocale,
      defaultNS: "common",
      ns: initialNamespaces,
      resources: hasSeed ? seedResources : undefined,
      partialBundledLanguages: hasSeed,
      react: { bindI18nStore: "added" },
      interpolation: {
        escapeValue: false,
        skipOnVariables: true,
      },
    });

  if (useNamespaceGroups && !initialNamespacesOverride) {
    const instances = scopedGroupInstances.get(locale) ?? new Set();
    instances.add(scopedI18n);
    scopedGroupInstances.set(locale, instances);
    // Created after the deferred group was requested: catch up before first use, so a screen
    // reached through `whenAllNamespacesLoaded` never renders raw keys from this clone.
    const loadingAll = allNamespaces.get(locale);
    if (loadingAll) {
      await loadingAll.catch(() => undefined);
      await scopedI18n.loadNamespaces(
        Object.keys(i18n.getDataByLanguage(locale) ?? {}),
      );
    }
  }

  return scopedI18n;
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
      skipOnVariables: true,
    },
  })
  .then(() => preloadNamespaces(initialLocale));

export { i18n };
