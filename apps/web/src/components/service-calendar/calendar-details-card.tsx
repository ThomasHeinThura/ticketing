import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@taskdesk/ui";
import { type UseFormReturn, useFormState } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { CalendarMetadata } from "@/hooks/use-service-calendar-editor";
import { timezoneOptions } from "@/lib/service-calendar-form";

const TIMEZONE_OPTIONS = timezoneOptions();

export function CalendarDetailsCard({
  form,
  isNew,
}: {
  form: UseFormReturn<CalendarMetadata>;
  isNew: boolean;
}) {
  const { t } = useTranslation("serviceCalendars");
  const { errors } = useFormState({ control: form.control });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("details.title")}</CardTitle>
        <CardDescription>{t("details.description")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="calendar-key">
            {t(
              isNew
                ? "details.stableKeyLabel"
                : "details.stableKeyReadOnlyLabel",
            )}
          </Label>
          <Input
            id="calendar-key"
            autoComplete="off"
            maxLength={64}
            readOnly={!isNew}
            {...form.register("key")}
            aria-invalid={Boolean(errors.key)}
          />
          <p className="text-xs text-muted-foreground">
            {t("details.stableKeyHelp")}
          </p>
          {errors.key ? (
            <p className="text-sm text-destructive" role="alert">
              {errors.key.message}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="calendar-name">{t("details.name")}</Label>
          <Input
            id="calendar-name"
            autoComplete="off"
            maxLength={120}
            {...form.register("name")}
            aria-invalid={Boolean(errors.name)}
          />
          {errors.name ? (
            <p className="text-sm text-destructive" role="alert">
              {errors.name.message}
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
            aria-invalid={Boolean(errors.timezone)}
          />
          <datalist id="service-calendar-timezones">
            {TIMEZONE_OPTIONS.map((timezone) => (
              <option key={timezone} value={timezone} />
            ))}
          </datalist>
          <p className="text-xs text-muted-foreground">
            {t("details.timezoneHelp")}
          </p>
          {errors.timezone ? (
            <p className="text-sm text-destructive" role="alert">
              {errors.timezone.message}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
