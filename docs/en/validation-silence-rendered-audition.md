# 靜音剪輯提案：渲染試聽與驗證

## 候選範圍

基底為 main `272af117c90384a2f79e50df39b0fb2f3185c31e`。
PR #100、#107、#108 已提供靜音分析、不可變 Review、明確接受與 Precision 審閱介面。
本候選透過既有 Record 音訊 renderer 和私有 PCM cache 試聽已保存的提案，
不將推演結果儲存成永久 Composition。

## 音訊與時間軸驗收矩陣

| 情境                       | 必要證據                                    | 品質判讀界線                        |
| -------------------------- | ------------------------------------------- | ----------------------------------- |
| 對白加背景音樂             | 原版／提案 Record mix 與接受後輸出 PCM 比對 | 低能量分析不等於語音辨識            |
| 雙聲道、44.1/48 kHz        | 聲道分離、輸出樣本數與 48 kHz sample index  | 仍需人耳試聽                        |
| 來源重用、trim、speed      | 各次出現位置獨立映射至時間軸                | 不假設逐字時間戳                    |
| J/L timing、B-roll         | 依既有時間契約等價渲染或明確拒絕            | 不支援的獨立音訊時序保持封鎖        |
| cut 涉及 fade/gain/ducking | 試聽前沿用 automation conflict 拒絕         | 曲線重新映射屬 Prompt 02            |
| Lock、User Pin             | 既有 solver 拒絕受保護修改                  | 試聽不得繞過編輯保護                |
| 來源、revision、專案改變   | 舊 descriptor／callback 失效                | 必須重新明確審閱                    |
| 取消、寫入失敗             | 清理私有暫存，原專案保持原狀                | 不得發出未完成輸出的成功 descriptor |

## 隱私與人工驗收

提交的 fixtures 全部使用合成資料。私人媒體、來源絕對路徑、憑證與個人錄音
不得進入 repository 或 CI artifacts。本次尚未提供真實對白素材或 Windows/macOS
人耳試聽工作站；合成 PCM 與波形量測無法證明語音完整性、接縫可接受性、
沒有可聞 click，或取得真人品質認可。這些項目持續保留人工驗收門檻。

Crossfade 必須由既有可接受的編輯／渲染契約提供。試聽不自動新增 crossfade，
也不宣稱硬接縫已修復。相鄰樣本振幅跳變可作為客觀診斷，但不能單獨判定聽感品質。

## 驗證狀態

本候選的本機驗證結果列於下表。候選 CI 需以 PR 最終 head 的 GitHub 檢查為準；真實素材與工作站品質門檻仍未完成。

---

# Silence rendered audition: contract and validation

## Candidate scope

Implementation starts from main `272af117c90384a2f79e50df39b0fb2f3185c31e`. PRs #100, #107 and #108 already provide Silence analysis,
immutable durable Reviews, explicit acceptance and the Precision Review UI.
This candidate adds audition of a saved Review using the existing Record audio
renderer and private PCM cache. It must not save a speculative Composition.

## Audio and timeline acceptance matrix

| Case                                 | Required evidence                                                 | Quality boundary                              |
| ------------------------------------ | ----------------------------------------------------------------- | --------------------------------------------- |
| Dialogue plus background music       | Original and proposed Record mix, accepted render PCM parity      | Low energy is not speech recognition          |
| Stereo, 44.1/48 kHz sources          | Channel separation, output sample count and 48 kHz sample indices | Human listening remains required              |
| Reused source, trim and speed        | Each source occurrence maps to its own timeline interval          | No assumed word timestamps                    |
| J/L timing and B-roll                | Existing timing policy either renders equivalently or rejects     | Unsupported independent timing stays blocked  |
| Fade/gain/ducking intersecting a cut | Existing automation conflict rejects before audition              | Prompt 02 owns curve remapping                |
| Lock and User Pin                    | Existing solver rejects protected modifications                   | Audition cannot bypass edit policy            |
| Source/revision/project change       | Old descriptors and callbacks rejected                            | Explicit new Review is required               |
| Cancellation and write failure       | Private temporary artifacts cleaned, saved film unchanged         | No successful descriptor on incomplete output |

## Privacy and manual gates

All committed fixtures must be synthetic. No private media, source absolute paths,
credentials or personal recordings may enter the repository or CI artifacts.
No real dialogue recordings or Windows/macOS listening workstation were supplied
for this candidate. Synthetic sample and waveform measurements cannot establish
speech intelligibility, acceptable joins, absence of audible clicks, or human
approval. Those remain manual gates, even when renderer equivalence passes.

