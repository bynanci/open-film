你是一名 Principal Software Engineer、Media Pipeline Architect、Video Editing Systems Engineer、Open-source Maintainer 與 Product Designer。

請自主設計並實作一個開源專案：

# OpenFilm

OpenFilm 是一套：

**Open-source、Local-first、Story-first、Non-destructive 的影片敘事與素材編排系統。**

它的目的不是取代：

- DaVinci Resolve
- Premiere Pro
- Final Cut Pro

而是處理這些專業剪輯工具通常做得不好的前置流程：

大量素材
→ Metadata Normalization
→ Timeline Reconstruction
→ Duplicate Detection
→ Event Clustering
→ Media Understanding
→ Story Planning
→ Asset Selection
→ Duration Optimization
→ Editable Rough Cut
→ NLE Export

核心概念：

```text
Media Library
    ↓
Understand
    ↓
Organize
    ↓
Tell a Story
    ↓
Compose Timeline
    ↓
Export
```

---

# 1. Project Vision

OpenFilm 不應該只是一個「AI 自動剪片 App」。

它應成為：

> An open media storytelling engine.

讓使用者可以把數年甚至數十年的：

- 手機照片
- 相機照片
- 手機影片
- Action Camera
- 360 Camera
- Drone
- GoPro
- Insta360
- DSLR / Mirrorless
- Audio
- 未來其他 Media Source

整理成具有：

- 時間結構
- 地點結構
- 人物結構
- Event
- Story
- Emotion
- Duration Constraint

的影片。

---

# 2. First Use Case

第一個官方 Template：

```text
Proposal Film
```

需求：

- 情侶歷年照片與影片
- 依時間順序
- 不是流水帳
- 有 Story Arc
- 五分鐘內
- 有重要回憶
- 有情緒曲線
- 可輸出到 Resolve / Premiere / Final Cut

但所有 architecture 必須保持 generic。

禁止在 Core Domain 寫死：

```text
proposal
girlfriend
relationship
wedding
```

這些只能存在：

```text
templates/proposal-film/
```

---

# 3. Future Use Cases

架構必須可以支援：

```text
Proposal Film
Wedding Film
Travel Film
Family Memory Film
Baby Growth Film
Annual Recap
Graduation Film
Memorial Film
Sports Highlight
Documentary
YouTube Story
Travel Journal
Event Recap
Personal Life Archive
```

甚至：

```text
Custom Story Template
```

---

# 4. Core Architecture Principle

將系統拆成：

```text
OpenFilm Core

Media
Metadata
Catalog
Timeline
Events
Story
Ranking
Duration
Composition
Export
Plugins
```

Application：

```text
Desktop App
CLI
Future Web UI
```

不允許 Core Domain 綁死 Vue、Tauri 或任何特定 UI。

---

# 5. Recommended Architecture

優先考慮 monorepo：

```text
open-film/

apps/
  desktop/
  cli/

packages/
  core/
  media/
  metadata/
  catalog/
  timeline/
  events/
  story/
  solver/
  analysis/
  render/
  exporters/
  plugin-sdk/
  ui/

plugins/

templates/

examples/

docs/

tests/
```

Desktop：

```text
Vue 3
TypeScript
Vite
Tauri
```

Core：

```text
TypeScript
```

Native Media Runtime：

```text
Rust / Tauri commands
FFmpeg
FFprobe
ExifTool
```

Storage：

```text
SQLite
```

---

# 6. Strict Dependency Direction

遵守：

```text
UI
 ↓
Application
 ↓
Domain
 ↓
Interfaces
```

Adapter：

```text
FFmpeg
ExifTool
SQLite
Filesystem
AI Models
Exporters
```

Core 不可以：

```text
import Vue
import Tauri UI
direct filesystem coupling everywhere
```

使用 Ports & Adapters / Hexagonal Architecture。

但不要過度 abstraction。

---

# 7. OpenFilm Project Format

建立公開、可版本化的 Project Format。

例如：

```text
*.openfilm
```

本質可以是一個 directory：

```text
my-film.openfilm/

project.json

database.sqlite

story/
timeline/
analysis/
cache/
```

原始素材不要複製進 project。

使用：

```text
MediaReference
```

引用。

例如：

```ts
interface MediaReference {
  id: string
  uri: string

  type:
    | 'file'
    | 'volume'
    | 'external'

  relativePath?: string

  contentHash?: string
}
```

