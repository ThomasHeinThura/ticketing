import "@testing-library/jest-dom/vitest";
import { expect } from "vitest";
// vitest-axe@0.1.0's `extend-expect` entrypoint is broken (an empty runtime
// file — see src/test/a11y.ts for the type-side fix), so the matcher is
// registered here explicitly instead.
import * as axeMatchers from "vitest-axe/matchers";

expect.extend(axeMatchers);
