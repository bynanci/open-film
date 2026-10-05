# Resolve preparation fixture and parser gate

`verify.py` uses official OpenTimelineIO 0.18.1 and FFprobe. Invoke it through
`scripts/verify-interchange.ts`, which generates procedural CC0 sources and three
OTIO cases, runs official read/write/read, checks actual file URLs/hashes/bounds,
and proves that a missing source fails verification. No DaVinci Resolve process
is available or simulated.

```sh
OPENFILM_OTIO_PYTHON=/path/to/otio-venv/bin/python pnpm test:interchange --output /path/to/empty/bundle
```

The output contains cut-only, metadata-only advanced-edit and fractional-rate
cases with expected manifests and reports. Advanced effects require manual
recreation; the slow-motion case deliberately exposes a labeled padding gap.
The retained sources are real decodable synthetic PNG/MP4/WAV files. Original
source hashes remain unchanged after the gate.

See [NLE compatibility and manual QA](../../../docs/nle-compatibility.md) before
using these files as a Resolve import checklist. Passing this script establishes
parser and source-reference evidence, not an actual Resolve import result.
