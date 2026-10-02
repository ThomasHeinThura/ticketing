export function getDefaultCookieAttributes() {
  return {
    sameSite: "lax" as const,
    secure: true,
    httpOnly: true,
    path: "/",
  };
}
