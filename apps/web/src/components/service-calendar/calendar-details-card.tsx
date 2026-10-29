import {
  Autocomplete,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@taskdesk/ui";
import { useEffect, useState } from "react";
import {
  type UseFormReturn,
  useController,
  useFormState,
} from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { CalendarMetadata } from "@/hooks/use-service-calendar-editor";
import { timezoneOptions } from "@/lib/service-calendar-form";

const TIMEZONE_OPTIONS = timezoneOptions();

export function CalendarDetailsCard({
  form,
  isNew,
  disabled = false,
}: {
  form: UseFormReturn<CalendarMetadata>;
  isNew: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation("serviceCalendars");
  const { errors } = useFormState({ control: form.control });
  const { field: timezone } = useController({
    control: form.control,
    name: "timezone",
  });
  const [timezoneOpen, setTimezoneOpen] = useState(false);
  useEffect(() => {
    if (disabled) setTimezoneOpen(false);
  }, [disabled]);
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
          <Autocomplete
            items={TIMEZONE_OPTIONS}
            value={timezone.value}
            onValueChange={(value) => {
              if (!disabled) timezone.onChange(value);
            }}
            open={timezoneOpen && !disabled}
            onOpenChange={(open) => setTimezoneOpen(open && !disabled)}
            disabled={disabled}
          >
            <AutocompleteInput
              id="calendar-timezone"
              name={timezone.name}
              ref={timezone.ref}
              onBlur={timezone.onBlur}
              placeholder={t("details.timezonePlaceholder")}
              autoComplete="off"
              disabled={disabled}
              aria-invalid={Boolean(errors.timezone)}
              aria-describedby={
                errors.timezone
                  ? "calendar-timezone-help calendar-timezone-error"
                  : "calendar-timezone-help"
              }
              triggerLabel={t("details.timezoneSuggestions")}
              showTrigger
            />
            <AutocompletePopup>
              <AutocompleteList>
                {(zone: string) => (
                  <AutocompleteItem key={zone} value={zone}>
                    {zone}
                  </AutocompleteItem>
                )}
              </AutocompleteList>
              <AutocompleteEmpty>{t("details.timezoneHelp")}</AutocompleteEmpty>
            </AutocompletePopup>
          </Autocomplete>
          <p
            id="calendar-timezone-help"
            className="text-xs text-muted-foreground"
          >
            {t("details.timezoneHelp")}
          </p>
          {errors.timezone ? (
            <p
              id="calendar-timezone-error"
              className="text-sm text-destructive"
              role="alert"
            >
              {errors.timezone.message}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
