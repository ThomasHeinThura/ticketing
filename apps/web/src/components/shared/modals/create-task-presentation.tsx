import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbSeparator,
  Button,
  Checkbox,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@taskdesk/ui";
import type { ComponentProps, ReactNode } from "react";

/** Pinned Kaneo create-modal composition; each controller owns its real API state. */
export const CREATE_TASK_DIALOG_CLASS =
  "taskdesk-create-task-modal max-w-2xl max-h-[90vh] flex flex-col overflow-hidden";
export const CREATE_TASK_PROPERTY_BUTTON_CLASS =
  "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors border border-border hover:bg-accent/50";
export const CREATE_TASK_PROPERTY_OPTION_CLASS =
  "w-full flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent/50 text-left transition-colors h-8";

export function CreateTaskHeader({
  projectLabel,
  title,
  description,
  breadcrumbLabel,
}: {
  projectLabel: string;
  title: string;
  description: string;
  breadcrumbLabel: string;
}) {
  return (
    <DialogHeader className="flex-shrink-0">
      <DialogTitle asChild>
        <Breadcrumb label={breadcrumbLabel}>
          <BreadcrumbList>
            <BreadcrumbItem className="text-muted-foreground font-semibold tracking-wider text-sm">
              {projectLabel}
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem className="text-foreground font-medium text-sm">
              {title}
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </DialogTitle>
      <DialogDescription className="sr-only">{description}</DialogDescription>
    </DialogHeader>
  );
}
export function CreateTaskBody({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-6 px-6">
      {children}
    </div>
  );
}
export function CreateTaskTitleInput(props: ComponentProps<typeof Input>) {
  return (
    <Input
      {...props}
      unstyled
      className="w-full [&_[data-slot=input]]:h-auto [&_[data-slot=input]]:px-0 [&_[data-slot=input]]:py-3 [&_[data-slot=input]]:text-2xl [&_[data-slot=input]]:leading-tight [&_[data-slot=input]]:font-semibold [&_[data-slot=input]]:tracking-tight [&_[data-slot=input]]:text-foreground [&_[data-slot=input]]:placeholder:text-muted-foreground [&_[data-slot=input]]:outline-none"
    />
  );
}
export function CreateTaskPropertyRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 py-2">{children}</div>
  );
}
export function CreateTaskFooter({
  createMore,
  onCreateMoreChange,
  createMoreId,
  createMoreLabel,
  cancelLabel,
  submitLabel,
  onCancel,
  disabled,
  pending = false,
  submitTestId,
}: {
  createMore: boolean;
  onCreateMoreChange: (value: boolean) => void;
  createMoreId: string;
  createMoreLabel: string;
  cancelLabel: string;
  submitLabel: string;
  onCancel: () => void;
  disabled: boolean;
  pending?: boolean;
  submitTestId?: string;
}) {
  return (
    <DialogFooter className="flex-shrink-0 border-t border-border bg-background px-6 py-4">
      <div className="flex items-center gap-3 mr-auto">
        <label
          htmlFor={createMoreId}
          className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
        >
          <Checkbox
            id={createMoreId}
            checked={createMore}
            onCheckedChange={(value) => onCreateMoreChange(Boolean(value))}
            disabled={pending}
            className="rounded border-border bg-background text-primary focus:ring-ring focus:ring-offset-0 focus:ring-2 transition-[border-color,box-shadow]"
          />
          {createMoreLabel}
        </label>
      </div>
      <Button
        type="button"
        onClick={onCancel}
        variant="outline"
        size="sm"
        className="border-border text-foreground hover:bg-accent"
        disabled={pending}
      >
        {cancelLabel}
      </Button>
      <Button
        type="submit"
        disabled={disabled}
        size="sm"
        className="disabled:opacity-50"
        aria-busy={pending || undefined}
        data-testid={submitTestId}
      >
        {submitLabel}
      </Button>
    </DialogFooter>
  );
}

export function CreateTaskDiscardDialog({
  open,
  onOpenChange,
  onDiscard,
  title,
  description,
  cancelLabel,
  discardLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDiscard: () => void;
  title: string;
  description: string;
  cancelLabel: string;
  discardLabel: string;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose
            render={<Button type="button" variant="outline" size="sm" />}
          >
            {cancelLabel}
          </AlertDialogClose>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={onDiscard}
          >
            {discardLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
