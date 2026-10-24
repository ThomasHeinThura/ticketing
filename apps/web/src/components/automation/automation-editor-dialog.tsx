import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@taskdesk/ui";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type AssignableRole,
  type Automation,
  AutomationRuleError,
} from "@/fetchers/automation/automations";
import { listWebhooks } from "@/fetchers/webhook/webhooks";
import useGetLabelsByWorkspace from "@/hooks/queries/label/use-get-labels-by-workspace";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useGetAssignablePeople from "@/hooks/queries/work-item/use-get-assignable-people";
import useGetWorkItemTypes from "@/hooks/queries/work-item/use-get-work-item-types";
import {
  ACTION_TYPES,
  type ActionDraft,
  actionNeedsPerson,
  CHANGEABLE_FIELDS,
  type ConditionDraft,
  conditionDefaults,
  draftFromAutomation,
  draftToInput,
  EDITABLE_CONDITIONS,
  type EditableConditionField,
  emptyAction,
  emptyCondition,
  emptyDraft,
  operatorsFor,
  PRIORITIES,
  type RuleDraft,
  STATE_GROUPS,
  TRIGGERS,
  validateDraft,
} from "./automation-model";
import { type PickerOption, PickerSelect } from "./picker-select";

const NO_PRIORITY = "__none__";

type Lists = {
  types: PickerOption[];
  labels: PickerOption[];
  labelNames: PickerOption[];
  projectKeys: PickerOption[];
  people: PickerOption[];
  webhooks: PickerOption[];
};

