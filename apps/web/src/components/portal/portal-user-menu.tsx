import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Separator,
} from "@taskdesk/ui";
import { LogOut, Settings } from "lucide-react";
import { useState } from "react";
import { getInitials } from "@/lib/get-initials";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import { portalAuthClient } from "@/lib/portal-auth-client";
import { routes } from "@/lib/routes";

/** The signed-in customer, read from the session the portal root already loaded. */
export type PortalShellUser = {
  name: string;
  email: string;
  image: string | null;
};

/** Kaneo's avatar menu, on the customer side: identity, Settings and Sign out. */
export default function PortalUserMenu({ user }: { user: PortalShellUser }) {
  const { t } = usePortalTranslation("portal");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const initials = getInitials(user.name || user.email, "??");

  async function signOut() {
    if (pending) return;
    setPending(true);
    setFailed(false);
    try {
      const result = await portalAuthClient.signOut();
      if (result.error) throw new Error("sign out refused");
      queryClient.clear();
      await navigate({
        to: routes.portalSignIn.path,
        search: { stage: "email", factor: "totp" },
      });
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 rounded-full p-0"
          aria-label={t("shell.userMenu.label", {
            name: user.name || user.email,
          })}
        >
          <Avatar className="size-7">
            {user.image ? <AvatarImage src={user.image} alt="" /> : null}
            <AvatarFallback className="border border-border/30 text-xs font-medium">
              {initials}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60 p-0" side="bottom" align="end">
        <div className="flex items-center gap-2 px-2.5 py-2 text-left text-sm">
          <Avatar className="size-8">
            {user.image ? <AvatarImage src={user.image} alt="" /> : null}
            <AvatarFallback className="border border-border/30 text-xs font-medium">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="grid min-w-0 flex-1 leading-tight">
            <span className="truncate font-medium">
              {user.name || t("shell.userMenu.unnamed")}
            </span>
            {user.email ? (
              <span className="truncate text-xs text-muted-foreground">
                {user.email}
              </span>
            ) : null}
          </div>
        </div>
        <Separator />
        <div className="p-0.5">
          <DropdownMenuItem
            className="h-7 gap-2 px-2 text-sm font-normal"
            onClick={() => void navigate({ to: routes.portalAccount.path })}
          >
            <Settings className="size-3.5" aria-hidden="true" />
            {t("navigation.settings")}
          </DropdownMenuItem>
        </div>
        <DropdownMenuSeparator />
        <div className="p-0.5">
          <DropdownMenuItem
            className="h-7 gap-2 px-2 text-sm font-normal"
            disabled={pending}
            closeOnClick={false}
            onClick={() => void signOut()}
          >
            <LogOut className="size-3.5" aria-hidden="true" />
            {pending ? t("shell.userMenu.signingOut") : t("navigation.signOut")}
          </DropdownMenuItem>
        </div>
        {failed ? (
          <p
            role="alert"
            className="border-t border-border px-2.5 py-2 text-destructive text-xs"
          >
            {t("navigation.signOutFailed")}
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
