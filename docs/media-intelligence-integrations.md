# 媒體智慧整合 / Media intelligence integrations

## 繁體中文摘要

查核日期：2026-11-04。OpenFilm 既有能力比較基準為
`c068b8fdf2a09832443db892770b22ad3e5a36e6`；以下也記錄本次分支候選新增的功能，
不代表已發行版本或所有平台已通過驗證。完整來源、版本與授權盤點見下方英文契約。

### 本輪可使用的內容

本輪提供 **本機低能量／靜音候選分析 → 審閱 JSON 提案 → 明確套用**，範圍為
CLI 與 application service。沿用既有 FFmpeg，不安裝 Auto-Editor，不新增 Python、
GPU 或模型下載。參考 Auto-Editor 的音量活動與邊界保留操作，不代表呼叫其 CLI。
低能量不等於無語音、無意義或應刪除的內容；這不是語音活動偵測（VAD）。

從儲存庫根目錄執行，換成目前專案的來源與 Composition ID：

```bash
pnpm --silent cli silence analyze ASSET_ID --project /path/to/project \
  --threshold-db -40 --min-silence 0.5

pnpm --silent cli silence preview ASSET_ID --composition COMPOSITION_ID \
  --project /path/to/project --threshold-db -40 \
  --min-silence 0.5 --padding 0.12 > silence-review.json
```

先閱讀 `silence-review.json` 的來源、參數與受影響區段。標準輸出是完整
`{ reviewId, proposal }`，進度走標準錯誤；`pnpm --silent` 避免 script banner
污染 JSON。這是編輯提案，不是新算繪的影片。接受後才套用：

```bash
pnpm --silent cli silence apply --project /path/to/project \
  --review silence-review.json --confirm
```

可選 `--request-id REQUEST_ID`；已建置的 `openfilm` binary 可直接執行相同子命令。
application service 為 `app.silence.analyzeAsset`／`createProposal`／`apply`。
這次沒有 silence HTTP API、桌面面板、背景排程或跨重啟續跑。

### 分析與套用的界線

- **量測：**第一個音訊串流、48 kHz PCM、20 ms 視窗、每聲道 peak 取最大值；
  僅接受零起點容器，保留其音訊串流延遲與封包間隙；非零容器 start time 以 422 拒絕，
  不直接猜測 duration 減起點。避免反相聲道相消或 8 kHz 降採樣移除高頻內容後誤判。
  既有 waveform／rhythm 的 8 kHz 是另一種分析，不代表靜音量測也是 8 kHz。
- **參數：**閾值 `[-80, -10]` dBFS，預設 `-40`；最短區段 `[0.1, 30]` 秒，
  預設 `0.5`；padding `[0, 2]` 秒，預設 `0.12`。Padding 縮小刪除範圍，保留兩端。
- **資源上限：**本機一般檔案、1–64 聲道、來源最長 24 小時、最多 2,000 區間；
  私有來源快照最多 32 GiB、review JSON 最多 1 MiB、單次 FFmpeg 分析最多一小時。
  超限明確失敗；24 小時來源上限不保證一小時內完成。前景分析支援取消。
- **審閱：**Analyze／Preview 都不改時間軸。Apply 驗證持久 review、完整提案雜湊、
  實際來源 SHA 與 Composition revision；來源或時間軸變更需重新審閱。
  Generic editor／batch 也不得繞過。Silence Apply 必須是交易唯一 leaf，允許單層 batch
  包住單一命令，不允許巢狀 batch 或混入其他編輯。
- **編輯：**來源區間依 trim／speed 映射，鎖定或 user pin 衝突拒絕；一般音訊、
  字幕與圖形走既有 ripple 規則。受影響的獨立 `audioTiming` 目前不能安全分割，
  因此明確拒絕。Undo／Redo 只在同一 application session；不同 CLI 程序不共享
  Undo 歷史。Review 與最後時間軸會落盤，原始媒體不變。

### 11 個專案的用途與差異

