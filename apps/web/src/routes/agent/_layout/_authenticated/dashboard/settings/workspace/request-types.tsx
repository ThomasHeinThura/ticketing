import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Alert, AlertDescription, Button } from "@taskdesk/ui";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { RequestTypeEditorSheet } from "@/components/settings/request-types/request-type-editor";
import { RequestTypeList } from "@/components/settings/request-types/request-type-list";
import type { RequestType } from "@/components/settings/request-types/request-type-model";
import { useRequestTypeGroupOrder } from "@/components/settings/request-types/use-request-type-group-order";
import { getRequestTypes, unpublishRequestType } from "@/fetchers/intake";
import { getRequestTypeGroupOrder } from "@/fetchers/intake-group-order";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { parseRequestTypeEditorSearch } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/request-types",
)({
  validateSearch: parseRequestTypeEditorSearch,
  component: RequestTypesPage,
});

/**
 * Request types list (grouped by catalogue group) with the editor in a Sheet. `?requestTypeId=`
 * opens an existing type, so deep links keep working; "New" opens a blank editor locally.
 */
function RequestTypesPage() {
  const { t } = useTranslation("requestTypes");
  const workspace = useActiveWorkspace();
  const workspaceId = workspace.data?.id;
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: Route.fullPath });
  const selected = Route.useSearch().requestTypeId ?? null;
  const [creating, setCreating] = useState(false);
  const setSelected = (id: string | null) =>
    void navigate({ search: { requestTypeId: id ?? undefined } });
  const types = useQuery({
    queryKey: ["request-types", workspaceId],
    queryFn: () => getRequestTypes(workspaceId ?? ""),
    enabled: Boolean(workspaceId),
  });
  const groupOrderQuery = useQuery({
    queryKey: ["request-type-group-order", workspaceId],
    queryFn: () => getRequestTypeGroupOrder(workspaceId ?? ""),
    enabled: Boolean(workspaceId),
  });
  const groupOrder = useRequestTypeGroupOrder(
    workspaceId,
    groupOrderQuery.data,
  );
  const unpublish = useMutation({
    mutationFn: (id: string) => unpublishRequestType(id),
    onSuccess: async (_, id) => {
      await queryClient.invalidateQueries({ queryKey: ["request-types"] });
      await queryClient.invalidateQueries({ queryKey: ["request-type", id] });
    },
  });
  const list =
    (types.data as unknown as { requestTypes: RequestType[] } | undefined)
      ?.requestTypes ?? [];
  const loading = types.isLoading || groupOrderQuery.isLoading;
  const loadFailed = types.isError || groupOrderQuery.isError;
  const editorOpen = creating || selected !== null;
  const openNew = () => {
    if (selected) setSelected(null);
    setCreating(true);
  };
  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <PageTitle title={t("title")} />
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Button onClick={openNew}>
          <PlusIcon aria-hidden="true" className="size-4" />
          {t("new")}
        </Button>
      </header>
      {loadFailed || unpublish.isError ? (
        <Alert variant="error">
          <AlertDescription>{t("loadError")}</AlertDescription>
          {loadFailed ? (
            <Button
              variant="outline"
              onClick={() => {
                if (types.isError) void types.refetch();
                if (groupOrderQuery.isError) void groupOrderQuery.refetch();
              }}
            >
              {t("common:actions.retry", { defaultValue: "Retry" })}
            </Button>
          ) : null}
        </Alert>
      ) : null}
      {loading ? (
        <p role="status">{t("loading")}</p>
      ) : (
        <RequestTypeList
          types={list}
          groupOrder={groupOrder}
          onReloadGroupOrder={() => void groupOrderQuery.refetch()}
          onOpen={(id) => {
            setCreating(false);
            setSelected(id);
          }}
          onUnpublish={(id) => unpublish.mutate(id)}
          unpublishPending={unpublish.isPending}
        />
      )}
      {workspaceId ? (
        <RequestTypeEditorSheet
          open={editorOpen}
          requestTypeId={creating ? null : selected}
          workspaceId={workspaceId}
          types={list}
          onClose={() => {
            setCreating(false);
            if (selected) setSelected(null);
          }}
          onSaved={(id) => {
            setCreating(false);
            setSelected(id);
          }}
        />
      ) : null}
    </div>
  );
}
