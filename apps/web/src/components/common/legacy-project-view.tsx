import { useLocation, useNavigate } from "@tanstack/react-router";
import { Alert, AlertDescription, AlertTitle, Button } from "@taskdesk/ui";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import useGetProject from "@/hooks/queries/project/use-get-project";
import useGetTask from "@/hooks/queries/task/use-get-task";
import {
  isAuthorizedLegacyProject,
  legacyTaskHref,
  translateLegacyProjectView,
} from "@/lib/legacy-project-view";
import Layout from "./layout";

export default function LegacyProjectView({
  projectId,
  workspaceId,
  view,
}: {
  projectId: string;
  workspaceId: string;
  view: "board" | "backlog";
}) {
  const { t } = useTranslation(["workItems"]);
  const location = useLocation();
  const navigate = useNavigate();
  const project = useGetProject({ id: projectId, workspaceId });
  const authorized =
    project.isSuccess &&
    isAuthorizedLegacyProject(project.data, projectId, workspaceId);
  const translated = translateLegacyProjectView(
    location.search,
    authorized ? project.data.slug : "",
    view,
  );
  const task = useGetTask(
    translated.legacyTaskId ?? "",
    undefined,
    authorized && Boolean(translated.legacyTaskId),
  );
  const taskHref =
    authorized && task.isSuccess && translated.legacyTaskId
      ? legacyTaskHref(
          workspaceId,
          projectId,
          translated.legacyTaskId,
          task.data.projectId,
        )
      : undefined;
  const href = authorized
    ? translated.legacyTaskId
      ? taskHref
      : translated.href
    : undefined;
  useEffect(() => {
    if (
      href &&
      (translated.legacyTaskId || translated.unsupported.length === 0)
    )
      void navigate({ href, replace: true });
  }, [href, navigate, translated.legacyTaskId, translated.unsupported.length]);
  const unavailable =
    project.isError ||
    (project.isSuccess && !authorized) ||
    (authorized &&
      translated.legacyTaskId &&
      (task.isError || (task.isSuccess && !taskHref)));
  if (unavailable)
    return (
      <Layout.Content>
        <Alert>
          <AlertDescription>
            {t("workItems:legacyView.unavailable")}
          </AlertDescription>
        </Alert>
      </Layout.Content>
    );
  if (!href || translated.legacyTaskId || translated.unsupported.length === 0)
    return (
      <Layout.Content>
        <p>{t("workItems:legacyView.opening")}</p>
      </Layout.Content>
    );
  return (
    <Layout.Content>
      <Alert>
        <AlertTitle>{t("workItems:legacyView.unsupportedTitle")}</AlertTitle>
        <AlertDescription>
          {t("workItems:legacyView.unsupportedDescription", {
            controls: translated.unsupported
              .map((control) => t(`workItems:legacyView.controls.${control}`))
              .join(", "),
          })}
        </AlertDescription>
        <Button onClick={() => void navigate({ href, replace: true })}>
          {t("workItems:legacyView.continue")}
        </Button>
      </Alert>
    </Layout.Content>
  );
}
