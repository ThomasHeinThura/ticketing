import type { AppLocale } from "@i18n/resources";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { authClient } from "@/lib/auth-client";
import { getBrowserLocale, resolveLocale } from "@/lib/i18n";
import { profileSessionGuard } from "@/lib/profile-session-guard";

export function useLocale() {
  const { i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();

  const locale = useMemo(
    () => resolveLocale(i18n.resolvedLanguage, getBrowserLocale()),
    [i18n.resolvedLanguage],
  );

  const check = profileSessionGuard(session?.user?.id, session?.session?.id);
  const save = useMutation({
    mutationFn: async (nextLocale: AppLocale) => {
      await check();
      const { error } = await authClient.updateUser({ locale: nextLocale });
      if (error) {
        throw new Error(error.message || "Failed to update locale");
      }
    },
    meta: {
      audits: {
        targets: () => [
          { kind: "self", audience: "staff", section: "profile" },
        ],
      },
    },
  });

  const setLocale = async (nextLocale: AppLocale) => {
    await save.mutateAsync(nextLocale);
    await check(true);
    const resolved = resolveLocale(nextLocale, null);
    await queryClient.invalidateQueries({ queryKey: ["session"] });
    await check(true);
    document.documentElement.lang = resolved;
    await i18n.changeLanguage(resolved);
  };

  return {
    locale,
    setLocale,
  };
}
