import { useNavigate } from "@tanstack/react-router";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@taskdesk/ui";
import { MoreHorizontal, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { routes } from "@/lib/routes";

/**
 * The project header "…" menu (L-03). Kaneo has no header menu, so this composes the
 * sidebar project "…" menu's pieces: the same icon, label and Project settings item.
 */
export default function ProjectHeaderMenu({
  projectId,
}: {
  projectId: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-7 border border-transparent text-muted-foreground hover:text-foreground"
          />
        }
      >
        <MoreHorizontal className="size-4" />
        <span className="sr-only">{t("navigation:sidebar.more")}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-44 rounded-lg" align="end">
        <DropdownMenuItem
          className="h-7 cursor-pointer text-sm"
          onClick={() => {
            void navigate({
              to: routes.projectSettingsGeneral.path,
              params: { projectId },
            });
          }}
        >
          <Settings className="text-muted-foreground" />
          <span>{t("navigation:projectList.projectSettings")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
