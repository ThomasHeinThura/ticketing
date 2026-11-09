import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "@taskdesk/ui";
import {
  ArrowDown,
  ArrowUp,
  EllipsisIcon,
  EyeOffIcon,
  PencilIcon,
} from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { formatDateMedium } from "@/lib/format";
import { groupRequestTypes, type RequestType } from "./request-type-model";
import type { useRequestTypeGroupOrder } from "./use-request-type-group-order";

type GroupOrderState = ReturnType<typeof useRequestTypeGroupOrder>;

/**
 * Request types grouped by catalogue group, in catalogue order. Each group header carries the
 * group-order moves (only the possible ones); Save/Cancel shows only while the order changed.
 */
export function RequestTypeList({
  types,
  groupOrder,
  onReloadGroupOrder,
  onOpen,
  onUnpublish,
  unpublishPending,
}: {
  types: RequestType[];
  groupOrder: GroupOrderState;
  onReloadGroupOrder: () => void;
  onOpen: (id: string) => void;
  onUnpublish: (id: string) => void;
  unpublishPending: boolean;
}) {
  const { t } = useTranslation("requestTypes");
  const sections = groupRequestTypes(types, groupOrder.draft);
  const orderedCount = groupOrder.draft.length;
  const saving = groupOrder.save.isPending;

  if (sections.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t("emptyTitle")}</EmptyTitle>
          <EmptyDescription>{t("emptyDescription")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {groupOrder.changed ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-sidebar px-4 py-3">
          <p className="text-sm text-muted-foreground">
            {t("groupOrderDescription", {
              defaultValue:
                "Move groups independently from request type order.",
            })}
          </p>
          <div className="flex gap-2">
            <Button
              disabled={saving}
              onClick={groupOrder.cancel}
              size="sm"
              type="button"
              variant="outline"
            >
              {t("common:actions.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              disabled={saving}
              onClick={() => groupOrder.save.mutate()}
              size="sm"
              type="button"
            >
              {saving
                ? t("savingGroupOrder", {
                    defaultValue: "Saving group order…",
                  })
                : t("saveGroupOrder", { defaultValue: "Save group order" })}
            </Button>
          </div>
        </div>
      ) : null}
      {groupOrder.save.isError ? (
        <Alert variant="error" role="alert">
          <AlertDescription>
            {t("groupOrderSaveFailed", {
              defaultValue:
                "Group order could not be saved. Reload the groups and try again.",
            })}
          </AlertDescription>
          <Button onClick={onReloadGroupOrder} type="button" variant="outline">
            {t("groupOrderReload", { defaultValue: "Reload groups" })}
          </Button>
        </Alert>
      ) : null}
      {groupOrder.save.isSuccess ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("groupOrderSaved", { defaultValue: "Group order saved." })}
        </p>
      ) : null}
      {sections.map((section, index) => (
        <RequestTypeGroup
          key={section.group}
          group={section.group}
          types={section.types}
          canMoveUp={section.ordered && index > 0 && !saving}
          canMoveDown={section.ordered && index < orderedCount - 1 && !saving}
          onMove={(delta) => groupOrder.move(index, delta)}
          onOpen={onOpen}
          onUnpublish={onUnpublish}
          unpublishPending={unpublishPending}
        />
      ))}
    </div>
  );
}

function RequestTypeGroup({
  group,
  types,
  canMoveUp,
  canMoveDown,
  onMove,
  onOpen,
  onUnpublish,
  unpublishPending,
}: {
  group: string;
  types: RequestType[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (delta: -1 | 1) => void;
  onOpen: (id: string) => void;
  onUnpublish: (id: string) => void;
  unpublishPending: boolean;
}) {
  const { t } = useTranslation("requestTypes");
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-md border border-border bg-sidebar"
    >
      <header className="flex min-h-11 items-center justify-between gap-2 border-b border-border px-4 py-2">
        <h2 className="min-w-0 truncate text-sm font-medium" id={headingId}>
          {group}
        </h2>
        <span className="flex shrink-0 gap-1">
          {canMoveUp ? (
            <Button
              aria-label={t("moveGroupUp", {
                group,
                defaultValue: `Move ${group} up`,
              })}
              onClick={() => onMove(-1)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <ArrowUp aria-hidden="true" className="size-4" />
            </Button>
          ) : null}
          {canMoveDown ? (
            <Button
              aria-label={t("moveGroupDown", {
                group,
                defaultValue: `Move ${group} down`,
              })}
              onClick={() => onMove(1)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <ArrowDown aria-hidden="true" className="size-4" />
            </Button>
          ) : null}
        </span>
      </header>
      {types.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          {t("groupEmpty", { defaultValue: "No request types in this group." })}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {types.map((type) => (
            <RequestTypeRow
              key={type.id}
              type={type}
              onOpen={onOpen}
              onUnpublish={onUnpublish}
              unpublishPending={unpublishPending}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function RequestTypeRow({
  type,
  onOpen,
  onUnpublish,
  unpublishPending,
}: {
  type: RequestType;
  onOpen: (id: string) => void;
  onUnpublish: (id: string) => void;
  unpublishPending: boolean;
}) {
  const { t } = useTranslation("requestTypes");
  const fieldCount = type.formSchema?.fields?.length ?? 0;
  return (
    <li className="flex items-start gap-2 px-2 py-2 sm:items-center">
      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <Button
          className="h-auto min-w-0 justify-start px-2 py-1 text-left font-medium"
          onClick={() => onOpen(type.id)}
          type="button"
          variant="ghost"
        >
          <span className="truncate">{type.name}</span>
        </Button>
        <div className="flex min-w-0 flex-wrap items-center gap-2 px-2 sm:ml-auto sm:px-0">
          {type.published ? (
            <Badge variant="success">
              {t("publishedVersion", {
                version: type.version,
                defaultValue: "Published v{{version}}",
              })}
            </Badge>
          ) : (
            <Badge variant="outline">
              {t("draft", { defaultValue: "Draft" })}
            </Badge>
          )}
          {type.customerVisible ? (
            <Badge variant="info">
              {t("visible", { defaultValue: "Visible to customers" })}
            </Badge>
          ) : null}
          <span className="text-xs text-muted-foreground">
            {t("fieldCount", {
              count: fieldCount,
              defaultValue: "{{count}} fields",
            })}
          </span>
          {type.updatedAt ? (
            <span className="text-xs text-muted-foreground">
              {t("updated", {
                date: formatDateMedium(type.updatedAt),
                defaultValue: "Updated {{date}}",
              })}
            </span>
          ) : null}
        </div>
      </div>
      <Menu>
        <MenuTrigger
          render={
            <Button
              aria-label={t("rowActions", {
                name: type.name,
                defaultValue: "Actions for {{name}}",
              })}
              className="shrink-0 text-muted-foreground"
              size="icon-sm"
              type="button"
              variant="ghost"
            />
          }
        >
          <EllipsisIcon aria-hidden="true" className="size-4" />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem onClick={() => onOpen(type.id)}>
            <PencilIcon aria-hidden="true" className="size-4" />
            {t("editAction", { defaultValue: "Edit" })}
          </MenuItem>
          {type.published ? (
            <MenuItem
              disabled={unpublishPending}
              onClick={() => onUnpublish(type.id)}
            >
              <EyeOffIcon aria-hidden="true" className="size-4" />
              {t("unpublish", { defaultValue: "Unpublish" })}
            </MenuItem>
          ) : null}
        </MenuPopup>
      </Menu>
    </li>
  );
}