function ConditionRow({
  condition,
  lists,
  disabled,
  onChange,
  onRemove,
}: {
  condition: ConditionDraft;
  lists: Lists;
  disabled: boolean;
  onChange: (next: ConditionDraft) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation("automations");
  const fieldOptions: PickerOption[] = Object.keys(EDITABLE_CONDITIONS).map(
    (field) => ({ value: field, label: t(`conditions.fields.${field}`) }),
  );
  if (condition.readOnly) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2">
        <p className="min-w-0 text-sm break-words">
          <span className="font-mono text-xs">
            {condition.field} {condition.op} {condition.value}
          </span>
          <span className="ms-2 text-xs text-muted-foreground">
            {t("conditions.keptAsStored")}
          </span>
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("conditions.remove")}
          disabled={disabled}
          onClick={onRemove}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
    );
  }
  const field = condition.field as EditableConditionField;
  const operatorOptions = operatorsFor(field).map((op) => ({
    value: op,
    label: t(`conditions.ops.${op}`),
  }));
  const valueControl = (() => {
    if (condition.op === "is_empty" || condition.op === "is_not_empty")
      return null;
    const set = (value: string) => onChange({ ...condition, value });
    switch (field) {
      case "type":
        return (
          <PickerSelect
            ariaLabel={t("conditions.value")}
            value={condition.value}
            options={lists.types}
            placeholder={t("conditions.pickType")}
            disabled={disabled}
            onChange={set}
          />
        );
      case "state.group":
        return (
          <PickerSelect
            ariaLabel={t("conditions.value")}
            value={condition.value}
            options={STATE_GROUPS.map((group) => ({
              value: group,
              label: t(`stateGroups.${group}`),
            }))}
            placeholder={t("conditions.pickValue")}
            disabled={disabled}
            onChange={set}
          />
        );
      case "priority":
        return (
          <PickerSelect
            ariaLabel={t("conditions.value")}
            value={condition.value}
            options={PRIORITIES.map((priority) => ({
              value: priority,
              label: t(`priorities.${priority}`),
            }))}
            placeholder={t("conditions.pickValue")}
            disabled={disabled}
            onChange={set}
          />
        );
      case "label":
        return (
          <PickerSelect
            ariaLabel={t("conditions.value")}
            value={condition.value}
            options={lists.labelNames}
            placeholder={t("conditions.pickLabel")}
            disabled={disabled}
            onChange={set}
          />
        );
      case "project":
        return (
          <PickerSelect
            ariaLabel={t("conditions.value")}
            value={condition.value}
            options={lists.projectKeys}
            placeholder={t("conditions.pickProject")}
            disabled={disabled}
            onChange={set}
          />
        );
      case "comment_visibility":
        return (
          <PickerSelect
            ariaLabel={t("conditions.value")}
            value={condition.value}
            options={[
              { value: "public", label: t("conditions.visibility.public") },
              { value: "internal", label: t("conditions.visibility.internal") },
            ]}
            placeholder={t("conditions.pickValue")}
            disabled={disabled}
            onChange={set}
          />
        );
      case "field_changed":
        return (
          <PickerSelect
            ariaLabel={t("conditions.value")}
            value={condition.value}
            options={CHANGEABLE_FIELDS.map((name) => ({
              value: name,
              label: t(`conditions.changeable.${name}`),
            }))}
            placeholder={t("conditions.pickValue")}
            disabled={disabled}
            onChange={set}
          />
        );
      case "age":
        return (
          <div className="flex min-w-0 items-center gap-2">
            <Input
              type="number"
              min={0}
              step={1}
              aria-label={t("conditions.minutes")}
              className="w-24"
              value={condition.value}
              disabled={disabled}
              onChange={(event) => set(event.target.value)}
            />
            <span className="text-sm text-muted-foreground">
              {t("conditions.minutesSince")}
            </span>
            <PickerSelect
              ariaLabel={t("conditions.basis")}
              value={condition.basis}
              options={[
                { value: "created_at", label: t("conditions.basisCreated") },
                { value: "updated_at", label: t("conditions.basisUpdated") },
              ]}
              placeholder={t("conditions.basis")}
              disabled={disabled}
              onChange={(basis) =>
                onChange({
                  ...condition,
                  basis: basis === "updated_at" ? "updated_at" : "created_at",
                })
              }
            />
          </div>
        );
      default:
        return null;
    }
  })();
  return (
    <div className="grid gap-2 sm:grid-cols-[10rem_9rem_1fr_auto] sm:items-center">
      <PickerSelect
        ariaLabel={t("conditions.field")}
        value={condition.field}
        options={fieldOptions}
        placeholder={t("conditions.field")}
        disabled={disabled}
        onChange={(next) =>
          onChange({
            ...condition,
            field: next,
            ...conditionDefaults(next as EditableConditionField),
          })
        }
      />
      <PickerSelect
        ariaLabel={t("conditions.operator")}
        value={condition.op}
        options={operatorOptions}
        placeholder={t("conditions.operator")}
        disabled={disabled}
        onChange={(op) => onChange({ ...condition, op })}
      />
      <div className="min-w-0">{valueControl}</div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t("conditions.remove")}
        disabled={disabled}
        onClick={onRemove}
      >
        <Trash2 aria-hidden="true" />
      </Button>
    </div>
  );
}

