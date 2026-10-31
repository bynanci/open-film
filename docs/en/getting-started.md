# Getting started

Run OpenFilm from source, create a first project and export an MP4. The basic workflow runs locally and needs no cloud account or AI provider. Optional remote services require separate configuration and consent before data is sent.

The latest stable release is **v0.4.0**. The commands below target current `main` development; when using a published release, also read its [release notes](https://github.com/bynanci/open-film/releases). A distributable native desktop installer is not available yet.

## 1. Prepare your environment

Install Git, **Node.js 24.14.0 or newer**, **pnpm 11.11.0**, and **FFmpeg and FFprobe** available in your terminal. Check the versions:

```sh
node --version
pnpm --version
ffmpeg -version
ffprobe -version
```

Downloading source and dependencies needs a network connection. General editing does not require Python or a model. To use optional speech transcription, follow [transcription setup](transcription.md) later.

## 2. Start the local workspace

```sh
git clone https://github.com/bynanci/open-film.git
cd open-film
pnpm install --frozen-lockfile
pnpm dev
```

Keep the terminal open and visit [http://127.0.0.1:1420](http://127.0.0.1:1420) in a browser. You should see the OpenFilm welcome screen and a `server.ready` message from the local service in the terminal.

`pnpm dev` starts both the workspace (1420) and local API (4310). When your work is saved, press Ctrl+C to stop the development processes. These are local development services; do not expose them directly to the internet.

For native folder pickers, install Tauri's platform prerequisites, stop any existing `pnpm dev`, then run:

```sh
pnpm --filter @openfilm/desktop tauri dev
```

This opens the native development window and starts the same local services. See the [desktop guide](https://github.com/bynanci/open-film/blob/main/apps/desktop/README.md) for platform requirements and packaging limits. To explore the CLI, run `pnpm cli --help` from the repository root.

## 3. Make your first film

Choose a small set of playable photos and short videos. On the welcome screen, select **Create Film** and enter a title, story type, film language, target and maximum length. **Advanced** controls the project location. The maximum length must be at least the target length.

| Step      | Action                                                                      | Expected result                                          |
| --------- | --------------------------------------------------------------------------- | -------------------------------------------------------- |
| Add media | Select files or a folder in Library and wait for Activity to finish         | Thumbnails and import results appear in Library          |
| Organize  | Inspect media, mark favorites and reject unwanted shots                     | A set of usable moments for your story                   |
| Story     | Create a story, refine its beats, select important media and create the cut | An editable cut appears in Edit                          |
| Edit      | Adjust order and length, wait for Saved, then render a preview              | A preview of the current film; later edits mark it stale |
| Export    | Choose Watch / Share to export MP4                                          | A local output location and download link                |

Continue with the [film-making workflow](product-workflow.md) for controls, shortcuts and recovery. Play the exported MP4, then reopen the project to confirm that your saved edit and media are still available.

## Where are your files?

The project lives in the folder chosen during creation or your configured default location. Native-path imports reference original media; browser selections and drops copy files into the local project. Neither import method rewrites originals or uploads them to a cloud.

Keep externally referenced originals and back them up separately. Before moving a drive or project, read [media portability and relinking](media-portability.md) and [Collect Media](collect-media.md).

## Common setup issues

| Symptom                                                  | Next step                                                                                                                                     |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace does not open                                  | Read the startup terminal; confirm both services are running and another OpenFilm process is not using ports 1420/4310                        |
| FFmpeg or FFprobe is missing                             | Make the version commands above work, then restart the service after updating PATH                                                            |
| A source cannot preview                                  | Check [source support](source-support.md); raw 360 media may need a flat export from the camera application                                   |
| Media is marked missing                                  | Reconnect the drive or [relink the source](media-portability.md); do not replace it based on filename alone                                   |
| Transcription or a supported TTS provider is unavailable | Follow [transcription setup](transcription.md) or [TTS setup](provider-generation.md) for supported features; basic editing remains available |

If you still need help, follow [Support](https://github.com/bynanci/open-film/blob/main/SUPPORT.md) with your version, platform, reproduction steps and redacted error messages. To improve OpenFilm, start with [Contributing](https://github.com/bynanci/open-film/blob/main/CONTRIBUTING.md).
