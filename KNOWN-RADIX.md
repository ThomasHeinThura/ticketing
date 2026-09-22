# Known Radix references

`pnpm check:ui` (`scripts/ci/check-ui.mjs`) parses the table below and fails the build if any
file in the repository imports `@radix-ui/*` or the bare `radix-ui` umbrella package that is
not listed here. See #9 (docs/04-engineering/ci-cd.md, gate G1).

The two real Radix imports the repo had — `apps/web/src/components/ui/form.tsx`
(`@radix-ui/react-slot`) and `apps/web/src/components/ui/timeline.tsx` (the `radix-ui`
umbrella's `Slot`) — were both replaced by a small local `Slot` implementation
(`apps/web/src/lib/slot.tsx`) in the same change that added this file. There is nothing left
to list: **this table has zero data rows on purpose**, not because a row was overlooked. Add
a row here — and only here — the moment a real Radix import is genuinely needed again; do
not add one to silence a `check:ui` failure without first trying a Base UI or local
alternative the way #9 did for `Slot`.

| File | Package | Reason |
| --- | --- | --- |
