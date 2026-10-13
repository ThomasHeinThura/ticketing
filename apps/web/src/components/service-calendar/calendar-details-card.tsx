import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@taskdesk/ui";
import type { UseFormReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { CalendarMetadata } from "@/hooks/use-service-calendar-editor";
import { timezoneOptions } from "@/lib/service-calendar-form";

const TIMEZONE_OPTIONS = timezoneOptions();

export function CalendarDetailsCard({
  form,
}: {
  form: UseFormReturn<CalendarMetadata>;
}) {
  const { t } = useTranslation("serviceCalendars");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("details.title")}</CardTitle>
        <CardDescription>{t("details.description")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="calendar-name">{t("details.name")}</Label>
          <Input
            id="calendar-name"
            autoComplete="off"
            maxLength={120}
            {...form.register("name")}
            aria-invalid={Boolean(form.formState.errors.name)}
          />
          {form.formState.errors.name ? (
            <p className="text-sm text-destructive" role="alert">
              {form.formState.errors.name.message}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="calendar-timezone">{t("details.timezone")}</Label>
          <Input
            id="calendar-timezone"
            list="service-calendar-timezones"
            placeholder={t("details.timezonePlaceholder")}
            autoComplete="off"
            {...form.register("timezone")}
            aria-invalid={Boolean(form.formState.errors.timezone)}
          />
          <datalist id="service-calendar-timezones">
            {TIMEZONE_OPTIONS.map((timezone) => (
              <option key={timezone} value={timezone} />
            ))}
          </datalist>
          <p className="text-xs text-muted-foreground">
            {t("details.timezoneHelp")}
          </p>
          {form.formState.errors.timezone ? (
            <p className="text-sm text-destructive" role="alert">
              {form.formState.errors.timezone.message}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
