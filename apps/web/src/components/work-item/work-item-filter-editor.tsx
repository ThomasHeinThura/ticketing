import {
  Button,
  Checkbox,
  CheckboxGroup,
  Input,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@taskdesk/ui";
import { Plus, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import type { WorkItemFilterMode } from "@/lib/routes";
import {
  parseWorkItemFilterText,
  printWorkItemFilterText,
  type WorkItemFilter,
} from "@/lib/work-item-filter";

/**
 * The visual rendering of the one filter AST (`SV-11`); the text rendering is
 * `lib/work-item-filter.ts`. The field table mirrors the P1 whitelist in api-design.md
 * ("Work-item search v1"): the server stays the authority, and a clause this table does not
 * list is shown, kept and removable rather than dropped, so nothing the URL or a saved view
 * carries is silently lost (`SV-12`).
 */
type FilterField = {
  id: string;
  /** Key under `workItems:filter.fields`. */
  labelKey: string;
  operators: readonly FilterOperator[];
  values?: readonly string[];
  fixedValue?: string;
};

const OPERATORS = ["eq", "in", "contains", "lt", "lte", "gt", "gte"] as const;
type FilterOperator = (typeof OPERATORS)[number];

function operatorKey(operator: string): FilterOperator | undefined {
  return (OPERATORS as readonly string[]).includes(operator)
    ? (operator as FilterOperator)
    : undefined;
}

const FILTER_FIELDS: readonly FilterField[] = [
  {
    id: "state.group",
    labelKey: "stateGroup",
    operators: ["eq", "in"],
    values: ["backlog", "unstarted", "started", "completed", "cancelled"],
  },
  {
    id: "priority",
    labelKey: "priority",
    operators: ["eq", "in", "gt", "gte", "lt", "lte"],
    values: ["low", "medium", "high", "urgent"],
  },
  {
    id: "assignee",
    labelKey: "assignee",
    operators: ["eq"],
    fixedValue: "@me",
  },
  {
    id: "watcher",
    labelKey: "watcher",
    operators: ["contains"],
    fixedValue: "@me",
  },
  {
    id: "dueDate",
    labelKey: "dueDate",
    operators: ["lt", "lte", "gt", "gte"],
  },
  {
    id: "createdAt",
    labelKey: "createdAt",
    operators: ["lt", "lte", "gt", "gte"],
  },
  { id: "project", labelKey: "project", operators: ["eq"] },
  { id: "type", labelKey: "type", operators: ["eq"] },
];

const DEFAULT_FILTER_LEAF: WorkItemFilter = {
  field: "state.group",
  op: "eq",
  value: "started",
};

function isGroup(
  node: WorkItemFilter,
): node is Extract<WorkItemFilter, { clauses: WorkItemFilter[] }> {
  return "clauses" in node;
}

function leafFor(fieldId: string): WorkItemFilter {
  const field = FILTER_FIELDS.find((candidate) => candidate.id === fieldId);
  if (!field) return { ...DEFAULT_FILTER_LEAF };
  const value = field.fixedValue ?? field.values?.[0] ?? "";
  return { field: field.id, op: field.operators[0] ?? "eq", value };
}

function updateAt(
  node: WorkItemFilter | undefined,
  path: number[],
  change: (current: WorkItemFilter) => WorkItemFilter,
): WorkItemFilter | undefined {
  if (!node) return undefined;
  if (!path.length) return change(node);
  if (!isGroup(node)) return node;
  const [index, ...rest] = path;
  return {
    ...node,
    clauses: node.clauses.map((child, childIndex) =>
      childIndex === index ? (updateAt(child, rest, change) ?? child) : child,
    ),
  };
}

function removeAt(
  node: WorkItemFilter | undefined,
  path: number[],
): WorkItemFilter | undefined {
  if (!node || !path.length) return undefined;
  if (!isGroup(node)) return node;
  if (path.length === 1) {
    const clauses = node.clauses.filter((_child, index) => index !== path[0]);
    return clauses.length ? { ...node, clauses } : undefined;
  }
  const [index, ...rest] = path;
  const clauses = node.clauses
    .map((child, childIndex) =>
      childIndex === index ? removeAt(child, rest) : child,
    )
    .filter((child): child is WorkItemFilter => child !== undefined);
  return clauses.length ? { ...node, clauses } : undefined;
}

function updateLeafField(
  node: WorkItemFilter,
  fieldId: string,
): WorkItemFilter {
  if (isGroup(node)) return node;
  return leafFor(fieldId);
}

function updateLeafOperator(
  node: WorkItemFilter,
  operator: string,
): WorkItemFilter {
  if (isGroup(node)) return node;
  const field = FILTER_FIELDS.find((candidate) => candidate.id === node.field);
  const value =
    operator === "in"
      ? Array.isArray(node.value)
        ? node.value
        : [node.value]
      : (field?.fixedValue ??
        (Array.isArray(node.value) ? (node.value[0] ?? "") : node.value));
  return { ...node, op: operator, value };
}

function updateLeafValue(node: WorkItemFilter, value: string): WorkItemFilter {
  if (isGroup(node)) return node;
  return {
    ...node,
    value:
      node.op === "in"
        ? value
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean)
        : value,
  };
}

/** Fields the grammar recognises but the server does not back yet (it answers `422`). */
function knownUnavailable(field: string): boolean {
  return (
    field === "label" ||
    field.startsWith("cf.") ||
    field === "sla.state" ||
    field === "sla.due_at"
  );
}

function FilterNodeEditor({
  node,
  path,
  fallbackSurface,
  onChange,
  onRemove,
}: {
  node: WorkItemFilter;
  path: number[];
  fallbackSurface: "background" | "card";
  onChange: (
    path: number[],
    change: (current: WorkItemFilter) => WorkItemFilter,
  ) => void;
  onRemove: (path: number[]) => void;
}) {
  const { t } = useTranslation();
  if (!isGroup(node)) {
    const field = FILTER_FIELDS.find(
      (candidate) => candidate.id === node.field,
    );
    if (!field) {
      return (
        <div
          className={cn(
            "flex flex-wrap items-center gap-2 rounded-md border border-border p-3",
            fallbackSurface === "card" ? "bg-card" : "bg-background",
          )}
          data-testid="filter-unavailable-field"
        >
          <span className="text-sm">
            {node.field}:{" "}
            {Array.isArray(node.value) ? node.value.join(", ") : node.value}
          </span>
          {knownUnavailable(node.field) ? (
            <span className="text-muted-foreground text-sm">
              {t("workItems:filter.unavailableField")}
            </span>
          ) : (
            <span className="text-muted-foreground text-sm">
              {t("workItems:filter.unsupportedField")}
            </span>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={t("workItems:filter.removeFilter", {
              field: node.field,
            })}
            onClick={() => onRemove(path)}
          >
            <Trash2 />
          </Button>
        </div>
      );
    }
    const fieldLabel = t(`workItems:filter.fields.${field.labelKey}`);
    const value = Array.isArray(node.value)
      ? node.value.join(", ")
      : node.value;
    return (
      <div
        className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[minmax(8rem,1fr)_minmax(9rem,1fr)_minmax(10rem,1.5fr)_auto]"
        data-testid="filter-leaf"
      >
        <Select
          value={node.field}
          // `items` lets the closed trigger show the translated label, not the raw id.
          items={FILTER_FIELDS.map((candidate) => ({
            value: candidate.id,
            label: t(`workItems:filter.fields.${candidate.labelKey}`),
          }))}
          onValueChange={(next) =>
            next && onChange(path, (current) => updateLeafField(current, next))
          }
        >
          <SelectTrigger aria-label={t("workItems:filter.field")}>
            <SelectValue placeholder={t("workItems:filter.fieldPlaceholder")} />
          </SelectTrigger>
          <SelectPopup>
            {FILTER_FIELDS.map((candidate) => (
              <SelectItem key={candidate.id} value={candidate.id}>
                {t(`workItems:filter.fields.${candidate.labelKey}`)}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Select
          value={node.op}
          items={field.operators.map((operator) => ({
            value: operator,
            label: operatorKey(operator)
              ? t(`workItems:filter.operators.${operator}`)
              : operator,
          }))}
          onValueChange={(next) =>
            next &&
            onChange(path, (current) => updateLeafOperator(current, next))
          }
        >
          <SelectTrigger
            aria-label={t("workItems:filter.operatorFor", {
              field: fieldLabel,
            })}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {field.operators.map((operator) => (
              <SelectItem key={operator} value={operator}>
                {operatorKey(operator)
                  ? t(`workItems:filter.operators.${operator}`)
                  : operator}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        {field.fixedValue ? (
          <Input
            aria-label={t("workItems:filter.valueFor", { field: fieldLabel })}
            value={field.fixedValue}
            disabled
          />
        ) : field.values && node.op === "in" ? (
          <CheckboxGroup
            aria-label={t("workItems:filter.valuesFor", { field: fieldLabel })}
            className="flex flex-row flex-wrap gap-2"
            value={Array.isArray(node.value) ? node.value : [node.value]}
            onValueChange={(selected) => {
              const values = selected.filter(
                (entry): entry is string => typeof entry === "string",
              );
              if (values.length)
                onChange(path, (current) =>
                  updateLeafValue(current, values.join(",")),
                );
            }}
          >
            {field.values.map((option) => (
              <div key={option} className="flex items-center gap-1 text-sm">
                <Checkbox value={option} aria-label={option} />
                {option}
              </div>
            ))}
          </CheckboxGroup>
        ) : field.values && node.op !== "in" ? (
          <Select
            value={Array.isArray(node.value) ? node.value[0] : node.value}
            onValueChange={(next) =>
              next &&
              onChange(path, (current) => updateLeafValue(current, next))
            }
          >
            <SelectTrigger
              aria-label={t("workItems:filter.valueFor", { field: fieldLabel })}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {field.values.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        ) : (
          <Input
            aria-label={t("workItems:filter.valueFor", { field: fieldLabel })}
            value={value}
            placeholder={
              node.op === "in"
                ? t("workItems:filter.listPlaceholder")
                : field.id.includes("Date")
                  ? t("workItems:filter.datePlaceholder")
                  : t("workItems:filter.valuePlaceholder")
            }
            onChange={(event) =>
              onChange(path, (current) =>
                updateLeafValue(current, event.target.value),
              )
            }
          />
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={t("workItems:filter.removeFilter", { field: fieldLabel })}
          onClick={() => onRemove(path)}
        >
          <Trash2 />
        </Button>
      </div>
    );
  }

  return (
    <fieldset
      className="grid gap-3 rounded-md border border-border p-3"
      data-testid="filter-group"
    >
      <legend className="px-1 font-medium text-sm">
        {t("workItems:filter.match")}
      </legend>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={node.op}
          items={[
            { value: "and", label: t("workItems:filter.matchAll") },
            { value: "or", label: t("workItems:filter.matchAny") },
          ]}
          onValueChange={(next) =>
            next &&
            onChange(path, (current) => ({
              ...current,
              op: next as "and" | "or",
            }))
          }
        >
          <SelectTrigger
            aria-label={t("workItems:filter.groupOperator")}
            className="w-36"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="and">
              {t("workItems:filter.matchAll")}
            </SelectItem>
            <SelectItem value="or">{t("workItems:filter.matchAny")}</SelectItem>
          </SelectPopup>
        </Select>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            onChange(path, (current) =>
              isGroup(current)
                ? {
                    ...current,
                    clauses: [...current.clauses, { ...DEFAULT_FILTER_LEAF }],
                  }
                : current,
            )
          }
        >
          <Plus /> {t("workItems:filter.addCondition")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            onChange(path, (current) =>
              isGroup(current)
                ? {
                    ...current,
                    clauses: [
                      ...current.clauses,
                      { op: "and", clauses: [{ ...DEFAULT_FILTER_LEAF }] },
                    ],
                  }
                : current,
            )
          }
        >
          <Plus /> {t("workItems:filter.addGroup")}
        </Button>
        {path.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={t("workItems:filter.removeGroup")}
            onClick={() => onRemove(path)}
          >
            <Trash2 />
          </Button>
        ) : null}
      </div>
      <div className="grid gap-2 border-s-2 border-border ps-3">
        {node.clauses.map((child, index) => (
          <FilterNodeEditor
            key={[...path, index].join(".")}
            node={child}
            path={[...path, index]}
            fallbackSurface={fallbackSurface}
            onChange={onChange}
            onRemove={onRemove}
          />
        ))}
      </div>
    </fieldset>
  );
}

type WorkItemFilterEditorProps = {
  filter: string;
  mode: WorkItemFilterMode;
  fallbackSurface?: "background" | "card";
  /** The server's refusal of the applied filter (`status: message`), shown beside it. */
  apiError?: string;
  /** Focus the editor's first control on mount. */
  autoFocus?: boolean;
  /** Escape closes the editor (a disclosure), except inside a select popup. */
  onClose?: () => void;
  onModeChange: (mode: WorkItemFilterMode) => void;
  onApply: (filter: string) => void;
};

export default function WorkItemFilterEditor({
  filter,
  mode,
  fallbackSurface = "background",
  apiError,
  autoFocus = false,
  onClose,
  onModeChange,
  onApply,
}: WorkItemFilterEditorProps) {
  const { t } = useTranslation();
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (autoFocus)
      formRef.current
        ?.querySelector<HTMLElement>("button, input, [role=combobox]")
        ?.focus();
  }, [autoFocus]);
  const [textDraft, setTextDraft] = useState(filter);
  const [visualDraft, setVisualDraft] = useState<WorkItemFilter | undefined>();
  const [textError, setTextError] = useState<string>();

  useEffect(() => {
    setTextDraft(filter);
    setTextError(undefined);
    try {
      setVisualDraft(parseWorkItemFilterText(filter));
    } catch {
      setVisualDraft(undefined);
    }
  }, [filter]);

  const parsedText = useMemo(() => {
    try {
      return { filter: parseWorkItemFilterText(textDraft) };
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : t("workItems:filter.invalidText"),
      };
    }
  }, [textDraft, t]);

  const parsedFilter = "filter" in parsedText ? parsedText.filter : undefined;

  const activeFilter = mode === "visual" ? visualDraft : parsedFilter;
  const visualText = useMemo(() => {
    try {
      return printWorkItemFilterText(visualDraft);
    } catch {
      return undefined;
    }
  }, [visualDraft]);

  const handleModeChange = (nextMode: WorkItemFilterMode) => {
    if (nextMode === mode) return;
    if (nextMode === "visual") {
      if ("error" in parsedText) {
        setTextError(parsedText.error);
        return;
      }
      setVisualDraft(parsedFilter);
      setTextError(undefined);
    } else if (visualText !== undefined) {
      setTextDraft(visualText);
      setTextError(undefined);
    }
    onModeChange(nextMode);
  };

  const handleApply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mode === "text") {
      if ("error" in parsedText) {
        setTextError(parsedText.error);
        return;
      }
      onApply(textDraft.trim());
      return;
    }
    if (visualText === undefined) {
      setTextError(t("workItems:filter.notRepresentable"));
      return;
    }
    onApply(visualText);
  };

  const onChange = (
    path: number[],
    change: (current: WorkItemFilter) => WorkItemFilter,
  ) => {
    setVisualDraft((current) => updateAt(current, path, change));
    setTextError(undefined);
  };
  const onRemove = (path: number[]) => {
    setVisualDraft((current) => removeAt(current, path));
    setTextError(undefined);
  };
  const addFirstFilter = () =>
    setVisualDraft({ op: "and", clauses: [{ ...DEFAULT_FILTER_LEAF }] });

  return (
    <form
      ref={formRef}
      className="grid gap-3"
      aria-label={t("workItems:filter.formLabel")}
      onSubmit={handleApply}
      onKeyDown={(event) => {
        // A select popup uses Escape to close itself, and its events bubble through React.
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          !(event.target as Element).closest(
            '[role="listbox"], [role="option"], [aria-expanded="true"]',
          )
        )
          onClose?.();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <fieldset
          className="flex items-center gap-2"
          aria-label={t("workItems:filter.modeGroup")}
        >
          <legend className="sr-only">{t("workItems:filter.modeGroup")}</legend>
          <Button
            type="button"
            size="sm"
            variant={mode === "visual" ? "default" : "outline"}
            aria-pressed={mode === "visual"}
            onClick={() => handleModeChange("visual")}
          >
            {t("workItems:filter.modeVisual")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "text" ? "default" : "outline"}
            aria-pressed={mode === "text"}
            onClick={() => handleModeChange("text")}
          >
            {t("workItems:filter.modeText")}
          </Button>
        </fieldset>
        <Button type="submit" size="sm" variant="outline">
          {t("workItems:filter.apply")}
        </Button>
      </div>
      {mode === "text" ? (
        <Input
          aria-label={t("workItems:filter.textLabel")}
          placeholder={t("workItems:filter.textPlaceholder")}
          value={textDraft}
          maxLength={8192}
          aria-invalid={!!textError}
          onChange={(event) => {
            setTextDraft(event.target.value);
            setTextError(undefined);
          }}
        />
      ) : visualDraft ? (
        <FilterNodeEditor
          node={visualDraft}
          path={[]}
          fallbackSurface={fallbackSurface}
          onChange={onChange}
          onRemove={onRemove}
        />
      ) : (
        <div className="rounded-md border border-border p-3 text-sm">
          <p>{t("workItems:filter.noFilters")}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={addFirstFilter}
          >
            <Plus /> {t("workItems:filter.addCondition")}
          </Button>
        </div>
      )}
      {mode === "visual" && visualDraft && !isGroup(visualDraft) ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              setVisualDraft((current) =>
                current && !isGroup(current)
                  ? {
                      op: "and",
                      clauses: [current, { ...DEFAULT_FILTER_LEAF }],
                    }
                  : current,
              )
            }
          >
            <Plus /> {t("workItems:filter.addCondition")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              setVisualDraft((current) =>
                current && !isGroup(current)
                  ? {
                      op: "and",
                      clauses: [
                        current,
                        { op: "and", clauses: [{ ...DEFAULT_FILTER_LEAF }] },
                      ],
                    }
                  : current,
              )
            }
          >
            <Plus /> {t("workItems:filter.addGroup")}
          </Button>
        </div>
      ) : null}
      {textError ? (
        <p className="text-destructive text-sm" role="alert">
          {textError}
        </p>
      ) : null}
      {apiError &&
      (mode === "text"
        ? textDraft.trim() === filter
        : visualText === filter) ? (
        <p
          className="text-destructive text-sm"
          role="alert"
          data-testid="work-item-search-error"
        >
          {apiError}
        </p>
      ) : null}
      {mode === "visual" && !visualDraft && filter && "error" in parsedText ? (
        <p className="text-destructive text-sm" role="alert">
          {t("workItems:filter.cannotOpenVisually", {
            error: parsedText.error,
          })}
        </p>
      ) : null}
      {activeFilter &&
      "field" in activeFilter &&
      knownUnavailable(activeFilter.field) ? (
        <p className="text-muted-foreground text-sm">
          {t("workItems:filter.unavailableHint")}
        </p>
      ) : null}
    </form>
  );
}
