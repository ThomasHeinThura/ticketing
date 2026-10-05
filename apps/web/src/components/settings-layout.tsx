import { useNavigate } from "@tanstack/react-router";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
  Button,
  KbdSequence,
  Separator,
  SidebarTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@taskdesk/ui";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Layout from "@/components/common/layout";
import { shortcuts } from "@/constants/shortcuts";
import { cn } from "@/lib/cn";

type SettingsLayoutProps = {
  title: string;
  description?: string;
  icon?: ReactNode;
  backPath?: string;
  backLabel?: string;
  children: ReactNode;
  className?: string;
};

export function SettingsLayout({
  title,
  description,
  backPath,
  backLabel,
  children,
  className,
}: SettingsLayoutProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const resolvedBackLabel = backLabel ?? t("navigation:settingsLayout.back");

  const handleBack = () => {
    if (backPath) {
      navigate({ to: backPath });
    } else {
      window.history.back();
    }
  };

  return (
    <Layout>
      <Layout.Header>
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-1 w-full">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <SidebarTrigger
                    className="-ml-1 h-6 w-6"
                    toggleLabel={t("common:a11y.toggleSidebar")}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="flex items-center gap-2 text-[10px]">
                    {t("navigation:settingsLayout.toggleSidebar")}
                    <KbdSequence
                      keys={[
                        shortcuts.sidebar.prefix,
                        shortcuts.sidebar.toggle,
                      ]}
                    />
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Separator
              orientation="vertical"
              className="mx-1.5 data-[orientation=vertical]:h-2.5"
            />
            <Breadcrumb
              className="flex items-center gap-1 text-xs w-full"
              label={t("common:breadcrumb.label")}
            >
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink href="/dashboard/settings">
                    <h1 className="text-xs text-card-foreground">
                      {t("navigation:page.settingsTitle")}
                    </h1>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <h1 className="text-xs text-card-foreground">{title}</h1>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div className="flex items-center gap-1.5">
            {backPath && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBack}
                className="gap-1.5 text-xs"
              >
                <ArrowLeft className="w-3 h-3" />
                {resolvedBackLabel}
              </Button>
            )}
          </div>
        </div>
      </Layout.Header>
      <Layout.Content>
        <div className={cn("max-w-4xl mx-auto space-y-8 py-6", className)}>
          {description && (
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
          )}
          {children}
        </div>
      </Layout.Content>
    </Layout>
  );
}
