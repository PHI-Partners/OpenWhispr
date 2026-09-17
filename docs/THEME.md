# Visual Theme & Aesthetics (reference: OpenWhispr source)

Pulled directly from `src/index.css` (Tailwind v4 `@theme` tokens) and `src/components/ui/`.

## System

- **Tailwind CSS v4** with CSS custom-property tokens (`@theme` block), not a JS config file — `components.json` even leaves `tailwind.config` empty
- Light mode: plain hex colors. Dark mode: **OKLCH** colors (perceptually uniform lightness — easier to keep a consistent "step" between surface layers than hex/HSL)
- One `.dark` class swaps the whole palette; components never branch on theme in JS

## Color palette

**Brand**
| Token | Value | Use |
|---|---|---|
| `--color-primary` | `#4577e9` (blue) | Buttons, links, focus ring — the one brand color, same in both themes |
| `--color-accent` | `oklch(0.55 0.22 285)` (violet) | Secondary accent |
| `--color-agent-brand` | `#8787ff` | "Agent Mode" AI-assistant identity color |
| Brand glass gradient | `#5588F0 → #3466E2` | Primary buttons, mic/send circles — a subtle top-to-bottom blue gradient, not a flat fill |

**Light mode**
- Background `#ffffff`, foreground `#171717` (near-black, not pure black)
- Surface hierarchy for depth: `surface-0` (`#fff`) → `surface-1` (`#fafafa`) → `surface-2` → `surface-3` (`#f5f5f5`) → `surface-raised` (`#f0f0f0`)
- Borders: `#e5e5e5` default, `#d4d4d4` hover, primary blue when active
- Secondary "Parchment" palette (`--color-parchment-*`, warm cream `#f9f6f1` bg / dark brown `#2b1f14` text) — used for a distinct warm surface elsewhere in the app, not the default chrome

**Dark mode** — charcoal, not black
- Base `oklch(0.22 0.006 260)` (hue 260 = neutral blue-grey), steps up in lightness by ~0.05 per surface layer up to `surface-raised` at `0.33`
- Foreground `oklch(0.93 0 0)` (off-white, not pure white)
- Accent hue 285 (violet) kept distinct from primary hue 260 (blue) so interactive vs. brand elements stay visually separable

**Semantic**: `success` (green), `warning` (amber), `destructive` (red), `info` (blue) — each with a `-foreground` pair, consistent in both themes.

## Typography

- **Yowza** (licensed display face, Latin-only) → **Noto Sans** (CJK/fallback) → system stack (`-apple-system, "Segoe UI", Roboto, ...`)
- **Inter Variable** used specifically in onboarding as a fallback layer between Yowza and Noto Sans
- **Caveat** (handwriting-style variable font) for a casual/personal accent somewhere in the UI (notes?)
- Custom metrics override on Yowza (`ascent-override`/`descent-override`) to optically align its baseline with 16px icons — a level of polish you can skip for v1

## Shape & elevation

- **Tight, "premium macOS" radius scale**: `--radius-sm` 4px → `--radius` 6px (buttons/inputs) → `--radius-lg` 8px (cards) → `--radius-xl` 10px → `--radius-shell` 12px (main window's inset container). Buttons are actually `rounded-full` (pill-shaped), not just 6px.
- **"Liquid glass" surface** used on translucent panels and primary buttons: `bg-white/55` (light) or `white/6` (dark) + `backdrop-blur-xl` + `backdrop-saturate-150` + an inset-highlight box-shadow (`--shadow-glass`) that fakes a bright top rim, like frosted glass catching light
- Layered card shadows scale with elevation: `--shadow-card` (resting) → `--shadow-card-hover` → `--shadow-elevated` → `--shadow-modal`, each just a stronger/longer blur, softer in dark mode with an inset highlight instead of a hard shadow

## Motion

- No animation library (no Framer Motion) — plain CSS `transition`/`@keyframes`
- Standard interactive transition: `200ms ease-out` on color/transform; press states scale down slightly (`active:scale-[0.985]`) rather than changing color, for tactile feedback
- Respects `prefers-reduced-motion`: transforms are stripped app-wide, but opacity/color transitions are kept (motion that carries meaning stays; decorative travel goes)
- Custom easing for onboarding entrances: `cubic-bezier(0.23, 1, 0.32, 1)` — starts fast, decelerates (feels immediate, not sluggish)

## Takeaways for a clone

1. Define colors as CSS variables in a Tailwind v4 `@theme` block (not `tailwind.config.js`) — light mode in hex, dark mode in OKLCH for even steps.
2. Pick **one** brand hue for primary actions/links; keep it identical across light/dark so the brand reads consistently.
3. Charcoal (not pure black) dark mode, near-black (not pure white/black) text — avoids the harsh AMOLED look.
4. Pill-shaped (`rounded-full`) primary buttons + subtle glass/blur on floating panels reads as "premium macOS-native" — cheap to do with just `backdrop-blur` + an inset box-shadow, no design system needed.
5. Skip Framer Motion; CSS transitions cover everything here and keep bundle size down.
