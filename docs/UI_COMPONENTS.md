# UI Packages & Components (reference: OpenWhispr source)

Pulled directly from the [OpenWhispr repo](https://github.com/OpenWhispr/openwhispr) `package.json` and `src/`.

## Core

| Package | Role |
|---|---|
| `react` / `react-dom` 19 | UI framework |
| `vite` + `@vitejs/plugin-react` + `@tailwindcss/vite` | Dev server / build |
| `zustand` | Global state (settings, notes, auth, etc.) |
| `react-i18next` / `i18next` | Localization (12+ languages) |

## Component layer

- **shadcn/ui** — not a runtime dependency; it's a scaffolding CLI (`shadcn-ui` in deps) that generates owned component source into `src/components/ui/`. Style preset: `new-york`, base color `neutral` (see `components.json`).
- **Radix UI primitives** (unstyled, accessible, shadcn builds on these): `react-accordion`, `react-dialog`, `react-dropdown-menu`, `react-label`, `react-popover`, `react-progress`, `react-select`, `react-slot`, `react-tabs`, `react-direction`
- **class-variance-authority (cva)** + **clsx** + **tailwind-merge** — variant-based component styling (`buttonVariants`, etc.), the standard shadcn pattern
- **`@tanstack/react-virtual`** — virtualized long lists (notes, transcripts)

## Icons

- **Not** lucide, despite `components.json` listing it as the default — the app uses **Nucleo** (`src/components/icons/nucleo/`), a paid outline icon set, checked in as individual `.tsx` SVG components with a generated `nucleo-map.json` index and a shared `createIcon.tsx` factory.
- For a clone: either license Nucleo, or point shadcn at `lucide-react` instead (its actual default) — free and drop-in compatible with the same icon-prop conventions.

## Rich text / editor

- **TipTap** (`@tiptap/core`, `@tiptap/react`, `@tiptap/starter-kit`, plus `extension-mention`, `extension-placeholder`, `extension-task-item/list`, `suggestion`) — ProseMirror-based editor for notes, with `@`-mentions and checklists
- `tiptap-markdown` — markdown import/export for the editor
- `react-markdown` + `remark-gfm` — render markdown (chat/assistant responses) outside the editor

## Fonts

- `@fontsource-variable/inter` — UI body font (variable weight)
- `@fontsource-variable/caveat` — handwriting-style accent font
- **Yowza / Yowza Soft** — the actual brand display font, but it's a **licensed** typeface (Blaze Type) not committed to the repo; fetched at build time by `scripts/download-brand-fonts.js` and registered via a custom `@font-face` injector (`brandFonts.ts`). Falls back to Noto Sans when absent — so a clone gets the fallback automatically with no extra work.
- Noto Sans — bundled fallback covering CJK/wide scripts

## Misc

- `canvas-confetti` — celebratory confetti burst (onboarding/milestones)
- `tw-animate-css` — extra Tailwind animation utilities (no Framer Motion / motion library used — animation is plain CSS transitions + keyframes)

## What to reuse for a clone (minimal set)

```
react react-dom zustand
vite @vitejs/plugin-react @tailwindcss/vite tailwindcss
@radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-select @radix-ui/react-tabs @radix-ui/react-popover
class-variance-authority clsx tailwind-merge
lucide-react          # instead of the paid Nucleo set
@tanstack/react-virtual
```

Skip TipTap/i18next/confetti/AI-SDK provider packages unless your clone specifically needs rich-text notes, multi-language UI, or multi-provider LLM chat — none of that is required for the "record + transcribe a meeting" core.