| 專案                   | 可以借鑑／後續接入                     | OpenFilm 現況與重要界線                                                                               |
| ---------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [PySceneDetect][scene] | Content／Adaptive 場景偵測             | 已有 FFmpeg scene markers；評估品質增益後才接 provider。BSD-3-Clause，無模型。                        |
| [Auto-Editor][auto]    | 音量／動作規則、保留 margin、v3 時間軸 | 本輪只獨立實作低能量 review/apply，未接 CLI/v3。Code Unlicense，release 二進位與 App 資產另計。       |
| [vid.stab][vidstab]    | 兩階段穩定化                           | 尚無 adapter；兩次需完全一致的畫格順序。現行 LGPL-2.1+，舊版 GPL；FFmpeg build 仍另查。               |
| [color-matcher][color] | 統計色彩轉移                           | 已有三參數 primary-color 審閱；不是同一功能。Code GPL-3.0+，無模型；影片連續性需另驗。                |
| [rembg][rembg]         | 照片遮罩 producer                      | PhotoDepth 已有來源／遮罩契約；尚缺此 producer。Code MIT；預設 BRIA 模型商業使用有獨立付費條款。      |
| [RIFE][rife]           | 畫格插補                               | 已有 retime，未接插補。作者 Practical-RIFE code 與列出的 weights 為 MIT，不能外推任意 checkpoint。    |
| [Real-ESRGAN][real]    | 照片超解析／復原                       | 已有縮放與 proxy，未接學習式超解析。Code BSD-3-Clause，個別權重與 GFPGAN 另盤點。                     |
| [Demucs][demucs]       | 從混音分離 vocals／drums／bass／other  | 已有按片段角色輸出 stems，並非混音分離。Code MIT；作者明說 weights 授權未釐清，不隨附。               |
| [librosa][librosa]     | 音訊 DSP、onset／tempo／beat 品質參考  | 已有 PCM 節奏分析與 snap，優先補比較證據。Code ISC，基本 DSP 不需模型；beat 不代表 downbeat／phrase。 |
| [HyperFrames][hyper]   | 逐幀 seek、ready gate、HTML 動畫算繪   | 本文特指 HeyGen 專案。已有宣告式 GraphicScene；先借契約，不執行任意 HTML/JS。Code Apache-2.0。        |
| [FFmpeg][ffmpeg]       | 既有解碼／濾鏡／封裝基礎               | 本輪新增靜音證據；raw ffprobe、build manifest 已存在。授權取決於實際 build，非一律 LGPL。             |

建議順序：先完成本輪 CLI/application 驗收；再做 Desktop 審閱與 durable jobs、
既有 scene/rhythm 品質比較；接著驗單張遮罩／超解析／色彩轉移；再處理影片穩定化、
插補與音源分離的時間映射及品質；HTML renderer 的執行隔離另立切片。
未來項目不應直接勾成完成，也不應混入 native installer／真機發行證據。
所有分析、衍生資產與正式編輯分離，沿用一份 Composition 與 editor 交易。

見 [ADR 012](adr/012-reviewed-media-intelligence.md)。以下英文內容提供可查核的
完整規格、維護狀態與官方來源；授權表是工程盤點，不是法律結論。

## English reference

Research checked on 2026-11-04. The OpenFilm comparison baseline is
`c068b8fdf2a09832443db892770b22ad3e5a36e6`; this page also describes the silence
review workflow added by this branch candidate.

The current slice is **local low-energy/silence evidence → reviewed proposal →
explicit application**, through the CLI and application service. It uses the
existing FFmpeg runtime and adds no Python, GPU, or model-download requirement.
Auto-Editor's audio-activity and margin workflow is a design reference; its CLI
is neither installed nor invoked. Other projects below are researched references
or future candidates, not eleven installed integrations.

See [ADR 012](adr/012-reviewed-media-intelligence.md), the existing
[media intelligence](media-intelligence.md),
[rhythm validation](validation-rhythm-analysis-snapping.md),
[primary color](primary-color.md), [PhotoDepth](photo-depth.md), and
[GraphicScene](graphic-scenes.md) guides.

### The current workflow

Run from the repository root. Use asset and Composition IDs from the open project,
and replace the example project path.

```bash
pnpm --silent cli silence analyze ASSET_ID --project /path/to/project \
  --threshold-db -40 --min-silence 0.5

pnpm --silent cli silence preview ASSET_ID --composition COMPOSITION_ID \
  --project /path/to/project --threshold-db -40 \
  --min-silence 0.5 --padding 0.12 > silence-review.json
```

Inspect the sources, parameters, affected ranges, and full proposal in
`silence-review.json`. Preview writes the complete `{ reviewId, proposal }` JSON
to stdout and progress to stderr, so its output can be redirected directly.
`pnpm --silent` prevents the script banner from contaminating that JSON. The
built `openfilm` binary can run the same subcommands directly. This preview is an
inspectable edit plan, not a newly rendered preview movie. Apply only after review:

