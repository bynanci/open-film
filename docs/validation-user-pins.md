# User Pin finishing integration validation

## 2026-10-30 — candidate integration and bounded local evidence

Branch: `codex/v1-user-pinned`. Author Tasks1–8 clean checkpoint:
`1f36a545a6271d60f4608cc5f6d0fc3f5ba7e4d2`. Merge checkpoint `429a026`
consumes reviewed finishing/render-QA parent `4723035`. Compatible variant
absence fix `7804aa1` is carried as `58d5df1`. Subsequent source identities and
current implementation/artifact byte hashes are retained in the private receipt;
these entries do not replace first whole-branch review or complete hosted gates.

### Scope and policy

Pins remain inline version1 state on Clip/GraphicScene. Default projects remain
schema1.0; the first pin-state write promotes only1.0→1.1 in the existing saved
transaction. Clearing/Undo does not downgrade, and promotion retains a newer
validated header. No schema1.2 dispatcher, alternate pin map, database migration,
second timeline, client origin authority or new Fit acceptance API is introduced.
Existing source/clip/node locks, required media and selections retain their owners.

The merged code preserves focal commitTransaction's fourth options argument and
its captured-revision comparison after queue flush. Solver edits use the separate
fourth TimelineEditContext with authoritative timebase/server-owned origin.
Current full photo/title/color/local-preset payloads and authored absence remain
protected against automatic edits. Untouched pinned clips also compare the shared
resolved primary coefficient matrix and Film Look matrix, including local Look2.
A direct named clip correction/title/Look remains an explicit authored edit.

Statistical reviewed Apply and D8 reviewed preset acceptance are automatic. A
pinned Auto Match target cannot Apply until explicitly released and measured
again. Automatic preset application that changes protected payload or inherited
Look requires explicit release. Exact acknowledged retries return the saved
receipt/current cut without overwriting later pins. Preset snapshots, provenance,
source guards, immutable source bytes and the existing publication CAS remain
with their actual owners.

Current re-solve preserves authored beat boundaries and occupied-gap partitions.
Some otherwise feasible whole-film redistributions can therefore return capacity
conflicts. The bounded search does not prove global infeasibility. Explicit
selected Fit commands remain the existing manual ingress and can add pins to
newly edited targets. Pins attach to the final acknowledged direct batch.

### Tests-first corrections and retained failures

Four primary integration regressions first failed, then passed: film/beat inherited
primary changes, rounded effective equivalence/automatic candidate substitution,
and a real-FFmpeg pinned Auto Match target/release/manual-control journey.
Two variant seams were reproduced before correction: inherited beat primary
settings retained old beat IDs, and preset-plan target bindings retained old beat
IDs. Both now map derived target identities while retaining source story/plan/
source-beat identities, sourceGuard hashes, snapshot data and detached full pins.

The schema's actual supported-shape fixture initially failed. Its versioned
structural definitions now include ambient/Bezier2, bilingual/finishing, primary,
local Look2 with fixed20-value alpha-preserving matrix tuples, typed immutable
snapshots/license/provenance, captions and preset receipts/plan bindings. New
source-URI/markup/preset-font-path negatives first failed, then passed. Runtime
validation still enforces cross-field references, text boundaries, source clocks,
encoded byte budgets and integrity hashes. The existing Ajv6 tooling test adapts
only 2020 fixed-tuple syntax to its equivalent draft7 syntax; an independent
existing Python jsonschema validator tests the unchanged public 2020-12 document.
No dependency changed. One initial fixture helper-argument/type-narrowing error
was corrected; its failed logs remain.

Six inherited preset CAS tests initially stopped at the newly valid pin boundary:
their preparatory direct title edit now creates a pin. Their same preparatory
batch now explicitly releases it last, retaining one prior history step and every
original CAS/project/disk/source/Undo assertion. All six then pass and still
exercise lock/hash/metadata changes inside the publication transaction. No pin
policy bypass or assertion weakening was added.

### Observed local checks

| Selection                                                             | Observed result                                                                                                                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Core/solver/pin/schema initial focused batch                          | 7 actual files /155 tests passed; two nonexistent file filters selected no file and are omitted from final inventories.                                                        |
| Actual finishing schema current cases                                 | 35 tests passed; 34 exported concrete valid/invalid fixtures also pass the unchanged official Draft2020-12 document.                                                           |
| Pipeline/adoption/preset Story/automatic direction and graphic agents | 7 files /166 tests passed in127.54s, using application port0 where needed.                                                                                                     |
| Actual TimelineClip host and Pin/UI/focal adapter selection           | 5 files /105 tests passed in41.83s, including the real host's existing55 cases.                                                                                                |
| Complete application/Named/Collect initial run                        | 10 files passed and6 inherited CAS fixture cases failed;131 passing assertions. Corrected CAS six-case rerun passes; final combined rerun is recorded at the later checkpoint. |
| Actual pinned MP4 original and finishing cases                        | 2 cases passed in4.99s; realFFmpeg frames/PCM/source controls below.                                                                                                           |
| Intermediate browser                                                  | Existing Pin journey1/1 passed in11.6s; dirty candidate58d5df1 plus tracked diffSHA256 e5194cae7c624f55c7483827ca678504ab204c89623264359f57a2c37db9f918.                       |

