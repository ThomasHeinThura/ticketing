import { Button } from "@taskdesk/ui";
import { Repeat2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import useAgileFeatures from "@/hooks/queries/agile/use-agile-features";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { BulkAgileDialog } from "./bulk-agile-dialog";

/**
 * The toolbar entry for bulk add to a cycle or module. Rendered only when at least one of the
 * features resolves on for the project and the caller may update work items (the caller passes
 * `canUpdate`), so a support queue never sees it.
 */
export function BulkAgileActions({
  projectId,
  workspaceId,
  canUpdate,
  selectedKeys,
  busy,
  onDone,
}: {
  projectId: string;
  workspaceId: string;
  canUpdate: boolean;
  selectedKeys: string[];
  busy?: boolean;
  onDone?: (added: string[]) => void;
}) {
  const { t } = useTranslation("agile");
  const [open, setOpen] = useState(false);
  const { features } = useAgileFeatures(canUpdate ? projectId : undefined);
  const { data: projects } = useGetProjects({ workspaceId });
  const project = projects?.find((candidate) => candidate.id === projectId);
  if (!canUpdate || !project || (!features.cycles && !features.modules))
    return null;
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => setOpen(true)}
      >
        <Repeat2 className="size-4" aria-hidden="true" />
        {t("bulk.action")}
      </Button>
      {open ? (
        <BulkAgileDialog
          projectKey={project.slug}
          features={features}
          selectedKeys={selectedKeys}
          onClose={() => setOpen(false)}
          onDone={onDone}
        />
      ) : null}
    </>
  );
}
