import { useNavigate } from "@tanstack/react-router";
import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@taskdesk/ui";
import { Building2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Logo } from "@/components/common/logo";

/**
 * Shown to a signed-in person who belongs to no workspace and may not create one. Only an
 * instance administrator creates workspaces (owner decision D-A, 12 Nov 2026), so everyone
 * else waits for an invitation; the pending-invitations page stays one click away.
 */
export function NoWorkspaceEmpty() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <div className="w-full max-w-md mx-auto">
      <Logo className="mx-auto mb-6 w-full flex items-end justify-center" />
      <Empty data-testid="no-workspace-empty">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Building2 />
          </EmptyMedia>
          <EmptyTitle>
            <h1>{t("auth:onboarding.noWorkspace.title")}</h1>
          </EmptyTitle>
          <EmptyDescription>
            {t("auth:onboarding.noWorkspace.description")}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row flex-wrap justify-center">
          <Button
            variant="outline"
            onClick={() => navigate({ to: "/invitations" })}
          >
            {t("auth:onboarding.noWorkspace.viewInvitations")}
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}