Crossfade must use an existing accepted edit/render contract. Audition does not
invent crossfades or claim that a hard join has been repaired. A sample jump is
an objective diagnostic; it does not independently decide perceptual quality.

## Validation status

Local candidate checks are recorded below. Candidate CI must be checked on the
final PR head. Real-media and workstation listening acceptance remains open.

## API 契約 / API contract

`POST /api/silence/jobs/:jobId/audition`

```ts
interface SilenceAuditionRequest {
  reviewId: string;
  proposal: SilenceCutProposal; // exact saved @openfilm/core proposal
  requestId: string;
  windowSeconds?: number;
}
```

`proposal` 必須是完整已保存的 JSON 物件，不能修改候選來取代建立新的 durable Review。
`windowSeconds` 範圍為 0.1–3 秒。
回應包含 `version: 1`、`reviewId`、`requestId`、`baseRevision`、
`before` / `after` Record descriptor、`seams`、`removedSamples` 與
`parity: "renderer"`。每個 seam 提供原版／提案的起訖 sample index，
以及原時間軸移除的起訖 sample index；sample rate 固定 48,000 Hz。

The exact persisted proposal object is required. Candidate changes must first
create a new durable Review. Each descriptor uses the existing
`GET /api/record-audio-preview/:id/pcm?startSample=…&count=…` endpoint:
stereo interleaved signed 24-bit little-endian PCM, with at most 192,000 frames
per read. Descriptors expose no source or cache path.

取消透過中止 HTTP 請求／AbortSignal 進行。服務沿用既有 active task、
renderer 的 AbortSignal 與 Record cache lock。相同 requestId 必須維持相同
job、Review、proposal 與 window；內容變更回 409。每個 session 最多保留
64 個 request identity，超過則明確回 busy；重新開啟專案後必須明確重新準備。

Cancellation aborts the HTTP request and existing renderer task. An identical
request can reuse valid descriptors; a conflicting request identity fails.
Source, saved Composition, project or durable Review changes revoke eligibility.
The browser may resample PCM to its audio device rate; renderer PCM equivalence
does not establish device playback or human listening quality.

## 資源與效能界線 / Resource bounds

試聽沿用 Record 的整支 Composition 渲染，`windowSeconds` 僅控制播放範圍，
不縮短準備階段的渲染。既有上限為一小時／每個 PCM 檔 1 GiB，私有 cache
總額 2 GiB；過長或容量不足會拒絕。長片準備可能需要較久，可明確取消。

Audition prepares the full saved/proposed Record mix, then reads only the chosen
seam window. The existing one-hour/1 GiB per-file and 2 GiB private-cache budgets
remain enforced. This candidate does not claim interactive render latency for
large films or real-media workstations.

## 重現與人工驗收 / Reproduction and manual checks

```sh
pnpm install --frozen-lockfile
OPENFILM_AUDIO_EVIDENCE_DIR=/tmp/openfilm-silence-evidence pnpm test:media tests/integration/silence-audition-media.test.ts
pnpm build
pnpm exec playwright test tests/e2e/silence-review.spec.ts
```

CI 保存 `synthetic-silence-audition-<candidate-sha>` artifact，僅包含由本測試
產生、檔名為 `silence-audition-*` 的 WAV／MP4 與 JSON 量測。
不保存 project.json、renderer manifest 或來源路徑。

The real-render test generates synthetic stereo WAV, music and video fixtures,
renders original/proposed audio, explicitly accepts through the existing API,
then compares accepted Record PCM and formal WAV output. It also probes actual
MP4 audio PTS, duration and loudness. The optional evidence directory contains
only synthetic media and measurements for this test's prefixed artifact set.

人工驗收請在本機指定且不會提交的媒體上進行：開啟 Precision → Silence Review，
建立分析並逐項審閱候選；修改候選後先保存新的 Review。設定接縫前後秒數，
準備原版與剪輯後音訊並切換試聽；聆聽語尾、子音、呼吸、背景音樂切點與
左右聲道，記錄主觀判讀與裝置／輸出設定。另測試取消、換專案、來源替換、
接受後 Undo/Redo 及 Save/Reopen。品質不滿意時保留候選或拒絕提案。

Manual approval requires local real dialogue/music listening on Windows/macOS:
check syllables, breaths, music continuity, stereo balance and join clicks.
Record the device and sample-rate settings without publishing private paths.
Exercise cancel, project switch, stale source, explicit Accept, Undo/Redo and
Save/Reopen. Synthetic equality alone cannot approve these perceptual gates.

