# OpenFilm desktop

The Vue workspace uses the local application service at `127.0.0.1:4310`.
No remote fonts, media, models, or upload services are requested. All imagery in
the workspace comes from cached thumbnails of imported local media.

From the repository root, `pnpm dev` starts the API and Vite on ports 4310 and 1420. `pnpm --filter @openfilm/desktop build` builds the frontend. The browser
workflow supports all project, library, story, preview, and export operations;
folder paths can be entered directly. A Tauri window adds the native folder
picker through the narrowly scoped `pick_folder` command.

## Native shell

With the platform's Tauri prerequisites installed, run
`pnpm --filter @openfilm/desktop tauri dev`. Tauri's development hook runs the
repository's combined development command. Stop an existing `pnpm dev` before
starting this hook to avoid duplicate servers. Linux requires Rust, a C/C++
toolchain, GTK 3, WebKitGTK 4.1, and related Tauri system libraries. Consult
[Tauri's platform prerequisites](https://v2.tauri.app/start/prerequisites/).

For a compiled shell, start the bundled Node application service separately, or
set `OPENFILM_NODE_PATH` to an absolute Node 24.14+ executable and
`OPENFILM_SERVER_PATH` to the absolute `dist/server/index.mjs` path before
launching. The shell starts that executable with the server path as a separate
argument and stops only its own child on exit. It never executes a shell string.
These variables are local executable configuration, not project or user input.
The API accepts the Tauri application origin and restricts external requests.

Installer bundling is intentionally disabled for this milestone: a redistributable
package still needs a verified platform-specific Node runtime, FFmpeg/FFprobe,
and optional ExifTool resources. A frontend build alone does not validate the
native shell or produce a standalone desktop installer.

The API-backed browser E2E test creates real temporary media with FFmpeg, imports
it, edits selections and a story beat, composes, renders an MP4, exports, and
reopens the project. It does not substitute fixture screens or mock requests.
