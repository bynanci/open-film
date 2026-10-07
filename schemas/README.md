# OpenFilm public formats

`openfilm-project-1.0.0.schema.json` defines the project manifest and reusable
media, story, composition, event, duplicate-group, and job definitions.
`media-asset-1.0.0.schema.json` references its media definition.
`plugin-manifest-1.schema.json` defines plugin API version `1`.
Schema `$id` values are stable identifiers; validators should resolve the
accompanying files locally and do not need network access.

All durations, source trim positions, and timeline positions use seconds.
Frame rates are frames per second. Clip visual x/y coordinates are composition-
frame pixels from frame center (+x right, +y down); source pixels are contain-fit
before scale and clockwise rotation. Geographic coordinates use WGS84 degrees,
and event region radii use kilometers. Confidence and job progress are fractions from
zero to one; user ratings range from zero to five. Timestamps include an explicit
timezone. Namespace plugin metadata keys to avoid collisions.

Clip `locked` is an optional additive 1.0.0 field. Existing projects without it
remain valid and no data conversion is needed. The lock protects clip identity,
source selection, duration and effects; preceding edits may ripple its timeline
position. Unlock explicitly before editing or removing a locked clip. The loader
preserves this field through save/reopen and rejects non-boolean values.

Call `validateProject` when loading a manifest. It checks semantic duration
bounds, unique IDs, calendar timestamps, story references, and beat references in
addition to the structural schema. Supply `{ assetIds: catalogIds }` to check
candidate, selection, constraint, and clip references against a catalog. Project
manifests do not embed original media or duplicate the catalog.

`validateMediaAsset`, `validateStory`, `validateComposition`, and `validateJob`
are portable runtime validators. Successful validation returns independent,
JSON-compatible data; it never writes or changes the original object.

The migration entry point is `migrateProject`. The documented `0.1.0` draft has
the same fields and units as `1.0.0` but allows omitted project settings.
Migrating it sets the schema version to `1.0.0` and supplies omitted settings as
1920 by 1080 at 30 fps. Existing settings and all nested fields must still pass
validation. Version `1.0.0` is validated and copied without conversion.
Unversioned, malformed, future, and other undocumented versions are rejected;
migration does not infer units, field names, or missing content.

Supported story constraints are `must-include`, `must-exclude`, and `asset-order`
with unique `assetIds`, plus `chronological` with optional `enabled`. Solvers
report infeasible requirements instead of silently dropping required assets.

AI interfaces declare `execution: local | remote`, their endpoint, and the data
classes they may receive. `ProviderRegistry` has no default remote provider.
Registration does not enable a remote provider: callers must supply scoped,
timestamped `RemoteProviderConsent` through `grantConsent` first. Invocation
checks consent, declared payload classes, and unchanged provider destination;
revocation or replacing a provider requires a new grant. A plugin is executable
code and should be trusted by its host; consent enforcement is a host contract,
not a sandbox for arbitrary plugin code.
