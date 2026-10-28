import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Skeleton,
} from "@taskdesk/ui";
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import useGetReparentPreview from "@/hooks/queries/project-member/use-get-reparent-preview";

type Props = {
  projectId: string;
  /** `undefined` keeps the dialog closed; `null` previews moving to the top level. */
  parentId: string | null | undefined;
  parentName: string | null;
  isMoving: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

type PersonLine = { personId: string; displayName: string | null };

function PersonList({
  title,
  people,
  testId,
}: {
  title: string;
  people: Array<PersonLine & { detail?: string }>;
  testId: string;
}) {
  if (people.length === 0) return null;
  return (
    <div className="space-y-1" data-testid={testId}>
      <p className="text-xs font-medium">{title}</p>
      <ul className="space-y-0.5 text-xs text-muted-foreground">
        {people.map((person) => (
          <li
            key={person.personId}
            className="flex flex-wrap items-center gap-2"
          >
            <span className="text-foreground">
              {person.displayName ?? person.personId}
            </span>
            {person.detail ? (
              <Badge variant="outline" size="sm">
                {person.detail}
              </Badge>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Confirmation before a re-parent (edge-case table: "a preview shows who gains and loses
 * access"). The API computes the preview from the same ancestor reach rules the roster uses;
 * nothing is written until the person confirms, and the move itself is still decided by the
 * ownership route.
 */
function ReparentPreviewDialog({
  projectId,
  parentId,
  parentName,
  isMoving,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const open = parentId !== undefined;
  const preview = useGetReparentPreview(projectId, parentId);
  const data = preview.data;
  const nothingChanges =
    data !== undefined &&
    data.gains.length === 0 &&
    data.losses.length === 0 &&
    data.roleChanges.length === 0;

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("settings:projectMembers.reparent.title")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {parentName
              ? t("settings:projectMembers.reparent.descriptionParent", {
                  parent: parentName,
                })
              : t("settings:projectMembers.reparent.descriptionRoot")}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3" data-testid="reparent-preview">
          {preview.isLoading ? (
            <div aria-busy="true" className="space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-40" />
            </div>
          ) : null}
          {preview.isError ? (
            <Alert variant="error" role="alert">
              <AlertDescription>
                {preview.error instanceof Error && preview.error.message
                  ? preview.error.message
                  : t("settings:projectMembers.reparent.loadError")}
              </AlertDescription>
            </Alert>
          ) : null}
          {data?.refusal ? (
            <Alert variant="warning" data-testid="reparent-preview-refused">
              <TriangleAlert />
              <AlertDescription>
                {t("settings:projectMembers.reparent.refused")}
              </AlertDescription>
            </Alert>
          ) : null}
          {data && !data.refusal ? (
            <>
              <PersonList
                testId="reparent-gains"
                title={t("settings:projectMembers.reparent.gains")}
                people={data.gains.map((person) => ({
                  ...person,
                  detail: t("settings:projectMembers.reparent.via", {
                    role: person.roleName,
                    project: person.via.projectName,
                  }),
                }))}
              />
              <PersonList
                testId="reparent-losses"
                title={t("settings:projectMembers.reparent.losses")}
                people={data.losses.map((person) => ({
                  ...person,
                  detail: t("settings:projectMembers.reparent.via", {
                    role: person.roleName,
                    project: person.via.projectName,
                  }),
                }))}
              />
              <PersonList
                testId="reparent-role-changes"
                title={t("settings:projectMembers.reparent.roleChanges")}
                people={data.roleChanges.map((person) => ({
                  ...person,
                  detail: t("settings:projectMembers.reparent.roleChange", {
                    from: person.from.roleName,
                    to: person.to.roleName,
                  }),
                }))}
              />
              {nothingChanges ? (
                <p className="text-xs text-muted-foreground">
                  {t("settings:projectMembers.reparent.noChange")}
                </p>
              ) : null}
              {data.descendantProjectCount > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("settings:projectMembers.reparent.descendants", {
                    count: data.descendantProjectCount,
                  })}
                </p>
              ) : null}
            </>
          ) : null}
        </div>

        <AlertDialogFooter>
          <AlertDialogClose
            render={<Button variant="outline" size="sm" disabled={isMoving} />}
          >
            {t("common:actions.cancel")}
          </AlertDialogClose>
          <Button
            size="sm"
            disabled={
              isMoving ||
              preview.isLoading ||
              preview.isError ||
              !!data?.refusal
            }
            onClick={onConfirm}
          >
            {t("settings:projectMembers.reparent.confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default ReparentPreviewDialog;
