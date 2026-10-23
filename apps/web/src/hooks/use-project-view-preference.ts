import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import {
  patchUserSettings,
  type UserSettings,
} from "@/fetchers/user-settings/user-settings";
import {
  useGetUserSettings,
  userSettingsQueryKey,
} from "@/hooks/queries/user-settings/use-get-user-settings";
import type { WorkItemSearchColumn } from "@/lib/work-item-list-search";
import { WORK_ITEM_SEARCH_COLUMNS } from "@/lib/work-item-list-search";

/**
 * Per-user, per-project view preferences kept in `user_preference` through
 * `GET`/`PATCH /api/me/settings` (`VW-15` collapsed list groups, `VW-19` chosen columns). The
 * value is read from, and written optimistically into, the same per-user settings query the
 * density preference uses, so it follows the person across devices. A failed write rolls the
 * cache back to what the server holds; the UI never blocks on the route.
 */
export function useProjectViewPreference<T>({
  projectId,
  name,
  parse,
}: {
  projectId: string | undefined;
  /** The settings key prefix: `listGroups`, `columns` or `layout` (`VW-2`). */
  name: "listGroups" | "columns" | "layout";
  /** Returns the value for stored data of the right shape, otherwise undefined. */
  parse: (raw: unknown) => T | undefined;
}) {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const { data, isFetched } = useGetUserSettings(userId);
  const settingKey = projectId ? `${name}.${projectId}` : undefined;
  const value =
    settingKey && data ? parse(data.settings[settingKey]) : undefined;

  const { mutate } = useMutation({
    // One person's preference writes land in order, so the last click wins on the server too.
    scope: { id: "user-settings" },
    mutationFn: ({
      patch,
    }: {
      patch: Record<string, unknown>;
      seed: boolean;
    }) => patchUserSettings(patch),
    onSuccess: (response, { seed }) => {
      // The write answers with the person's full settings. When there was nothing cached to
      // update optimistically, that answer is what the screen shows; otherwise the cache
      // already holds the newest choice and an older response must not overwrite it.
      if (seed)
        queryClient.setQueryData(userSettingsQueryKey(userId), response);
    },
    onError: () => {
      void queryClient.invalidateQueries({
        queryKey: userSettingsQueryKey(userId),
      });
    },
  });

  const set = useCallback(
    (next: T | null) => {
      if (!userId || !settingKey) return;
      const queryKey = userSettingsQueryKey(userId);
      const cached = queryClient.getQueryData<UserSettings>(queryKey);
      // Never invent a partial settings object: a read still in flight would overwrite it, and
      // the density sync would reconcile against a body with no density in it.
      if (cached) {
        const settings: Record<string, unknown> = { ...cached.settings };
        if (next === null) delete settings[settingKey];
        else settings[settingKey] = next;
        queryClient.setQueryData<UserSettings>(queryKey, {
          settings,
        } as UserSettings);
      }
      mutate({ patch: { [settingKey]: next }, seed: !cached });
    },
    [mutate, queryClient, settingKey, userId],
  );

  // `settled`: the server has answered (or failed, or there is no signed-in user), so a
  // missing `value` really means "nothing stored" and a local fallback may be used.
  return { value, set, settled: !userId || isFetched };
}

/** A stored project layout (`VW-2`). */
export function parseProjectLayout(
  raw: unknown,
): "board" | "list" | "table" | undefined {
  return raw === "board" || raw === "list" || raw === "table" ? raw : undefined;
}

/** A stored list of collapsed group ids. */
export function parseCollapsedGroups(raw: unknown): string[] | undefined {
  return Array.isArray(raw) && raw.every((id) => typeof id === "string")
    ? raw
    : undefined;
}

/** A stored, duplicate-free subset of the table columns, in display order. */
export function parseTableColumns(
  raw: unknown,
): WorkItemSearchColumn[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const known = new Set<string>(WORK_ITEM_SEARCH_COLUMNS);
  const seen = new Set<string>();
  for (const column of raw) {
    if (typeof column !== "string" || !known.has(column) || seen.has(column))
      return undefined;
    seen.add(column);
  }
  return raw as WorkItemSearchColumn[];
}
