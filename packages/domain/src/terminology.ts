import type { TERMINOLOGY_LOCALES } from "./terminology-defaults.generated.js";

/** Closed noun registry shared by persisted terminology overrides and UI consumers. */
export const TERMINOLOGY_TERM_KEYS = [
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

export type TerminologyTermKey = (typeof TERMINOLOGY_TERM_KEYS)[number];
export type TerminologyAudience = "agent" | "customer" | "both";
export type TerminologyScope = "instance" | "workspace";
export type TerminologyLocale = (typeof TERMINOLOGY_LOCALES)[number];

export type TerminologyForms = Readonly<Record<string, string>>;

export type TerminologyOverride = {
  scope: TerminologyScope;
  workspaceId: string | null;
  audience: TerminologyAudience;
  termKey: TerminologyTermKey;
  locale: TerminologyLocale;
  forms: TerminologyForms;
};

export type NotificationCopySegment =
  | { kind: "text"; text: string }
  | {
      kind: "term";
      termKey: TerminologyTermKey;
      count: number;
    };

export type NotificationCopyDescriptorV1 = {
  version: 1;
  title: readonly NotificationCopySegment[];
  body: readonly NotificationCopySegment[];
};