```bash
pnpm --silent cli silence apply --project /path/to/project \
  --review silence-review.json --confirm
```

Apply also accepts an optional `--request-id REQUEST_ID`. The application methods
are `app.silence.analyzeAsset`, `app.silence.createProposal`, and
`app.silence.apply`. This slice adds no silence HTTP API, desktop panel, background
queue, or restart/resume interface. The existing intelligence jobs API must not
be mistaken for a silence workflow endpoint.

#### What the detector actually means

This is an energy detector, **not voice activity detection (VAD)**. Quiet speech
may fall below the threshold, while music or background noise can prevent a pause
from being selected. Low energy does not prove that content is unimportant.

| Item            | Current contract                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Audio selection | Analyze the first audio stream; fail explicitly when there is no audio.                                                                                                                                                                                                                                                                                                                          |
| Analysis clock  | Decode 48 kHz PCM and classify 20 ms windows. Accept zero-based container starts and preserve audio-stream delays and packet gaps. Nonzero container start time is rejected with 422, without guessing a corrected duration. Do not reuse the existing 8 kHz waveform/rhythm analysis rate, which would discard audible high-frequency content. These are not sample-accurate speech boundaries. |
| Channels        | Use the maximum per-channel peak in each window. Opposite-phase channels must not disappear through a mono downmix.                                                                                                                                                                                                                                                                              |
| Threshold       | `threshold-db` is dBFS in `[-80, -10]`, default `-40`.                                                                                                                                                                                                                                                                                                                                           |
| Minimum range   | `min-silence` is `[0.1, 30]` seconds, default `0.5`.                                                                                                                                                                                                                                                                                                                                             |
| Retained margin | `padding` is `[0, 2]` seconds, default `0.12`. It shrinks a removal range to retain content at both edges; it does not extend the source.                                                                                                                                                                                                                                                        |
| Limits          | At most 24 hours per source and 2,000 candidate intervals. Reject oversized input rather than silently publishing truncated evidence.                                                                                                                                                                                                                                                            |
| Execution       | Foreground progress and `AbortSignal` cancellation. Failed or cancelled analysis is not an applicable completed result.                                                                                                                                                                                                                                                                          |

The source must also be a regular local file, with 1–64 audio channels. The
private source snapshot is limited to 32 GiB; persisted review JSON and the CLI
review reader are limited to 1 MiB. A single FFmpeg analysis retains the existing
one-hour execution timeout. A 24-hour source limit does not promise that any
24-hour recording will finish within one hour. Resource-limit failures are explicit.

#### Review and acceptance

Analyze produces source evidence. Preview maps ranges through clip trims and
speed into the Composition and persists an exact review record. Neither operation
modifies the timeline or original media.

Apply verifies the saved review record, full proposal hash, actual source hash,
and Composition revision. It must not skip preview, accept a modified plan, or
regenerate a different unreviewed edit from a clip ID. Generic editor and batch
routes enforce the same acceptance boundary. The silence command must be the
transaction's only leaf: one flat batch can wrap that single command, but nested
batches and mixing with other edits are rejected. This preserves the reviewed geometry. Changed sources or
timeline state require a fresh preview and review.

Lock or user-pin conflicts reject application. Supported audio, captions, and
graphics follow the existing ripple rules. An affected independent `audioTiming`
is rejected because the current primitive cannot safely split its source sample
ranges. It must not silently drop or misalign audio. Successful application uses
the existing editor's Undo/Redo history within the same application session.
Undo history does not persist across separate CLI processes. Review records and
the resulting timeline do persist; original media remains unchanged.

### Eleven references and the existing OpenFilm boundary

“Existing” identifies capabilities found at the baseline. “Future” identifies a
provider, runtime, or feature not connected by this slice. Similar output names
do not make the tools' clocks or editing semantics interchangeable.

