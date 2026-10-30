import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@taskdesk/ui";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { TimeField } from "@/components/service-calendar/time-field";
import type { QuietHours } from "@/fetchers/notification-preferences/get-notification-preferences";
import { saveQuietHours } from "@/fetchers/notification-preferences/quiet-hours";
import useGetNotificationPreferences from "@/hooks/queries/notification-preferences/use-get-notification-preferences";
import { formatClockTime, parseClockTime } from "@/lib/service-calendar-form";

function timeZones(current: string): string[] {
  const zones =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [];
  return [...new Set(["UTC", current, ...zones].filter(Boolean))];
}

/**
 * NO-3: the person's own quiet hours. External delivery is deferred inside the window (the
 * server evaluates it at every drain, so a change applies at once); in-app notifications still
 * arrive live, and SLA breaches and approval expiry ignore it.
 */
export function QuietHoursPreference() {
  const { t } = useTranslation("notificationProvider");
  const preferences = useGetNotificationPreferences();
  const quietHours = preferences.data?.quietHours ?? null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("quietHours.title")}</CardTitle>
        <CardDescription>{t("quietHours.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {preferences.isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : preferences.isError ? (
          <Alert variant="error">
            <AlertDescription>{t("quietHours.unavailable")}</AlertDescription>
            <Button
              variant="outline"
              onClick={() => void preferences.refetch()}
            >
              {t("retry")}
            </Button>
          </Alert>
        ) : (
          <QuietHoursForm key={JSON.stringify(quietHours)} saved={quietHours} />
        )}
      </CardContent>
    </Card>
  );
}

function QuietHoursForm({ saved }: { saved: QuietHours | null }) {
  const { t } = useTranslation("notificationProvider");
  const queryClient = useQueryClient();
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [start, setStart] = useState(saved?.start ?? "22:00");
  const [end, setEnd] = useState(saved?.end ?? "07:00");
  const [timezone, setTimezone] = useState(saved?.timezone ?? browserZone);
  const [notice, setNotice] = useState<string | null>(null);
  const zones = useMemo(() => timeZones(timezone), [timezone]);
  const mutation = useMutation({
    mutationFn: saveQuietHours,
    onSuccess: async (_data, variables) => {
      setNotice(variables ? t("quietHours.saved") : t("quietHours.cleared"));
      await queryClient.invalidateQueries({
        queryKey: ["notification-preferences"],
      });
    },
  });
  const startMinutes = parseClockTime(start, false);
  const endMinutes = parseClockTime(end, false);
  const valid = startMinutes !== null && endMinutes !== null && start !== end;
  const dirty =
    !saved ||
    saved.start !== start ||
    saved.end !== end ||
    saved.timezone !== timezone;
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (mutation.isPending || !valid || !dirty) return;
        setNotice(null);
        mutation.mutate({ start, end, timezone });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="quiet-hours-start">{t("quietHours.start")}</Label>
          <TimeField
            id="quiet-hours-start"
            label={t("quietHours.start")}
            value={startMinutes}
            placeholder={start}
            disabled={mutation.isPending}
            onChange={(minutes) => {
              setStart(formatClockTime(minutes));
              setNotice(null);
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="quiet-hours-end">{t("quietHours.end")}</Label>
          <TimeField
            id="quiet-hours-end"
            label={t("quietHours.end")}
            value={endMinutes}
            placeholder={end}
            disabled={mutation.isPending}
            onChange={(minutes) => {
              setEnd(formatClockTime(minutes));
              setNotice(null);
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="quiet-hours-timezone">
            {t("quietHours.timezone")}
          </Label>
          <Select
            value={timezone}
            disabled={mutation.isPending}
            onValueChange={(value) => {
              if (mutation.isPending) return;
              if (value) setTimezone(value);
              setNotice(null);
            }}
          >
            <SelectTrigger id="quiet-hours-timezone">
              <SelectValue>{timezone}</SelectValue>
            </SelectTrigger>
            <SelectContent aria-label={t("quietHours.timezone")}>
              {zones.map((zone) => (
                <SelectItem key={zone} value={zone}>
                  {zone}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{t("quietHours.note")}</p>
      {!valid && (
        <p role="alert" className="text-sm text-destructive">
          {t("quietHours.invalid")}
        </p>
      )}
      {mutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("quietHours.saveFailed")}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={mutation.isPending || !valid || !dirty}>
          {t("quietHours.save")}
        </Button>
        {saved && (
          <Button
            type="button"
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => {
              setNotice(null);
              mutation.mutate(null);
            }}
          >
            {t("quietHours.clear")}
          </Button>
        )}
      </div>
    </form>
  );
}
