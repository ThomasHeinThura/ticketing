import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { WorkflowTransitionInput } from "@/fetchers/workflow";

export type NamedOption = { id: string; name: string };

const ANY = "__any";
const NOTE_POLICIES = ["none", "optional", "required"] as const;

/**
 * `WF-9` authoring: adds one transition (from, to, role, note policy) to the working copy.
 * Guards, approvals and effects are not authored here; they are kept on the transitions
 * that already carry them.
 */
export function WorkflowAddTransitionDialog({
  open,
  onOpenChange,
  states,
  roles,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  states: NamedOption[];
  roles: NamedOption[];
  onAdd: (transition: WorkflowTransitionInput) => void;
}) {
  const { t } = useTranslation();
  const [from, setFrom] = useState(ANY);
  const [to, setTo] = useState("");
  const [role, setRole] = useState(ANY);
  const [notePolicy, setNotePolicy] =
    useState<(typeof NOTE_POLICIES)[number]>("none");
  const nameOf = (id: string, options: NamedOption[]) =>
    options.find((option) => option.id === id)?.name;
  const reset = () => {
    setFrom(ANY);
    setTo("");
    setRole(ANY);
    setNotePolicy("none");
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent closeLabel={t("common:actions.close")}>
        <DialogHeader>
          <DialogTitle>{t("settings:workflows.add.title")}</DialogTitle>
          <DialogDescription>
            {t("settings:workflows.add.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6">
          <div className="space-y-2">
            <Label htmlFor="workflow-transition-from">
              {t("settings:workflows.transitions.from")}
            </Label>
            <Select
              value={from}
              onValueChange={(value) => setFrom(value ?? ANY)}
            >
              <SelectTrigger id="workflow-transition-from">
                <SelectValue>
                  {from === ANY
                    ? t("settings:workflows.transitions.anyState")
                    : nameOf(from, states)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>
                  {t("settings:workflows.transitions.anyState")}
                </SelectItem>
                {states.map((state) => (
                  <SelectItem key={state.id} value={state.id}>
                    {state.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="workflow-transition-to">
              {t("settings:workflows.transitions.to")}
            </Label>
            <Select value={to} onValueChange={(value) => setTo(value ?? "")}>
              <SelectTrigger id="workflow-transition-to">
                <SelectValue
                  placeholder={t("settings:workflows.add.toPlaceholder")}
                >
                  {nameOf(to, states)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {states.map((state) => (
                  <SelectItem key={state.id} value={state.id}>
                    {state.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="workflow-transition-role">
              {t("settings:workflows.transitions.role")}
            </Label>
            <Select
              value={role}
              onValueChange={(value) => setRole(value ?? ANY)}
            >
              <SelectTrigger id="workflow-transition-role">
                <SelectValue>
                  {role === ANY
                    ? t("settings:workflows.transitions.anyRole")
                    : nameOf(role, roles)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>
                  {t("settings:workflows.transitions.anyRole")}
                </SelectItem>
                {roles.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="workflow-transition-note">
              {t("settings:workflows.transitions.notes")}
            </Label>
            <Select
              value={notePolicy}
              onValueChange={(value) =>
                setNotePolicy((value as typeof notePolicy) ?? "none")
              }
            >
              <SelectTrigger id="workflow-transition-note">
                <SelectValue>
                  {t(`settings:workflows.notePolicy.${notePolicy}`)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {NOTE_POLICIES.map((policy) => (
                  <SelectItem key={policy} value={policy}>
                    {t(`settings:workflows.notePolicy.${policy}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            disabled={!to}
            onClick={() => {
              onAdd({
                fromStateTemplateId: from === ANY ? null : from,
                toStateTemplateId: to,
                roleId: role === ANY ? null : role,
                notePolicy,
                noteVisibility: "internal",
                requiresApproval: false,
                approvalPolicy: null,
                requiresCab: false,
                isReopen: false,
                guards: [],
                effects: [],
              });
              reset();
              onOpenChange(false);
            }}
          >
            {t("settings:workflows.add.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
