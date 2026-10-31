import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@taskdesk/ui";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Layout from "@/components/common/layout";
import SidebarToggle from "@/components/common/sidebar-toggle";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { cn } from "@/lib/cn";

type WorkspaceLayoutProps = {
  title: ReactNode;
  headerActions?: ReactNode;
  children: ReactNode;
  onCreateProject?: () => void;
  className?: string;
};

export default function WorkspaceLayout({
  title,
  headerActions,
  children,
  className,
}: WorkspaceLayoutProps) {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();

  return (
    <Layout>
      <Layout.Header>
        <div className="flex items-center justify-between w-full">
          <div className="flex min-w-0 items-center gap-1 w-full">
            <SidebarToggle />
            <div className="mx-1.5 h-4 w-px shrink-0 bg-border/80" />
            <Breadcrumb
              className="flex min-w-0 items-center gap-1 text-xs w-full"
              label={t("common:breadcrumb.label")}
            >
              <BreadcrumbList className="min-w-0 flex-nowrap">
                <BreadcrumbItem className="min-w-0">
                  <BreadcrumbLink href="/" className="min-w-0">
                    <span className="block truncate text-xs font-normal text-card-foreground">
                      {workspace?.name}
                    </span>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem className="min-w-0">
                  <span className="block truncate text-xs font-normal text-card-foreground">
                    {title}
                  </span>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div
            className={`${cn("flex shrink-0 items-center gap-1.5", className)}`}
          >
            {headerActions}
          </div>
        </div>
      </Layout.Header>
      <Layout.Content>{children}</Layout.Content>
    </Layout>
  );
}