---

# 8. Open Project Schema

建立 versioned schema：

```ts
interface OpenFilmProject {
  schemaVersion: string

  id: string
  title: string

  createdAt: string
  updatedAt: string

  mediaLibraries: MediaLibrary[]

  stories: Story[]

  timelines: Timeline[]

  settings: ProjectSettings
}
```

Migration 必須被考慮：

```text
schema v1
→ v2
→ v3
```

---

# 9. Generic MediaAsset

核心資料模型：

```ts
interface MediaAsset {
  id: string

  uri: string

  mediaType:
    | 'image'
    | 'video'
    | 'audio'
    | '360-video'

  source?: {
    device?: string
    manufacturer?: string
    application?: string
  }

  capturedAt?: string
  capturedAtConfidence?: number

  timezone?: string

  duration?: number

  dimensions?: {
    width: number
    height: number
  }

  codec?: string

  frameRate?: number

  colorSpace?: string

  hdr?: boolean

  gps?: {
    latitude: number
    longitude: number
  }

  contentHash?: string
  perceptualHash?: string

  tags: string[]

  rating?: number

  state: {
    favorite?: boolean
    rejected?: boolean
    locked?: boolean
  }
}
```

不要加入 Proposal-specific fields。

---

# 10. Extensible Metadata Model

Metadata 必須允許 plugin 加入額外資訊：

```ts
metadata: Record<string, unknown>
```

例如：

```text
openfilm.camera.insta360

openfilm.vision.faces

openfilm.audio.transcript

openfilm.geo.location

openfilm.story.emotion
```

使用 namespace 避免 collision。

---

# 11. Source Adapter Architecture

不同素材來源用：

```ts
interface MediaSourceAdapter {
  id: string

  supports(input: SourceInput): boolean

  scan(input: SourceInput): Promise<MediaCandidate[]>

  extractMetadata(
    candidate: MediaCandidate
  ): Promise<MediaMetadata>
}
```

官方 adapters：

```text
FilesystemSource
PixelSource
Insta360Source
GenericCameraSource
```

未來：

```text
Google Photos
iCloud Photos
NAS
S3
Dropbox
OneDrive
Immich
PhotoPrism
```

但 Core 不依賴它們。

---

# 12. Processing Pipeline

設計可擴展的 pipeline：

```text
Discover
↓
Inspect
↓
Normalize Metadata
↓
Fingerprint
↓
Thumbnail
↓
Proxy
↓
Analyze
↓
Index
```

每個 stage 都必須：

```text
restartable
observable
cancelable
idempotent where possible
```

不要因為某個檔案失敗而讓整批 Import 中止。

---

# 13. Metadata Time Resolution

提供：

```ts
interface TimestampResolver
```

預設 precedence：

```text
EXIF DateTimeOriginal
QuickTime creation_time
camera metadata
sidecar metadata
filesystem mtime
```

產出：

```ts
{
  timestamp,
  source,
  confidence
}
```

而不是只回 timestamp。

---

# 14. Duplicate Engine

抽象成：

```ts
interface SimilarityProvider
```

支援：

```text
exact hash
perceptual hash
video fingerprint
embedding similarity
```

形成：

```text
SimilarityGroup
```

不要寫死照片連拍。

---

# 15. Event Engine

Event 是 Core Domain。

```ts
interface Event {
  id: string

  startAt?: string
  endAt?: string

  location?: GeoRegion

  assetIds: string[]

  labels: string[]

  confidence?: number
}
```

Default clustering：

```text
time distance
location distance
media similarity
```

未來 plugin 可加入不同演算法。

---

# 16. Story Engine

OpenFilm 最重要的 abstraction：

```ts
interface Story {
  id: string

  title: string

  template?: string

  targetDuration?: number

  maxDuration?: number

  beats: StoryBeat[]
}
```

StoryBeat：

```ts
interface StoryBeat {
  id: string

  title: string

  intent?: string

  targetDuration?: number

  constraints?: StoryConstraint[]

  candidateAssetIds?: string[]

  selectedAssetIds?: string[]
}
```

---

# 17. Story Template

建立：

```ts
interface StoryTemplate {
  id: string

  name: string

  description: string

  create(config): Story
}
```

例如：

```text
proposal-film
travel-film
annual-recap
family-memory
sports-highlight
blank
```

---

# 18. Template 必須可以外掛

例如：

