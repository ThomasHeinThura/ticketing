// Framer Motion's spring configuration is a JS transition object, not a CSS easing token.
export const springSettle = {
  type: "spring",
  stiffness: 100,
  damping: 15,
  mass: 1,
} as const;
