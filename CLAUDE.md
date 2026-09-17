# Project

## Overview 
<!-- TODO: briefly describe what this app does, its primary users, and the core technical shape (e.g. language/framework for backend and frontend, monorepo or not). -->

## Prerequisites
- **Windows 10/11 x64** — the only target platform (WASAPI loopback capture, Windows whisper.cpp binaries, NSIS installer).
- **Node.js `^22.13.0 || >=24`** with its bundled npm — the `engines` range in `package.json`; ESLint 10 sets the floor.
- **Git**.
- **Network access during `npm ci`** — the `install-electron` postinstall downloads the Electron binary and `ffmpeg-static` downloads ffmpeg; `better-sqlite3` ships N-API prebuilds, so no C++ toolchain is needed.

## Quick Start: Install and Build
```powershell
git clone https://github.com/PHI-Partners/OpenWhispr.git
cd OpenWhispr
npm ci             # exact install from package-lock.json
npm run dev        # launch the app with renderer HMR
npm run build      # bundle into out/main, out/preload, out/renderer
npm run preview    # launch the production bundle
```

Code quality:

```powershell
npm run typecheck  # tsc -b over tsconfig.node.json and tsconfig.web.json
npm run lint       # ESLint with type information; any warning fails
npm run format     # Prettier rewrites code, JSON, CSS and HTML (Markdown is excluded)
```

## Tech Stack
A number in parentheses names the `docs/BACKLOG.md` epic or task that introduces that piece; rationale in depth lives in `docs/TECH_STACK.md`.

| Area | Choice | Why |
|---|---|---|
| Language | TypeScript 6.0, strict; Node `.mjs` for scripts | One type system across main, preload, renderer and the IPC contract; held below 6.1 because typescript-eslint 8.70 requires it |
| Desktop shell | Electron 44 | Tray, global hotkey and always-on-top overlay; sandboxed renderers reach main only through the `contextBridge` API |
| Build | electron-vite 5 on Vite 7 with `@vitejs/plugin-react` 5 | One config builds main, preload and renderer with HMR; electron-vite 5 supports Vite ≤ 7, and plugin-react 6 needs Vite 8 |
| Package management | npm with exact versions (`.npmrc` `save-exact=true`) and a committed lockfile | Reproducible installs; upgrades are deliberate and start by checking peer ranges |
| UI | React 19 | Mainstream component model and ecosystem |
| Styling | Tailwind CSS v4 through `@tailwindcss/vite` | CSS `@theme` tokens without a config file (`docs/THEME.md`); `tailwindcss` and `@tailwindcss/vite` must share the exact version |
| Components | shadcn/ui source on Radix primitives (8.1.2); `class-variance-authority` + `clsx` + `tailwind-merge` | Accessible primitives whose code the project owns; variant-based styling |
| State | Zustand | Global stores without Redux boilerplate |
| Icons and lists | `lucide-react`; `@tanstack/react-virtual` | Free icon set; virtualised meeting and transcript lists |
| Audio capture | `getUserMedia` + `MediaRecorder` (Epic 4); Electron loopback through `desktopCapturer` (Epic 6); native WASAPI process-loopback helper in C (Epic 12) | Both sides of a call without native Node addons; the helper also excludes the app's own audio |
| Audio decoding | `ffmpeg-static` (Epic 4) | One long-running ffmpeg turns webm/opus chunks into 16 kHz mono PCM for the WAV file and whisper |
| Transcription | whisper.cpp `whisper-server` on 127.0.0.1 with a user-selected ggml model downloaded on demand from a ten-entry catalog, `base.en` recommended (Epic 5); Vulkan build with CPU fallback (Epic 11) | Offline and private; no weights in the installer, so accuracy and disk use are the user's choice; Vulkan is the practical AMD GPU backend on Windows |
| Storage | `better-sqlite3` 13 (Epic 7) | Embedded synchronous SQLite; its N-API prebuild loads in Node and Electron without a native rebuild |
| Packaging and updates | electron-builder 26 with NSIS and code signing; `electron-updater` on GitHub Releases (Epic 10) | Signed installer with native binaries outside asar; self-update |
| Code quality | ESLint 10 flat config, typescript-eslint 8 (`recommendedTypeChecked`), `eslint-plugin-react-hooks` 7, Prettier 3 | Type-aware rules catch floating and misused promises; Prettier owns formatting and `eslint-config-prettier` switches off conflicting rules |
| Testing | Vitest 5 (`main`: node, `renderer`: jsdom + React Testing Library) and Playwright driving Electron (Epic 2) | Unit and integration tests plus end-to-end checks of the real app |

## Architecture

### Folder Structure
```text
.claude/skills/        Claude Code skills for this repo (playwright-cli)
docs/                  specs (ARCHITECTURE, TECH_STACK, UI_COMPONENTS, THEME) and BACKLOG.md, the numbered task list
  superpowers/plans/   implementation plan per backlog task
src/
  main/                Electron main process: app lifecycle, windows, services; entry index.ts
    ipc/               ipcHandlers.ts, the single registration point for every ipcMain.handle
    audio/             ffmpeg decoder, WAV writer, recording session, WASAPI helper manager (Epics 4, 12)
  preload/             window.api through contextBridge; bundled, since a sandboxed preload cannot load local modules or npm packages
  shared/              code imported by both sides; ipc.ts holds the channel constants, payload types and the Api interface
  renderer/            React UI with one HTML entry per window (index.html; overlay.html in 9.1.4)
    src/               renderer source behind the @/ alias; components/ui/ holds the shadcn primitives (8.1.2)
resources/             files shipped next to the app outside asar, plus the WASAPI helper's C source (Epics 5, 9, 11, 12)
  bin/                 whisper-server builds in cpu/ and vulkan/, audio helper exe (gitignored, provisioned by scripts)
  icons/               app and tray icons
scripts/               Node .mjs provisioning and build scripts: test fixtures, whisper binaries, Vulkan and helper builds
.cache/                developer-only ggml model cache filled by setup:whisper (gitignored, never packaged)
tests/                 fixtures/, fakes/, helpers/, mocks/ and e2e/ (Epic 2)
out/                   electron-vite build output (gitignored)
dist/                  electron-builder output (gitignored, Epic 10)
```