```text
templates/
  proposal-film/
    manifest.json
    story.ts
    scoring.ts

  travel-film/
    manifest.json
    story.ts
```

讓 Community 能自己建立：

```text
OpenFilm Story Templates
```

而不用 fork Core。

---

# 19. Proposal Template

官方第一個 template：

```text
@openfilm/template-proposal
```

可提供：

```text
Cold Open
Beginning
Ordinary Days
Adventure
Growing Together
Why You
Future
Build-up
Ending
```

例如：

```text
0:00–0:12 Cold Open
0:12–0:45 Beginning
0:45–1:30 Ordinary Days
1:30–2:25 Adventures
2:25–3:15 Growing Together
3:15–4:05 Why You
4:05–4:40 Future
4:40–4:55 Build-up
4:55–5:00 End
```

但這只能存在 template package。

---

# 20. Scoring Engine

抽象：

```ts
interface AssetScorer {
  score(
    asset: MediaAsset,
    context: StoryContext
  ): Promise<ScoreResult>
}
```

ScoreResult：

```ts
interface ScoreResult {
  score: number

  factors: {
    id: string
    score: number
    reason?: string
  }[]
}
```

所有 AI Ranking 都必須 explainable。

---

# 21. Default Scoring Providers

可以提供：

```text
Technical Quality
Uniqueness
Visual Diversity
Chronological Importance
Event Importance
Face Presence
Emotion
Audio Quality
Speech Relevance
User Rating
```

模板可以重新配置權重。

---

# 22. Constraint Solver

建立 generic：

```text
CompositionSolver
```

輸入：

```text
Story
Assets
Scores
Constraints
```

輸出：

```text
CompositionPlan
```

Constraints 可以包括：

```text
max duration
target duration
must include
must exclude
locked
minimum beat duration
maximum beat duration
chronological preference
asset repetition
event coverage
person coverage
media type balance
```

---

# 23. Duration Is Generic

不要寫死：

```text
300 seconds
```

Core：

```ts
story.maxDuration
```

Proposal Template：

```text
target = 270
max = 300
```

Travel Film：

```text
target = 480
max = 600
```

YouTube：

可能沒有 max。

---

# 24. Composition Model

產生：

```ts
interface Composition {
  id: string

  storyId: string

  duration: number

  tracks: Track[]
}
```

Track：

```text
video
audio
music
titles
overlay
```

Clip：

```ts
interface Clip {
  id: string

  assetId: string

  sourceIn?: number
  sourceOut?: number

  timelineStart: number
  timelineDuration: number

  transform?: ClipTransform
}
```

這將成為 OpenFilm 與 NLE 之間的重要 abstraction。

---

# 25. Non-destructive Editing

任何：

```text
Trim
Crop
Reframe
Speed
Volume
Order
Story placement
Color metadata
```

只存 operation。

不得修改 source。

---

# 26. Plugin System

這是 OpenFilm 成為真正 Open-source Platform 的核心。

建立：

```text
@openfilm/plugin-sdk
```

Plugin types：

```text
source
metadata
analysis
story-template
scorer
solver
effect
exporter
renderer
ui-extension
```

---

# 27. Plugin Manifest

例如：

```json
{
  "id": "openfilm.insta360",
  "name": "Insta360 Adapter",
  "version": "0.1.0",
  "apiVersion": "1",
  "capabilities": [
    "source",
    "metadata"
  ]
}
```

---

# 28. AI Provider Architecture

不要把系統綁死 OpenAI 或任何模型。

建立：

```ts
interface VisionProvider

interface EmbeddingProvider

interface TranscriptionProvider

interface LanguageProvider
```

Providers：

```text
Local
OpenAI
Ollama
Whisper.cpp
ONNX
future providers
```

使用者自己選。

---

# 29. Local-first

預設：

```text
No cloud required.
```

Basic workflow 必須完全 offline：

```text
Import
Metadata
Timeline
Duplicates
Events
Story
Composition
Preview
Export
```

AI 是 enhancement，不是 prerequisite。

---

# 30. Privacy

不得偷偷上傳：

```text
images
videos
faces
transcripts
GPS
metadata
```

任何 remote provider 都必須：

```text
explicit opt-in
```

UI 清楚標示。

---

# 31. Preview Renderer

提供：

```text
FFmpegRenderer
```

把 Composition 轉成：

```text
preview.mp4
```

先支援：

