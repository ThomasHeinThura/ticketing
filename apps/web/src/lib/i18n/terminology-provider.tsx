import { useQuery } from "@tanstack/react-query";
import type { i18n as I18nInstance } from "i18next";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useState,
} from "react";
import { I18nContext, I18nextProvider } from "react-i18next";
import {
  getPortalTerminology,
  getPublicTerminology,
  getWorkspaceRuntimeTerminology,
  type PublicTerminology,
} from "@/fetchers/terminology";
import { i18n as baseI18n, createScopedI18n } from "./index";

type Audience = "agent" | "customer";
type PortalSelector =
  | { requestTypeKey: string }
  | { submissionRef: string }
  | { workItemKey: string };

/** Agent instance-level terminology, kept separate from nested workspace clones. */
const AgentInstanceTerminologyContext = createContext<I18nInstance | null>(
  null,
);

export function mergeAudienceTerms(
  base: unknown,
  audience: Audience,
  overlays: PublicTerminology["terms"],
) {
  const source =
    typeof base === "object" && base !== null && !Array.isArray(base)
      ? (base as Record<string, unknown>)
      : {};
  const oldAudience = source[audience];
  const audienceValues =
    typeof oldAudience === "object" &&
    oldAudience !== null &&
    !Array.isArray(oldAudience)
      ? (oldAudience as Record<string, unknown>)
      : {};
  const nextAudience = { ...audienceValues };
  for (const [termKey, forms] of Object.entries(overlays)) {
    if (!forms) continue;
    for (const [category, value] of Object.entries(forms))
      nextAudience[`${termKey}_${category}`] = value;
  }
  return { ...source, [audience]: nextAudience };
}

/** Replace the complete namespace: i18next forkResourceStore only shallow-copies it. */
export function installAudienceTerms(
  instance: Pick<typeof baseI18n, "addResourceBundle">,
  locale: string,
  shipped: unknown,
  audience: Audience,
  overlays: PublicTerminology["terms"],
) {
  instance.addResourceBundle(
    locale,
    "term",
    structuredClone(mergeAudienceTerms(shipped, audience, overlays)),
    false,
    true,
  );
}

/**
 * Terminology lives in a forked i18next resource store. Agent and customer overrides are
 * therefore scoped to their own application provider and never modify the shared locale
 * bundle used by the other surface.
 */
export function TerminologyProvider({
  audience,
  locale,
  workspaceId,
  portalSelector,
  children,
}: PropsWithChildren<{
  audience: Audience;
  locale: string;
  workspaceId?: string | null;
  portalSelector?: PortalSelector;
}>) {
  const inheritedI18n = useContext(I18nContext)?.i18n;
  const inheritedAgentInstanceI18n = useContext(
    AgentInstanceTerminologyContext,
  );
  const query = useQuery({
    queryKey: [
      "terminology-runtime",
      audience,
      locale,
      workspaceId ?? null,
      portalSelector ?? null,
    ],
    queryFn: () => {
      if (audience === "customer" && portalSelector)
        return getPortalTerminology(locale, portalSelector);
      if (audience === "agent" && workspaceId)
        return getWorkspaceRuntimeTerminology(workspaceId, locale);
      return getPublicTerminology(locale);
    },
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const scopeKey =
    audience === "agent"
      ? `workspace:${workspaceId ?? "instance"}`
      : portalSelector
        ? `portal:${Object.entries(portalSelector)[0]?.join(":") ?? "resource"}`
        : "instance";
  const cloneKey = `${audience}:${locale}:${scopeKey}`;
  const [scopedStore, setScopedStore] = useState<{
    key: string;
    instance: I18nInstance;
    shippedTerms: unknown;
  } | null>(null);
  const effectiveTerms =
    query.isSuccess && query.isFetchedAfterMount
      ? query.data?.terms
      : undefined;

  useEffect(() => {
    let current = true;
    setScopedStore(null);
    void createScopedI18n(locale)
      .then(async (instance) => {
        if (!current) return;
        const shippedTerms = structuredClone(
          instance.getResourceBundle(locale, "term"),
        );
        installAudienceTerms(instance, locale, shippedTerms, audience, {});
        if (audience === "agent") {
          const { installAgentTerminology } = await import(
            "./agent-translation"
          );
          if (!current) return;
          installAgentTerminology(instance);
        }
        void instance.changeLanguage(locale);
        setScopedStore({ key: cloneKey, instance, shippedTerms });
      })
      .catch(() => {
        if (current) setScopedStore(null);
      });
    return () => {
      current = false;
    };
  }, [audience, cloneKey, locale]);

  const activeScopedStore = scopedStore?.key === cloneKey ? scopedStore : null;
  const isolatedI18n = activeScopedStore?.instance ?? null;
  const hasWorkspaceScope = audience === "agent" && Boolean(workspaceId);
  const instanceFallback =
    inheritedAgentInstanceI18n ??
    (hasWorkspaceScope ? inheritedI18n : null) ??
    baseI18n;
  const publishedAgentInstanceI18n =
    audience === "agent" && !hasWorkspaceScope
      ? (isolatedI18n ?? instanceFallback)
      : (inheritedAgentInstanceI18n ?? instanceFallback);

  useEffect(() => {
    if (!activeScopedStore || !isolatedI18n) return;
    installAudienceTerms(
      isolatedI18n,
      locale,
      activeScopedStore.shippedTerms,
      audience,
      effectiveTerms ?? {},
    );
    void isolatedI18n.changeLanguage(locale);
  }, [activeScopedStore, audience, effectiveTerms, isolatedI18n, locale]);

  return (
    <AgentInstanceTerminologyContext.Provider
      value={publishedAgentInstanceI18n}
    >
      <I18nextProvider i18n={isolatedI18n ?? instanceFallback}>
        {children}
      </I18nextProvider>
    </AgentInstanceTerminologyContext.Provider>
  );
}
