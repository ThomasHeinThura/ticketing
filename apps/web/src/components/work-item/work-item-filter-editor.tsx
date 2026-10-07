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
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import type { WorkItemFilterMode } from "@/lib/routes";
import {
  parseWorkItemFilterText,
  printWorkItemFilterText,
  type WorkItemFilter,
} from "@/lib/work-item-filter";

type FilterField = {
  id: string;
  label: string;
  operators: readonly string[];
  values?: readonly string[];
  fixedValue?: string;
};

const FILTER_FIELDS: readonly FilterField[] = [
  {
    id: "state.group",
    label: "State group",
    operators: ["eq", "in"],
    values: ["backlog", "unstarted", "started", "completed", "cancelled"],
  },
  {
    id: "priority",
    label: "Priority",
    operators: ["eq", "in", "gt", "gte", "lt", "lte"],
    values: ["low", "medium", "high", "urgent"],
  },
  { id: "assignee", label: "Assignee", operators: ["eq"], fixedValue: "@me" },
  {
    id: "watcher",
    label: "Watcher",
    operators: ["contains"],
    fixedValue: "@me",
  },
  { id: "dueDate", label: "Due date", operators: ["lt", "lte", "gt", "gte"] },
  {
    id: "createdAt",
    label: "Created date",
    operators: ["lt", "lte", "gt", "gte"],
  },
  { id: "project", label: "Project", operators: ["eq"] },
  { id: "type", label: "Type", operators: ["eq"] },
];

const OPERATOR_LABELS: Record<string, string> = {
  eq: "is",
  in: "is one of",
  contains: "contains",
  lt: "before / less than",
  lte: "at or before / at most",
  gt: "after / greater than",
  gte: "at or after / at least",
};

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
              Unavailable in P1; applying sends this field to search for its
              documented 422 response.
            </span>
          ) : (
            <span className="text-muted-foreground text-sm">
              Unsupported field; edit in text mode or remove.
            </span>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`Remove ${node.field} filter`}
            onClick={() => onRemove(path)}
          >
            <Trash2 />
          </Button>
        </div>
      );
    }
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
          onValueChange={(next) =>
            next && onChange(path, (current) => updateLeafField(current, next))
          }
        >
          <SelectTrigger aria-label="Filter field">
            <SelectValue placeholder="Field" />
          </SelectTrigger>
          <SelectPopup>
            {FILTER_FIELDS.map((candidate) => (
              <SelectItem key={candidate.id} value={candidate.id}>
                {candidate.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Select
          value={node.op}
          onValueChange={(next) =>
            next &&
            onChange(path, (current) => updateLeafOperator(current, next))
          }
        >
          <SelectTrigger aria-label={`Operator for ${field.label}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {field.operators.map((operator) => (
              <SelectItem key={operator} value={operator}>
                {OPERATOR_LABELS[operator] ?? operator}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        {field.fixedValue ? (
          <Input
            aria-label={`Value for ${field.label}`}
            value={field.fixedValue}
            disabled
          />
        ) : field.values && node.op === "in" ? (
          <CheckboxGroup
            aria-label={`Values for ${field.label}`}
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
            <SelectTrigger aria-label={`Value for ${field.label}`}>
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
            aria-label={`Value for ${field.label}`}
            value={value}
            placeholder={
              node.op === "in"
                ? "value1, value2"
                : field.id.includes("Date")
                  ? "YYYY-MM-DD or 7d"
                  : "Value"
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
          aria-label={`Remove ${field.label} filter`}
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
      <legend className="px-1 text-sm font-medium">Match</legend>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={node.op}
          onValueChange={(next) =>
            next &&
            onChange(path, (current) => ({
              ...current,
              op: next as "and" | "or",
            }))
          }
        >
          <SelectTrigger aria-label="Group operator" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="and">all (AND)</SelectItem>
            <SelectItem value="or">any (OR)</SelectItem>
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
          <Plus /> Add condition
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
          <Plus /> Add group
        </Button>
        {path.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label="Remove filter group"
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
  apiError?: string;
  onModeChange: (mode: WorkItemFilterMode) => void;
  onApply: (filter: string) => void;
};

export default function WorkItemFilterEditor({
  filter,
  mode,
  fallbackSurface = "background",
  apiError,
  onModeChange,
  onApply,
}: WorkItemFilterEditorProps) {
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
        error: error instanceof Error ? error.message : "Invalid filter text.",
      };
    }
  }, [textDraft]);

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
      setTextError(
        "This filter cannot be represented in text mode. Remove or edit the unsupported clause.",
      );
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
      className="grid gap-3"
      aria-label="Work item filters"
      onSubmit={handleApply}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <fieldset
          className="flex items-center gap-2"
          aria-label="Filter editor mode"
        >
          <legend className="sr-only">Filter editor mode</legend>
          <Button
            type="button"
            size="sm"
            variant={mode === "visual" ? "default" : "outline"}
            aria-pressed={mode === "visual"}
            onClick={() => handleModeChange("visual")}
          >
            Visual
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "text" ? "default" : "outline"}
            aria-pressed={mode === "text"}
            onClick={() => handleModeChange("text")}
          >
            Text
          </Button>
        </fieldset>
        <Button type="submit" size="sm" variant="outline">
          Apply filter
        </Button>
      </div>
      {mode === "text" ? (
        <Input
          aria-label="Filter work items"
          placeholder="assignee:@me state:started OR priority:>=high"
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
          <p>No filters are active.</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={addFirstFilter}
          >
            <Plus /> Add condition
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
            <Plus /> Add condition
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
            <Plus /> Add group
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
          This saved filter cannot be opened visually: {parsedText.error}
        </p>
      ) : null}
      {activeFilter &&
      "field" in activeFilter &&
      knownUnavailable(activeFilter.field) ? (
        <p className="text-muted-foreground text-sm">
          This recognized field is unavailable in P1. Apply it to see the API's
          field-specific 422 response.
        </p>
      ) : null}
    </form>
  );
}
