import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from "@taskdesk/ui";
import type { DocumentAutosave } from "@/hooks/use-document-autosave";

/** Shown when leaving a document whose edits could not be saved (conflict, failure, blank title). */
export function LeaveUnsavedDialog({
  leave,
  labels,
}: {
  leave: DocumentAutosave["leave"];
  labels: { title: string; description: string; stay: string; leave: string };
}) {
  return (
    <AlertDialog
      open={leave.blocked}
      onOpenChange={(open) => {
        if (!open) leave.stay();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{labels.title}</AlertDialogTitle>
          <AlertDialogDescription>{labels.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={leave.stay}>
            {labels.stay}
          </Button>
          <Button variant="destructive" onClick={leave.proceed}>
            {labels.leave}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