```text
image
video
simple audio
simple title
crossfade
basic transforms
```

不要第一版重造完整 GPU compositor。

---

# 32. Exporter Architecture

```ts
interface TimelineExporter {
  id: string

  export(
    composition: Composition
  ): Promise<ExportResult>
}
```

官方支援：

```text
OpenTimelineIO
FCPXML
EDL where applicable
JSON
```

後續：

```text
Premiere
Resolve
Final Cut
Blender
Kdenlive
Shotcut
```

---

# 33. OpenTimelineIO

優先研究並支援 OTIO。

OpenFilm Composition：

```text
↓
OTIO
↓
NLE
```

這會是 interoperability 的重要基礎。

---

# 34. Desktop UX

OpenFilm Desktop 不應像企業 SaaS Dashboard。

Information Architecture：

```text
Library
Stories
Timeline
Export
```

Library：

```text
All Media
Events
People
Places
Duplicates
Favorites
Rejected
```

Stories：

```text
Story Templates
Story Beats
Candidates
Selections
```

Timeline：

```text
Composition
```

---

# 35. UI Philosophy

方向：

```text
Apple Photos
Lightroom Library
modern film organizer
story editor
```

而不是：

```text
Premiere Clone
Dashboard
spreadsheet
```

Content-first。

---

# 36. CLI

Open-source developer workflow 需要：

```bash
openfilm create
openfilm import ./photos
openfilm analyze
openfilm story generate
openfilm compose
openfilm render
openfilm export
```

例如：

```bash
openfilm story generate \
  --template proposal-film \
  --target 270 \
  --max 300
```

---

# 37. Headless Core

所有核心流程應可：

```text
UI
CLI
Automation
Script
```

共用。

Desktop 不應是唯一使用方式。

---

# 38. API / SDK

未來 Community 可以：

```ts
import {
  OpenFilmProject,
  createStory,
  compose
} from '@openfilm/core'
```

把 OpenFilm 當 Library 使用。

---

# 39. Open-source Strategy

專案從一開始就當公開 Repository 維護。

至少建立：

```text
README.md
LICENSE
CONTRIBUTING.md
CODE_OF_CONDUCT.md
SECURITY.md
CHANGELOG.md
ROADMAP.md
```

---

# 40. License

研究：

```text
MIT
Apache-2.0
```

優先選擇適合：

- 商用
- Fork
- Plugin ecosystem
- Community contribution

的 permissive license。

在沒有特殊法律需求的情況下優先考慮：

```text
Apache-2.0
```

因為包含明確 patent grant。

將 license 決策記錄於 ADR。

---

# 41. Repository Quality

建立：

```text
.github/
  ISSUE_TEMPLATE/
  PULL_REQUEST_TEMPLATE.md
  workflows/
```

CI 至少：

```text
lint
typecheck
unit test
integration test
build
```

---

# 42. ADR

重要 architecture decisions 寫：

```text
docs/adr/
```

例如：

```text
001-monorepo.md
002-tauri.md
003-project-format.md
004-plugin-system.md
005-local-first.md
006-otio.md
```

---

# 43. Sample Dataset

不要把私人照片提交 repository。

建立：

```text
fixtures/sample-media/
```

使用：

- CC0
- generated media
- test assets

確保 CI 可重現。

---

# 44. First Milestone

Milestone：

```text
OpenFilm v0.1
```

目標：

```text
Folder
↓
Import
↓
Metadata
↓
Timeline
↓
Duplicate detection
↓
Event grouping
↓
Manual rating
↓
Story Template
↓
Composition
↓
Preview MP4
```

---

# 45. v0.1 Definition of Done

至少：

- 建立 OpenFilm project
- Import image/video
- originals immutable
- SQLite persistence
- metadata extraction
- capturedAt resolution
- thumbnails
- proxy video
- exact duplicate
- basic perceptual duplicate
- chronological library
- basic event clustering
- favorite
- rejected
- locked
- Story Template API
- Proposal template
- generic Story Engine
- generic duration constraints
- Composition generation
- Preview MP4
- reopen project
- tests
- documentation

---

# 46. Do Not Implement Yet

第一階段不要把時間浪費在：

```text
professional color grading
complex transitions
GPU effects engine
3D
full NLE timeline
cloud collaboration
social network
asset marketplace
mobile editor
```

保持：

```text
Story Engine
Media Organization
Composition
Interoperability
```

優先。

---

# 47. Engineering Quality

