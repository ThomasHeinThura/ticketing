import {
  TERMINOLOGY_TERM_KEYS,
  type TerminologyAudience,
  type TerminologyForms,
  type TerminologyScope,
  type TerminologyTermKey,
} from "@taskdesk/domain";
import { z } from "../openapi";

export {
  TERMINOLOGY_TERM_KEYS,
  type TerminologyAudience,
  type TerminologyForms,
  type TerminologyScope,
  type TerminologyTermKey,
};

export const terminologyTermKeySchema = z.enum(TERMINOLOGY_TERM_KEYS);
export const terminologyAudienceSchema = z.enum(["agent", "customer", "both"]);
export const terminologyScopeSchema = z.enum(["instance", "workspace"]);

export type TerminologyOverride = {
  scope: TerminologyScope;
  workspaceId: string | null;
  audience: TerminologyAudience;
  termKey: TerminologyTermKey;
  locale: string;
  forms: TerminologyForms;
};
