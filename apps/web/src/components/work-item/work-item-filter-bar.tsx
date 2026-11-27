import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Calendar,
  Checkbox,
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@taskdesk/ui";
import { Plus, SlidersHorizontal, X } from "lucide-react";
import {
  type KeyboardEvent,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  PickerPopover,
  PickerSearchList,
} from "@/components/common/picker-popover";
import type { WorkItemFilterMode } from "@/lib/routes";
import {
  parseWorkItemFilterText,
  printWorkItemFilterText,
} from "@/lib/work-item-filter";
import {
  chipValues,
  type FilterLeaf,
  fromChips,
  toChips,
  withOperator,
  withValues,
} from "@/lib/work-item-filter-chips";
import {
  FILTER_FIELDS,
  type FilterField,
  operatorKey,
} from "@/lib/work-item-filter-fields";

const WorkItemFilterEditor = lazy(
  () => import("@/components/work-item/work-item-filter-editor"),
);

const POPUP_CLASS = "max-w-[calc(100vw-2rem)]";
const COMPARISON_GLYPHS: Record<string, string> = {
  lt: "<",
  lte: "≤",
  gt: ">",
  gte: "≥",
};

const fieldFor = (leaf: FilterLeaf): FilterField | undefined =>
  FILTER_FIELDS.find((field) => field.id === leaf.field);

const isEmpty = (leaf: FilterLeaf) => chipValues(leaf).every((v) => !v);

const toIsoDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function ValueChecklist({
  options,
  selected,
  multiple,
  onChange,
}: {
  options: readonly string[];
  selected: readonly string[];
  multiple: boolean;
  onChange: (values: string[]) => void;
}) {
  const { t } = useTranslation();
  const label = t("workItems:filter.searchValues");
  const items = useMemo(() => options.map((value) => ({ value })), [options]);
  return (
    <Command
      items={items}
      filter={(item: unknown, query: string) =>
        (item as { value: string }).value
          .toLowerCase()
          .includes(query.trim().toLowerCase())
      }
    >
      <CommandInput aria-label={label} placeholder={label} maxLength={200} />
      <CommandEmpty>{t("common:picker.noResults")}</CommandEmpty>
      <CommandList className="max-h-60 overflow-y-auto">
        {(option: { value: string }) => {
          const checked = selected.includes(option.value);
          return (
            <CommandItem
              key={option.value}
              value={option.value}
              aria-selected={checked}
              className="flex items-center gap-2"
              onClick={() =>
                onChange(
                  multiple
                    ? checked
                      ? selected.filter((v) => v !== option.value)
                      : [...selected, option.value]
                    : [option.value],
                )
              }
            >
              <Checkbox
                checked={checked}
                tabIndex={-1}
                aria-hidden="true"
                className="pointer-events-none"
              />
              <span className="truncate text-sm">{option.value}</span>
            </CommandItem>
          );
        }}
      </CommandList>
    </Command>
  );
}

function ValueInput({
  leaf,
  field,
  onChange,
}: {
  leaf: FilterLeaf;
  field: FilterField;
  onChange: (next: FilterLeaf) => void;
}) {
  const { t } = useTranslation();
  const current = chipValues(leaf)[0] ?? "";
  const [draft, setDraft] = useState(current);
  const [invalid, setInvalid] = useState(false);
  // Back/Forward can change the applied value while the popover is open; follow it.
  useEffect(() => {
    setDraft(current);
    setInvalid(false);
  }, [current]);
  const isDate = field.id === "dueDate" || field.id === "createdAt";
  const commit = (value: string) => {
    const next = { ...leaf, value };
    try {
      printWorkItemFilterText(next);
    } catch {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setDraft(value);
    if (value !== current) onChange(next);
  };
  const selected = /^\d{4}-\d{2}-\d{2}$/u.test(current)
    ? new Date(`${current}T00:00:00`)
    : undefined;
  return (
    <div className="grid gap-2">
      <Input
        aria-label={t("workItems:filter.valueFor", {
          field: t(`workItems:filter.fields.${field.labelKey}`),
        })}
        aria-invalid={invalid}
        value={draft}
        maxLength={100}
        placeholder={
          isDate
            ? t("workItems:filter.datePlaceholder")
            : t("workItems:filter.valuePlaceholder")
        }
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalid(false);
        }}
        onBlur={() => draft.trim() && commit(draft.trim())}
        onKeyDown={(event) => {
          if (event.key === "Enter" && draft.trim()) commit(draft.trim());
        }}
      />
      {isDate ? (
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(date) => date && commit(toIsoDate(date))}
        />
      ) : null}
    </div>
  );
}

