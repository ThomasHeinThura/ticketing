import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import type { WorkflowValidation } from "@/fetchers/workflow";
import { routes } from "@/lib/routes";
import type { NamedOption } from "./workflow-add-transition-dialog";

/** Every stranded key across the adopting projects, once each, in a stable order. */
export function stuckWorkItemKeys(report: WorkflowValidation): string[] {
  return [
    ...new Set(report.projects.flatMap((project) => project.stuckWorkItemKeys)),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

const DEFAULT_MISSING = "no default state selected";
const DEFAULT_NOT_ENABLED =
  /^default state (\S+) is not one of the project's enabled states$/;
const NO_OUTBOUND = /^state (\S+) has no outbound transition in this workflow$/;

/**
 * One adopting project's problems as sentences. The API's English strings embed state ids;
 * the known ones become translated sentences naming the state, and any other string has its
 * ids replaced by state names, so no raw id reaches the screen.
 */
export function projectProblemMessages(
  errors: string[],
  states: NamedOption[],
  t: (key: string, options?: Record<string, unknown>) => string,
): string[] {
  const nameOf = (id: string) =>
    states.find((state) => state.id === id)?.name ??
    t("settings:workflows.validation.unknownState");
  return errors.map((error) => {
    if (error === DEFAULT_MISSING)
      return t("settings:workflows.validation.noDefaultState");
    const notEnabled = DEFAULT_NOT_ENABLED.exec(error);
    if (notEnabled)
      return t("settings:workflows.validation.defaultNotEnabled", {
        state: nameOf(notEnabled[1]),
      });
    const noOutbound = NO_OUTBOUND.exec(error);
    if (noOutbound)
      return t("settings:workflows.validation.stateNoOutbound", {
        state: nameOf(noOutbound[1]),
      });
    return states.reduce(
      (text, state) => text.split(state.id).join(state.name),
      error,
    );
  });
}

function Problems({
  title,
  ids,
  states,
}: {
  title: string;
  ids: string[];
  states: NamedOption[];
}) {
  if (ids.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="font-medium text-sm">{title}</p>
      <div className="flex flex-wrap gap-1">
        {ids.map((id) => (
          <Badge key={id} variant="outline">
            {states.find((state) => state.id === id)?.name ?? id}
          </Badge>
        ))}
      </div>
    </div>
  );
}

/**
 * `WF-9`: the validation report for a draft, including the work items a publish would
 * strand, each linking to the item. Publishing from here is allowed even when the report
 * lists problems, but the button says so: in-flight items are never migrated.
 */
export function WorkflowValidationDialog({
  open,
  onOpenChange,
  versionNumber,
  report,
  states,
  roles,
  projects,
  canPublish,
  publishing,
  onPublish,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versionNumber: number;
  report: WorkflowValidation | undefined;
  states: NamedOption[];
  roles: NamedOption[];
  /** The workspace's projects, to show a name rather than the project's id. */
  projects: NamedOption[];
  canPublish: boolean;
  publishing: boolean;
  onPublish: () => void;
}) {
  const { t } = useTranslation();
  const stuck = report ? stuckWorkItemKeys(report) : [];
  const projectName = (projectId: string) =>
    projects.find((project) => project.id === projectId)?.name ??
    t("settings:workflows.validation.unknownProject");
  const problemProjects = report
    ? report.projects.filter((project) => project.errors.length > 0)
    : [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t("common:actions.close")}
        className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>
            {t("settings:workflows.validation.title", {
              number: versionNumber,
            })}
          </DialogTitle>
          <DialogDescription>
            {t("settings:workflows.validation.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6" data-testid="workflow-validation">
          {report?.valid ? (
            <Alert variant="success">
              <AlertTitle>
                {t("settings:workflows.validation.valid")}
              </AlertTitle>
            </Alert>
          ) : report ? (
            <Alert variant="warning">
              <AlertTitle>
                {t("settings:workflows.validation.invalid")}
              </AlertTitle>
              <AlertDescription>
                {t("settings:workflows.validation.publishNote")}
              </AlertDescription>
            </Alert>
          ) : null}
          {report ? (
            <>
              <Problems
                title={t("settings:workflows.validation.unreachable")}
                ids={report.unreachableStateTemplateIds}
                states={states}
              />
              <Problems
                title={t("settings:workflows.validation.noOutbound")}
                ids={report.noOutboundStateTemplateIds}
                states={states}
              />
              <Problems
                title={t("settings:workflows.validation.roles")}
                ids={report.rolesWithNoLegalTransition}
                states={roles}
              />
              {problemProjects.map((project) => (
                <div key={project.projectId} className="space-y-1">
                  <p className="font-medium text-sm">
                    {projectName(project.projectId)}
                  </p>
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {projectProblemMessages(project.errors, states, t).map(
                      (message) => (
                        <li key={message}>{message}</li>
                      ),
                    )}
                  </ul>
                </div>
              ))}
              {stuck.length > 0 ? (
                <div className="space-y-2">
                  <p className="font-medium text-sm">
                    {t("settings:workflows.validation.stuckTitle", {
                      count: stuck.length,
                    })}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {t("settings:workflows.validation.stuckDescription")}
                  </p>
                  <Table
                    aria-label={t("settings:workflows.validation.stuckTitle", {
                      count: stuck.length,
                    })}
                  >
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          {t("settings:workflows.validation.workItem")}
                        </TableHead>
                        <TableHead>
                          {t("settings:workflows.validation.project")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.projects.flatMap((project) =>
                        project.stuckWorkItemKeys.map((key) => (
                          <TableRow key={`${project.projectId}:${key}`}>
                            <TableCell>
                              <Button
                                variant="link"
                                size="sm"
                                className="h-auto p-0 font-mono"
                                render={
                                  <Link
                                    to={routes.workItemDetail.path}
                                    params={{ key }}
                                  />
                                }
                              >
                                {key}
                              </Button>
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {projectName(project.projectId)}
                            </TableCell>
                          </TableRow>
                        )),
                      )}
                    </TableBody>
                  </Table>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common:actions.close")}
          </Button>
          {canPublish ? (
            <Button
              variant={report?.valid ? "default" : "destructive"}
              disabled={!report || publishing}
              onClick={onPublish}
            >
              {report?.valid
                ? t("settings:workflows.validation.publish", {
                    number: versionNumber,
                  })
                : t("settings:workflows.validation.publishAnyway", {
                    number: versionNumber,
                  })}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
