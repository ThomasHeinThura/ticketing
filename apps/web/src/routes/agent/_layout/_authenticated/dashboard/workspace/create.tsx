import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Button, Card, CardContent, Input } from "@taskdesk/ui";
import { Building2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { WorkspaceOwnerPicker } from "@/components/workspace/workspace-owner-picker";
import activateWorkspace from "@/fetchers/workspace/activate-workspace";
import useCreateWorkspace from "@/hooks/queries/workspace/use-create-workspace";
import { authClient } from "@/lib/auth-client";
import { routes } from "@/lib/routes";
import { toast } from "@/lib/toast";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/create",
)({
  // Only an instance administrator creates a workspace (owner decision D-A, 12 Nov 2026).
  // Everyone else is sent home; the API refuses them as well.
  beforeLoad: ({ context }) => {
    if (context.session?.user?.role !== "admin") {
      throw redirect({ to: routes.agentHome.path });
    }
  },
  component: RouteComponent,
});

function RouteComponent() {
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
    if (inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, []);

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

      // The administrator is a member only if they named themselves. Handed to someone else, the
      // workspace is not theirs to open: leave them in God Mode instead of activating it.
      if (ownerUserId !== session?.user?.id) {
        toast.success(t("workspace:create.successHandedOver"));
        navigate({ to: routes.godModeHealth.path, replace: true });
        return;
      }
      toast.success(t("workspace:create.success"));

      // S8a: native replacement for authClient.organization.setActive().
      await activateWorkspace(createdWorkspace.id);

      navigate({ to: "/agent", replace: true });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("workspace:create.error"),
      );
    }
  };

  return (
    <>
      <PageTitle title={t("workspace:create.pageTitle")} />
      <div className="min-h-screen w-full bg-background flex items-center justify-center p-4 overflow-y-auto">
        <div className="w-full max-w-md">
          <Card className="shadow-sm">
            <CardContent className="p-8">
              <div className="text-center mb-8">
                <div className="flex justify-center mb-4">
                  <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center">
                    <Building2 className="h-6 w-6 text-muted-foreground" />
                  </div>
                </div>

                <h1 className="text-2xl font-semibold text-foreground mb-2">
                  {t("workspace:create.heading")}
                </h1>
                <p className="text-muted-foreground text-sm">
                  {t("workspace:create.subtitle")}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-4">
                  <div>
                    <label
                      htmlFor="workspace-name"
                      className="block text-sm font-medium text-foreground mb-2"
                    >
                      Workspace Name
                    </label>
                    <Input
                      ref={inputRef}
                      id="workspace-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t("workspace:create.namePlaceholder")}
                      className="h-12 text-lg font-medium"
                      required
                    />
                    {!name.trim() && (
                      <p className="mt-1 text-destructive-foreground text-sm">
                        {t("workspace:create.required")}
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="workspace-description"
                      className="block text-sm font-medium text-foreground mb-2"
                    >
                      {t("workspace:create.descriptionLabel")}
                    </label>
                    <Input
                      id="workspace-description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder={t("workspace:create.descriptionPlaceholder")}
                      className="h-10"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="workspace-owner"
                      className="block text-sm font-medium text-foreground mb-2"
                    >
                      {t("workspace:create.ownerLabel")}
                    </label>
                    <WorkspaceOwnerPicker
                      id="workspace-owner"
                      value={ownerUserId}
                      onChange={setOwnerUserId}
                      disabled={isPending}
                    />
                    <p className="mt-1 text-muted-foreground text-sm">
                      {t("workspace:create.ownerHelp")}
                    </p>
                  </div>
                </div>

                <div className="pt-4">
                  <Button
                    type="submit"
                    disabled={!name.trim() || !ownerUserId || isPending}
                    className="w-full h-12 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isPending
                      ? t("workspace:create.creating")
                      : t("workspace:create.submit")}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
