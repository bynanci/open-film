# Global product experience and internationalization

The user-approved product brief is the implementation direction: a first-time
user should create a rough-cut film without learning interchange formats or the
media toolchain. The entry flow is Create Film → Add Media → Organize → Story →
Edit → Export. Navigation remains freely accessible, with progress and recovery
guidance rather than a locked wizard.

## Baseline and scope

PR #1 was merged at `10caced98a22b79116f2ec63a965ed9e25c9b272` after fixes for
directory rescans, accepted-format previews, stale/dependent Fit suggestions and
large-library media status. Its candidate `729f33083076282e4247c53ffec91b06dd5593c2`
passed both CI runs 37387623001 and 37387618376. The merged main passed 37387995045.
Real Resolve application QA remains unverified; parser fixtures are separate
evidence. This round starts on `codex/global-product-i18n` from that merged main.

Keep the current application, composition, persistence, render and interchange
boundaries. Reuse the mounted timeline and its autosave/history/recovery contract.
Do not add remote services, AI features, new NLE formats or a professional NLE UI.

## Product and visual decisions

- An editorial media workspace: dark neutral surfaces, warm restrained accent,
  contact-sheet media, clear story-beat hierarchy and an always-readable duration
  budget. Avoid metric dashboards and dense track-first controls.
- Welcome and Create Film hide storage details under Advanced. Actual file/folder
  imports and MP4 output connect the full flow; controls never promise an absent
  feature.
- Library, Story, Edit and Export are stable internal IDs with translated labels.
  Inspector details expose technical evidence only when useful.
- Three production UI languages and a development pseudo locale share semantic
  catalogs. Locally stored UI preferences do not mutate project content.
- Film content has a persisted locale and explicit template/user text provenance.
  Legacy text is preserved; only template-owned known keys change on an explicit
  film-language operation.
- Structured application errors keep stable codes and parameters alongside raw
  diagnostics. Localized primary messages guide recovery; details remain available.
- Theme, focus, typography, CJK font fallbacks, spacing and motion use shared
  tokens. Desktop widths from 1024 upward remain usable; long titles wrap without
  displacing durations.

## Verification boundary

Verify schema/persistence, catalogs and parameters, runtime language switching,
user-authored text preservation, real import/render/export, keyboard editing,
offline recovery and large-text layouts. Use the official OTIO parser and retain
the real Resolve manual gate. Browser screenshots and layout assertions support
visual QA; they do not certify every OS, camera or NLE version.
