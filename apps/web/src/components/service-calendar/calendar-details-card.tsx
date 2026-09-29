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
import type { CalendarMetadata } from "@/hooks/use-service-calendar-editor";
import { timezoneOptions } from "@/lib/service-calendar-form";

const TIMEZONE_OPTIONS = timezoneOptions();

export function CalendarDetailsCard({
  form,
}: {
  form: UseFormReturn<CalendarMetadata>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Calendar details</CardTitle>
        <CardDescription>
          All windows and date-only holidays use this IANA timezone.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="calendar-name">Name</Label>
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
          <Label htmlFor="calendar-timezone">IANA timezone</Label>
          <Input
            id="calendar-timezone"
            list="service-calendar-timezones"
            placeholder="Select or enter a timezone"
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
            Start typing to find a timezone. UTC is available as a choice.
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
