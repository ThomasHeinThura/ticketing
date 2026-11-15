import { useNavigate } from "@tanstack/react-router";
import {
  Button,
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPopup,
  SheetTitle,
} from "@taskdesk/ui";
import { ChevronLeft } from "lucide-react";
import {
  createContext,
  type ReactElement,
  type ReactNode,
  useContext,
  useMemo,
} from "react";
import { useTranslation } from "react-i18next";
import { ActionTooltip } from "@/components/common/action-tooltip";

type SettingsSidebarContextValue = {
  workspaceId?: string;
  workspaceLoading?: boolean;
  backToProject?: string;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
};

const SettingsSidebarContext = createContext<SettingsSidebarContextValue>({
  workspaceId: undefined,
  workspaceLoading: false,
  backToProject: undefined,
  menuOpen: false,
  setMenuOpen: () => {},
});

export function SettingsSidebarProvider({
  children,
  workspaceId,
  workspaceLoading = false,
  backToProject,
  menuOpen,
  setMenuOpen,
}: {
  children: ReactNode;
  workspaceId?: string;
  workspaceLoading?: boolean;
  backToProject?: string;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
}): ReactElement {
  const value = useMemo(
    () => ({
      workspaceId,
      workspaceLoading,
      backToProject,
      menuOpen,
      setMenuOpen,
    }),
    [workspaceId, workspaceLoading, backToProject, menuOpen, setMenuOpen],
  );

  return (
    <SettingsSidebarContext.Provider value={value}>
      {children}
    </SettingsSidebarContext.Provider>
  );
}

/**
 * Returns from settings to the active workspace or project board, or explains via tooltip why the
 * button is disabled when a zero-workspace instance admin visits God Mode.
 */
export function SettingsBackButton({
  workspaceId,
  workspaceLoading = false,
  backToProject,
  className,
  wrapperClassName,
  iconClassName,
}: {
  workspaceId?: string;
  workspaceLoading?: boolean;
  backToProject?: string;
  className?: string;
  wrapperClassName: string;
  iconClassName?: string;
}): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Avoid flashing the zero-workspace tooltip while active workspace membership is still loading.
  const disabledReason =
    workspaceId || workspaceLoading
      ? undefined
      : t("auth:onboarding.noWorkspace.title");
  const button = (
    <Button
      variant="ghost"
      size="sm"
      disabled={!workspaceId}
      aria-description={disabledReason}
      className={className}
      onClick={() => {
        if (!workspaceId) return;
        if (backToProject) navigate({ href: backToProject });
        else navigate({ to: "/agent" });
      }}
    >
      <ChevronLeft aria-hidden="true" className={iconClassName} />
      {backToProject
        ? t("navigation:page.backToProject")
        : t("navigation:page.backToWorkspace")}
    </Button>
  );
  if (!disabledReason) return button;
  // A disabled Button ignores pointer events, so the reason tooltip sits on a wrapper.
  return (
    <ActionTooltip label={disabledReason}>
      <span className={wrapperClassName}>{button}</span>
    </ActionTooltip>
  );
}

export default function SettingsSidebar({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  const { t } = useTranslation();
  const {
    workspaceId,
    workspaceLoading,
    backToProject,
    menuOpen,
    setMenuOpen,
  } = useContext(SettingsSidebarContext);

  return (
    <>
      {/* Docked from lg up; below lg (768 px tablets too) the same menu opens as a sheet so
          the settings page gets the full width (UX-10). */}
      <aside className="hidden w-64 shrink-0 lg:block">{children}</aside>
      <Sheet onOpenChange={setMenuOpen} open={menuOpen}>
        <SheetPopup
          side="left"
          className="w-64 bg-sidebar p-0 text-sidebar-foreground lg:hidden"
          closeLabel={t("common:actions.close")}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{t("common:sidebar.title")}</SheetTitle>
            <SheetDescription>
              {t("common:sidebar.mobileDescription")}
            </SheetDescription>
          </SheetHeader>
          <div className="border-b border-sidebar-border p-2 pr-14">
            <SettingsBackButton
              workspaceId={workspaceId}
              workspaceLoading={workspaceLoading}
              backToProject={backToProject}
              className="w-full justify-start text-sm font-normal"
              wrapperClassName="block w-full"
              iconClassName="size-4"
            />
          </div>
          {children}
        </SheetPopup>
      </Sheet>
    </>
  );
}