function ActionRow({
  action,
  lists,
  disabled,
  onChange,
  onRemove,
}: {
  action: ActionDraft;
  lists: Lists;
  disabled: boolean;
  onChange: (next: ActionDraft) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation("automations");
  if (action.readOnly) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2">
        <p className="min-w-0 text-sm break-words">
          <span className="font-mono text-xs">{action.type}</span>
          <span className="ms-2 text-xs text-muted-foreground">
            {t("actions.keptAsStored")}
          </span>
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("actions.remove")}
          disabled={disabled}
          onClick={onRemove}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
    );
  }
  const set = (value: string) => onChange({ ...action, value });
  const control = (() => {
    switch (action.type) {
      case "assign":
      case "add_watcher":
        return (
          <PickerSelect
            ariaLabel={t("actions.person")}
            value={action.value}
            options={lists.people}
            placeholder={t("actions.pickPerson")}
            disabled={disabled}
            onChange={set}
          />
        );
      case "set_priority":
        return (
          <PickerSelect
            ariaLabel={t("actions.priority")}
            value={action.value === "" ? NO_PRIORITY : action.value}
            options={[
              { value: NO_PRIORITY, label: t("actions.noPriority") },
              ...PRIORITIES.map((priority) => ({
                value: priority,
                label: t(`priorities.${priority}`),
              })),
            ]}
            placeholder={t("actions.pickPriority")}
            disabled={disabled}
            onChange={(next) => set(next === NO_PRIORITY ? "" : next)}
          />
        );
      case "set_due_date":
        return (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={3650}
              step={1}
              aria-label={t("actions.dueInDays")}
              className="w-24"
              value={action.value}
              disabled={disabled}
              onChange={(event) => set(event.target.value)}
            />
            <span className="text-sm text-muted-foreground">
              {t("actions.daysFromNow")}
            </span>
          </div>
        );
      case "add_label":
      case "remove_label":
        return (
          <PickerSelect
            ariaLabel={t("actions.label")}
            value={action.value}
            options={lists.labels}
            placeholder={t("actions.pickLabel")}
            disabled={disabled}
            onChange={set}
          />
        );
      case "call_webhook":
        return (
          <PickerSelect
            ariaLabel={t("actions.webhook")}
            value={action.value}
            options={lists.webhooks}
            placeholder={t("actions.pickWebhook")}
            disabled={disabled}
            onChange={set}
          />
        );
      default:
        return null;
    }
  })();
  return (
    <div className="grid gap-2 sm:grid-cols-[12rem_1fr_auto] sm:items-center">
      <PickerSelect
        ariaLabel={t("actions.type")}
        value={action.type}
        options={ACTION_TYPES.map((type) => ({
          value: type,
          label: t(`actions.types.${type}`),
        }))}
        placeholder={t("actions.type")}
        disabled={disabled}
        onChange={(type) =>
          onChange({
            ...action,
            type,
            value: type === "set_priority" ? "high" : "",
          })
        }
      />
      <div className="min-w-0">{control}</div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t("actions.remove")}
        disabled={disabled}
        onClick={onRemove}
      >
        <Trash2 aria-hidden="true" />
      </Button>
    </div>
  );
}

/**
 * The rule editor, in plain language: **When** a trigger, **If** a flat list of conditions all
 * hold (an OR is two rules, `AM-1`), **Then** a flat list of actions, **Run as** the effective
 * role the rule may not exceed (`AM-3`). A new rule is saved disabled (`AM-10`); the API names
 * every problem by path and the dialog shows them verbatim.
 */
