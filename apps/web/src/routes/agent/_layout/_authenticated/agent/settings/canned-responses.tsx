import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Card,
  CardAction,
  CardDescription,
  CardFrame,
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
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import CommentEditor, {
  type CommentContentSnapshot,
} from "@/components/activity/comment-editor";
import PageTitle from "@/components/page-title";
import {
  type CannedResponseInput,
  getCannedResponseLibrary,
  removeCannedResponse,
  saveCannedResponse,
} from "@/fetchers/canned-response/manage-canned-responses";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import {
  type CannedResponseSearch,
  parseCannedResponseSearch,
} from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/canned-responses",
)({
  validateSearch: parseCannedResponseSearch,
  component: CannedResponsesPage,
});
type Snippet = Awaited<ReturnType<typeof getCannedResponseLibrary>>[number];
const EMPTY_DOCUMENT = { type: "doc", content: [{ type: "paragraph" }] };

function CannedResponseEditor({
  snippet,
  pending,
  error,
  onSave,
  onClose,
}: {
  snippet?: Snippet;
  pending: boolean;
  error: unknown;
  onSave: (input: CannedResponseInput) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(snippet?.name ?? "");
  const [content, setContent] = useState<CommentContentSnapshot>({
    text: "",
    document: snippet?.body ?? EMPTY_DOCUMENT,
  });
  const [visibility, setVisibility] = useState<"public" | "internal">(
    snippet?.visibilityDefault === "public" ? "public" : "internal",
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        className="max-w-2xl"
        closeLabel={t("common:actions.close")}
      >
        <DialogHeader>
          <DialogTitle>
            {t(
              snippet
                ? "settings:cannedResponses.edit"
                : "settings:cannedResponses.create",
            )}
          </DialogTitle>
          <DialogDescription>
            {t("settings:cannedResponses.description")}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && !pending)
              onSave({
                name: name.trim(),
                body: content.document,
                visibilityDefault: visibility,
              });
          }}
          className="space-y-4"
        >
          <div className="space-y-4 px-6">
            <div className="space-y-2">
              <Label htmlFor="snippet-name">
                {t("settings:cannedResponses.name")}
              </Label>
              <Input
                id="snippet-name"
                autoFocus
                required
                maxLength={200}
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {t("settings:cannedResponses.body")}
              </p>
              <CommentEditor
                value={content.text}
                documentValue={content.document}
                onContentChange={setContent}
                disabled={pending}
                showQuickAttachButton={false}
                enableMentions={false}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="snippet-visibility">
                {t("settings:cannedResponses.visibility")}
              </Label>
              <Select
                value={visibility}
                disabled={pending}
                onValueChange={(value) => {
                  if (value === "public" || value === "internal")
                    setVisibility(value);
                }}
              >
                <SelectTrigger id="snippet-visibility">
                  <SelectValue>
                    {visibility === "public"
                      ? t("activity:timeline.public")
                      : t("activity:timeline.internal")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="internal">
                    {t("activity:timeline.internal")}
                  </SelectItem>
                  <SelectItem value="public">
                    {t("activity:timeline.public")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {error ? (
              <Alert variant="error">
                <AlertDescription>
                  {error instanceof Error
                    ? error.message
                    : t("settings:cannedResponses.failed")}
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
            <Button type="submit" disabled={pending || !name.trim()}>
              {t("settings:cannedResponses.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CannedResponsesPage() {
  const { t } = useTranslation();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const cache = useQueryClient();
  const { workspace, canManageWorkspaceSettings, isCheckingPermissions } =
    useWorkspacePermission();
  const canManage = canManageWorkspaceSettings();
  const library = useQuery({
    queryKey: ["canned-responses", "management", workspace?.id],
    enabled: Boolean(workspace?.id && canManage),
    queryFn: () => getCannedResponseLibrary(workspace?.id ?? ""),
  });
  const open = (next: CannedResponseSearch) => {
    mutation.reset();
    void navigate({ search: next });
  };
  const close = () => open({ q: search.q });
  const mutation = useMutation({
    mutationFn: async (
      input: { kind: "save"; value: CannedResponseInput } | { kind: "delete" },
    ) => {
      if (!workspace || !canManage)
        throw new Error(t("settings:cannedResponses.forbidden"));
      if (input.kind === "delete") {
        if (!search.id || search.id === "new")
          throw new Error(t("settings:cannedResponses.notFound"));
        return removeCannedResponse(search.id);
      }
      return saveCannedResponse(
        workspace.id,
        input.value,
        search.id === "new" ? undefined : search.id,
      );
    },
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ["canned-responses"] });
      close();
    },
  });
  const selected = library.data?.find((row) => row.id === search.id);
  const filtered = (library.data ?? []).filter((row) =>
    row.name.toLocaleLowerCase().includes((search.q ?? "").toLocaleLowerCase()),
  );
  const busy =
    !workspace || isCheckingPermissions || (canManage && library.isLoading);
  return (
    <>
      <PageTitle title={t("settings:cannedResponses.title")} />
      <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">
              {t("settings:cannedResponses.title")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("settings:cannedResponses.description")}
            </p>
          </div>
          {canManage && !busy ? (
            <Button
              onClick={() => open({ ...search, id: "new", action: undefined })}
            >
              <Plus aria-hidden="true" />
              {t("settings:cannedResponses.create")}
            </Button>
          ) : null}
        </div>
        {busy ? (
          <Skeleton className="h-24 w-full" />
        ) : !canManage ? (
          <Alert>
            <AlertDescription>
              {t("settings:cannedResponses.forbidden")}
            </AlertDescription>
          </Alert>
        ) : library.isError ? (
          <Alert variant="error">
            <AlertDescription>
              {t("settings:cannedResponses.loadFailed")}
            </AlertDescription>
            <Button variant="outline" onClick={() => void library.refetch()}>
              {t("common:actions.retry")}
            </Button>
          </Alert>
        ) : (
          <>
            <Input
              aria-label={t("settings:cannedResponses.search")}
              placeholder={t("settings:cannedResponses.search")}
              value={search.q ?? ""}
              onChange={(event) =>
                void navigate({
                  search: { ...search, q: event.target.value || undefined },
                  replace: true,
                })
              }
            />
            {filtered.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{t("settings:cannedResponses.empty")}</EmptyTitle>
                  <EmptyDescription>
                    {t("settings:cannedResponses.emptyDescription")}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <CardFrame>
                {filtered.map((row) => (
                  <Card key={row.id}>
                    <CardHeader>
                      <CardTitle>{row.name}</CardTitle>
                      <CardDescription>
                        {row.visibilityDefault === "public"
                          ? t("activity:timeline.public")
                          : t("activity:timeline.internal")}
                      </CardDescription>
                      <CardAction>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("settings:cannedResponses.editNamed", {
                            name: row.name,
                          })}
                          onClick={() =>
                            open({ ...search, id: row.id, action: undefined })
                          }
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t(
                            "settings:cannedResponses.deleteNamed",
                            { name: row.name },
                          )}
                          onClick={() =>
                            open({ ...search, id: row.id, action: "delete" })
                          }
                        >
                          <Trash2 />
                        </Button>
                      </CardAction>
                    </CardHeader>
                  </Card>
                ))}
              </CardFrame>
            )}
            {search.id && search.id !== "new" && !selected ? (
              <Alert>
                <AlertDescription>
                  {t("settings:cannedResponses.notFound")}
                </AlertDescription>
                <Button variant="outline" onClick={close}>
                  {t("common:actions.close")}
                </Button>
              </Alert>
            ) : null}
            {search.id &&
            search.action !== "delete" &&
            (search.id === "new" || selected) ? (
              <CannedResponseEditor
                key={`${workspace?.id}:${search.id}`}
                snippet={selected}
                pending={mutation.isPending}
                error={mutation.error}
                onSave={(value) => mutation.mutate({ kind: "save", value })}
                onClose={close}
              />
            ) : null}
            {selected && search.action === "delete" ? (
              <AlertDialog
                open
                onOpenChange={(opened) => {
                  if (!opened && !mutation.isPending) close();
                }}
              >
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("settings:cannedResponses.deleteNamed", {
                        name: selected.name,
                      })}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("settings:cannedResponses.deleteDescription")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  {mutation.error ? (
                    <Alert variant="error">
                      <AlertDescription>
                        {mutation.error.message}
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  <AlertDialogFooter>
                    <Button
                      variant="outline"
                      disabled={mutation.isPending}
                      onClick={close}
                    >
                      {t("common:actions.cancel")}
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={mutation.isPending}
                      onClick={() => mutation.mutate({ kind: "delete" })}
                    >
                      {t("common:actions.delete")}
                    </Button>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
