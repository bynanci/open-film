# Published GraphicScene schema validation — 2026-10-20

Reviewed base: `a48f3e911fe10db7045dfd45fb4a2d42a3012e66`.
Review discussion: `4328164582`, PR #41.

The published schema previously admitted `graphicScenes: [{}]` and malformed
scene trees that `validateGraphicScenes` rejects. The optional PhotoDepth item
description did not define the required base scene or any primitive tree.

The fix adds complete version-1 scene and Image/Text/Shape/Group node definitions,
strict primitive-specific field names, bounded literal strings, geometry,
optional layer state, and explicit enter/from and exit/to animation data.
The collection admits eight scenes and each node list admits 64 entries. Local
references enforce four nesting levels while preserving an empty group at the
maximum depth. PhotoDepth retains its existing mode/receipt/camera contract and
uses the same path-free catalog identifier definition as base graphics.
Schema `$id`, project schema `1.0.0`, runtime admission and legacy projects
without graphics remain unchanged. No package or lockfile changes are needed.

The portable regression suite uses the existing locked ESLint Ajv validator for
the shared draft-07/2020-12 keyword subset. It removes only the meta-schema
declaration from a detached test copy. Independent Python
`jsonschema.Draft202012Validator` checks the unchanged published 2020-12 document,
including its meta-schema, with remote retrieval disabled.

The same corpus contains 113 JSON documents: legacy/empty graphics, the existing
shape fixture, all four primitives, multilingual text, optional state, nested
groups, explicit animations, boundary list sizes, PhotoDepth source/asset
backgrounds and all four fallback reasons, plus malformed and unsafe variants.
Both validators expose 84 schema/core mismatches on the unchanged baseline and
zero after the fix. The 128-test suite also checks 14 authoritative runtime
semantic rejection controls and stable schema/local-reference identities.

Cross-field interval comparisons, ID uniqueness, total node/text and pixel
budgets, and PhotoDepth node/source/duration/region bindings still require core
admission. JSON Schema measures Unicode characters while core additionally
bounds UTF-16 code units. The schema does not claim to inspect catalog assets,
local files, image alpha or rendering feasibility. Call `validateProject` and
the existing media admission before using a saved scene.

Evidence is retained in `/tmp/openfilm-v1-validation/pr41-schema-*` and the
candidate-bound `pr41-schema-report.json`. The focused compatibility and static
checks are recorded there; combined release gates remain with the coordinator.