| Project                       | Official capability and entry point                                                                                                               | OpenFilm comparison                                                                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PySceneDetect][scene]        | Python `detect(path, ContentDetector())` or `AdaptiveDetector`; CLI `detect-content list-scenes` returns source scene ranges.                     | FFmpeg scene-change markers and source-bound caches already exist. Compare adaptive detector quality before adding an optional provider. Scene detection itself is not missing.                                                     |
| [Auto-Editor][auto]           | Current Nim CLI with audio/motion activity rules, `--margin`, NLE exports, and `--export v3`.                                                     | This slice independently implements low-energy proposals and reviewed application. No CLI adapter, v3 importer, complete activity-rule language, or VAD is delivered.                                                               |
| [vid.stab][vidstab]           | C library; FFmpeg `vidstabdetect` writes transforms and `vidstabtransform` consumes them.                                                         | No stabilization adapter is connected. It needs derived video, crop/zoom disclosure, and identical frame input across both passes.                                                                                                  |
| [color-matcher][color]        | Python `ColorMatcher().transfer(src=..., ref=..., method="mkl")` and CLI `-s`/`-r`; statistical color-transfer methods.                           | Primary-color reference review and three-parameter adjustment already exist. Full statistical transfer is a separate feature. One image does not establish temporal stability or standard LUT interchange.                          |
| [rembg][rembg]                | Python `remove`/`new_session`, CLI `i`/`p`/`b`, including mask output.                                                                            | PhotoDepth already binds source and mask hashes. A mask producer is still a future adapter. Start with still images; framewise video output needs temporal quality evidence.                                                        |
| [RIFE / Practical-RIFE][rife] | The author's frame-interpolation projects; `inference_video.py --multi=2 --video=...`, with matching model code and `flownet.pkl`.                | Retime data and editing already exist; learned interpolation is not connected. Interpolation changes derived frame density, not resolution or the intended narrative timing.                                                        |
| [Real-ESRGAN][real]           | `inference_realesrgan.py -n RealESRGAN_x4plus -i input.png -o out`; `RealESRGANer.enhance` for restoration/super-resolution.                      | Scaling, proxies, and non-destructive rendering exist. Learned super-resolution is a different future capability; validate a still-image derivative before video quality and timing.                                                |
| [Demucs][demucs]              | `uvx demucs --two-stems=vocals -n htdemucs input.wav`; `demucs.api.Separator(...).separate_audio_file(...)`.                                      | Existing exports group known clips by dialogue/narration/music/ambience role. Estimating vocals/drums/bass/other from a mixed recording is a separate, unconnected capability.                                                      |
| [librosa][librosa]            | Audio DSP including `librosa.load`, `onset.onset_detect`, and `beat.beat_track(..., units="samples")`.                                            | A local PCM energy-flux rhythm producer and rhythm snapping already exist. Prefer an offline reference or optional provider. A beat is not automatically a downbeat or semantic phrase.                                             |
| [HyperFrames][hyper]          | Specifically HeyGen's `heygen-com/hyperframes`; `npx hyperframes init`/`lint`/`check`/`render` captures HTML animation with a browser and FFmpeg. | Declarative GraphicScenes and pure time evaluation already exist. Adapt frame seeking and readiness contracts first. No arbitrary HTML/JavaScript execution is added. This reference does not mean another similarly named library. |
| [FFmpeg][ffmpeg]              | `ffmpeg`/`ffprobe`, codecs, filters, resampling, and containers.                                                                                  | Already powers import, analysis, proxies, and rendering. Silence evidence is new here; raw ffprobe metadata, build manifests, and filter checks are existing foundations.                                                           |

### Clock and derived-media admission requirements

These are requirements for future adapters, not a claim that all corresponding
schemas or providers are added by this slice.

- **Source timing comes before convenient FPS values.** [FFmpeg presentation time][ffmpeg-clock]
  is `PTS × time_base`; average or guessed frame-rate values do not replace VFR
  frame timestamps. PySceneDetect's [PyAV backend][scene-backends] and
  [FrameTimecode documentation][scene-clock] likewise distinguish PTS from
  average-rate approximations.
- **External timelines need versioned contracts.** [Auto-Editor v3][auto-v3]
  uses a rational time base for clip `start`/`dur`/`offset` and supports video
  and audio layers. The format is partially stable; effects and transitions
  need explicit support. Do not reinterpret arbitrary JSON values as OpenFilm
  Composition seconds. No v3 importer is added here.
- **Preserve audio sample coordinates.** Demucs normally produces 44.1 kHz
  stereo, while [librosa loading defaults][librosa-load] to 22,050 Hz mono.
  Specify resampling/channel policy and retain source origin, source/analysis
  sample rates, sample counts, hop length, and window alignment. Correct
  [librosa frame/time conversion][librosa-clock] requires consistent
  `hop_length`/`sr` and any half-window offset for non-centered STFT analysis.
