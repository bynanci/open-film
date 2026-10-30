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
