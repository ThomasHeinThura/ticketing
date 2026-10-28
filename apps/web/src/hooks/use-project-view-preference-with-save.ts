import { useCallback } from "react";
import { useProjectViewPreference } from "./use-project-view-preference";

/** Promise-based save wrapper for controls that must not present an unpersisted value. */
export function useProjectViewPreferenceWithSave<T>(input: {
  projectId: string | undefined;
  name: "listGroups" | "columns" | "columnWidths" | "layout";
  parse: (raw: unknown) => T | undefined;
}) {
  const preference = useProjectViewPreference(input);
  const setAsync = useCallback(
    (next: T | null) =>
      new Promise<void>((resolve, reject) => {
        const accepted = preference.set(next, {
          onSuccess: resolve,
          onError: reject,
        });
        if (!accepted) reject(new Error("User settings are unavailable"));
      }),
    [preference.set],
  );
  return { ...preference, setAsync };
}