- **Example video scripts are not PTS authorities.** The
  [Real-ESRGAN video helper][real-video] re-encodes raw frames using average FPS;
  the [RIFE helper][rife-video] also depends on FPS/frame sequences. vid.stab's
  passes need the same frame order, count, rate, and preprocessing. Preserve or
  explicitly construct the source-to-derivative time map before adoption.
- **Keep evidence, transformations, and edits separate.** Evidence records the
  source hash, provider/algorithm version, parameters, and observations.
  Restoration, interpolation, masks, stabilization, and source separation create
  derived assets with lineage rather than replacing originals. Only an accepted
  edit proposal changes the Composition.
- **Render from frame state, not wall time.** HyperFrames'
  [determinism contract][hyper-clock] drives `seekFrame` with `floor(frame) / fps`
  and excludes uncontrolled clocks, randomness, and mid-render downloads.
  Reproducibility also needs pinned browser, fonts, media, and renderer versions;
  this contract alone is not a cross-environment pixel-identity guarantee.

### Runtime and download costs

| Category                              | Actual requirements                                                                                                                                                                                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing local runtime                | FFmpeg/FFprobe; this slice uses CPU decoding and requires no new GPU or model. Hardware acceleration needs an actual run: `ffmpeg -hwaccels` lists compiled-in support, not proven device availability.                                                                                                             |
| Candidates without pretrained weights | PySceneDetect, Auto-Editor, vid.stab, color-matcher, and librosa still have Python/Nim/C and media-library dependencies. No model does not mean no installation cost.                                                                                                                                               |
| Model/device-dependent candidates     | rembg uses a chosen ONNX model/runtime provider; Real-ESRGAN uses PyTorch/BasicSR or a separately assessed ncnn/Vulkan build; RIFE needs matched code/weights; Demucs needs PyTorch and model artifacts. CPU/CUDA/other backend support depends on the chosen version and does not establish real-time performance. |
| Browser rendering                     | HyperFrames requires Node.js 22+, a browser, and FFmpeg. Its renderer needs no generative model; external AI authoring, remote assets, and cloud rendering have separate dependencies and data transfers.                                                                                                           |

Optional providers should disclose download URLs, revisions, hashes, sizes,
device requirements, and terms before a user chooses installation. rembg includes
cloud backends that upload images, so the package name alone is not evidence of
local execution. Download permission and consent to transmit private media are
different decisions; retain the [offline-default policy](adr/005-local-first.md).
This change downloads no external model and installs none of these optional
runtimes.

### Maintenance and license evidence

This is an engineering inventory of official upstream statements, not a legal
or compatibility opinion. It does not change OpenFilm's Apache-2.0 license.
Code, weights, media, fonts, and the actual distributed binaries need separate
records. Reference versions below are not claims that OpenFilm ran or bundles them.