使用：

```text
TypeScript strict
ESLint
Prettier
Vitest
Playwright
```

Rust：

```text
cargo fmt
cargo clippy
cargo test
```

Domain 需有 unit test。

---

# 48. Testing

Unit：

```text
timestamp resolver
duplicate scoring
event clustering
story scoring
constraint solver
composition duration
project migrations
```

Integration：

```text
media import
ffprobe
thumbnail
proxy
SQLite
preview render
```

E2E：

```text
Create project
Import sample media
Create Proposal Story
Generate Composition
Verify duration <= max
Render Preview
Reload Project
```

---

# 49. Performance

設計假設：

```text
10,000–100,000 assets
100 GB–10 TB library
```

不可：

```text
load entire library into memory
decode all media eagerly
block UI during analysis
```

使用：

```text
lazy loading
pagination
background workers
job queue
incremental indexing
```

---

# 50. Job System

建立 generic Job abstraction：

```ts
interface Job {
  id: string
  type: string
  status:
    | 'queued'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled'

  progress?: number
}
```

Jobs：

```text
Import
Thumbnail
Proxy
Analysis
Render
Export
```

---

# 51. Observability

提供：

```text
structured logs
job logs
debug mode
```

Error 必須可以知道：

```text
哪個檔案
哪個 stage
哪個 adapter
哪個 command
```

不要只顯示：

```text
Something went wrong
```

---

# 52. Work Execution Rules

這是一個實作任務，不是研究報告。

請：

```text
Inspect
Plan
Implement
Test
Verify
Fix
Document
Continue
```

如果 workspace 沒有 repo：

建立：

```text
open-film
```

如果已有 repository：

先理解現有 architecture 再修改。

---

# 53. Autonomous Execution

不要每完成一個小步驟就停下來。

合理技術決策：

自己做。

把 assumptions 寫在：

```text
docs/
```

只有遇到：

- credential
- paid service
- destructive operation
- irreversible architectural conflict
- 權限問題

才視為 blocker。

---

# 54. Keep Project State

建立：

```text
TASKS.md
ROADMAP.md
```

TASKS：

```text
## P0 Foundation

- [x] Monorepo
- [x] Core media model
- [ ] Import pipeline
- [ ] Metadata resolver

## P1 Library

...
```

完成後立即更新。

---

# 55. Product North Star

OpenFilm 的成功標準不是：

> AI 可以產出影片。

而是：

> 使用者能掌握自己的媒體資料、自己的故事，以及自己的最終剪輯。

OpenFilm 必須提供：

```text
Open Media Model
Open Story Model
Open Project Format
Open Plugin API
Open Export Format
```

避免：

```text
vendor lock-in
cloud lock-in
AI provider lock-in
NLE lock-in
```

---

# 56. Long-term Vision

最終希望形成：

```text
             OpenFilm

        ┌──── Media ────┐
        │               │
Sources → Library → Story
        │             │
        │             ↓
        │        Composition
        │             │
        └─────────────┤
                      ↓

              OpenTimelineIO

          ┌───────────┼───────────┐
          ↓           ↓           ↓

       Resolve     Premiere     Final Cut
```

Community 可以開發：

```text
Source Plugins
Analysis Plugins
Story Templates
AI Providers
Exporters
Effects
```

OpenFilm Core 維持：

```text
small
stable
portable
testable
documented
```

---

# 57. First Execution

現在開始。

第一輪直接完成：

1. Inspect workspace
2. 建立或確認 `open-film` repository
3. 建立 monorepo
4. 建立 packages/core
5. 建立 MediaAsset / Project / Story / Composition Domain Model
6. 定義 Project Schema Versioning
7. 建立 Source Adapter interface
8. 建立 Analysis Provider interface
9. 建立 Story Template interface
10. 建立 Exporter interface
11. 建立 Plugin Manifest
12. 建立 Desktop skeleton
13. 建立 CLI skeleton
14. 加入 tests
15. 建立 CI
16. 建立 README
17. 建立 Apache-2.0 License 或完成 License ADR
18. 建立 ROADMAP.md
19. 建立 TASKS.md
20. 執行 lint / typecheck / tests / build
21. 修正所有可處理錯誤
22. 繼續實作最高順位 P0 Media Foundation

不要只輸出 architecture proposal。

實際建立 project、code、tests 與 documentation。

除非真正遇到 blocker，否則持續推進。
