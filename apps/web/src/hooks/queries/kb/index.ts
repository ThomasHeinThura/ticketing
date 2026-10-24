import { useQuery } from "@tanstack/react-query";
import {
  getKbArticle,
  getKbArticles,
  getKbCategories,
  getKbFeedback,
  getKbReport,
  getKbSettings,
  getKbVersion,
  getKbVersions,
  type KbListParams,
} from "@/fetchers/kb";

export const kbKeys = {
  all: (workspaceId: string) => ["kb", workspaceId] as const,
  list: (params: KbListParams) =>
    ["kb", params.workspaceId, "list", params] as const,
  article: (id: string) => ["kb", "article", id] as const,
  versions: (id: string) => ["kb", "article", id, "versions"] as const,
  version: (id: string, number: number) =>
    ["kb", "article", id, "version", number] as const,
  feedback: (id: string) => ["kb", "article", id, "feedback"] as const,
  categories: (workspaceId: string) =>
    ["kb", workspaceId, "categories"] as const,
  settings: (workspaceId: string) => ["kb", workspaceId, "settings"] as const,
  report: (workspaceId: string) => ["kb", workspaceId, "report"] as const,
};

export const useKbArticles = (params: KbListParams) =>
  useQuery({
    queryKey: kbKeys.list(params),
    queryFn: () => getKbArticles(params),
    enabled: Boolean(params.workspaceId),
  });
export const useKbArticle = (id: string) =>
  useQuery({
    queryKey: kbKeys.article(id),
    queryFn: () => getKbArticle(id),
    enabled: Boolean(id),
  });
export const useKbVersions = (id: string, enabled = true) =>
  useQuery({
    queryKey: kbKeys.versions(id),
    queryFn: () => getKbVersions(id),
    enabled: Boolean(id) && enabled,
  });
export const useKbVersion = (id: string, number: number | undefined) =>
  useQuery({
    queryKey: kbKeys.version(id, number ?? 0),
    queryFn: () => getKbVersion(id, number as number),
    enabled: Boolean(id) && number !== undefined,
  });
export const useKbFeedback = (id: string, enabled = true) =>
  useQuery({
    queryKey: kbKeys.feedback(id),
    queryFn: () => getKbFeedback(id),
    enabled: Boolean(id) && enabled,
  });
export const useKbCategories = (workspaceId: string) =>
  useQuery({
    queryKey: kbKeys.categories(workspaceId),
    queryFn: () => getKbCategories(workspaceId),
    enabled: Boolean(workspaceId),
  });
export const useKbSettings = (workspaceId: string) =>
  useQuery({
    queryKey: kbKeys.settings(workspaceId),
    queryFn: () => getKbSettings(workspaceId),
    enabled: Boolean(workspaceId),
  });
export const useKbReport = (workspaceId: string, enabled = true) =>
  useQuery({
    queryKey: kbKeys.report(workspaceId),
    queryFn: () => getKbReport(workspaceId),
    enabled: Boolean(workspaceId) && enabled,
  });
