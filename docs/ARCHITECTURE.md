# Architecture & Build Plan (Windows, AMD)

Everything below marked **"OpenWhispr does:"** is sourced directly from the [OpenWhispr repo](https://github.com/OpenWhispr/openwhispr) (paths given). Everything marked **"Recommended for v1:"** is a deliberately simpler substitute — OpenWhispr is a mature, feature-heavy product; you don't need its full complexity to get a working recorder+transcriber.

## 1. Process split & IPC contract

Electron has two worlds that can't talk directly: **main** (Node, full OS/file access) and **renderer** (your React UI, sandboxed). `preload.js` is the only bridge.

**OpenWhispr does:** (`preload.js:65`) exposes one namespaced object via `contextBridge`, where every method just forwards to a kebab-case IPC channel:

```js
// preload.js
contextBridge.exposeInMainWorld("electronAPI", {
  saveTranscription: (text, rawText, options) =>
    ipcRenderer.invoke("db-save-transcription", text, rawText, options),
  transcribeLocalWhisper: (audioBlob, options) =>
    ipcRenderer.invoke("transcribe-local-whisper", audioBlob, options),
  whisperServerStart: (modelName) => ipcRenderer.invoke("whisper-server-start", modelName),
  // ...one line per capability the UI needs
});
```

Each channel is handled on the main side with `ipcMain.handle("channel-name", async (event, ...args) => {...})`, centralized in `src/helpers/ipcHandlers.js`.

**Recommended for v1 contract** — the minimum set to record a meeting and get a transcript:

```js
// preload.js
contextBridge.exposeInMainWorld("api", {
  startMeetingRecording: () => ipcRenderer.invoke("meeting-recording-start"),
  stopMeetingRecording: () => ipcRenderer.invoke("meeting-recording-stop"),
  onTranscriptUpdate: (cb) => ipcRenderer.on("transcript-update", (_e, chunk) => cb(chunk)),
  listMeetings: () => ipcRenderer.invoke("db-list-meetings"),
  getMeeting: (id) => ipcRenderer.invoke("db-get-meeting", id),
});
```

Keep it to this handful of channels until it works end-to-end; add more as you actually need them.

## 2. Audio capture

Two independent streams to think about: **your microphone** and **system audio** ("what you hear" — the other meeting participants). This is the part with real Windows-specific complexity.

### Microphone

**Recommended for v1:** plain Web Audio API in the renderer — `navigator.mediaDevices.getUserMedia({ audio: true })` + `MediaRecorder`, no native code at all. This is standard and sufficient for capturing your own voice.

**OpenWhispr does more:** it ships a custom native helper (`resources/windows-mic-listener.c`, ~1400 lines, raw WASAPI) instead of `getUserMedia`, for lower latency, device-change recovery, and instant hotkey-triggered capture. Not needed for a first version — the browser API is fine.

### System audio (loopback) — the hard part

There's no cross-platform way to capture "what's playing through the speakers." Two options, in increasing order of effort:

**Recommended for v1 — Electron's built-in loopback:**
```js
// main process
const source = await desktopCapturer.getSources({ types: ["screen"] });
// renderer, with that source id:
navigator.mediaDevices.getUserMedia({
  audio: { mandatory: { chromeMediaSource: "desktop" } },
  video: false, // still requires video: true on some Electron versions; discard the video track
});
```
Captures the **default output device**, system-wide. Limitation: it also picks up your own app's sounds (not an issue if your app makes none) and can't isolate/exclude specific processes.

**What OpenWhispr actually does** (`resources/windows-system-audio-helper.c`, 743 lines): a standalone native helper using **WASAPI process-loopback in exclude mode** (`VAD\Process_Loopback`, Windows 10 2004+, via `ActivateAudioInterfaceAsync` — this is the API behind Windows' own "app audio" capture in the Xbox Game Bar / Voice Access). It hears *every* app on *every* output device while specifically excluding OpenWhispr's own process tree. Compiled with plain MSVC:
```
cl /O2 windows-system-audio-helper.c /Fe:windows-system-audio-helper.exe ole32.lib mmdevapi.lib
```
Spawned as a subprocess with a tiny CLI protocol (`src/helpers/windowsLoopbackAudioManager.js`):
- `helper.exe probe` → prints one JSON line, capability check
- `helper.exe start --exclude-pid <pid> --sample-rate 24000` → streams raw 16-bit mono PCM to **stdout**; status/error events as line-delimited JSON on **stderr** (`{"type":"start"}`, `{"type":"warning",...}`, `{"type":"error",...}`)
- Closing stdin tells it to exit cleanly

It automatically falls back to the Chromium display-media approach above on pre-2004 Windows.

**Verdict:** start with the Electron `desktopCapturer` approach. Only build the native WASAPI process-loopback helper later if you specifically need to exclude your own app's audio or capture non-default output devices — it's a genuine multi-day undertaking (COM interop, activation callbacks, device-change handling).

### Mixing

Combine mic + loopback into one mono stream before transcribing (simplest), or keep them as two tracks if you want to later distinguish "me" vs "them" (diarization — skip for v1). Either way, resample/convert to **16kHz mono WAV** before sending to Whisper — use `ffmpeg-static` for this, same as OpenWhispr (`src/helpers/ffmpegUtils.js`).

## 3. Transcription: talking to whisper.cpp

**OpenWhispr does** (`src/helpers/whisperServer.js`): spawns whisper.cpp's own prebuilt `whisper-server` binary as a **long-running local HTTP server**:
- Picks the first free port in range `8178–8199`
- Launches it with `--model <path> --host 127.0.0.1 --port <port>`
- Selects a GPU-specific binary subdirectory for CUDA or **Vulkan** builds depending on detected hardware (`whisperCudaManager.js` / `whisperVulkanManager.js`) — this is your AMD path: Vulkan build, no code changes needed beyond pointing at the right binary
- Health-checks the server every 5s once running
- For each chunk of audio: converts to WAV, then **HTTP POST multipart/form-data to `/inference`** on the local server, gets back JSON with the transcript text

This is the same pattern as any other local-server model runtime — no special Node bindings required, just `child_process.spawn` + `http` calls, which keeps your dependency surface small.

**Recommended for v1:** copy this exact pattern — it's already simple and it's proven. Bundle the prebuilt `whisper-server` Vulkan binary (or CPU-only to start, add Vulkan once the basic loop works) + a small model (`ggml-base.en.bin`) with your app, spawn it once, POST WAV chunks to `/inference`.

## 4. Data model

**OpenWhispr does** (`src/helpers/database.js`): `better-sqlite3`, raw SQL, **no migration framework** — each table starts with a minimal `CREATE TABLE IF NOT EXISTS`, and every column added later is a startup-time `ALTER TABLE ... ADD COLUMN` wrapped in try/catch that swallows "duplicate column" errors. Simple, no version tracking needed, works fine at this scale:

```js
db.exec(`
  CREATE TABLE IF NOT EXISTS transcriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);
try {
  db.exec("ALTER TABLE transcriptions ADD COLUMN has_audio INTEGER NOT NULL DEFAULT 0");
} catch (err) {
  if (!err.message.includes("duplicate column")) throw err;
}
```

**Recommended for v1 schema** (one table to start):

```sql
CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT 'Untitled Meeting',
  transcript TEXT NOT NULL DEFAULT '',
  audio_path TEXT,
  duration_seconds REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Adopt OpenWhispr's additive-`ALTER TABLE`-in-try/catch pattern from day one — it costs nothing and means you never have to write a real migration until the schema needs something SQLite's `ALTER TABLE` can't do (renaming/dropping columns).

## 5. Packaging

`electron-builder` (see the repo's `electron-builder.json`), same as noted in `TECH_STACK.md`. Key thing to get right early: native binaries (`whisper-server.exe`, your audio helper if you build one) need to be marked as **extra resources** (not bundled into the asar) so they can be spawned as real subprocesses — asar-packed files aren't directly executable. OpenWhispr keeps them under `resources/bin/`.

## 6. Build order (do not build these in parallel)

1. **Record button → WAV file.** Renderer button, `getUserMedia` mic capture, `MediaRecorder`, save to disk via IPC. Verify the file plays back correctly. No Whisper yet.
2. **Wire up whisper-server.** Spawn it, POST that saved WAV to `/inference`, print the returned text to console. Verify accuracy with your own voice before touching system audio.
3. **Add system audio via `desktopCapturer`.** Mix with mic, confirm the transcript picks up both sides of a real call.
4. **Persist to SQLite + build the UI shell** (React + Tailwind + shadcn, per `TECH_STACK.md`/`UI_COMPONENTS.md`) — list of past meetings, view a transcript.
5. **Package with electron-builder**, confirm the `.exe` runs on a clean Windows machine with the bundled `whisper-server` binary and model.
6. *(Later, optional)* Swap CPU whisper-server for the Vulkan build once step 5 works, to use the AMD GPU. Only then consider the native WASAPI loopback helper if `desktopCapturer` proves insufficient.