export function AutomationEditorDialog({
  rule,
  workspaceId,
  scopeProjectId,
  assignableRoles,
  pending,
  error,
  onSave,
  onClose,
}: {
  rule?: Automation;
  workspaceId: string;
  /** Set for a project rule: its roster supplies the people pickers. */
  scopeProjectId: string | null;
  assignableRoles: AssignableRole[];
  pending: boolean;
  error: unknown;
  onSave: (input: ReturnType<typeof draftToInput>) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("automations");
  const [draft, setDraft] = useState<RuleDraft>(() =>
    rule ? draftFromAutomation(rule) : emptyDraft(assignableRoles[0]?.id ?? ""),
  );
  const [touched, setTouched] = useState(false);
  const [rosterProjectId, setRosterProjectId] = useState(scopeProjectId ?? "");

  const types = useGetWorkItemTypes({ workspaceId });
  const labels = useGetLabelsByWorkspace(workspaceId);
  const projects = useGetProjects({ workspaceId });
  const needsPeople = draft.actions.some((action) =>
    actionNeedsPerson(action.type),
  );
  const people = useGetAssignablePeople({
    projectId: rosterProjectId || undefined,
    enabled: needsPeople,
  });
  const needsWebhooks = draft.actions.some(
    (action) => action.type === "call_webhook",
  );
  const webhooks = useQuery({
    queryKey: ["webhooks", workspaceId],
    enabled: needsWebhooks && Boolean(workspaceId),
    queryFn: () => listWebhooks(workspaceId),
    retry: false,
  });

  const workspaceLabels = (labels.data ?? []).filter(
    (label) => !("projectId" in label) || !label.projectId,
  );
  const lists: Lists = {
    types: (types.data ?? []).map((type) => ({
      value: type.key,
      label: type.name,
    })),
    labels: workspaceLabels.map((label) => ({
      value: label.id,
      label: label.name,
    })),
    labelNames: workspaceLabels.map((label) => ({
      value: label.name,
      label: label.name,
    })),
    projectKeys: (projects.data ?? []).map((project) => ({
      value: project.slug,
      label: `${project.name} (${project.slug})`,
    })),
    people: (people.data ?? []).map((person) => ({
      value: person.personId,
      label: person.name ?? person.personId,
    })),
    webhooks: (webhooks.data ?? []).map((webhook) => ({
      value: webhook.id,
      label: webhook.name,
    })),
  };

  const problems = validateDraft(draft);
  const apiProblems =
    error instanceof AutomationRuleError ? error.problems : [];

  const updateCondition = (key: string, next: ConditionDraft) =>
    setDraft((current) => ({
      ...current,
      conditions: current.conditions.map((entry) =>
        entry.key === key ? next : entry,
      ),
    }));
  const updateAction = (key: string, next: ActionDraft) =>
    setDraft((current) => ({
      ...current,
      actions: current.actions.map((entry) =>
        entry.key === key ? next : entry,
      ),
    }));

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        className="max-w-3xl"
        closeLabel={t("common:actions.close")}
      >
        <DialogHeader>
          <DialogTitle>
            {rule ? t("editor.editTitle") : t("editor.newTitle")}
          </DialogTitle>
          <DialogDescription>{t("editor.description")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            setTouched(true);
            if (problems.length === 0 && !pending) onSave(draftToInput(draft));
          }}
        >
          <div className="max-h-[60vh] space-y-5 overflow-y-auto px-6">
            <div className="space-y-2">
              <Label htmlFor="automation-name">{t("editor.name")}</Label>
              <Input
                id="automation-name"
                autoFocus
                maxLength={120}
                value={draft.name}
                disabled={pending}
                aria-invalid={touched && problems.includes("nameRequired")}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
              {touched && problems.includes("nameRequired") ? (
                <p className="text-xs text-destructive-foreground">
                  {t("editor.problems.nameRequired")}
                </p>
              ) : null}
            </div>

            <section className="space-y-2" aria-labelledby="automation-when">
              <h3 id="automation-when" className="text-sm font-semibold">
                {t("editor.when")}
              </h3>
              <PickerSelect
                ariaLabel={t("editor.when")}
                value={draft.trigger}
                options={TRIGGERS.map((trigger) => ({
                  value: trigger,
                  label: t(`triggers.${trigger}`),
                }))}
                placeholder={t("editor.pickTrigger")}
                disabled={pending}
                onChange={(trigger) =>
                  setDraft((current) => ({ ...current, trigger }))
                }
              />
            </section>

            <section className="space-y-2" aria-labelledby="automation-if">
              <h3 id="automation-if" className="text-sm font-semibold">
                {t("editor.if")}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t("editor.ifHelp")}
              </p>
              {draft.conditions.map((condition) => (
                <ConditionRow
                  key={condition.key}
                  condition={condition}
                  lists={lists}
                  disabled={pending}
                  onChange={(next) => updateCondition(condition.key, next)}
                  onRemove={() =>
                    setDraft((current) => ({
                      ...current,
                      conditions: current.conditions.filter(
                        (entry) => entry.key !== condition.key,
                      ),
                    }))
                  }
                />
              ))}
              {touched && problems.includes("conditionValueRequired") ? (
                <p className="text-xs text-destructive-foreground">
                  {t("editor.problems.conditionValueRequired")}
                </p>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    conditions: [...current.conditions, emptyCondition()],
                  }))
                }
              >
                <Plus aria-hidden="true" />
                {t("editor.addCondition")}
              </Button>
            </section>

            <section className="space-y-2" aria-labelledby="automation-then">
              <h3 id="automation-then" className="text-sm font-semibold">
                {t("editor.then")}
              </h3>
              {needsPeople && !scopeProjectId ? (
                <div className="space-y-1">
                  <Label htmlFor="automation-roster">
                    {t("editor.rosterProject")}
                  </Label>
                  <PickerSelect
                    id="automation-roster"
                    value={rosterProjectId}
                    options={(projects.data ?? []).map((project) => ({
                      value: project.id,
                      label: `${project.name} (${project.slug})`,
                    }))}
                    placeholder={t("editor.pickRosterProject")}
                    disabled={pending}
                    onChange={setRosterProjectId}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("editor.rosterHelp")}
                  </p>
                </div>
              ) : null}
              {draft.actions.map((action) => (
                <ActionRow
                  key={action.key}
                  action={action}
                  lists={lists}
                  disabled={pending}
                  onChange={(next) => updateAction(action.key, next)}
                  onRemove={() =>
                    setDraft((current) => ({
                      ...current,
                      actions: current.actions.filter(
                        (entry) => entry.key !== action.key,
                      ),
                    }))
                  }
                />
              ))}
              {touched && problems.includes("actionsRequired") ? (
                <p className="text-xs text-destructive-foreground">
                  {t("editor.problems.actionsRequired")}
                </p>
              ) : null}
              {touched && problems.includes("actionValueRequired") ? (
                <p className="text-xs text-destructive-foreground">
                  {t("editor.problems.actionValueRequired")}
                </p>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    actions: [...current.actions, emptyAction()],
                  }))
                }
              >
                <Plus aria-hidden="true" />
                {t("editor.addAction")}
              </Button>
              <p className="text-xs text-muted-foreground">
                {t("editor.noDelete")}
              </p>
            </section>

            <section className="space-y-2" aria-labelledby="automation-role">
              <h3 id="automation-role" className="text-sm font-semibold">
                {t("editor.runAs")}
              </h3>
              <PickerSelect
                ariaLabel={t("editor.runAs")}
                value={draft.effectiveRoleId}
                options={assignableRoles.map((role) => ({
                  value: role.id,
                  label: role.name,
                }))}
                placeholder={t("editor.pickRole")}
                disabled={pending}
                onChange={(effectiveRoleId) =>
                  setDraft((current) => ({ ...current, effectiveRoleId }))
                }
              />
              <p className="text-xs text-muted-foreground">
                {t("editor.runAsHelp")}
              </p>
              {touched && problems.includes("roleRequired") ? (
                <p className="text-xs text-destructive-foreground">
                  {t("editor.problems.roleRequired")}
                </p>
              ) : null}
            </section>

            <div className="flex items-center gap-2">
              <Checkbox
                id="automation-stop"
                checked={draft.stopProcessing}
                disabled={pending}
                onCheckedChange={(checked) =>
                  setDraft((current) => ({
                    ...current,
                    stopProcessing: checked === true,
                  }))
                }
              />
              <Label htmlFor="automation-stop" className="font-normal">
                {t("editor.stopProcessing")}
              </Label>
            </div>

            {error ? (
              <Alert variant="error">
                <AlertTitle>{t("editor.saveFailed")}</AlertTitle>
                <AlertDescription>
                  {apiProblems.length > 0 ? (
                    <ul className="list-disc ps-4">
                      {apiProblems.map((problem) => (
                        <li key={`${problem.path}:${problem.message}`}>
                          <span className="font-mono text-xs">
                            {problem.path}
                          </span>{" "}
                          {problem.message}
                        </li>
                      ))}
                    </ul>
                  ) : error instanceof Error && error.message ? (
                    error.message
                  ) : (
                    t("editor.saveFailed")
                  )}
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              disabled={pending}
              onClick={onClose}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {rule ? t("editor.save") : t("editor.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
