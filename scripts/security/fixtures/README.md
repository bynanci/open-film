# Observed scanner fixtures

`observed-0.22.2-actual-path-patched.stdout` and
`observed-0.22.2-registry-baseline.stdout` are unedited stdout bytes from actual
`cargo-audit 0.22.2` scans of the current main lock and its exact GLib path-patched
lock, using the same local RustSec database (1,422 advisories). Both use
`--no-fetch`, so database commit fields are null; the audit-capture receipt binds
the fresh clone commit separately. The path-patched scan exits 0 and omits GLib;
the registry baseline exits 1 with GLib `RUSTSEC-2024-0429`. Both retain the
unmaintained `proc-macro-error` notice.

`observed-0.22.2-historical.stdout` and
`observed-0.22.2-actual-before-tokio.stdout` are retained as negative parser cases
from the pre-Tokio patch state. They are not evidence for the current candidate.
These files are parser fixtures and never successful candidate evidence. Tests
derive synthetic fault/eligible inputs from the current same-DB observations.
