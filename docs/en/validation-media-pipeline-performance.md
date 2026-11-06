# Audio and video pipeline performance

Baseline: `origin/main` at `d332fb3265077ca08f218f6ba9b6c65d2519eaa2`. The measured change is limited to source decoder concurrency while building video preview proxies. Audio proxy decoding, canonical audio policy, mix planning, rendered export encoding, source verification, proxy limits and review/accept behavior are unchanged.

## Measurement environment and method

The runner used FFmpeg 7.1.5 on Debian 13, an AMD EPYC 9V45 host with a four-CPU cgroup quota and 32 GiB memory limit. Inputs were local synthetic files, not user media: 20-second 30 fps 4K H.264/AAC (600 frames, 161,135,919 bytes), 20-second 1080p H.264/AAC (41,653,234 bytes), and five-minute stereo 48 kHz FLAC (38,908,680 bytes). Proxy runs used the application’s 640×360 H.264 ultrafast CRF 28 plus source audio path. Each decoder/transcode profile had one warm-up and three measured runs. Repeated seek measurements used 18 shuffled timestamps, each in a new FFmpeg process; the reported latency includes process startup. Peak RSS is FFmpeg’s sampled `VmHWM` from `/proc/<pid>/status` at 5 ms intervals. These figures describe this runner, not a workstation guarantee.

The proxy comparison used the existing video proxy command with input decoder thread counts 1, 2, 4 and auto (`0`); scaling, filter threads, codecs, preset, CRF, audio, timestamps and output settings stayed fixed. The production change selects two input decoder threads for video proxy work. Audio proxy decoding remains at one thread.

## Results

| Workload                                    | Decoder threads | Median time |    Peak RSS | Output bytes | Finding                     |
| ------------------------------------------- | --------------: | ----------: | ----------: | -----------: | --------------------------- |
| 4K full video decode to null, 600 frames    |               1 |    3,731 ms |  92,448 KiB |            — | Baseline                    |
| 4K full video decode to null, 600 frames    |               2 |    2,068 ms | 120,116 KiB |            — | 44.6% faster; +27 MiB peak  |
| 1080p full video decode to null, 600 frames |               1 |      905 ms |  56,384 KiB |            — | Baseline                    |
| 1080p full video decode to null, 600 frames |               2 |      530 ms |  58,584 KiB |            — | 41.4% faster; +2.2 MiB peak |
| 4K source to video proxy                    |               1 |    4,308 ms | 136,376 KiB |    1,381,843 | Baseline                    |
| 4K source to video proxy                    |               2 |    3,211 ms | 227,100 KiB |    1,381,843 | 25.5% faster; +88 MiB peak  |
| 1080p source to video proxy                 |               1 |    1,056 ms |  72,388 KiB |    2,100,446 | Baseline                    |
| 1080p source to video proxy                 |               2 |      991 ms |  99,988 KiB |    2,100,446 | 6.2% faster; +27 MiB peak   |

An additional three-run call through the actual `createProxy` function measured a 4K median of 4,265 ms before and 3,286 ms after the thread change. Both outputs were 1,381,279 bytes with identical encoded-file SHA-256 `dc10357b852f0d96631587ce3109ecc49ebcf971bfa3897c9354a0498bc4b196`. Their decoded video frame-manifest hash was identical (`a28039c2cd06a1dae7684cc1225ad77bc86e4a46dad84497a8ff1cf2fcdb4db9`) and decoded audio PCM hash was identical (`1c9f9f40def89bd4079d10c96ae08989407a80dbba75daf21eaa428700cd308c`). The original file hash remained `c3b6af16df2bda57facc5115ac3cc190b0ad713e69f898069a1603d48136b55e` before and after. The proxy retained 640×360, 30 fps, 48 kHz audio and 20.01-second container duration.

| Accurate random seek workload                           | Median |    P95 |
| ------------------------------------------------------- | -----: | -----: |
| Original 4K source                                      | 270 ms | 612 ms |
| Existing 640×360 proxy, default 8.33-second maximum GOP |  59 ms |  72 ms |
| Proxy with forced 1-second GOP                          |  49 ms |  60 ms |

The one-second GOP increased this fixture’s proxy from 1,381,843 to 1,551,868 bytes (+12.3%) for a 10 ms median and 12 ms P95 reduction. I kept the existing GOP because this measured seek gain does not justify the larger managed cache. The existing proxy already cut this runner’s 4K seek median by 78% and P95 by 88%.

| Five-minute stereo FLAC workload     |                                                              Decoder threads 1 |     Decoder threads 2 |
| ------------------------------------ | -----------------------------------------------------------------------------: | --------------------: |
| Full audio decode median / peak RSS  |                                                            190 ms / 34,040 KiB |   170 ms / 34,140 KiB |
| 192 kbps MP3 proxy median / peak RSS |                                                          1,773 ms / 34,688 KiB | 1,781 ms / 34,780 KiB |
| MP3 size / SHA-256                   | 7,201,196 / `3c702114270f4b19512fe35d9baf66c21608478fb907d6ed7ffa8a8720803bf6` |             Identical |
| Accurate random seek median / P95    |                                                                     46 / 53 ms |            46 / 48 ms |

Audio proxy encoding did not benefit from a second decoder thread, and peak memory was already small. The audio path therefore stays unchanged.

## Decision and validation

Video proxy decoding now uses a bounded two-thread decoder. This captured most of the 4K proxy speedup seen with automatic threading while avoiding automatic thread-pool growth; the unchanged audio path remains single-threaded. The change does not touch the export renderer’s single-thread deterministic encode, audio mix graph, audio timing, source hash checks, file-size/quota enforcement, or stored proxy recipe. Exact proxy bytes and decoded audio/video were unchanged on the measured FFmpeg 7.1.5 fixture.

Focused FFmpeg proxy, HDR/SDR preview and proxy-cache application regressions, followed by lint, typecheck, format and build, are recorded with the commit that carries this profile. Full Vitest, Playwright, native builds, physical workstation profiling, GPU/4K export throughput and long-running memory soak are separate gates; this document does not claim they passed. The next useful profile is an actual 4K export on Windows and macOS, separating input decode, filter graph, output encode and peak memory under concurrent desktop activity.