| Project       | Maintenance/version evidence                                                                                                                                  | Code versus weights                                                                                                                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PySceneDetect | README lists v0.7.2, 2026-10-11; inspected revision `c5ce29c`.                                                                                                | [BSD-3-Clause][scene-license]; core detection needs no pretrained weights. Check third-party binaries separately.                                                                                                                                                      |
| Auto-Editor   | Current Nim revision `5ad05f9`, 2026-11-02.                                                                                                                   | [Unlicense][auto-license]; no ML weights. README distinguishes release-binary dependencies and the separate application's proprietary assets.                                                                                                                          |
| vid.stab      | Revision `e2445c4`, 2026-08-14, with an explicit relicensing record.                                                                                          | Current LGPL-2.1-or-later; v1.1.2 and earlier were GPL-2.0-or-later; see [RELICENSE][vidstab-license]. FFmpeg configure still gates libvidstab behind GPL, so the library label alone does not classify a complete build. No weights.                                  |
| color-matcher | Revision `908a640`, 2026-02-24; code reports version 0.6.0.                                                                                                   | [GPL-3.0-or-later][color-license]; statistical methods need no pretrained weights. Invoking a separate process is not an automatic compatibility determination.                                                                                                        |
| rembg         | Revision `e2c2e3f`, 2026-11-02.                                                                                                                               | Code [MIT][rembg-license]; each model has its own terms. The current default `bria-rmbg` is about 1.02 GB, and the official README says commercial RMBG-2.0 use requires a paid BRIA agreement. MIT does not cover every model automatically.                          |
| RIFE          | Research repository and author's Practical-RIFE are distinct; practical revision `bbfd2ea`, 2026-08-27.                                                       | Code [MIT][rife-license]; Practical-RIFE explicitly puts the contents of its listed trained-model links under the same MIT license. That does not cover arbitrary third-party checkpoints.                                                                             |
| Real-ESRGAN   | Latest release [v0.3.0][real-release], 2022-09-20; inspected mainline revision `a4abfb2`, 2024-04-02; not archived.                                           | Code [BSD-3-Clause][real-license]; the [model zoo][real-models] lists artifacts, but this review did not separately establish redistribution terms for every weight. Inventory GFPGAN/other model and runtime dependencies separately.                                 |
| Demucs        | Meta repository archived 2025-01-01. Author fork lists v4.1.0, 2026-07-11, while stating it is not under active feature development; revision `829d218`.      | [MIT code, unclear weight rights][demucs-license]. The author identifies MusDB/Meta data-rights issues and cannot clarify a grant. The six-source CC-NC-BY suggestion is the author's tentative assessment, not established MIT coverage. No weights are bundled here. |
| librosa       | Latest release [1.0.0][librosa-release], 2026-08-11; inspected revision `4ffed28`.                                                                            | Code [ISC][librosa-license]; core DSP needs no pretrained weights. Downloaded example music has separate asset terms.                                                                                                                                                  |
| HyperFrames   | Official HeyGen repository; latest release [v0.9.12][hyper-release], 2026-11-04; revision `21f2119`. [`FrameAdapter`][hyper-adapter] remains experimental v0. | Code [Apache-2.0][hyper-license]; no required model for the core renderer. Animation libraries, fonts, assets, browser, FFmpeg, and external AI services are separate inventory items.                                                                                 |
| FFmpeg        | Official [downloads][ffmpeg-download] list 9.0.2, 2026-09-18. OpenFilm uses the actually installed build.                                                     | Most code is LGPL-2.1-or-later; GPL/version3 options and external libraries affect build terms. The official [license][ffmpeg-license] says nonfree builds are not redistributable. Normal media operations need no ML weights.                                        |

### Adoption order and completion evidence

1. **Current slice: silence candidates and reviewed application.** Verify
   opposite-phase channels, rejection of nonzero container starts, delayed audio/short
   gaps, bounded parameters
   and cancellation, trim/speed mapping, stale or modified sources/revisions/
   proposals/review IDs, generic/batch enforcement, locks/pins, rejection of
   unsupported audio timing, and complete Composition Undo/Redo. Keep focused
   test results distinct from cross-platform CI. This interface guide alone
   does not establish platform validation.
2. **Next: improve existing evidence quality.** Compare optional librosa and
   PySceneDetect results against time-labeled fixtures and explicit tolerances
   before adding their runtimes. Treat durable jobs and HTTP/desktop review as
   separate slices; CLI cancellation does not establish restart/resume support.
3. **Still-image derivatives.** Validate rembg masks, Real-ESRGAN restoration,
   and color-matcher separately: image output, lineage, parameters, performance,
   and rights, followed by explicit adoption. Statistical color transfer remains
   distinct from the existing three-parameter correction.
4. **Video and audio reprocessing.** vid.stab, RIFE, and Demucs require timing
   maps, synchronization, artifact/reconstruction quality, and interruption
   cleanup. Address unclear Demucs weight rights separately. Framewise masks
   and color transfer also need flicker and temporal-consistency assessment.
5. **Optional browser animation rendering.** First apply HyperFrames-inspired
   out-of-order seeking and ready-gate tests to GraphicScenes. An actual HTML
   renderer needs a separate execution-isolation, resource, font, and browser-
   version decision. Official [Core documentation][hyper-core] already requires
   trusted authors for code-bearing inputs.

These future priorities are recommendations, not delivered feature promises.
All integrations should retain one Composition and the existing editor
transaction boundary, rather than introducing an inconsistent second timeline.

