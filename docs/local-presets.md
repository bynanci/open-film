# Local data-only presets

Local presets add Film Looks, title styles and authored Story pacing through a
small JSON document. Open **Settings → Local presets**, choose a local JSON file,
review its recipes, author, provenance and declared license, then acknowledge
the license before installation. Installation does not change an open film.

Select an installed entry and a saved target, review the proposed change, then
accept it. A Film Look can target the film, one beat or one visual clip. A title
style targets an existing titled clip and preserves its text. Both use the
ordinary editor history and support Undo/Redo. Saved local looks remain visible
in their existing controls after the installed package is removed.

A Story entry requires an explicit mapping of every recipe beat to the authored
source beats in order. Review uses the existing StoryPlan proposal. Acceptance
creates a new rough cut, preserving the source film, assigned media, selections,
constraints and duration bounds. Unsupported mappings or protected sources fail
with a visible error. No LLM, provider or network consent is involved.

## Packages and compatibility

The first format is one UTF-8 JSON document, at most **256 KiB**, with no ZIP,
assets, font files, executable entry point, HTML, URL or filesystem path.
Unknown fields and unsupported versions are rejected. Duplicate JSON keys,
non-finite numbers, invalid Unicode, unsafe property descriptors, links and
oversized or deeply nested input are rejected at their applicable boundaries.

The envelope is `format: "openfilm-presets"`, `schemaVersion: 1`, an ASCII
package ID, stable three-part numeric version, name, declared license,
provenance and 1–32 entries. IDs reserve the `openfilm` and `builtin` namespaces.
A package version is immutable: identical content can be installed again;
different content using the same ID and version is a conflict. Different
versions can coexist. The registry holds at most 32 packages and 256 entries.

Supported license declarations are Apache-2.0, MIT, BSD-2-Clause, BSD-3-Clause,
CC0-1.0 and CC-BY-4.0, with copyright and notice. Provenance records the author,
an original/adapted designation and a plain-text source description. Adaptations
also require a modification notice. These are publisher declarations; review
does not establish ownership or license authenticity.

Each entry contains `kind`, `id`, `name` and `recipe`:

| Kind        | Recipe owner                                                       | Application                                                             |
| ----------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `film-look` | Version 1, `encoded-sdr-rgb`, 20-value matrix and default strength | Existing film → beat → clip resolver; local saved looks use FilmLook v2 |
| `title`     | Existing `TitleStyle` and `validateTitleStyle`                     | Existing measured title preview and native renderer                     |
| `story`     | Version 1, locale text, bounded durations and 1–12 weighted beats  | Existing authored StoryPlan review and new rough-cut transaction        |

Film Look coefficients preserve the alpha row and use the same SVG/FFmpeg
matrix after tone mapping. Primary color correction remains a separate owner.
Title recipes use installed font families, with the existing fallback and
missing-font evidence. Story text supports `en-US`, `zh-TW` and `ja-JP`; missing
translations fall back to the recipe's declared default locale. Subsequent
localization changes template-owned title/intent text and preserves user text.

For example, this complete synthetic package declares one modest warm look:

```json
{
  "format": "openfilm-presets",
  "schemaVersion": 1,
  "id": "example.studio",
  "name": "Warm memories",
  "version": "1.0.0",
  "license": {
    "spdxId": "CC0-1.0",
    "copyright": "2026 OpenFilm contributors",
    "notice": "Original synthetic example dedicated to the public domain."
  },
  "provenance": {
    "author": "OpenFilm contributors",
    "origin": "original",
    "source": "Synthetic numeric example"
  },
  "entries": [
    {
      "kind": "film-look",
      "id": "warm",
      "name": "Warm",
      "recipe": {
        "version": 1,
        "domain": "encoded-sdr-rgb",
        "matrix": [
          1.05, 0.01, 0, 0.02, 0, 0, 1, 0, 0.01, 0, 0, 0, 0.95, 0.01, 0, 0, 0,
          0, 1, 0
        ],
        "defaultStrength": 0.8
      }
    }
  ]
}
```

