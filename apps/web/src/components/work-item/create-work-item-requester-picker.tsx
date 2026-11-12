import {
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@taskdesk/ui";
import { Check, Contact } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback } from "@/components/avatar";
import {
  CREATE_TASK_PROPERTY_BUTTON_CLASS,
  CREATE_TASK_PROPERTY_OPTION_CLASS,
} from "@/components/shared/modals/create-task-presentation";
import useGetRequesterCandidates from "@/hooks/queries/work-item/use-get-requester-candidates";
import { cn } from "@/lib/cn";
import { getInitials } from "@/lib/get-initials";

type Props = {
  projectId: string;
  requesterId: string;
  onChange: (personId: string) => void;
  canUpdate: boolean;
  disabled: boolean;
};

/**
 * A-03: raise the request for a customer. Kaneo's create-modal chip, listing only the
 * customers of the project's organisation; hidden when there are none (an internal project).
 */
export default function CreateWorkItemRequesterPicker({
  projectId,
  requesterId,
  onChange,
  canUpdate,
  disabled,
}: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const candidates = useGetRequesterCandidates({
    projectId,
    enabled: canUpdate,
  });
  const people = Array.isArray(candidates.data) ? candidates.data : [];
  if (!canUpdate || people.length === 0) return null;
  const selected = people.find((person) => person.personId === requesterId);
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? people.filter((person) =>
        `${person.name ?? ""} ${person.email ?? ""}`
          .toLowerCase()
          .includes(needle),
      )
    : people;
  const label = (person: (typeof people)[number]) =>
    person.name ?? person.email ?? t("workItems:journey.unnamedPerson");
  return (
    <Popover onOpenChange={(open) => (open ? undefined : setQuery(""))}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label={t("workItems:properties.requester")}
          data-testid="create-work-item-requester-trigger"
          disabled={disabled}
          className={cn(
            CREATE_TASK_PROPERTY_BUTTON_CLASS,
            selected ? "bg-accent/30 text-foreground" : "text-muted-foreground",
          )}
        >
          <Contact className="w-3.5 h-3.5" />
          <span>
            {selected ? label(selected) : t("workItems:properties.requester")}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1" align="start">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("workItems:properties.requesterSearch")}
          aria-label={t("workItems:properties.requesterSearch")}
          className="mb-1 h-8 text-sm"
        />
        <div className="max-h-64 space-y-1 overflow-y-auto">
          <Button
            type="button"
            variant="ghost"
            className={CREATE_TASK_PROPERTY_OPTION_CLASS}
            disabled={disabled}
            onClick={() => onChange("")}
          >
            <Contact className="w-3.5 h-3.5" />
            {t("workItems:properties.noRequester")}
            {!requesterId ? <Check className="ml-auto h-4 w-4" /> : null}
          </Button>
          {shown.map((person) => (
            <Button
              type="button"
              variant="ghost"
              key={person.personId}
              aria-label={label(person)}
              className={cn(
                CREATE_TASK_PROPERTY_OPTION_CLASS,
                "h-auto min-h-8 overflow-hidden",
              )}
              disabled={disabled}
              onClick={() => onChange(person.personId)}
            >
              <Avatar className="h-6 w-6">
                <AvatarFallback className="text-xs font-medium border border-border/30">
                  {getInitials(label(person))}
                </AvatarFallback>
              </Avatar>
              <span className="flex min-w-0 flex-1 flex-col items-stretch text-left">
                <span className="truncate text-sm">{label(person)}</span>
                {person.name && person.email ? (
                  <span className="truncate text-muted-foreground text-xs">
                    {person.email}
                  </span>
                ) : null}
              </span>
              {person.personId === requesterId ? (
                <Check className="ml-auto h-4 w-4" />
              ) : null}
            </Button>
          ))}
          {shown.length === 0 ? (
            <p className="px-2 py-1.5 text-muted-foreground text-xs">
              {t("workItems:properties.noRequesterMatch")}
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
