import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbSeparator,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@taskdesk/ui";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { WorkspaceOwnerPicker } from "@/components/workspace/workspace-owner-picker";
import activateWorkspace from "@/fetchers/workspace/activate-workspace";
import useCreateWorkspace from "@/hooks/queries/workspace/use-create-workspace";
import { authClient } from "@/lib/auth-client";
import { toast } from "@/lib/toast";

type CreateWorkspaceModalProps = {
  open: boolean;
  onClose: () => void;
};

function CreateWorkspaceModal({ open, onClose }: CreateWorkspaceModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
  const { data: session } = authClient.useSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { mutateAsync, isPending } = useCreateWorkspace();

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [open]);

  const handleClose = () => {
    setName("");
    setDescription("");
    setOwnerUserId(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !ownerUserId) return;

    try {
      const createdWorkspace = await mutateAsync({
        name,
        description,
        ownerUserId,
      });
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });

      // Only an instance administrator creates a workspace (owner decision D-A, 12 Nov 2026)
      // and is a member only if they named themselves. Handed to someone else, the workspace
      // is not theirs to open, so stay where they are.
      if (ownerUserId !== session?.user?.id) {
        toast.success(t("workspace:create.successHandedOver"));
        handleClose();
        return;
      }
      toast.success(t("common:modals.createWorkspace.successToast"));

      // S8a: native replacement for authClient.organization.setActive().
      await activateWorkspace(createdWorkspace.id);

      navigate({ to: "/agent" });

      handleClose();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("common:modals.createWorkspace.errorToast"),
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle asChild>
            <Breadcrumb label={t("common:breadcrumb.label")}>
              <BreadcrumbList>
                <BreadcrumbItem className="text-muted-foreground font-semibold tracking-wider text-sm">
                  {t("common:modals.createWorkspace.breadcrumbTaskDesk")}
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem className="text-foreground font-medium text-sm">
                  {t("common:modals.createWorkspace.title")}
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("common:modals.createWorkspace.description")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4 px-6">
            <Input
              ref={inputRef}
              unstyled
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("common:modals.createWorkspace.namePlaceholder")}
              className="w-full [&_[data-slot=input]]:h-auto [&_[data-slot=input]]:px-0 [&_[data-slot=input]]:py-2 [&_[data-slot=input]]:text-2xl [&_[data-slot=input]]:leading-tight [&_[data-slot=input]]:font-semibold [&_[data-slot=input]]:tracking-tight [&_[data-slot=input]]:text-foreground [&_[data-slot=input]]:placeholder:text-muted-foreground [&_[data-slot=input]]:outline-none"
              required
            />

            <Input
              unstyled
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t(
                "common:modals.createWorkspace.descriptionPlaceholder",
              )}
              className="w-full [&_[data-slot=input]]:h-auto [&_[data-slot=input]]:px-0 [&_[data-slot=input]]:py-2 [&_[data-slot=input]]:text-base [&_[data-slot=input]]:leading-relaxed [&_[data-slot=input]]:text-foreground [&_[data-slot=input]]:placeholder:text-muted-foreground [&_[data-slot=input]]:outline-none"
            />

            <div className="space-y-1.5">
              <p className="text-sm font-medium text-foreground">
                {t("workspace:create.ownerLabel")}
              </p>
              <WorkspaceOwnerPicker
                value={ownerUserId}
                onChange={setOwnerUserId}
                disabled={isPending}
              />
              <p className="text-muted-foreground text-sm">
                {t("workspace:create.ownerHelp")}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              onClick={handleClose}
              variant="outline"
              size="sm"
              className="border-border text-foreground hover:bg-accent"
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || !ownerUserId || isPending}
              size="sm"
              className="disabled:opacity-50"
            >
              {t("common:modals.createWorkspace.createButton")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default CreateWorkspaceModal;
