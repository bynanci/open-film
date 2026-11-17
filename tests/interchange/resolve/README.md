# Resolve preparation fixture and parser gate

**[繁體中文](README.zh-TW.md) · [English](README.md) · [日本語](README.ja.md)**

`verify.py` uses official OpenTimelineIO 0.18.1, FFprobe, and FFmpeg. Invoke it
through `scripts/verify-interchange.ts`, which generates procedural CC0 sources
and five OTIO cases, runs official read/write/read, checks actual file
URLs/hashes/bounds, and proves that a missing source fails verification. It also
decodes synthetic sources and actual Renderer MP4/full mix WAV exports to check
audio/video synchronization. No DaVinci Resolve process is available or simulated.

```sh
OPENFILM_OTIO_PYTHON=/path/to/otio-venv/bin/python pnpm test:interchange --output /path/to/empty/bundle
```

The output contains cut-only, metadata-only advanced-edit and fractional-rate
cases with expected manifests and reports. Advanced effects require manual
recreation; the slow-motion case deliberately exposes a labeled padding gap.
The retained sources are real decodable synthetic PNG/MP4/WAV files. Original
source hashes remain unchanged after the gate.

Two additional sync cases use synchronized video-only MP4 and stereo 48 kHz PCM
WAV sources: one white source frame at frame 30 and a 50 ms, 1 kHz tone beginning
at the same time. Each source/output is 160×90 and 120 frames (4 or 4.004 seconds).
The existing Composition, OTIO exporter, shared rational clock, canonical audio
sample timing, and FFmpegRenderer produce the trimmed and placed results.

| Case              | Rate       | Source marker sample | Trim in / placement frames | Record flash frame | Record tone sample |
| ----------------- | ---------- | -------------------- | -------------------------- | ------------------ | ------------------ |
| `sync-30`         | 30/1       | 48000                | 12 / 24                    | 42                 | 67200              |
| `sync-fractional` | 30000/1001 | 48048                | 10 / 15                    | 35                 | 56056              |

The Python oracle declares these expectations independently of generated metadata
and verifies both official OTIO reads, every decoded source/output video frame,
the complete stereo PCM mix, exact marker onset/end, and full PCM sample count.
For all 120 source/output video frames, a bounded FFprobe read checks integer
presentation timestamps against exact rational frame times, with stream start
PTS zero and exact duration. AAC stream metadata separately requires start PTS
zero, a 1/48000 timebase, and exactly 192000 or 192192 presentation samples;
decoded AAC padding is measured separately from this exact stream duration.
Fractional-rate endpoints use absolute rational positions, with integral sample
endpoints; rounding each 1601.6-sample frame would drift. `sync-evidence.json`
records actual timestamps, stream clocks, and decoded observations. PCM and visual assertions have zero sample/frame
uncertainty. MP4 AAC is observed separately with a declared ±1024-sample onset/end
allowance: one AAC LC transform frame permits lossy pre-echo/ringing around the
0.01-amplitude detection threshold. This codec allowance never applies to PCM,
video presentation timestamps, or AAC stream timing metadata.

See [NLE compatibility and manual QA](../../../docs/nle-compatibility.md) before
using these files as a Resolve import checklist. Passing this script establishes
parser, source-reference, and synthetic renderer sync evidence. Actual Resolve
import and playback remain unverified.