The intermediate browser exercised direct trim→saved pin→neighbor regeneration→
exact anchor→reopen→release→Undo with original-byte checks. It is explicitly an
intermediate dirty-source observation, not a final clean-head gate. Its actual
changed-file hashes are retained separately. Both shared ports were confirmed
closed and the exclusive lease released afterward.

### Actual synthetic MP4 evidence

The existing actual MP4 pin/neighbor-solve case is retained, with a separate case
using direct nonidentity primary correction, an actual local Film Look2 snapshot,
bilingual title runs and title finishing. The authored reference and automatically
re-solved pinned output retain16 decoded edited frames and identical PCM hashes.
The original source SHA-256 is unchanged. A wrong-transform control differs in
video and PCM; an omitted-color control differs in decoded picture while PCM is
unchanged. No pixel/audio threshold or existing assertion was widened.

Fresh source/reference/protected/control MP4s and decoded signatures are retained
under `/tmp/openfilm-finishing-integration/Pin-current/actual-media/`. All fixtures
are synthetic. Existing Collect tests also verify a pinned mixed-use source is
copied once as the entire original,160 decoded source frames/PCM and source hashes
match after ZIP relocation/reopen, and pinned derivative clock remapping fails.
Actual Named Version tests exercise authentic hash-pinned SQLite v5 snapshots,
current v6 snapshots, immutable old payloads and explicit1.0/1.1 pin restoration.

First whole-branch review, final reviewed parent recovery integrations and complete
exact-head hosted gates remain coordinator-owned. No full suite, native benchmark,
hosted OS result, physical presentation/NLE claim or merge readiness is inferred.

## 2026-10-30 — clean integration proof and reviewed dependency recovery

At clean `0e7ff67750a40d8f7276dfd6263c428c38091dc8`, the corrected combined
selection passes all24 actual files /410 tests in50.60s, with every assertion
passed and zero skipped/todo in the actual JSON report. This includes full
primary review, preset catalog-CAS, Pin policy/placement, core contracts, actual
Named Version SQLite v5/v6/1.1 restore, creative variants and Collect suites.
The existing55-case TimelineClip host also passes within its separate5-file/
105-test run. Existing pipeline/automatic writers pass7files/166tests. The new
schema passes35tests and34 concrete fixtures against the unchanged official
Draft2020-12 schema. Types, scoped lint, full formatting,2905 localization keys
and135 English documentation mirrors pass. No failed checkpoint is rewritten.

Merge `eeb0419` then consumes reviewed D7 `a9995f1`, including C `df60370` and
its separately reviewed cleanup privacy/UI corrections. Cleanup failures now
expose only a stable typed503/path-free error; actual HTTP media and edit routes
retain the real EACCES negative controls. The append-only test conflict retains
both that HTTP regression and the new pinned Auto Match journey. The real
TimelineClip host is byte-identical to the reviewed incoming host, with primary
source-color and local-presets bindings each present exactly once. Pin context,
schema floor, primary automatic-origin guard, whole payload/scene policy and
variant/source provenance corrections remain intact.

The final integrated candidate's local checks and fresh actual source/artifact
receipt are retained separately under
`/tmp/openfilm-finishing-integration/Pin-final/`. The preceding clean checkpoint
receipt remains `Pin-checkpoint/` (source261/artifacts43, receiptSHA256
`00573af0366a5200638410b2d7fd64da6339de63f7969835c6b84611db16854c`).
Intermediate browser/failed fixtures retain their own identities. First whole
review and complete exact-head hosted gates remain pending with the coordinator;
this entry does not mark the feature merge-ready or claim hosted OS evidence.

## 2026-10-30 — first whole-review correction wave

The completed first whole-feature review at `87bd92d` reproduced one P1 and two
P2 findings. This coordinated wave keeps measured AudioQuality acceptance
automatic, retains mutable same-ID replacement/shortening proposals, and stages
legacy ripple overlay reconciliation until the complete anchored cut is known.
The existing explicit Fit ingress remains the manual exception. Ordinary manual
volume edits remain available under their actual clip/source locks.

A real FFmpeg AudioQuality report now exposes pinned or locked ineligibility with
a localized reason and disables the existing panel's Apply action. Pinned
acceptance returns `timeline.pinConflict`/409. A separate explicit release and
fresh measurement allow automatic acceptance without re-pinning. Reviewed audio
requires a single-command transaction, so direct volume, trim, pin/release, lock,
or other-target commands cannot change its authority in a mixed batch. Original
source/settings/revision checks, request retry, saved-project CAS, Undo/Redo and
reopen remain covered with real measured evidence and unchanged source hashes.

Retained clip IDs preserve candidate source/range/duration and finishing edits;
actual source/clip/required-selection protection retains its previous payload.
Pinned anchors keep their exact owner payload and clock range. Tail graphics,
captions and locked audio are checked against final constrained placement rather
than a temporary shortened ripple. Genuine final overflow still rejects
atomically. At that constrained boundary it returns `timeline.pinConflict`/409,
replacing the obsolete early raw graphic-range error; ordinary unpinned graphic
and caption validation remains active.

