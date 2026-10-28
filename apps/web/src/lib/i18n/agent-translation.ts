import type { i18n as I18nInstance, TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { i18n as baseI18n } from "./index";

export const AGENT_TERMINOLOGY_KEYS = [
  "work_item",
  "project",
  "cycle",
  "module",
  "epic",
  "request",
  "submission",
  "service",
  "change",
] as const;

export type AgentTerminologyKey = (typeof AGENT_TERMINOLOGY_KEYS)[number];

type AgentTranslate = TFunction;

const originalAgentTranslators = new WeakMap<I18nInstance, AgentTranslate>();

function normalizeOptions(options: unknown): Record<string, unknown> {
  if (typeof options === "string") return { defaultValue: options };
  return options && typeof options === "object"
    ? (options as Record<string, unknown>)
    : {};
}

function getTermCount(options: unknown) {
  const count = normalizeOptions(options).count;
  return typeof count === "number" && Number.isFinite(count) ? count : 2;
}

function getTermVariables(translate: AgentTranslate, count: number) {
  return Object.fromEntries(
    AGENT_TERMINOLOGY_KEYS.flatMap((key) => [
      [`term_${key}_one`, translate(`agent.${key}`, { ns: "term", count: 1 })],
      [`term_${key}_other`, translate(`agent.${key}`, { ns: "term", count })],
    ]),
  );
}

/**
 * The noun variables cost eighteen lookups. Every `t()` call injects them, so a 500-row list
 * paid them thousands of times per render (G11 list render). They only change with the
 * language or the loaded resources (a terminology overlay arriving), so each instance keeps
 * them per language and count until either changes.
 */
const termVariableCaches = new WeakMap<
  I18nInstance,
  (count: number) => Record<string, string>
>();
const TERM_VARIABLE_CACHE_LIMIT = 64;

function cachedTermVariables(instance: I18nInstance, count: number) {
  let lookup = termVariableCaches.get(instance);
  if (!lookup) {
    const translate =
      originalAgentTranslators.get(instance) ?? instance.t.bind(instance);
    const cache = new Map<string, Record<string, string>>();
    const clear = () => cache.clear();
    instance.on?.("languageChanged", clear);
    instance.store?.on?.("added", clear);
    instance.store?.on?.("removed", clear);
    lookup = (requestedCount) => {
      const key = `${instance.language}\u0000${requestedCount}`;
      let variables = cache.get(key);
      if (!variables) {
        if (cache.size >= TERM_VARIABLE_CACHE_LIMIT) cache.clear();
        variables = getTermVariables(translate, requestedCount);
        cache.set(key, variables);
      }
      return variables;
    };
    termVariableCaches.set(instance, lookup);
  }
  return lookup(count);
}

/** Inject the closed agent noun set per translation call from the active isolated locale. */
export function withAgentTerminology<T extends AgentTranslate>(
  translate: T,
  instance?: I18nInstance,
): T {
  if (!instance) return translate;
  if (originalAgentTranslators.has(instance)) return translate;
  const termsFor = (options: unknown) =>
    cachedTermVariables(instance, getTermCount(options));
  const wrapped = ((
    key: string | string[] | TemplateStringsArray,
    options?: unknown,
    extraOptions?: unknown,
  ) => {
    const normalizedOptions =
      typeof options === "string"
        ? { ...normalizeOptions(extraOptions), defaultValue: options }
        : normalizeOptions(options);
    return translate(key as string | string[], {
      ...normalizedOptions,
      ...termsFor(typeof options === "string" ? extraOptions : options),
    });
  }) as unknown as T;
  return wrapped;
}

/** Install closed noun interpolation on an isolated agent clone for all existing t() callers. */
export function installAgentTerminology(instance: I18nInstance) {
  const rawTranslate =
    originalAgentTranslators.get(instance) ?? instance.t.bind(instance);
  originalAgentTranslators.set(instance, rawTranslate);
  const wrapped = ((
    key: string | string[] | TemplateStringsArray,
    options?: unknown,
    extraOptions?: unknown,
  ) => {
    const normalizedOptions =
      typeof options === "string"
        ? { ...normalizeOptions(extraOptions), defaultValue: options }
        : normalizeOptions(options);
    const countOptions = typeof options === "string" ? extraOptions : options;
    return rawTranslate(key as string | string[], {
      ...normalizedOptions,
      ...cachedTermVariables(instance, getTermCount(countOptions)),
    });
  }) as unknown as typeof instance.t;
  instance.t = wrapped;
}

/** Resolve the shipped agent noun for the default tooltip on renamed controls. */
export function getDefaultAgentTerm(
  instance: I18nInstance | undefined,
  termKey: AgentTerminologyKey,
  count: number,
  typedWorkItemName?: string,
) {
  if (termKey === "work_item" && typedWorkItemName?.trim())
    return typedWorkItemName;
  const locale =
    instance?.resolvedLanguage ?? instance?.language ?? baseI18n.language;
  return baseI18n.t(`agent.${termKey}`, {
    ns: "term",
    count,
    lng: locale,
  });
}

export function useAgentTranslation(namespace?: string | readonly string[]) {
  const translation = useTranslation(
    namespace as string | string[] | undefined,
  );
  return {
    ...translation,
    t: withAgentTerminology(translation.t, translation.i18n),
  };
}
