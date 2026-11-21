export function roleGrantsOwner(role: string): boolean {
  return role
    .split(",")
    .map((piece) => piece.trim().toLowerCase())
    .includes("owner");
}
