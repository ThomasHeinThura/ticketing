import type { ReactNode } from "react";
import { ProjectIdFeatureOff } from "@/components/agile/feature-off";
import ProjectLayout from "@/components/common/project-layout";
import { useProjectFeatureState } from "@/hooks/queries/feature-flag/use-project-pages-feature";

/**
 * P4R1-M2: the Kaneo Calendar and Gantt views exist only while `feature.calendar` /
 * `feature.timeline` resolves on for the project (features.md). A link to a switched-off view
 * keeps the project shell and shows the standard feature-off state; nothing is deleted.
 */
export default function ProjectViewFeatureGate({
  projectId,
  workspaceId,
  view,
  children,
}: {
  projectId: string;
  workspaceId: string;
  view: "calendar" | "gantt";
  children: ReactNode;
}) {
  const feature = view === "calendar" ? "feature.calendar" : "feature.timeline";
  const enabled = useProjectFeatureState(projectId, feature);
  if (enabled === true) return children;
  return (
    <ProjectLayout
      realtimeMode="canonical"
      projectId={projectId}
      workspaceId={workspaceId}
      activeView={view}
    >
      {enabled === false ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <ProjectIdFeatureOff
            feature={view === "calendar" ? "calendar" : "timeline"}
            headingLevel={1}
            projectId={projectId}
            workspaceId={workspaceId}
          />
        </div>
      ) : null}
    </ProjectLayout>
  );
}