function FilterChip({
  leaf,
  pending = false,
  onChange,
}: {
  leaf: FilterLeaf;
  /** A just-added chip that is not part of the filter until it has a value. */
  pending?: boolean;
  onChange: (next: FilterLeaf | undefined) => void;
}) {
  const { t } = useTranslation();
  const field = fieldFor(leaf);
  const [open, setOpen] = useState(pending);
  if (!field) return null;
  const label = t(`workItems:filter.fields.${field.labelKey}`);
  const values = chipValues(leaf).filter(Boolean);
  const glyph = COMPARISON_GLYPHS[leaf.op];
  const text = values.length
    ? glyph
      ? `${label} ${glyph} ${values.join(", ")}`
      : `${label}: ${values.join(", ")}`
    : label;
  // `eq` and `in` are one choice here: the picked values decide between them.
  const operators = [
    ...new Set(field.operators.map((op) => (op === "in" ? "eq" : op))),
  ];
  // Only fields whose table allows `in` can hold several values; an `eq`-only field swaps its value.
  const multiple =
    field.operators.includes("in") && (leaf.op === "eq" || leaf.op === "in");
  return (
    <Badge
      variant="outline"
      size="lg"
      className="h-7 gap-0 rounded-full ps-0 pe-0 sm:h-7"
    >
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next && pending) onChange(undefined);
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="h-full max-w-56 rounded-s-full rounded-e-none font-normal"
            data-testid="work-item-filter-chip"
          >
            <span className="truncate">{text}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className={`w-72 ${POPUP_CLASS}`}
          aria-label={label}
        >
          <div className="grid gap-2">
            {operators.length > 1 ? (
              <PickerPopover
                value={leaf.op === "in" ? "eq" : leaf.op}
                ariaLabel={t("workItems:filter.operatorFor", { field: label })}
                searchable={false}
                options={operators.map((op) => ({
                  value: op,
                  label: operatorKey(op)
                    ? t(`workItems:filter.operators.${op}`)
                    : op,
                }))}
                onChange={(op) => onChange(withOperator(leaf, op))}
              />
            ) : null}
            {field.fixedValue ? (
              <Label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={values.length > 0}
                  onCheckedChange={(checked) =>
                    onChange(
                      checked
                        ? { ...leaf, value: field.fixedValue ?? "" }
                        : undefined,
                    )
                  }
                />
                {t("workItems:filter.me")}
              </Label>
            ) : field.values ? (
              <ValueChecklist
                options={field.values}
                selected={values}
                multiple={multiple}
                onChange={(next) =>
                  onChange(
                    multiple
                      ? withValues(leaf, next)
                      : { ...leaf, value: next[0] ?? "" },
                  )
                }
              />
            ) : (
              <ValueInput leaf={leaf} field={field} onChange={onChange} />
            )}
          </div>
        </PopoverContent>
      </Popover>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="rounded-s-none rounded-e-full"
        aria-label={t("workItems:filter.removeFilter", { field: label })}
        onClick={() => onChange(undefined)}
      >
        <X />
      </Button>
    </Badge>
  );
}

/**
 * The Notion-style chip layer over the one filter AST (`SV-11`): a chip per simple condition,
 * applied live, and the form editor behind "Advanced". A filter chips cannot show (OR, groups,
 * unlisted fields) is one "Advanced filter" chip, so nothing the URL or a saved view carries is
 * lost (`SV-12`). Filter text nobody edits is never rewritten.
 */
