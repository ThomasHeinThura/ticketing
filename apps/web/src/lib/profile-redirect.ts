/** Where an old or documented profile URL lives now; `undefined` means the route is real. */
export function profileRedirectTarget(pathname: string): string | undefined {
  const normalised = pathname.replace(/\/+$/, "");
  if (normalised === "/agent/settings/profile") {
    return "/dashboard/settings/account/information";
  }
  if (normalised === "/agent/settings/profile/api-keys") {
    return "/dashboard/settings/account/developer";
  }
  return undefined;
}
