# Tech Stack — Meeting Recorder & Transcriber (Windows, AMD CPU/GPU)

Target: Windows 10/11, AMD CPU, AMD GPU (no CUDA available — use Vulkan instead).

See also: [`UI_COMPONENTS.md`](./UI_COMPONENTS.md) (full package list), [`THEME.md`](./THEME.md) (colors/typography/aesthetics), and [`ARCHITECTURE.md`](./ARCHITECTURE.md) (IPC contract, audio pipeline, whisper integration, data model, build order — sourced from the actual OpenWhispr code).

## UI

| Layer | Choice | Why |
|---|---|---|
| Shell | **Electron** | Tray icon, global hotkeys, always-on-top overlay window — all needed for a dictation/meeting widget |
| Framework | **React 19 + TypeScript** | Standard, large ecosystem |
| Bundler | **Vite** | Fast dev server, simple config |
| Styling | **Tailwind CSS v4** | CSS-variable `@theme` tokens, no separate config file — see `THEME.md` for the actual palette |
| Components | **shadcn/ui + Radix UI** primitives (`react-dialog`, `react-dropdown-menu`, `react-select`, `react-tabs`, `react-popover`) | Accessible primitives you own the code for, no runtime UI library lock-in |
| Component variants | **class-variance-authority + clsx + tailwind-merge** | Standard shadcn pattern for variant-based styling (button/card variants, etc.) |
| State | **Zustand** | Minimal boilerplate vs Redux |
| Icons | **lucide-react** | Free, drop-in icon set (OpenWhispr itself uses a paid Nucleo set — lucide is the equivalent free option) |
| Lists | **@tanstack/react-virtual** | Virtualize long transcript/notes lists |
| Fonts | **Inter** (variable, UI body) + system font stack fallback | Skip licensing a custom display font for v1 |
| Motion | Plain CSS transitions/keyframes | No animation library needed — see `THEME.md` for the easing/timing conventions worth copying |

## Backend (Electron main process / Node.js)

### 1. Audio capture (the meeting-recording piece)

Windows meeting audio = two separate streams you need to capture and can mix or keep split:

- **Microphone** — your voice
- **System audio loopback** — "what you hear" through speakers/headphones (the other participants) — this is the Windows-specific trick; there's no cross-platform API for it

| Choice | Why |
|---|---|
| **`getUserMedia` (mic)** | Standard Web Audio API, no native code needed |
| **Electron `desktopCapturer` (loopback)** | Built into Electron, captures the default output device system-wide, no native compilation required |
| **`ffmpeg-static`** | Resample/mix captured PCM down to 16kHz mono WAV, the format Whisper models expect |

OpenWhispr itself uses a custom-compiled native WASAPI helper (`resources/windows-system-audio-helper.c`) for process-exclusive loopback capture instead of the above — full detail and why to skip it for v1 is in [`ARCHITECTURE.md`](./ARCHITECTURE.md#2-audio-capture).

### 2. Transcription (local, offline, privacy-first)

| Choice | Why |
|---|---|
| **whisper.cpp** built with the **Vulkan** backend (`GGML_VULKAN=1`) | AMD GPUs have no CUDA support and ROCm on Windows is immature/limited — Vulkan is the practical cross-vendor GPU backend whisper.cpp supports on Windows |
| CPU fallback (AVX2 build) | Auto-fallback when no compatible GPU/driver is found |
| A ten-entry catalog of OpenAI Whisper ggml models, downloaded on demand (`tiny`, `base`, `small`, `medium` and their `.en` variants, `large-v3`, `large-v3-turbo`; `base.en` recommended) | Shipping no weights keeps the installer small and lets the user trade accuracy against disk and speed without reinstalling; `.en` models are more accurate per byte for English meetings, multilingual ones need `--language auto` |

### 3. Storage

- **better-sqlite3** — local transcript/meeting metadata, no server required

### 4. Packaging

- **electron-builder** — produces a signed Windows `.exe` installer
- **electron-updater** 