export default function WorkItemFilterBar({
  filter,
  mode,
  apiError,
  autoFocus = false,
  onClose,
  onModeChange,
  onApply,
}: {
  filter: string;
  mode: WorkItemFilterMode;
  apiError?: string;
  /** Focus "+ Filter" on mount (the user just opened the surface). */
  autoFocus?: boolean;
  /** Escape outside a popover closes the surface. */
  onClose?: () => void;
  onModeChange: (mode: WorkItemFilterMode) => void;
  /** `replace` is false for the first change of a filter session and for Advanced applies. */
  onApply: (filter: string, options?: { replace?: boolean }) => void;
}) {
  const { t } = useTranslation();
  const addRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (autoFocus) addRef.current?.focus();
  }, [autoFocus]);
  const [addOpen, setAddOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pending, setPending] = useState<FilterLeaf>();
  const chips = useMemo(() => {
    try {
      return toChips(parseWorkItemFilterText(filter));
    } catch {
      return null;
    }
  }, [filter]);

  // The first live chip change pushes a history entry so Back restores the earlier view; the
  // rest of the session replaces it, so Back does not step through every click (`VW-1`).
  const pushedRef = useRef(false);
  // A filter the bar did not apply itself (Back, Forward, a link) starts a new session.
  const appliedRef = useRef(filter);
  useEffect(() => {
    if (filter !== appliedRef.current) {
      pushedRef.current = false;
      appliedRef.current = filter;
    }
  }, [filter]);
  // The pending chip stays rendered until the URL carries its field, so its popover is not remounted.
  const shown = useMemo(
    () =>
      pending && !chips?.some((leaf) => leaf.field === pending.field)
        ? [...(chips ?? []), pending]
        : (chips ?? []),
    [chips, pending],
  );
  useEffect(() => {
    if (pending && chips?.some((leaf) => leaf.field === pending.field))
      setPending(undefined);
  }, [chips, pending]);
  const apply = (leaves: readonly FilterLeaf[]) => {
    try {
      const text = printWorkItemFilterText(fromChips(leaves));
      onApply(text, { replace: pushedRef.current });
      pushedRef.current = true;
      appliedRef.current = text;
    } catch {
      // A value the grammar refuses is never applied; the input marks itself invalid.
    }
  };
  const update = (index: number, next: FilterLeaf | undefined) => {
    const leaves = [...(chips ?? [])];
    if (next) leaves[index] = next;
    else leaves.splice(index, 1);
    apply(leaves);
  };
  const updatePending = (next: FilterLeaf | undefined) => {
    setPending(next);
    if (next && !isEmpty(next)) apply([...(chips ?? []), next]);
  };
  const addField = (id: string) => {
    const field = FILTER_FIELDS.find((candidate) => candidate.id === id);
    if (!field) return;
    setAddOpen(false);
    const op = field.operators[0] ?? "eq";
    // "Me" has nothing left to choose, so it applies at once.
    if (field.fixedValue)
      apply([...(chips ?? []), { field: id, op, value: field.fixedValue }]);
    else setPending({ field: id, op, value: "" });
  };

  const advancedLabel = t("workItems:filter.advancedFilter");
  const editor = (
    <PopoverContent
      align="start"
      className={`w-[40rem] max-h-[70vh] overflow-y-auto ${POPUP_CLASS}`}
      aria-label={t("workItems:filter.advancedFilter")}
    >
      <Suspense fallback={<div className="h-24" aria-busy="true" />}>
        <WorkItemFilterEditor
          filter={filter}
          mode={mode}
          fallbackSurface="card"
          onModeChange={onModeChange}
          onApply={(next) => {
            onApply(next, { replace: false });
            pushedRef.current = true;
            appliedRef.current = next;
            setAdvancedOpen(false);
          }}
        />
      </Suspense>
    </PopoverContent>
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // A popover uses Escape to close itself, and its events bubble through React.
    if (
      event.key === "Escape" &&
      !event.defaultPrevented &&
      !(event.target as Element).closest(
        '[data-slot="popover-popup"], [role="listbox"], [role="option"], [aria-expanded="true"]',
      )
    )
      onClose?.();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape bubbles from the controls inside.
    <div
      className="flex min-w-0 max-w-full flex-col gap-1"
      onKeyDown={handleKeyDown}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <fieldset
          aria-label={t("workItems:filter.chipsLabel")}
          className="m-0 flex min-w-0 items-center gap-1.5 overflow-x-auto border-0 p-0"
        >
          {chips === null ? (
            <Popover open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <Badge
                variant="outline"
                size="lg"
                className="h-7 gap-0 rounded-full ps-0 pe-0 sm:h-7"
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="h-full rounded-s-full rounded-e-none font-normal"
                    data-testid="work-item-filter-chip"
                  >
                    {advancedLabel}
                  </Button>
                </PopoverTrigger>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="rounded-s-none rounded-e-full"
                  aria-label={t("workItems:filter.removeFilter", {
                    field: advancedLabel,
                  })}
                  onClick={() => onApply("")}
                >
                  <X />
                </Button>
              </Badge>
              {editor}
            </Popover>
          ) : (
            // The pending chip is the last row, so once it has a value it becomes the same
            // element and its popover stays open for more values.
            shown.map((leaf, index) => (
              <FilterChip
                // biome-ignore lint/suspicious/noArrayIndexKey: a chip has no id; its position is its identity.
                key={`${leaf.field}:${index}`}
                leaf={leaf}
                pending={index === chips.length}
                onChange={(next) =>
                  index === chips.length
                    ? updatePending(next)
                    : update(index, next)
                }
              />
            ))
          )}
        </fieldset>
        {chips ? (
          <Popover open={addOpen} onOpenChange={setAddOpen}>
            <PopoverTrigger asChild>
              <Button
                ref={addRef}
                type="button"
                variant="ghost"
                size="xs"
                className="shrink-0"
              >
                <Plus />
                {t("workItems:filter.addFilter")}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className={`w-64 p-0 ${POPUP_CLASS}`}
              aria-label={t("workItems:filter.addFilter")}
            >
              <PickerSearchList
                searchLabel={t("workItems:filter.searchFields")}
                options={FILTER_FIELDS.map((field) => ({
                  value: field.id,
                  label: t(`workItems:filter.fields.${field.labelKey}`),
                }))}
                isSelected={(id) =>
                  (chips ?? []).some((leaf) => leaf.field === id)
                }
                onSelect={addField}
              />
            </PopoverContent>
          </Popover>
        ) : null}
        {chips ? (
          <Popover open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="shrink-0"
              >
                <SlidersHorizontal />
                {t("workItems:filter.advanced")}
              </Button>
            </PopoverTrigger>
            {editor}
          </Popover>
        ) : null}
      </div>
      {apiError ? (
        <Alert
          variant="error"
          role="alert"
          data-testid="work-item-search-error"
        >
          <AlertDescription>{apiError}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
