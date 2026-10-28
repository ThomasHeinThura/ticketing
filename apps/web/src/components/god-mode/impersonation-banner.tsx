import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
  Button,
} from "@taskdesk/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  endImpersonation,
  getImpersonationStatus,
} from "@/fetchers/god-mode/impersonation";

const impersonationStatusKey = ["god-mode", "impersonation-status"] as const;

/** Whole seconds left until `expiresAt`, never negative. */
export function secondsUntil(expiresAt: string | null, now: number): number {
  if (!expiresAt) return 0;
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000));
}

export function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * GM-11: the persistent, unmissable banner shown for the whole life of an impersonation session
 * (who is impersonating whom, the 30-minute countdown, and the exit control). Mounted only when
 * the resolved session carries `impersonatedBy`, so ordinary sessions never pay the status
 * request. At the cap the exit control is invoked automatically so the administrator returns to
 * their own session, and every state change reloads the app because the session cookie changed.
 */
export function ImpersonationBanner() {
  const { t, ready } = useTranslation("instanceUsers", {
    useSuspense: false,
  });
  const { data } = useQuery({
    queryKey: impersonationStatusKey,
    queryFn: getImpersonationStatus,
    staleTime: 60_000,
  });
  const [now, setNow] = useState(() => Date.now());
  const exit = useMutation({
    mutationFn: endImpersonation,
    onSettled: () => window.location.assign("/agent/god-mode/users"),
  });
  const remaining = secondsUntil(data?.expiresAt ?? null, now);
  const expired = Boolean(data?.impersonating) && remaining === 0;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (expired && !exit.isPending && !exit.isSuccess) exit.mutate();
  }, [expired, exit]);

  // The namespace is in the deferred i18n group: paint nothing rather than raw keys until it lands.
  if (!data?.impersonating || !ready) return null;
  return (
    <Alert
      variant="warning"
      className="rounded-none border-x-0 border-t-0"
      data-testid="impersonation-banner"
    >
      <AlertTitle>
        {t("dynamic.impersonation.banner", {
          impersonator: data.impersonator?.name ?? "",
          target: data.target?.name ?? "",
        })}
      </AlertTitle>
      <AlertDescription>
        {t("dynamic.impersonation.countdown", {
          time: formatCountdown(remaining),
        })}
        {data.reason ? ` · ${data.reason}` : ""}
      </AlertDescription>
      <AlertAction>
        <Button
          size="sm"
          variant="outline"
          disabled={exit.isPending}
          onClick={() => exit.mutate()}
        >
          {t("dynamic.impersonation.exit")}
        </Button>
      </AlertAction>
    </Alert>
  );
}
