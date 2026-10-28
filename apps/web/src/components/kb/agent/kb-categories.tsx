import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createKbCategory,
  type KbCategory,
  requestKbCategoryDeletion,
  updateKbCategory,
} from "@/fetchers/kb";
import { kbKeys, useKbCategories } from "@/hooks/queries/kb";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { toast } from "@/lib/toast";

const ROOT = "root";

/** Categories in tree order with their depth (parents before children, siblings by position). */
export function flattenCategories(categories: KbCategory[]) {
  const children = new Map<string | null, KbCategory[]>();
  for (const category of categories) {
    const list = children.get(category.parentId) ?? [];
    list.push(category);
    children.set(category.parentId, list);
  }
  const out: { category: KbCategory; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const category of children.get(parent) ?? []) {
      if (seen.has(category.id)) continue;
      seen.add(category.id);
      out.push({ category, depth });
      walk(category.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function RenameDialog({
  category,
  workspaceId,
  onClose,
}: {
  category: KbCategory;
  workspaceId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState(category.name);
  const mutation = useMutation({
    mutationFn: () => updateKbCategory(category.id, { name: name.trim() }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: kbKeys.all(workspaceId),
      });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent closeLabel={t("common:actions.close")}>
        <DialogHeader>
          <DialogTitle>{t("kb:categories.renameTitle")}</DialogTitle>
          <DialogDescription>
            {t("kb:categories.renameDescription")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && !mutation.isPending) mutation.mutate();
          }}
        >
          <div className="space-y-2 px-6">
            <Label htmlFor="kb-category-rename">{t("kb:fields.name")}</Label>
            <Input
              id="kb-category-rename"
              autoFocus
              required
              maxLength={120}
              value={name}
              disabled={mutation.isPending}
              onChange={(event) => setName(event.target.value)}
            />
            {mutation.error ? (
              <Alert variant="error">
                <AlertDescription>{mutation.error.message}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={onClose}>
              {t("common:actions.cancel")}
            </Button>
            <Button type="submit" disabled={mutation.isPending || !name.trim()}>
              {t("common:actions.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** KB-14: the category tree. Deleting one that still holds articles is refused by the server. */
export function KbCategories({
  workspaceId,
  canManage,
  onOpenCategory,
}: {
  workspaceId: string;
  canManage: boolean;
  onOpenCategory: (categoryId: string) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const openPendingAction = useOpenPendingAction();
  const categories = useKbCategories(workspaceId);
  const [name, setName] = useState("");
  const [parent, setParent] = useState(ROOT);
  const [renaming, setRenaming] = useState<KbCategory | null>(null);
  const create = useMutation({
    mutationFn: () =>
      createKbCategory(workspaceId, {
        name: name.trim(),
        parentId: parent === ROOT ? null : parent,
      }),
    onSuccess: async () => {
      setName("");
      await queryClient.invalidateQueries({
        queryKey: kbKeys.all(workspaceId),
      });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => requestKbCategoryDeletion(id),
    onSuccess: (pending) => openPendingAction(pending),
    onError: (error) => toast.error(error.message),
  });
  const rows = flattenCategories(categories.data?.categories ?? []);
  return (
    <div className="flex flex-col gap-4">
      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("kb:categories.addTitle")}</CardTitle>
            <CardDescription>
              {t("kb:categories.addDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (name.trim() && !create.isPending) create.mutate();
              }}
            >
              <div className="min-w-56 flex-1 space-y-1">
                <Label htmlFor="kb-category-name">{t("kb:fields.name")}</Label>
                <Input
                  id="kb-category-name"
                  required
                  maxLength={120}
                  value={name}
                  disabled={create.isPending}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="kb-category-parent">
                  {t("kb:categories.parent")}
                </Label>
                <Select
                  value={parent}
                  onValueChange={(value) => setParent(value ?? ROOT)}
                >
                  <SelectTrigger id="kb-category-parent" className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ROOT}>
                      {t("kb:categories.topLevel")}
                    </SelectItem>
                    {rows.map(({ category }) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={create.isPending || !name.trim()}>
                {t("kb:categories.add")}
              </Button>
            </form>
            {create.error ? (
              <Alert className="mt-3" variant="error">
                <AlertDescription>{create.error.message}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      {categories.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : categories.isError ? (
        <Alert variant="error">
          <AlertDescription>{t("kb:categories.loadError")}</AlertDescription>
        </Alert>
      ) : rows.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("kb:categories.emptyTitle")}</EmptyTitle>
            <EmptyDescription>
              {t("kb:categories.emptyDescription")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {rows.map(({ category, depth }) => (
            <li
              key={category.id}
              className="flex items-center gap-3 px-4 py-2"
              style={{ paddingInlineStart: `${16 + depth * 20}px` }}
            >
              <Button
                variant="link"
                className="h-auto p-0"
                onClick={() => onOpenCategory(category.id)}
              >
                {category.name}
              </Button>
              <Badge variant="outline">
                {t("kb:categories.articles", { count: category.articleCount })}
              </Badge>
              {canManage ? (
                <div className="ms-auto flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRenaming(category)}
                  >
                    {t("kb:categories.rename")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(category.id)}
                  >
                    {t("common:actions.delete")}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {renaming ? (
        <RenameDialog
          category={renaming}
          workspaceId={workspaceId}
          onClose={() => setRenaming(null)}
        />
      ) : null}
    </div>
  );
}