[scene]: https://github.com/Breakthrough/PySceneDetect/blob/c5ce29c73751e77139e838bd9ce9ab66a8e71a23/README.md
[scene-license]: https://github.com/Breakthrough/PySceneDetect/blob/c5ce29c73751e77139e838bd9ce9ab66a8e71a23/LICENSE
[scene-backends]: https://www.scenedetect.com/docs/latest/cli/backends.html
[scene-clock]: https://www.scenedetect.com/docs/latest/api/common.html
[auto]: https://github.com/WyattBlue/auto-editor/blob/5ad05f9ee76bc9fe4126bd25463eada082576f88/README.md
[auto-license]: https://github.com/WyattBlue/auto-editor/blob/5ad05f9ee76bc9fe4126bd25463eada082576f88/LICENSE
[auto-v3]: https://auto-editor.com/docs/v3
[vidstab]: https://github.com/georgmartius/vid.stab/blob/e2445c4081658318223762a696eb1c645c2d7168/README.md
[vidstab-license]: https://github.com/georgmartius/vid.stab/blob/e2445c4081658318223762a696eb1c645c2d7168/RELICENSE.md
[color]: https://github.com/hahnec/color-matcher/blob/908a64034f3bd218570a7e9ff6a1b01e0e4633c8/README.rst
[color-license]: https://github.com/hahnec/color-matcher/blob/908a64034f3bd218570a7e9ff6a1b01e0e4633c8/color_matcher/__init__.py
[rembg]: https://github.com/danielgatis/rembg/blob/e2c2e3f72701357b9bb3f2be32a4330d74ce8f47/README.md
[rembg-license]: https://github.com/danielgatis/rembg/blob/e2c2e3f72701357b9bb3f2be32a4330d74ce8f47/LICENSE.txt
[rife]: https://github.com/hzwer/Practical-RIFE/blob/bbfd2ea90910789a860ea3e2b32a240cd577b75e/README.md
[rife-license]: https://github.com/hzwer/Practical-RIFE/blob/bbfd2ea90910789a860ea3e2b32a240cd577b75e/LICENSE
[rife-video]: https://github.com/hzwer/ECCV2022-RIFE/blob/5d8adbdd40e12c2c8f91930eff838aebe561c086/inference_video.py
[real]: https://github.com/xinntao/Real-ESRGAN/blob/a4abfb2979a7bbff3f69f58f58ae324608821e27/README.md
[real-video]: https://github.com/xinntao/Real-ESRGAN/blob/a4abfb2979a7bbff3f69f58f58ae324608821e27/inference_realesrgan_video.py
[real-models]: https://github.com/xinntao/Real-ESRGAN/blob/a4abfb2979a7bbff3f69f58f58ae324608821e27/docs/model_zoo.md
[real-license]: https://github.com/xinntao/Real-ESRGAN/blob/a4abfb2979a7bbff3f69f58f58ae324608821e27/LICENSE
[real-release]: https://github.com/xinntao/Real-ESRGAN/releases/tag/v0.3.0
[demucs]: https://github.com/adefossez/demucs/blob/829d21890023800713e5dd231c67e43ecc06069b/README.md
[demucs-license]: https://github.com/adefossez/demucs/blob/829d21890023800713e5dd231c67e43ecc06069b/README.md#license
[librosa]: https://librosa.org/doc/main/api/generated/librosa.beat.beat_track.html
[librosa-load]: https://librosa.org/doc/main/auto_tutorials/01-intro/01-load.html
[librosa-clock]: https://librosa.org/doc/latest/_modules/librosa/core/convert.html
[librosa-license]: https://github.com/librosa/librosa/blob/4ffed287f9044654cc4a1a7393f895cd716a0a5d/LICENSE.md
[librosa-release]: https://github.com/librosa/librosa/releases/tag/1.0.0
[hyper]: https://github.com/heygen-com/hyperframes/blob/21f2119194ffdf525ff9f423d67cf09e788afa6c/README.md
[hyper-clock]: https://hyperframes.heygen.com/concepts/determinism
[hyper-core]: https://hyperframes.heygen.com/packages/core
[hyper-adapter]: https://hyperframes.heygen.com/concepts/frame-adapters
[hyper-license]: https://github.com/heygen-com/hyperframes/blob/21f2119194ffdf525ff9f423d67cf09e788afa6c/LICENSE
[hyper-release]: https://github.com/heygen-com/hyperframes/releases/tag/v0.9.12
[ffmpeg]: https://ffmpeg.org/ffmpeg.html
[ffmpeg-download]: https://ffmpeg.org/download.html
[ffmpeg-license]: https://ffmpeg.org/doxygen/trunk/md_LICENSE.html
[ffmpeg-clock]: https://ffmpeg.org/doxygen/trunk/structAVStream.html