Root configuration:
- `electron.vite.config.ts` — main, preload and renderer entries; `@shared` alias in all three, `@` in the renderer.
- `vite.browser-preview.config.ts` — standalone Vite config for the renderer in browser-preview mode (see below).
- `tsconfig.json` — references `tsconfig.node.json` (main, preload, shared, scripts, root config files) and `tsconfig.web.json` (renderer, shared); both extend `tsconfig.base.json`. Linting is type-aware, so every file ESLint checks must be included by one of them.
- `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore` — lint and format rules; both tools also skip everything in `.gitignore`.

## Browser Preview (DEV-only)

Run the renderer without Electron for visual inspection and Playwright-driven screenshots:

```powershell
npm run dev:browser        # Vite dev server at http://localhost:5173
```

When `window.api` is absent (no Electron preload), the renderer installs an in-memory mock API (`src/renderer/src/dev/browserPreviewApi.ts`) behind an `import.meta.env.DEV` guard. The mock is tree-shaken from production builds.

**What the mock provides:**
- 5 seeded meetings with varied durations, transcripts and dates
- A scripted recording simulation: `startMeetingRecording` → delayed `TranscriptUpdate` events → `stopMeetingRecording` adds the new meeting to the list

**Playwright browser-preview tests:**

```powershell
npx playwright test --project browser-preview-light   # light mode screenshots
npx playwright test --project browser-preview-dark     # dark mode screenshots
npx playwright test --project browser-preview-light --project browser-preview-dark  # both
```

These are separate from the Electron E2E tests (`--project electron`). The Vite dev server starts automatically via the `webServer` in `playwright.config.ts`.

**Interactive inspection loop (Playwright MCP tools):**
1. Run `npm run dev:browser`
2. Use the Playwright MCP tools to navigate to `http://localhost:5173`, inspect and screenshot
3. Screenshots can be taken in light or dark mode by setting `colorScheme` in the Playwright browser context

### Frontend
<!-- TODO: describe UI framework, state management, routing, and key design decisions -->

### Backend
<!-- TODO: describe server framework, data layer, auth approach, and key design decisions -->

## Communication Flow
<!-- TODO: diagram or prose describing how frontend, backend, and any external services talk to each other (REST, WebSocket, queues, etc.) -->

## App Configuration
<!-- TODO: list all environment variables and config files, their purpose, and example values -->

---

# Claude Instructions

## Tools

* Always use Context7 when you need library/API documentation, code generation, setup or configuration steps without me having to explicitly ask.
* Always use playwright cli & skills to test the application
* Use the TypeScript LSP for symbol/type exploration (go-to-definition, find-references, hover) instead of reading entire files through Explore agents. Reserve full-file reads for broad discovery tasks.

## Code Quality
* Prefer correct, complete implementations over minimal ones.
* Use appropriate data structures and algorithms — don't brute-force what has a known better solution.
* When fixing a bug, fix the root cause, not the symptom.
* If something I asked for requires error handling or validation to work reliably, include it without asking.

## Design Principles
* DRY: Every piece of logic has one authoritative place. Extract it when duplication appears — but only when the two instances truly represent the same knowledge, not just similar-looking code.
* KISS: Prefer the simplest solution that correctly solves the problem. Avoid clever abstractions, unnecessary frameworks, or new dependencies when a plain function will do.
* YAGNI: Only implement what is needed now. Do not add hooks, flags, extension points, or generalization for requirements that don't exist yet.
* SRP: Each function, class, or module has one reason to change. Split when a unit serves two distinct concerns.
* OCP: Extend behavior by adding code, not by modifying existing stable code. Use interfaces or composition rather than branching on type.
* LSP: Subtypes must be substitutable for their base type without breaking callers. If an override weakens a contract, the hierarchy is wrong.
* ISP: Don't force callers to depend on methods they don't use. Prefer narrow, focused interfaces over fat ones.
* DIP: High-level modules depend on abstractions, not concrete implementations. Inject dependencies; don't instantiate them inside.

## Planning & Thinking
* Before writing code, identify the minimal change that solves the problem. Start there.
* Do not invent requirements. If the scope is ambiguous, ask one clarifying question rather than covering all cases speculatively.
* Prefer editing existing code over creating new abstractions. New files, classes, and layers need justification.
* If a task can be done in under 20 lines, do not propose an architecture first.
* Always use Context7 when needing library/API documentation, code generation, setup or configuration steps — without waiting to be asked.

## Output Discipline
* Do not summarize what you just did. Code speaks for itself.
* Do not explain changes unless asked. Show the diff, not a tutorial about it.
* Do not add "you might also want to consider..." suggestions unless asked.
* When returning a code fix, return only the changed code — not the full file — unless the full file is necessary for context.

## Change Scope
* Only modify what the task requires. Do not refactor adjacent code unless it directly blocks the task.
* Do not rename variables, reformat files, or reorganize imports unless explicitly asked.
* If you notice a separate issue while working, flag it in one sentence — do not fix it uninvited.