## Saved-film portability

An accepted entry embeds its complete immutable recipe, license, provenance,
canonical ID and hashes in the saved film. The canonical ID has the form
`local:example.studio@1.0.0/film-look/warm`. Project open, render, Named Version
restore and Collect Media do not need the installed registry or original
package. Removing a package changes the list of available presets; already
accepted films keep their snapshots and their appearance.

Application and renderer boundaries recompute recipe and snapshot SHA-256
values from canonical data. Package content is hashed at review/install;
application checks the selected installed package against that hash. Hashes
detect changed content and bind reviews; they do not prove who authored it.
Legacy films without these optional fields retain their existing behavior.
Unknown nested recipe versions fail closed instead of producing an altered
picture. JSON/OTIO include snapshot metadata; editable NLE effects remain subject
to the existing metadata-only disclosure and baked handoff workflow.

## Review, retry and recovery

Every installation or application review binds the exact package, registry and
saved film revisions. If any changes, obtain a fresh review. Reuse the same
application request ID and exact body after an uncertain response: a durable
receipt acknowledges the accepted action without applying it again, including
after reopen, uninstall or Undo. The last 200 application receipts are retained.
A changed body with the same ID is a conflict.

Registry writes use an owned lock and atomic replacement in the configured
user-data directory. A cancelled operation before publication preserves the
accepted state; publication is the commit point. Alive or unverifiable owners
are preserved. The registry rejects symlinks, hard-linked owned files and
replaced directory identities. Package input never selects an output path.

A missing registry starts empty. A corrupt registry reports a local preset
error while existing films remain usable. Settings offers a review of a valid
previous backup when one exists. Explicit recovery checks the reviewed primary
and backup identities, restores that backup and retains one bounded corrupt
copy. If that recovery copy already exists, archive/remove it manually before
another recovery. Unknown future registry versions are never downgraded.

## CLI and HTTP

CLI commands use the same application services. Run from a project with the
ordinary `--project` option for application review/accept:

```sh
openfilm presets list
openfilm presets review --file warm.json
openfilm presets install --file warm.json --package-sha <packageSha256> --base-revision <registryRevision> --review-sha <reviewSha256> --accept-license
openfilm presets apply review --project Film.openfilm --request request.json
openfilm presets apply accept --project Film.openfilm --request request.json --review-sha <reviewSha256> --request-id <uniqueRequestId>
openfilm presets remove --package-id example.studio --package-version 1.0.0 --package-sha <packageSha256> --base-revision <registryRevision>
openfilm presets recovery review
openfilm presets recovery accept --file recovery-review.json --accept-recovery
```

`request.json` contains `projectId`, selection (`canonicalId`, `packageSha256`,
`registryRevision`), `baseRevision` and a typed `target`. Film Look targets use
`kind: "film-look"`, `compositionId`, `scope: "film" | "beat" | "clip"`, the
applicable beat/clip ID, and optional strength. Title targets use `kind: "title"`,
`compositionId` and `clipId`. Story targets use `kind: "story"`, `storyId`, explicit
`bindings` and the existing target/max-duration and transition options.

HTTP exposes `GET /api/presets`; global POST routes under
`/api/presets/import/review`, `/import/accept`, `/remove`, `/recovery/review` and
`/recovery/accept`; and project POST routes `/api/presets/apply/review` and
`/apply/accept`. HTTP accepts document content, never a filesystem import path.
Existing local Host/Origin, native session and mutation-queue protections apply.

See [validation](validation-local-presets.md) for executed security, browser,
render and relocation evidence and remaining integration gates.

## User pins

Reviewed preset acceptance is an automatic operation. A Film Look or title
preset that changes a pinned clip, or changes its inherited effective Look,
requires explicitly releasing that user pin first. Review and acceptance retain
existing source/clip locks, saved-revision checks and immutable preset provenance.
Exact accepted-request retries return the saved acknowledgement and current cut;
they do not overwrite a later manual pin. Ordinary direct inspector edits to a
named clip remain available under the existing locks.
