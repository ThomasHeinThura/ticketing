import { useQuery } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { useTranslation } from "react-i18next";
import { getOwnPendingAction } from "@/fetchers/pending-actions";
import { TerminologyProvider } from "@/lib/i18n/terminology-provider";

/** Resolve approval terminology from the current target, never from the active route workspace. */
export function PendingActionTerminologyBoundary({
  id,
  children,
}: PropsWithChildren<{ id: string }>) {
  const { i18n } = useTranslation();
  const action = useQuery({
    queryKey: ["me", "pending-action", id],
    queryFn: () => getOwnPendingAction(id),
  });
  const workspaceId =
    action.data?.approvalSupported && action.data.summary.redacted !== true
      ? action.data.targetWorkspaceId
      : null;

  return (
    <TerminologyProvider
      audience="agent"
      locale={i18n.resolvedLanguage ?? i18n.language}
      workspaceId={workspaceId ?? null}
    >
      {children}
    </TerminologyProvider>
  );
}