## 合成媒體量測 / Synthetic render measurements

工具 / tools: FFmpeg `7.1.5-0+deb13u1`, Linux x64. Output: 48 kHz stereo.

| Fixture                                             | Before / after samples | Removed samples | Before / after WAV LUFS | Maximum PCM error |
| --------------------------------------------------- | ---------------------: | --------------: | ----------------------: | ----------------: |
| 44.1 kHz, reused voice + 48 kHz music + B-roll      |        384000 / 307200 |           76800 |         −14.60 / −14.42 |                 0 |
| 48 kHz, trim + speed 1.25 + 44.1 kHz music + B-roll |        268800 / 207360 |           61440 |         −14.73 / −14.41 |                 0 |

原版與提案各自和獨立渲染的原版／接受後 WAV 比對，全區間 PCM 最大量測誤差
均為 0；接受後 Record PCM 和提案 PCM 逐位元相同。既有 renderer 精度斷言為
`2 / 2^23`，沒有放寬。兩支實際 MP4 的音訊 PTS 起點均為 0，時長為 6.4 秒／
4.32 秒，和預期 PCM 長度的差異不超過一個輸出 sample。

MP4 loudness observations are −14.40 / −14.35 LUFS and true peak −8.45 /
−6.75 dBTP. Maximum observed stereo seam step is approximately 0.001056
normalized amplitude. These are measurements, not perceptual pass thresholds;
no claim of click-free output or retained speech is made from synthetic tones.
JSON evidence includes source hashes, output filenames/SHA-256, sample windows,
measurements and the tested candidate SHA. CI uploads only synthetic files.

## UI evidence

- [1024 × 768 audition](/screenshots/silence-audition-1024x768.png)
- [1920 × 1080 audition](/screenshots/silence-audition-1920x1080.png)

Screenshots use the synthetic Silence Review fixture. The existing Precision
Inspector and monitor layout remain the host for the controls.

## 本機整合驗證 / Local integrated checks

| Check                                          | Actual result                                            |
| ---------------------------------------------- | -------------------------------------------------------- |
| `pnpm format:check`                            | Pass                                                     |
| `pnpm test:i18n` / `pnpm test:docs-i18n`       | 3120 semantic keys / 156 English reference mirrors; pass |
| `pnpm lint` / `pnpm typecheck` / `pnpm build`  | Pass; existing large-chunk build warning remains         |
| `pnpm test:contracts`                          | 77 files, 1494 tests passed                              |
| Related `pnpm test:media` selection            | 7 files, 64 tests passed                                 |
| Audition controls + Record playback unit tests | 2 files, 11 tests passed                                 |
| Silence Review + audio policy Playwright specs | 5 tests passed, default single worker                    |
| Docs VitePress build                           | Pass                                                     |
| License / provenance policy                    | Pass; 8 policy regressions                               |

The seven media suites are Silence Review, Silence Jobs, Record PCM application,
Silence Jobs HTTP, Record PCM HTTP, actual audition media and source-verification
cancellation. This is the related local selection; it is not a claim that the
entire local media suite or native workstation QA was run. CI runs the full
existing lanes on the submitted candidate. No assertions were skipped or relaxed.

## 已提交的量測證據 / Committed measurement evidence

The clean implementation commit
`11b3171af41bc466ed52c7bdb45548c59de7cbd6` was rerun with the candidate SHA
in `OPENFILM_QA_CANDIDATE_SHA`: the actual FFmpeg audition suite passed 14/14.
The following JSON records contain that SHA, original source hashes, output
filenames/hashes, before/after loudness and detailed meter/seam observations:

- [44.1 kHz reuse evidence](https://github.com/bynanci/open-film/blob/feat/silence-rendered-audition/docs/evidence/silence-audition/silence-audition-44100-reuse.json)
- [48 kHz trim/speed evidence](https://github.com/bynanci/open-film/blob/feat/silence-rendered-audition/docs/evidence/silence-audition/silence-audition-48000-trim-speed.json)

本機實際媒體證據合計約 7.2 MB，全部為合成 WAV／MP4；media binary 不提交到
repository，由 CI artifact 提供。上述 JSON 的輸出 hash 來自本機指定 FFmpeg 版本，
不代表不同 FFmpeg／編碼器版本的 MP4 必須逐位元相同；跨環境沿用既有 PCM 精度契約。
最終 PR head 的 CI 結果另於 PR 回報，不能將此本機 commit 的結果冒充新 head 的 CI。
