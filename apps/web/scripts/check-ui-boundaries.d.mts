// Type declarations for check-ui-boundaries.mjs, colocated so a `.ts` test can import the
// pure predicate functions with real types under "moduleResolution": "bundler" without
// enabling `allowJs` project-wide. Keep this in sync with the exports below by hand — it
// is a thin type shim, not a build output.

export declare const repoRoot: string;
export declare const webSrc: string;
export declare const uiSrc: string;
export declare const appsRoot: string;

export declare function isWithin(base: string, target: string): boolean;

export declare function resolveRelativeSpecifier(
  file: string,
  spec: string,
): string | null;

export declare function walk(dir: string): string[];

export declare function specifiers(file: string): string[];

export declare function isRelativeEscape(file: string, spec: string): boolean;

export declare function isForbiddenPackageOrAppsImport(
  file: string,
  spec: string,
): boolean;

export declare function isDeepUiImport(file: string, spec: string): boolean;

export declare function collectViolations(): {
  violations: string[];
  uiFileCount: number;
  webFileCount: number;
};
