// Placeholder. `vite/i18n-namespace-groups.ts` replaces this module's contents at build, dev and
// test time with a table of `() => import(...)` loaders, one per locale, for the first-paint
// namespace group. It is a real file so the import resolves for the type checker and for
// `check:deps`.
const loaders: Record<
  string,
  () => Promise<{ default: Record<string, unknown> }>
> = {};

export default loaders;
