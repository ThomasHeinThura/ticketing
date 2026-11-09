import {
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@taskdesk/ui";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useGetWorkItemTypes from "@/hooks/queries/work-item/use-get-work-item-types";
import type { RequestTypeDraft } from "./request-type-model";

const NO_PROJECT = "__none__";

/**
 * Name, group, description, work item type, default project (picked by name, never typed as an
 * id) and the three intake switches of a request type draft.
 */
export function RequestTypeDetailsFields({
  workspaceId,
  draft,
  setDraft,
}: {
  workspaceId: string;
  draft: RequestTypeDraft;
  setDraft: (next: RequestTypeDraft) => void;
}) {
  const { t } = useTranslation("requestTypes");
  const ids = { visible: useId(), autoAccept: useId(), private: useId() };
  const workItemTypes = useGetWorkItemTypes({ workspaceId });
  const projects = useGetProjects({ workspaceId });
  const projectList = projects.data ?? [];
  const projectLabel = (id: string | null) =>
    !id
      ? t("noDefaultProject", { defaultValue: "No default project" })
      : (projectList.find((project) => project.id === id)?.name ??
        t("unavailableProject", { defaultValue: "Unavailable project" }));
  // A stored project that is no longer listed (archived or deleted) keeps its value and option.
  const projectMissing =
    draft.defaultProjectId !== null &&
    !projectList.some((project) => project.id === draft.defaultProjectId);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label
          className="flex flex-col gap-1 text-sm"
          htmlFor="request-type-name"
        >
          {t("name", { defaultValue: "Name" })}
          <Input
            id="request-type-name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label
          className="flex flex-col gap-1 text-sm"
          htmlFor="request-type-group"
        >
          {t("group", { defaultValue: "Catalogue group" })}
          <Input
            id="request-type-group"
            value={draft.group}
            onChange={(e) => setDraft({ ...draft, group: e.target.value })}
          />
        </label>
        <label
          className="flex flex-col gap-1 text-sm sm:col-span-2"
          htmlFor="request-type-description"
        >
          {t("summary", { defaultValue: "Description" })}
          <Textarea
            id="request-type-description"
            value={draft.description ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, description: e.target.value })
            }
          />
        </label>
        <div className="flex flex-col gap-1">
          <Label htmlFor="request-type-work-item-type">
            {t("workItemType", { defaultValue: "Work item type" })}
          </Label>
          <Select
            value={draft.workItemTypeId || null}
            onValueChange={(value) =>
              setDraft({ ...draft, workItemTypeId: value ?? "" })
            }
          >
            <SelectTrigger id="request-type-work-item-type">
              <SelectValue
                placeholder={t("chooseType", {
                  defaultValue: "Choose a type",
                })}
              >
                {
                  workItemTypes.data?.find(
                    (type) => type.id === draft.workItemTypeId,
                  )?.name
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {workItemTypes.data?.map((type) => (
                <SelectItem key={type.id} value={type.id}>
                  {type.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="request-type-project">
            {t("defaultProject", { defaultValue: "Default project" })}
          </Label>
          <Select
            value={draft.defaultProjectId ?? NO_PROJECT}
            onValueChange={(value) =>
              setDraft({
                ...draft,
                defaultProjectId: value && value !== NO_PROJECT ? value : null,
              })
            }
          >
            <SelectTrigger id="request-type-project">
              <SelectValue>{projectLabel(draft.defaultProjectId)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_PROJECT}>{projectLabel(null)}</SelectItem>
              {projectMissing && draft.defaultProjectId ? (
                <SelectItem value={draft.defaultProjectId}>
                  {projectLabel(draft.defaultProjectId)}
                </SelectItem>
              ) : null}
              {projectList.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        {(
          [
            [
              ids.visible,
              "customerVisible",
              t("visible", { defaultValue: "Visible to customers" }),
              t("visibleHelp", {
                defaultValue:
                  "List this form in the customer portal catalogue.",
              }),
            ],
            [
              ids.autoAccept,
              "autoAccept",
              t("autoAccept", { defaultValue: "Auto accept" }),
              t("autoAcceptHelp", {
                defaultValue:
                  "Turn each submission into a work item in the default project without triage. Needs a default project.",
              }),
            ],
            [
              ids.private,
              "forcePrivate",
              t("forcePrivate", { defaultValue: "Keep submissions private" }),
              t("forcePrivateHelp", {
                defaultValue:
                  "Submissions stay private to the requester and are never shared with their organisation.",
              }),
            ],
          ] as const
        ).map(([id, key, label, help]) => (
          <div className="flex items-start gap-3" key={key}>
            <Checkbox
              aria-describedby={`${id}-help`}
              checked={draft[key]}
              className="mt-0.5"
              id={id}
              onCheckedChange={(checked) =>
                setDraft({ ...draft, [key]: Boolean(checked) })
              }
            />
            <div className="flex flex-col gap-0.5">
              <Label htmlFor={id}>{label}</Label>
              <p className="text-xs text-muted-foreground" id={`${id}-help`}>
                {help}
              </p>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