An additional reproduced integration case from the audio owner found no-op
variants materializing absent `sourceOut`. The bounded constructor correction
retains optional source/beat key presence in both candidate and canonical
documents. Full payload comparison stays exact, including ambient/Bezier,
bilingual/finishing, inherited primary/Look, preset bindings and provenance.
Film and section variants, reopening and detached ownership are exercised.

Tests first reproduced the review findings and optional-key case. The complete
original implementation with the new regression selection produces 22 failures
and 57 passes; the variant absence case separately produces three failures and
21 passes. One initial paired-photo fixture omitted its required layout version;
that fixture error and the corrected RED evidence are retained. Expanded legacy
GraphicScene/quality fixtures retain all content, ownership, source, interpolation,
duck/fade, history and reopen assertions while expecting exact new pin metadata.
Automatic-agent setup releases its target explicitly. Ordinary unpinned audio
truncation setup releases the soundtrack last in its authored batch, paired with
an exact typed pinned rejection and unchanged whole-project/disk/history control.

Actual synthetic eight-second anchored trim retains the saved tail graphic,
caption and locked audio and matches an independently constructed reference:
160 decoded frames, identical picture SHA-256
`382e3a3c526d866d5d680da0ebdf05c3a6a441863353f694416a6622545c5562`
and PCM SHA-256
`5bdac3b8c714c1ab3bae492ac198c1dfd49d2de2f71f7f7dca2090aa3217ae7e`.
Source SHA-256 remains
`1962b344a4a598e4f9c0a03014a40c5143233b6365834c0af41dc147c8775146`.
The earlier 16-frame pinned finishing and combined-photo controls remain intact.

Final focused selection passes all54 files /1,022 tests in209.51s, with every
actual assertion passed and none skipped, pending or todo. This includes all
original33 files (now555 tests), plus measured audio/panel/HTTP, saved graphic and
caption editors, rational clock, ordinary quality/Look controls and automatic
pipeline/adoption/direction writers. Separate exporter compatibility passes
4files /49 tests. Actual primary-review24, preset16, Named Version18 (authentic
SQLite v5/current v6 restoration), variant24 and Collect20 cases all execute.
Current TypeScript/Vue, full ESLint, full Prettier,2,909 semantic locale keys and
135 English documentation mirrors pass. The first expanded run's eight fixture
failures and subsequent exact fixture corrections remain in the evidence.

Correction-wave logs, actual JSON reports, fresh synthetic media and current byte
hashes are retained separately under `/tmp/openfilm-pin-review-fix/`; previous
receipts and failed stages are not relabeled. No full Vitest, browser, native
benchmark, hosted OS, physical hardware or foreign-NLE result is claimed for this
wave. One fresh scoped correction review and complete exact-head hosted gates
remain coordinator-owned; this does not mark the feature merge-ready.

## Automatic producer authority correction (2026-10-30)

The later full audio integration reproduced MotionGeneration import failures:
its expected automatic document differed from the direct-edit writer's newly
added pins. GraphicScene agent acceptance entered the same incorrect ingress.
Both producers now use a package-internal Symbol capability into the existing
parser, serialized queue, current-revision checks, complete protection policy,
atomic save and single history writer. The public edit API remains direct.
There is no client/provider origin field or additional timeline store.

Motion import, prepared retry and restore preserve absent or explicitly released
pin metadata. GraphicScene acceptance rejects pinned scenes with
`timeline.pinConflict`/409 before publication. Request fingerprints include the
producer authority, so identical payloads cannot reuse a request ID between
automatic and direct editing in either order. HTTP origin injection rejects400.
Real writer/CAS failures preserve the complete editor/project/disk state and
create no history; retry and Undo/Redo/reopen coverage retain all original source,
rendered-frame, duration, rollback and cleanup assertions.

The same integration exposed an existing typed color-lock error being shadowed
by the new generic direct-edit precheck. Look and primary-color commands retain
their authoritative clip, primary-source, paired-source and inherited-scope
validators with typed409/count errors. Tests first reproduce13 failures among84
lock cases, then pass all84. The separate producer regression starts with19
failures among51 tests; Motion44 and GraphicScene12 tests subsequently pass.
The final20-file selection passes296 tests with none skipped or pending. Its
preceding run's295 passes and one obsolete `/locked/` substring failure remain
recorded; that assertion now requires the exact primary-color409 code/count plus
unchanged whole editor/disk state. A compiler failure in two incomplete test
ProjectSettings fixtures is retained; supplying explicit frame dimensions fixes
it without changing runtime code. TypeScript/Vue, full ESLint, full Prettier,
2,909 semantic locale keys and135 English documentation mirrors pass.

This checkpoint does not close the separately observed hosted browser
operation-specific source-lock regression, full exact-head CI, scoped review or
workstation gates. Its logs and byte-bound correction package are retained under
the ignored User Pin integration evidence directory; no full-suite, hosted or
physical-hardware pass is claimed for this correction checkpoint.
