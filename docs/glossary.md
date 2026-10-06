# Glossary

A glossary remembers preferred names and terms without changing text silently.
Open the Glossary panel in **Edit → Transcript**, add the recognized term and
replacement, and choose **Find matches**. Review each correction before accepting
it. Basic glossary editing and suggestions work offline without a language model.

## Scope and matching

Project terms travel with the `.openfilm` catalog. Global terms live in OpenFilm's
user data and are shared across projects. A project definition takes precedence
over a global definition for the same source. Disabled project terms can shadow
their global counterpart. Changing the interface or film language does not modify
glossary content.

Matching is exact, with an optional case-insensitive flag. There is no fuzzy
homophone guessing. English brand capitalization can use a case-insensitive
source while the replacement remains exactly as entered. CJK terms match literal
text. Matching runs on the original text once: one replacement does not trigger
another replacement cascade. Overlapping terms prefer the longer match and
project scope. Creating the same source twice in a scope updates its definition;
conflicting ID/source updates are rejected.

Case-insensitive matching uses the same Unicode simple-case equivalence as
transcript search/replace. For example, long-s and Greek final-sigma variants match
their corresponding letters. It does not normalize accents, apply locale-specific
Turkish rules or expand `ß` into `ss`. Match ranges retain original UTF-16 offsets,
including when emoji precede a term; UI language does not affect matching.

Editing and saving an existing term preserves its enabled/disabled state.
Enable or disable it explicitly with the checkbox; saving its preferred spelling
does not silently opt it back into reviews or transcription hints.

An empty replacement explicitly suggests removing the matched term. Desktop,
API and CLI preserve that literal empty value; saving it never changes a
transcript automatically. Accepting a resulting deletion remains undoable.

Remembering an inline correction belongs to its selected segment and current
text. Undo, revision restore, deletion, structural edits or selecting another
segment clear or invalidate the offer. Ordinary typing and autosave preserve the
current correction; a reverted correction cannot silently become a glossary rule.

Each scope is bounded to 1,000 entries. Source terms have at most 512 characters;
replacements have at most 4,096. Matching compiles term tries and processes
transcripts in bounded batches. These limits keep behavior predictable; they are
not a claim of unlimited archive-scale search performance.

## User-data storage

Global data is a versioned `global-glossary.json`, validated before use and written
with an atomic replacement and a validated backup. Corrupt primary data can be
recovered from the backup; unsupported future versions and invalid backups are
reported rather than overwritten. Opening a project does not create global files.

Writes and backup repair use an exclusive same-host process lock around the
complete read–modify–write operation. A competing Desktop, server or CLI process
receives `glossary.storageBusy` (HTTP 409); retry after the other write finishes.
Successful writes therefore do not silently discard another process's terms.
Verified dead owners can be recovered, while live, malformed or unverified lock
owners are retained and reported as busy. The lock requires filesystem hard-link
support and is not a distributed storage protocol.

The trusted runtime path comes from an explicit application/server option, then
`OPENFILM_USER_DATA_DIR`, then the platform user-data location:

| OS      | Default                                                |
| ------- | ------------------------------------------------------ |
| Windows | `%APPDATA%/OpenFilm`                                   |
| macOS   | `~/Library/Application Support/OpenFilm`               |
| Linux   | `$XDG_DATA_HOME/openfilm` or `~/.local/share/openfilm` |

HTTP requests cannot change this path. A project's portable files do not contain
global terms, remote credentials or provider consent. Exporting global definitions
into a project is not automatic.

CLI examples:

```bash
pnpm cli glossary list --project /path/film.openfilm --scope effective
pnpm cli glossary add --project /path/film.openfilm --scope project --source "十河田" --replacement "十和田"
pnpm cli glossary update --project /path/film.openfilm --scope project --id term-id --disable
pnpm cli glossary delete --project /path/film.openfilm --scope project --id term-id
```

Use `--scope global` for user-owned terms and `--user-data-dir` for a trusted
headless runtime location. Omit case flags to preserve an existing term or use
the case-sensitive default for a new term. `--case-sensitive` and
`--case-insensitive` explicitly change either mode and are mutually exclusive.
API clients use `GET /api/glossary?scope=...`,
`POST /api/glossary` for add/update and `DELETE /api/glossary/:id?scope=...`.

## Before transcription

Enabled effective terms may be supplied as optional `promptHints` through the
existing `TranscriptionProvider` port. A provider advertises
`supportsPromptHints`; unsupported providers receive no hints. The application
uses up to 50 unique nonblank preferred terms, each at most 200 characters and
2,000 characters total. Longer glossary replacements remain valid for suggestions
but are omitted from this compact hint list. Replacements containing control
characters, including valid multiline/tabbed glossary content, are also omitted
from provider hints. Their saved text and review suggestions remain unchanged.

Whisper adapts these hints to its initial prompt. Hints are assistance, not a
recognition guarantee or post-processing replacement. Original recognition remains
available as a provider revision. The interface, film and transcription languages
remain three independent settings.

For remote transcription, nonempty hints also require disclosure and consent for
`text`. Consent to send audio/metadata alone cannot expose private project/global
terminology. The registry blocks the call before any hint text leaves the app.
