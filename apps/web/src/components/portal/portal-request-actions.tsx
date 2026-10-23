import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
} from "@taskdesk/ui";
import { Check } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { usePortalRequestActions } from "@/hooks/mutations/portal/use-portal-request-actions";
import { actionErrorKey, higherPriorities } from "@/lib/portal-request";
import { getPriorityIcon } from "@/lib/priority";

type Actions = ReturnType<typeof usePortalRequestActions>;

function ActionError({ error }: { error: unknown }) {
  const { t } = useTranslation("portal");
  if (!error) return null;
  const key = actionErrorKey(error);
  return (
    <Alert variant={key === "reopen_pending_review" ? "info" : "error"}>
      <AlertDescription>{t(`request.errors.${key}`)}</AlertDescription>
    </Alert>
  );
}

/**
 * CP-7: raise (never lower) the request's priority. Kaneo's priority popover, offering only the
 * priorities above the current one; the API refuses an equal or lower value regardless.
 */
export function PortalRaisePriority({
  current,
  escalate,
}: {
  current: string | null;
  escalate: Actions["escalate"];
}) {
  const { t } = useTranslation("portal");
  const [open, setOpen] = useState(false);
  const options = higherPriorities(current);
  if (options.length === 0) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={escalate.isPending}>
          {t("request.priority.raise")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-0" align="start">
        <div>
          {options.map((priority) => (
            <Button
              key={priority}
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-start gap-2 rounded-none px-2 first:rounded-t-md last:rounded-b-md"
              disabled={escalate.isPending}
              onClick={() =>
                escalate.mutate(priority, { onSuccess: () => setOpen(false) })
              }
            >
              {getPriorityIcon(priority)}
              <span className="text-sm">
                {t(`request.priority.value.${priority}`)}
              </span>
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** CP-8: reopen within the window. The API decides eligibility; the button shows only when it says so. */
export function PortalReopenButton({ reopen }: { reopen: Actions["reopen"] }) {
  const { t } = useTranslation("portal");
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={reopen.isPending}
      onClick={() => reopen.mutate()}
    >
      {t("request.reopen.action")}
    </Button>
  );
}

const RATINGS = [1, 2, 3, 4, 5] as const;

/**
 * CP-9: a one-to-five rating with an optional comment, once per request and changeable within
 * the reopen window (the API enforces both).
 */
export function PortalSatisfaction({
  rate,
  existing,
}: {
  rate: Actions["rate"];
  existing: { rating: number; comment?: string | null } | null;
}) {
  const { t } = useTranslation("portal");
  const [rating, setRating] = useState<number | null>(existing?.rating ?? null);
  const [comment, setComment] = useState(existing?.comment ?? "");
  return (
    <Card>
      <CardHeader>
        <CardTitle render={(props) => <h2 {...props} />}>
          {t("request.satisfaction.title")}
        </CardTitle>
        <CardDescription>
          {t("request.satisfaction.description")}
        </CardDescription>
      </CardHeader>
      <CardPanel>
        <div className="flex flex-col gap-3">
          <ToggleGroup
            variant="outline"
            size="sm"
            aria-label={t("request.satisfaction.scale")}
            value={rating === null ? [] : [String(rating)]}
            disabled={rate.isPending}
            onValueChange={(next) => {
              const value = Number(next[0]);
              if (RATINGS.some((entry) => entry === value)) setRating(value);
            }}
          >
            {RATINGS.map((value) => (
              <ToggleGroupItem
                key={value}
                value={String(value)}
                aria-label={t(`request.satisfaction.rating.${value}`)}
              >
                {value}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Textarea
            aria-label={t("request.satisfaction.comment")}
            placeholder={t("request.satisfaction.comment")}
            value={comment}
            disabled={rate.isPending}
            onChange={(event) => setComment(event.target.value)}
          />
          <ActionError error={rate.error} />
          {rate.isSuccess ? (
            <Alert variant="success">
              <AlertDescription className="flex items-center gap-2">
                <Check className="size-4" aria-hidden="true" />
                {t("request.satisfaction.thanks")}
              </AlertDescription>
            </Alert>
          ) : null}
          <div>
            <Button
              size="sm"
              disabled={rating === null || rate.isPending}
              onClick={() =>
                rating !== null &&
                rate.mutate({ rating, comment: comment.trim() || undefined })
              }
            >
              {existing
                ? t("request.satisfaction.update")
                : t("request.satisfaction.submit")}
            </Button>
          </div>
        </div>
      </CardPanel>
    </Card>
  );
}

export { ActionError as PortalActionAlert };
